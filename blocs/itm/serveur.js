// Indicateurs ITM : l'assistant écrit la définition d'un indicateur de la GMAO, BiRTEC en tire la
// requête indicateur et la requête liste, les contrôle (tables et colonnes existantes), les essaie sur
// MySQL, vérifie qu'elles concordent et fait corriger l'IA en cas d'écart. Les indicateurs créés sont
// gardés dans le fichier .birtec (historique). Le résultat reste du SQL, à coller dans la GMAO.

import { ErreurHttp } from '../../serveur/socle/http.js'
import { discuter, iaInstallee } from '../../serveur/socle/ia.js'
import { executerRequete, etatConnexion } from '../../serveur/socle/mysql.js'
import { journal } from '../../serveur/socle/installation.js'
import { lireInfo, ecrireInfo, listerIndicateurs, enregistrerIndicateur, supprimerIndicateur, listerNotes, listerRequetes } from '../../serveur/socle/birtec.js'
import { obtenirSchema, tablesUtiles, decrireTables, connaissancesUtiles, tablesDesConventions } from '../base/schema.js'
import { verifierSQL } from '../base/verification.js'
import { extraireJson } from '../rapports/serveur.js'
import { REGLAGES_VIDES, verifierDefinition, assembler, remplacerVariables, trouverFenetre, normaliser, deduireFenetres } from './indicateur.js'

const ESSAIS_DE_CORRECTION = 2
const LIGNES_MAX = 5000

// Fenêtres décrites dans le .birtec, complétées par celles déduites de la structure (tables en forme de fiche).
export async function reglagesITM() {
  const enregistres = { ...REGLAGES_VIDES, ...lireInfo('itm', {}) }
  const schema = await obtenirSchema()
  const connues = new Set(enregistres.fenetres.map((f) => f.table.toLowerCase()))
  const deduites = deduireFenetres(schema.tables).filter((f) => !connues.has(f.table.toLowerCase()))
  return { ...enregistres, fenetres: [...enregistres.fenetres, ...deduites] }
}

