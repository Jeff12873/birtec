// Rapports : création d'un .rptdesign à partir d'une description, aperçu, export, téléchargement.
//
// Les rapports sont rangés dans le dossier de travail (rapports/), avec leur description à côté
// (<nom>.birtec.json), qui servira à les modifier plus tard.

import fs from 'node:fs'
import path from 'node:path'
import { ErreurHttp, envoyerOctets } from 'ktec/http.js'
import { chemins, dossierTravail, reglagesPoste, journal } from 'ktec/installation.js'
import { rendreRapport, verifierRapport, etatConnexion, executerRequete } from 'ktec/mysql.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { obtenirSchema, tablesUtiles, decrireTables } from '../base/schema.js'
import { dossierRessources, lireInfo, lireFichier } from 'ktec/ktec.js'
import { verifierSQL } from '../base/verification.js'
import { genererRptdesign, verifierDescription, normaliserDescription, BLOCS_DONNEES, THEMES } from './generateur.js'

export const FORMATS = {
  pdf: { libelle: 'PDF', type: 'application/pdf' },
  xlsx: { libelle: 'Excel (.xlsx)', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  docx: { libelle: 'Word (.docx)', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  html: { libelle: 'Page web (.html)', type: 'text/html' },
  odt: { libelle: 'LibreOffice Writer (.odt)', type: 'application/vnd.oasis.opendocument.text' },
  ods: { libelle: 'LibreOffice Calc (.ods)', type: 'application/vnd.oasis.opendocument.spreadsheet' },
  pptx: { libelle: 'PowerPoint (.pptx)', type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
}

const ESSAIS_DE_CORRECTION = 2

export function routes(r) {
  r.get('/api/rapports', () => {
    const dossier = path.join(dossierTravail(), 'rapports')
    return fs
      .readdirSync(dossier)
      .filter((f) => f.endsWith('.rptdesign'))
      .map((f) => {
        const xml = fs.readFileSync(path.join(dossier, f), 'utf8')
        return { nom: f.replace(/\.rptdesign$/, ''), titre: lireTitre(xml) || f, modifie: fs.statSync(path.join(dossier, f)).mtime.toISOString() }
      })
      .sort((a, b) => b.modifie.localeCompare(a.modifie))
  })

  r.get('/api/rapports/formats', () => FORMATS)

  r.get('/api/rapports/:nom', (ctx) => {
    const fichier = fichierRapport(ctx.params.nom)
    const xml = fs.readFileSync(fichier, 'utf8')
    const description = lireJson(fichier.replace(/\.rptdesign$/, '.birtec.json'))
    // Les paramètres à choisir dans une liste (ligne, équipement…) : leurs valeurs sont lues à la demande.
    const parametres = lireParametres(xml).map((p) => {
      const d = description?.parametres?.find((q) => q.nom === p.nom)
      return { ...p, liste: Boolean(d?.liste?.requete), optionnel: Boolean(d?.optionnel) }
    })
    return { nom: ctx.params.nom, titre: lireTitre(xml), parametres, description }
  })

  // Les valeurs proposées pour un paramètre « à choisir dans une liste ».
  r.get('/api/rapports/:nom/parametres/:parametre', async (ctx) => {
    const description = lireJson(fichierRapport(ctx.params.nom).replace(/\.rptdesign$/, '.birtec.json'))
    const p = description?.parametres?.find((q) => q.nom === ctx.params.parametre)
    if (!p?.liste?.requete) throw new ErreurHttp(404, 'Ce paramètre n’a pas de liste de valeurs.')
    const resultat = await executerRequete(p.liste.requete, 1000)
    return resultat.lignes.map((l) => l[0]).filter((v) => v !== null && v !== '')
  })

  // POST /api/rapports/generer { description, nom? }
  // Construit le rapport, le vérifie, le fait tourner ; en cas d'erreur, l'IA corrige la description (2 essais).
  r.post('/api/rapports/generer', async (ctx) => {
    const { description, nom } = await ctx.json()
    return genererRapport(description, nom)
  })

  r.get('/api/rapports-themes', () => Object.keys(THEMES))

  // Refait un rapport créé par BiRTEC avec un autre thème, une image ou sans logo (sans passer par l'IA).
  r.post('/api/rapports/:nom/refaire', async (ctx) => {
    const changements = await ctx.json()
    const fichier = fichierRapport(ctx.params.nom)
    const fichierDescription = fichier.replace(/\.rptdesign$/, '.birtec.json')
    const description = lireJson(fichierDescription)
    if (!description) throw new ErreurHttp(409, 'Ce rapport n’a pas été créé par BiRTEC : sa description est introuvable.')
    for (const cle of ['theme', 'image', 'logo', 'description', 'positionDescription']) if (cle in changements) description[cle] = changements[cle]
    const { mysql } = reglagesPoste()
    const connexion = { url: `jdbc:mysql://${mysql.serveur}:${mysql.port || 3306}/${mysql.base}`, utilisateur: mysql.utilisateur, charte: lireInfo('charte') }
    const resultat = await essayer(description, fichier, connexion)
    if (resultat.erreurs.length) throw new ErreurHttp(400, resultat.erreurs.join(' ; '))
    fs.writeFileSync(fichierDescription, JSON.stringify(description, null, 2) + '\n')
    return { avertissements: resultat.avertissements }
  })

  // Aperçu HTML (dans un cadre de la page) avec les paramètres choisis.
  r.post('/api/rapports/:nom/apercu', async (ctx) => {
    const { parametres = {} } = await ctx.json()
    const sortie = path.join(chemins.cache, 'apercus', `${ctx.params.nom}.html`)
    fs.mkdirSync(path.dirname(sortie), { recursive: true })
    const fichier = fichierRapport(ctx.params.nom)
    const resultat = await rendreHtml(fichier, sortie, ctx.params.nom, parametres)
    // Nombre de lignes de la requête avec ces paramètres (rapports créés par BiRTEC seulement).
    const description = lireJson(fichier.replace(/\.rptdesign$/, '.birtec.json'))
    const lignes = description && unSeulTableau(description) ? await compterLignes(description, parametres).catch(() => null) : null
    return { erreurs: resultat.erreurs, lignes, adresse: `/api/rapports/${encodeURIComponent(ctx.params.nom)}/apercu.html?t=${Date.now()}` }
  })

  // Les images d'un aperçu (graphiques), rangées à côté de la page.
  r.get('/api/rapports/:nom/images/:fichier', (ctx) => {
    const fichier = path.join(chemins.cache, 'apercus', `${path.basename(ctx.params.nom)}_images`, path.basename(ctx.params.fichier))
    if (!fs.existsSync(fichier)) throw new ErreurHttp(404, 'Image introuvable')
    const type = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif' }[path.extname(fichier).toLowerCase()] || 'application/octet-stream'
    envoyerOctets(ctx.res, fs.readFileSync(fichier), { type })
  })

  r.get('/api/rapports/:nom/apercu.html', (ctx) => {
    const fichier = path.join(chemins.cache, 'apercus', `${path.basename(ctx.params.nom)}.html`)
    if (!fs.existsSync(fichier)) throw new ErreurHttp(404, 'Aperçu introuvable')
    envoyerOctets(ctx.res, fs.readFileSync(fichier), { type: 'text/html; charset=utf-8' })
  })

  // Export au format choisi : le fichier est envoyé au navigateur.
  r.post('/api/rapports/:nom/export', async (ctx) => {
    const { format, parametres = {} } = await ctx.json()
    if (!FORMATS[format]) throw new ErreurHttp(400, 'Format inconnu')
    const sortie = path.join(chemins.cache, 'exports', `${ctx.params.nom}.${format}`)
    fs.mkdirSync(path.dirname(sortie), { recursive: true })
    fs.rmSync(sortie, { force: true })
    const resultat = await rendreRapport(fichierRapport(ctx.params.nom), format, sortie, parametres, dossierRessources(chemins.cache))
    if (!fs.existsSync(sortie)) throw new ErreurHttp(500, `Export impossible : ${resultat.erreurs.join(' ; ') || 'erreur inconnue'}`)
    envoyerOctets(ctx.res, fs.readFileSync(sortie), { type: FORMATS[format].type, nom: `${ctx.params.nom}.${format}`, telecharger: true })
  })

  r.get('/api/rapports/:nom/fichier', (ctx) => {
    envoyerOctets(ctx.res, fs.readFileSync(fichierRapport(ctx.params.nom)), { type: 'application/xml', nom: `${ctx.params.nom}.rptdesign`, telecharger: true })
  })

  r.delete('/api/rapports/:nom', (ctx) => {
    const fichier = fichierRapport(ctx.params.nom)
    fs.rmSync(fichier, { force: true })
    fs.rmSync(fichier.replace(/\.rptdesign$/, '.birtec.json'), { force: true })
  })
}

// ---------------------------------------------------------------- génération et correction

// Fabrique le rapport (et sa description à côté), avec correction par l'IA si besoin.
export async function genererRapport(description, nom) {
  const { mysql } = reglagesPoste()
  const connexion = { url: `jdbc:mysql://${mysql.serveur}:${mysql.port || 3306}/${mysql.base}`, utilisateur: mysql.utilisateur, charte: lireInfo('charte') }
  nom = nomDeFichier(nom || description?.titre || 'rapport')
  const fichier = path.join(dossierTravail(), 'rapports', `${nom}.rptdesign`)
  const corrections = []
  let avertissements = []
  for (let essai = 0; ; essai++) {
    const resultat = await essayer(description, fichier, connexion)
    avertissements = resultat.avertissements
    if (!resultat.erreurs.length) break
    if (essai >= ESSAIS_DE_CORRECTION || !iaInstallee() || description.constructeur || Array.isArray(description.blocs)) {
      // Un rapport du constructeur n'est pas confié à l'IA : son SQL vient de BiRTEC (ou de l'utilisateur).
      return { nom, ok: false, erreurs: resultat.erreurs, corrections }
    }
    journal(`Rapport « ${nom} » : correction par l'IA (${resultat.erreurs[0]})`)
    description = await corrigerParIA(description, resultat.erreurs)
    corrections.push(resultat.erreurs[0])
  }
  fs.writeFileSync(fichier.replace(/\.rptdesign$/, '.birtec.json'), JSON.stringify(description, null, 2) + '\n')
  journal(`Rapport créé : ${fichier}`)
  return { nom, ok: true, erreurs: [], avertissements, corrections }
}

// Génère et vérifie le rapport. Renvoie { erreurs, avertissements } (pas d'erreur = rapport bon).
async function essayer(description, fichier, connexion) {
  const erreursDescription = verifierDescription(description)
  if (erreursDescription.length) return { erreurs: erreursDescription, avertissements: [] }
  // Tables et colonnes inexistantes : signalées avant tout essai, avec les tables qui ont la colonne.
  const schema = await obtenirSchema()
  const d = normaliserDescription(description)
  const inconnues = [
    ...d.blocs.filter((b) => BLOCS_DONNEES.includes(b.type)).flatMap((b, i) => verifierSQL(b.requete, schema).map((e) => (d.blocs.length > 1 ? `Bloc ${d.blocs.indexOf(b) + 1} : ${e}` : e))),
    ...d.parametres.filter((p) => p.liste?.requete).flatMap((p) => verifierSQL(p.liste.requete, schema).map((e) => `Liste « ${p.libelle || p.nom} » : ${e}`)),
  ]
  if (inconnues.length) return { erreurs: inconnues, avertissements: [] }
  fs.writeFileSync(fichier, genererRptdesign(description, { ...connexion, image: imageDu(description) }))
  const verification = await verifierRapport(fichier, dossierRessources(chemins.cache))
  // Une ressource absente (feuille de style du serveur BIRT…) n'empêche pas le rapport de fonctionner.
  const bloquantes = verification.erreurs.filter((e) => !/style sheet .* is not found|The style ".*" .* is not found|library .* not found/i.test(e))
  if (bloquantes.length) return { erreurs: bloquantes, avertissements: [] }
  if (!etatConnexion().ouverte) return { erreurs: [], avertissements: ['Connexion MySQL fermée : le rapport n’a pas été essayé sur la base.'] }

  // On le fait tourner avec les valeurs par défaut des paramètres : la requête est ainsi vraiment essayée.
  const parametres = Object.fromEntries((description.parametres || []).map((p) => [p.nom, p.defaut ?? '']))
  const sortie = path.join(chemins.cache, 'apercus', `${path.basename(fichier, '.rptdesign')}.html`)
  fs.mkdirSync(path.dirname(sortie), { recursive: true })
  try {
    const resultat = await rendreRapport(fichier, 'html', sortie, parametres, dossierRessources(chemins.cache))
    const erreurs = resultat.erreurs.filter((e) => !e.startsWith('Avertissement'))
    if (erreurs.length) return { erreurs, avertissements: [] }
  } catch (erreur) {
    return { erreurs: [erreur.message], avertissements: [] }
  }
  // Un rapport vide avec les valeurs par défaut cache souvent une erreur de filtre (mauvaise table, code inexistant…).
  const lignes = unSeulTableau(description) ? await compterLignes(description, parametres).catch(() => null) : null
  const avertissements = lignes === 0
    ? [`Le rapport ne contient aucune ligne avec les valeurs par défaut des paramètres${(description.parametres || []).length ? ` (${description.parametres.map((p) => `${p.libelle || p.nom} = ${p.defaut ?? ''}`).join(', ')})` : ''} : vérifiez les filtres de la requête.`]
    : []
  return { erreurs: [], avertissements, lignes }
}

// L'image choisie pour le haut du rapport (rangée dans le .ktec, catégorie « images »).
function imageDu(description) {
  if (!description.image) return null
  const octets = lireFichier('images', description.image)
  if (!octets) return null
  const ext = path.extname(description.image).toLowerCase()
  const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.bmp': 'image/bmp' }[ext] || 'image/png'
  return { nom: path.basename(description.image), type, octets }
}

// Rend un rapport en HTML pour l'aperçu, avec ses images (graphiques) servies par KTEC.
function rendreHtml(fichier, sortie, nom, parametres) {
  fs.rmSync(sortie.replace(/\.html$/, '_images'), { recursive: true, force: true })
  return rendreRapport(fichier, 'html', sortie, parametres, dossierRessources(chemins.cache), `/api/birtec/rapports/${encodeURIComponent(nom)}/images`)
}

// Aperçu d'un rapport pas encore enregistré (éditeur de rapport) : fabriqué à part, dans le cache.
export async function apercuBrouillon(description, valeurs = {}) {
  const nom = '_brouillon'
  const dossier = path.join(chemins.cache, 'apercus')
  fs.mkdirSync(dossier, { recursive: true })
  const fichier = path.join(dossier, `${nom}.rptdesign`)
  const { mysql } = reglagesPoste()
  const connexion = { url: `jdbc:mysql://${mysql.serveur}:${mysql.port || 3306}/${mysql.base}`, utilisateur: mysql.utilisateur, charte: lireInfo('charte') }
  const erreursDescription = verifierDescription(description)
  if (erreursDescription.length) return { erreurs: erreursDescription }
  fs.writeFileSync(fichier, genererRptdesign(description, { ...connexion, image: imageDu(description) }))
  const parametres = { ...Object.fromEntries((description.parametres || []).map((p) => [p.nom, p.defaut ?? ''])), ...valeurs }
  const resultat = await rendreHtml(fichier, path.join(dossier, `${nom}.html`), nom, parametres)
  return { erreurs: resultat.erreurs.filter((e) => !e.startsWith('Avertissement')), adresse: `/api/rapports/${nom}/apercu.html?t=${Date.now()}` }
}

// La requête d'un bloc (ou d'une ancienne description), les « ? » remplacés par les valeurs des paramètres
// (pour l'essayer sur la base). source = { requete, liaisons?, parametres }.
export function sqlAvecValeurs(source, valeurs = {}) {
  const description = source.requete === undefined && source.blocs ? premierBloc(source) : source
  const parametres = description.parametres || []
  const liaisons = description.liaisons || parametres.map((p) => p.nom)
  let i = 0
  const morceaux = String(description.requete).trim().replace(/;+\s*$/, '').split(/('(?:[^'\\]|\\.|'')*')/)
  return morceaux.map((m, n) => (n % 2 ? m : m.replace(/\?/g, () => {
    const nom = liaisons[i++]
    const p = parametres.find((q) => q.nom === nom) || {}
    const v = valeurs[p.nom] ?? p.defaut ?? ''
    return ['entier', 'decimal'].includes(p.type) && v !== '' && !isNaN(Number(v)) ? String(Number(v)) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`
  }))).join('')
}

// Le nombre de lignes n'a de sens que pour un rapport fait d'un seul tableau (sinon : null).
function unSeulTableau(description) {
  const d = normaliserDescription(description)
  const donnees = d.blocs.filter((b) => BLOCS_DONNEES.includes(b.type))
  return donnees.length === 1 && donnees[0].type === 'tableau'
}

// Le premier bloc de données d'un rapport en blocs, avec les paramètres du rapport.
function premierBloc(description) {
  const d = normaliserDescription(description)
  const b = d.blocs.find((x) => BLOCS_DONNEES.includes(x.type))
  return b ? { requete: b.requete, liaisons: b.liaisons || [], parametres: d.parametres } : { requete: 'SELECT 1', liaisons: [], parametres: [] }
}

// Nombre de lignes de la requête du rapport (son premier bloc de données) avec ces valeurs de paramètres.
export async function compterLignes(description, valeurs) {
  const r = await executerRequete(`SELECT COUNT(*) AS n FROM (${sqlAvecValeurs(description, valeurs)}) AS birtec_compte`, 1)
  return Number(r.lignes[0][0])
}

async function corrigerParIA(description, erreurs) {
  let structure = ''
  if (etatConnexion().ouverte) {
    const schema = await obtenirSchema()
    structure = `STRUCTURE DE LA BASE (tables utiles) :\n${decrireTables(tablesUtiles(schema, `${description.titre} ${description.requete}`))}\n\n`
  }
  const reponse = await discuter(
    [
      {
        role: 'system',
        content: `Tu corriges la description JSON d'un rapport BIRT généré par BiRTEC. Réponds uniquement par le JSON corrigé, sans texte autour.
Champs : titre, sousTitre, orientation (portrait|paysage), requete (SQL MySQL, lecture seule, « ? » pour chaque paramètre), parametres [{nom, libelle, type: texte|entier|decimal|date|dateheure, defaut}], liaisons (noms des paramètres pour chaque « ? », dans l'ordre), colonnes [{champ (alias exact de la requête), libelle, format: texte|entier|decimal|pourcentage|date|dateheure, total: somme|moyenne|nombre|min|max}], groupes [{champ, libelle, sousTotaux}].`,
      },
      { role: 'user', content: `${structure}DESCRIPTION :\n${JSON.stringify(description, null, 2)}\n\nERREUR OBTENUE :\n${erreurs.join('\n')}` },
    ],
    { temperature: 0.1, maxMots: 2000, reflechir: true },
  )
  const corrigee = extraireJson(reponse)
  if (!corrigee) return description
  // L'IA ne corrige que la requête et les colonnes : l'aspect choisi (thème, image, logo, description) est gardé.
  const aspect = Object.fromEntries(['theme', 'image', 'logo', 'description', 'positionDescription'].filter((c) => c in description).map((c) => [c, description[c]]))
  return { ...corrigee, ...aspect }
}

// Le premier objet JSON trouvé dans un texte (l'IA l'entoure parfois de ```json … ```).
export function extraireJson(texte) {
  const debut = texte.indexOf('{')
  const fin = texte.lastIndexOf('}')
  if (debut < 0 || fin < debut) return null
  try {
    return JSON.parse(texte.slice(debut, fin + 1))
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- lecture d'un .rptdesign

function lireTitre(xml) {
  return decoder(xml.match(/<text-property name="title">([^<]*)<\/text-property>/)?.[1] || '')
}

function lireParametres(xml) {
  // Les paramètres cachés (s, bdd… passés par la GMAO) ne sont pas proposés à la saisie.
  return [...xml.matchAll(/<scalar-parameter name="([^"]+)"[^>]*>([\s\S]*?)<\/scalar-parameter>/g)]
    .filter(([, , contenu]) => !/<property name="hidden">true</.test(contenu))
    .map(([, nom, contenu]) => ({
    nom,
    libelle: decoder(contenu.match(/<text-property name="promptText">([^<]*)</)?.[1] || nom),
    type: contenu.match(/<property name="dataType">([^<]*)</)?.[1] || 'string',
    defaut: decoder(contenu.match(/<simple-property-list name="defaultValue">\s*<value[^>]*>([^<]*)</)?.[1] || ''),
  }))
}

function decoder(texte) {
  return texte.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&amp;', '&')
}

// ---------------------------------------------------------------- outils

function fichierRapport(nom) {
  const fichier = path.join(dossierTravail(), 'rapports', `${path.basename(nom)}.rptdesign`)
  if (!fs.existsSync(fichier)) throw new ErreurHttp(404, 'Rapport introuvable')
  return fichier
}

// « OT curatifs par équipement » → « ot-curatifs-par-equipement »
function nomDeFichier(texte) {
  return (
    String(texte)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'rapport'
  )
}

function lireJson(fichier) {
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'))
  } catch {
    return null
  }
}
