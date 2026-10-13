// Rapports : création d'un .rptdesign à partir d'une description, aperçu, export, téléchargement.
//
// Les rapports sont rangés dans le dossier de travail (rapports/), avec leur description à côté
// (<nom>.birtec.json), qui servira à les modifier plus tard.

import fs from 'node:fs'
import path from 'node:path'
import { ErreurHttp, envoyerOctets } from '../../serveur/socle/http.js'
import { chemins, dossierTravail, reglagesPoste, journal } from '../../serveur/socle/installation.js'
import { rendreRapport, verifierRapport, etatConnexion } from '../../serveur/socle/mysql.js'
import { discuter, iaInstallee } from '../../serveur/socle/ia.js'
import { obtenirSchema, tablesUtiles, decrireTables } from '../base/schema.js'
import { dossierRessources, lireInfo } from '../../serveur/socle/birtec.js'
import { genererRptdesign, verifierDescription } from './generateur.js'

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
    return { nom: ctx.params.nom, titre: lireTitre(xml), parametres: lireParametres(xml), description }
  })

  // POST /api/rapports/generer { description, nom? }
  // Construit le rapport, le vérifie, le fait tourner ; en cas d'erreur, l'IA corrige la description (2 essais).
  r.post('/api/rapports/generer', async (ctx) => {
    let { description, nom } = await ctx.json()
    const { mysql } = reglagesPoste()
    const connexion = { url: `jdbc:mysql://${mysql.serveur}:${mysql.port || 3306}/${mysql.base}`, utilisateur: mysql.utilisateur, charte: lireInfo('charte') }
    nom = nomDeFichier(nom || description?.titre || 'rapport')
    const fichier = path.join(dossierTravail(), 'rapports', `${nom}.rptdesign`)
    const corrections = []

    for (let essai = 0; ; essai++) {
      const erreurs = await essayer(description, fichier, connexion)
      if (!erreurs.length) break
      if (essai >= ESSAIS_DE_CORRECTION || !iaInstallee()) {
        return { nom, ok: false, erreurs, corrections }
      }
      journal(`Rapport « ${nom} » : correction par l'IA (${erreurs[0]})`)
      description = await corrigerParIA(description, erreurs)
      corrections.push(erreurs[0])
    }
    fs.writeFileSync(fichier.replace(/\.rptdesign$/, '.birtec.json'), JSON.stringify(description, null, 2) + '\n')
    journal(`Rapport créé : ${fichier}`)
    return { nom, ok: true, erreurs: [], corrections }
  })

  // Aperçu HTML (dans un cadre de la page) avec les paramètres choisis.
  r.post('/api/rapports/:nom/apercu', async (ctx) => {
    const { parametres = {} } = await ctx.json()
    const sortie = path.join(chemins.cache, 'apercus', `${ctx.params.nom}.html`)
    fs.mkdirSync(path.dirname(sortie), { recursive: true })
    const resultat = await rendreRapport(fichierRapport(ctx.params.nom), 'html', sortie, parametres, dossierRessources(chemins.cache))
    return { erreurs: resultat.erreurs, adresse: `/api/rapports/${encodeURIComponent(ctx.params.nom)}/apercu.html?t=${Date.now()}` }
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

// Génère et vérifie le rapport. Renvoie la liste des erreurs (vide = rapport bon).
async function essayer(description, fichier, connexion) {
  const erreursDescription = verifierDescription(description)
  if (erreursDescription.length) return erreursDescription
  fs.writeFileSync(fichier, genererRptdesign(description, connexion))
  const verification = await verifierRapport(fichier, dossierRessources(chemins.cache))
  // Une ressource absente (feuille de style du serveur BIRT…) n'empêche pas le rapport de fonctionner.
  const bloquantes = verification.erreurs.filter((e) => !/style sheet .* is not found|The style ".*" .* is not found|library .* not found/i.test(e))
  if (bloquantes.length) return bloquantes
  // On le fait tourner avec les valeurs par défaut des paramètres : la requête est ainsi vraiment essayée.
  if (etatConnexion().ouverte) {
    const parametres = Object.fromEntries((description.parametres || []).map((p) => [p.nom, p.defaut ?? '']))
    const sortie = path.join(chemins.cache, 'apercus', `${path.basename(fichier, '.rptdesign')}.html`)
    fs.mkdirSync(path.dirname(sortie), { recursive: true })
    try {
      const resultat = await rendreRapport(fichier, 'html', sortie, parametres, dossierRessources(chemins.cache))
      return resultat.erreurs
    } catch (erreur) {
      return [erreur.message]
    }
  }
  return []
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
    { temperature: 0.1, maxMots: 2000 },
  )
  return extraireJson(reponse) || description
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