export function routes(r) {
  r.get('/api/itm/reglages', async () => {
    const reglages = await reglagesITM()
    return { ...reglages, fenetres: reglages.fenetres.filter((f) => !f.deduite), deduites: reglages.fenetres.filter((f) => f.deduite).length }
  })

  r.post('/api/itm/reglages', async (ctx) => {
    const reglages = await ctx.json()
    reglages.fenetres ||= []
    if (!Array.isArray(reglages.fenetres) || !Array.isArray(reglages.variables)) throw new ErreurHttp(400, 'Il faut deux listes : fenetres et variables.')
    for (const f of reglages.fenetres) if (!f.libelle || !f.table || !f.id || !f.code) throw new ErreurHttp(400, 'Chaque fenêtre a besoin de libelle, table, id et code.')
    ecrireInfo('itm', { fenetres: reglages.fenetres, variables: reglages.variables })
  })

  r.get('/api/itm/indicateurs', () => listerIndicateurs())

  r.post('/api/itm/indicateurs', async (ctx) => {
    const indicateur = await ctx.json()
    if (!indicateur.nom?.trim()) throw new ErreurHttp(400, 'L’indicateur doit avoir un nom.')
    return { id: enregistrerIndicateur(indicateur) }
  })

  r.delete('/api/itm/indicateurs/:id', (ctx) => supprimerIndicateur(Number(ctx.params.id)))

  // La valeur seule d'un indicateur (page d'accueil) : requête indicateur, variables remplacées.
  r.get('/api/itm/indicateurs/:id/valeur', async (ctx) => {
    const indicateur = listerIndicateurs().find((i) => i.id === Number(ctx.params.id))
    if (!indicateur) throw new ErreurHttp(404, 'Indicateur introuvable')
    if (!etatConnexion().ouverte) return { valeur: null }
    const { sql } = remplacerVariables(indicateur.requeteIndicateur || '', await reglagesITM())
    const r = await executerRequete(sql, 2)
    const colonne = r.colonnes.findIndex((c) => c.nom.toUpperCase() === 'VAL')
    return { valeur: r.lignes[0]?.[colonne < 0 ? 0 : colonne] ?? null }
  })

  // Assemble les deux requêtes à partir d'une définition (écrite ou retouchée à la main).
  r.post('/api/itm/assembler', async (ctx) => {
    const { definition } = await ctx.json()
    const reglages = await reglagesITM()
    const erreurs = verifierDefinition(definition, reglages)
    if (erreurs.length) return { erreurs }
    return { erreurs: [], definition: normaliser(definition, reglages), ...assembler(definition, reglages) }
  })

  // Essaie les deux requêtes (éventuellement retouchées à la main) sur la base.
  r.post('/api/itm/tester', async (ctx) => {
    const { requeteIndicateur, requeteListe } = await ctx.json()
    return tester(requeteIndicateur, requeteListe)
  })

  // POST /api/itm/creer { definition, demande } : depuis l'assistant. BiRTEC assemble, contrôle et essaie ;
  // en cas d'erreur, l'IA corrige la définition (2 fois au plus). Enregistré dans le .birtec si tout va bien
  // (ou si « forcer » est demandé).
  r.post('/api/itm/creer', async (ctx) => {
    const { definition: proposee, demande = '', forcer = false } = await ctx.json()
    const reglages = await reglagesITM()
    let definition = normaliser(proposee, reglages)
    let resultat = await essayer(definition, reglages)
    const corrections = []
    if (!forcer) {
      for (let essai = 0; resultat.erreurs.length && essai < ESSAIS_DE_CORRECTION && iaInstallee(); essai++) {
        journal(`Indicateur « ${definition.nom} » : correction par l'IA (${resultat.erreurs[0]})`)
        corrections.push(resultat.erreurs[0])
        const contexte = await contexteIA(`${demande} ${definition.nom} ${definition.explication || ''}`, definition.table, reglages)
        const corrigee = extraireJson(await discuter(
          [
            { role: 'system', content: consignes(reglages) },
            { role: 'user', content: `${contexte}\n\nDEMANDE : ${demande}\n\nDÉFINITION :\n${JSON.stringify(definition, null, 2)}\n\nERREURS OBTENUES :\n${resultat.erreurs.join('\n')}\n\nCorrige la définition. Réponds uniquement par le JSON corrigé.` },
          ],
          { temperature: 0.1, maxMots: 1500, reflechir: true },
        ))
        if (!corrigee) break
        definition = normaliser({ ...corrigee, nom: corrigee.nom || definition.nom }, reglages)
        resultat = await essayer(definition, reglages)
      }
    }
    let id = null
    if (!resultat.erreurs.length || forcer) {
      id = enregistrerIndicateur({ nom: definition.nom, fenetre: definition.fenetre, demande, definition, requeteIndicateur: resultat.requeteIndicateur, requeteListe: resultat.requeteListe, source: 'assistant' })
    }
    return { id, definition, corrections, ...resultat }
  })
}

// ---------------------------------------------------------------- essais

async function essayer(definition, reglages) {
  const erreurs = verifierDefinition(definition, reglages)
  if (erreurs.length) return { erreurs, avertissements: [] }
  const { requeteIndicateur, requeteListe, avertissements } = assembler(definition, reglages)
  // Tables et colonnes inexistantes : signalées avant tout essai, avec les tables qui ont la colonne.
  const inconnues = verifierSQL(requeteListe, await obtenirSchema())
  if (inconnues.length) return { requeteIndicateur, requeteListe, erreurs: inconnues, avertissements }
  const essai = etatConnexion().ouverte ? await tester(requeteIndicateur, requeteListe) : { erreurs: [], avertissements: ['Connexion MySQL fermée : requêtes non essayées.'] }
  return { requeteIndicateur, requeteListe, ...essai, avertissements: [...avertissements, ...essai.avertissements] }
}

// Les deux requêtes sur la base, variables remplacées par leurs valeurs d'essai.
// Vérifie : une seule valeur VAL, colonnes ID/CODE/DESI1/ACTIF, et le chiffre égal au nombre de lignes.
export async function tester(requeteIndicateur, requeteListe) {
  const reglages = await reglagesITM()
  const erreurs = []
  const avertissements = []
  const indicateur = remplacerVariables(requeteIndicateur || '', reglages)
  const liste = remplacerVariables(requeteListe || '', reglages)
  const restantes = [...new Set([...indicateur.restantes, ...liste.restantes])]
  if (restantes.length) avertissements.push(`Variables sans valeur d’essai (ajoutez-les aux réglages) : ${restantes.join(', ')}`)

  let valeur = null
  try {
    const r = await executerRequete(indicateur.sql, 5)
    const colonne = r.colonnes.findIndex((c) => c.nom.toUpperCase() === 'VAL')
    if (colonne < 0) erreurs.push('La requête indicateur doit rendre une colonne nommée VAL.')
    else if (r.lignes.length !== 1) erreurs.push(`La requête indicateur rend ${r.lignes.length} lignes au lieu d’une seule.`)
    else valeur = r.lignes[0][colonne]
  } catch (erreur) {
    erreurs.push(`Requête indicateur : ${erreur.message}`)
  }

  let resultatListe = null
  try {
    resultatListe = await executerRequete(liste.sql, LIGNES_MAX)
    const noms = resultatListe.colonnes.map((c) => c.nom.toUpperCase())
    for (const attendue of ['ID', 'CODE', 'DESI1', 'ACTIF']) if (!noms.includes(attendue)) erreurs.push(`La requête liste doit rendre une colonne ${attendue}.`)
    const iId = noms.indexOf('ID')
    if (iId >= 0) {
      const ids = new Set(resultatListe.lignes.map((l) => l[iId]))
      const lignes = resultatListe.lignes.length
      if (ids.size !== lignes) erreurs.push(`La liste affiche ${lignes - ids.size} fiche(s) en double (une même fiche sur plusieurs lignes) : ajoutez DISTINCT, ou retirez la jointure qui multiplie les lignes.`)
      if (valeur !== null && !resultatListe.tronque && Number(valeur) !== lignes) {
        erreurs.push(`L’indicateur vaut ${valeur} mais la liste affiche ${lignes} ligne(s) : les deux requêtes ne concordent pas.`)
      }
    }
  } catch (erreur) {
    erreurs.push(`Requête liste : ${erreur.message}`)
  }

  return {
    erreurs,
    avertissements,
    valeur,
    liste: resultatListe ? { colonnes: resultatListe.colonnes, lignes: resultatListe.lignes.slice(0, 50), total: resultatListe.lignes.length, tronque: resultatListe.tronque || resultatListe.lignes.length > 50, dureeMs: resultatListe.dureeMs } : null,
  }
}

// ---------------------------------------------------------------- IA

// Règles d'écriture d'une définition d'indicateur (aussi données à l'assistant).
export function reglesIndicateur(reglages, tablesUtiles = null) {
  const garder = tablesUtiles ? new Set(tablesUtiles.map((t) => t.toLowerCase())) : null
  const fenetres = reglages.fenetres
    .filter((f) => !garder || garder.has(f.table.toLowerCase()) || !f.deduite)
    .map((f) => `- table ${f.table} « ${f.libelle} » : identifiant ${f.table}.${f.id}, code ${f.table}.${f.code}${f.variableArbo ? `, filtre d'arborescence ${f.variableArbo}` : ''}`).join('\n')
  const variables = reglages.variables.map((v) => `- ${v.nom} : ${v.description || ''}`).join('\n')
  return `Un indicateur ITM = une requête qui compte des fiches d'une table (la fenêtre que la GMAO ouvrira), et une requête liste qui affiche ces fiches.
BiRTEC construit lui-même les deux requêtes à partir de cette définition JSON :
{"nom": "[Catégorie] - Nom court", "table": "table principale", "jointures": "LEFT JOIN … ON …\\nLEFT JOIN … ON …", "conditions": "…", "arborescence": true, "dateIndicateur": "table.COLONNE ou null", "tri": "DATE_INDICATEUR DESC", "explication": "une phrase"}

Règles :
- « nom » au format « [Catégorie] - Nom court » : catégorie d'un mot ou deux (Préventif, Dépannage, Magasin, Qualité saisie…), nom de quelques mots.
- « table » : la table des fiches comptées (une des tables listées plus bas). Ne la remets pas dans « jointures ». Préfixe toujours les colonnes par leur table, écrite comme dans la STRUCTURE.
- « jointures » : uniquement des JOIN / LEFT JOIN / INNER JOIN, sans FROM ni WHERE. Préfère LEFT JOIN.
- « conditions » : le contenu du WHERE, sans le mot WHERE et sans la variable d'arborescence (BiRTEC l'ajoute si « arborescence » est true). Pas de point-virgule, lecture seule.
- N'ajoute AUCUNE condition qui n'est pas demandée (pas de filtre de date si la demande n'en parle pas).
- Les variables de date s'écrivent sans apostrophes autour : FI.DATE_CRE >= {{DATE_DEB_MOIS}}.
- Filtre l'état (ACTIF) de la table principale si la demande concerne les fiches courantes (BiRTEC ajoute ACTIF = 1 sinon).
- « arborescence » : true pour limiter aux équipements visibles par la personne connectée (variable de la fenêtre), false pour tout le site.
- « dateIndicateur » : la date la plus parlante pour la liste (date limite, date de début…), ou null.
- « tri » : un des alias ID, CODE, DESI1 ou DATE_INDICATEUR (pas un nom de colonne), suivi de ASC ou DESC.
- Variables de la GMAO utilisables dans les conditions :
${variables || '- (aucune)'}
- Respecte les CONVENTIONS DU SITE et inspire-toi des INDICATEURS EXISTANTS.
- N'invente ni table ni colonne : utilise seulement la STRUCTURE fournie.

Tables possibles pour un indicateur :
${fenetres || '- (aucune : la structure de la base est inconnue)'}`
}

function consignes(reglages) {
  return `Tu écris des indicateurs pour l'écran « indicateurs personnalisés » d'une GMAO (base MySQL). Réponds uniquement par la définition JSON, sans texte autour.\n\n${reglesIndicateur(reglages)}`
}

export async function contexteIA(demande, libelleFenetre, reglages) {
  const fenetre = trouverFenetre(reglages, libelleFenetre)
  const notes = listerNotes()
  const schema = await obtenirSchema()
  const imposees = [...(fenetre ? [fenetre.table] : []), ...tablesDesConventions(notes, demande, schema)]
  let tables = []
  let description = ''
  for (let nombre = 10; nombre >= 4; nombre -= 2) {
    tables = tablesUtiles(schema, demande, nombre, imposees)
    description = decrireTables(tables)
    if (description.length < 20_000) break
  }
  const site = connaissancesUtiles(demande, tables, { notes, requetes: listerRequetes() })

  // Les indicateurs déjà écrits les plus proches de la demande (même fenêtre d'abord).
  const mots = new Set(demande.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((m) => m.length > 2))
  const exemples = listerIndicateurs()
    .map((i) => ({ i, score: (i.fenetre === libelleFenetre ? 2 : 0) + `${i.nom} ${i.demande || ''}`.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((m) => mots.has(m)).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ i }) => `### ${i.nom} (fenêtre ${i.fenetre})\n${i.definition ? JSON.stringify(i.definition) : `Requête indicateur :\n${i.requeteIndicateur}`}`)

  return [
    site.texte,
    exemples.length ? `INDICATEURS EXISTANTS (exemples) :\n${exemples.join('\n\n')}` : '',
    `STRUCTURE (${tables.length} tables utiles) :\n${description.slice(0, 24_000)}`,
  ].filter(Boolean).join('\n\n')
}
