// LA PHRASE : le bandeau au-dessus de la constellation. L'utilisateur dit ce qu'il veut voir (« les RI du parc
// peinture qui ont la fiche technique X cochée ») ; l'IA en fait une phrase à trous, avec les tables à relier et
// les choix à faire. BiRTEC vérifie tout sur la vraie structure, et lit dans la base les valeurs proposées en
// pastilles : l'IA choisit seulement quelle question poser, jamais les valeurs.
//
// Le SQL (comptage, aperçu, requête enregistrée) est construit ici, à partir d'une description (tables, clés,
// filtres) vérifiée sur la structure : aucun SQL ne vient du navigateur.

import { ErreurHttp } from 'ktec/http.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { enregistrerRequete } from 'ktec/ktec.js'
import { obtenirSchema, tablesUtiles, decrireTables } from '../base/schema.js'
import { extraireJson } from '../rapports/serveur.js'
import { devinerTypes, typeParId } from '../../interface/types.js'
import { lireModele, enregistrerModele, reconnaitreModele, lireArbre, lireParcs, sousLesNoeuds, cheminDe } from './modele.js'

const VALEURS_MAX = 30

export function routes(r) {
  // { texte } → { phrase: [{ texte } | { table } | { choix }], depart, tables, choix: [{ id, question, table, colonne, options }] }
  r.post('/api/phrase', async (ctx) => {
    const { texte = '' } = await ctx.json()
    if (!String(texte).trim()) throw new ErreurHttp(400, 'Dites ce que vous voulez voir.')
    if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste : construisez le chemin à la main dans la constellation.')
    const schema = await obtenirSchema()
    const { types } = devinerTypes(schema.tables, Object.fromEntries(schema.tables.filter((t) => t.typeChoisi).map((t) => [t.nom.toLowerCase(), t.typeChoisi])))
    const tables = tablesUtiles(schema, texte, 14)
    const description = decrireTables(tables)
      .split('\n')
      .map((ligne) => {
        const nom = ligne.match(/^TABLE (\S+)/)?.[1]?.toLowerCase()
        return nom && types.has(nom) ? `${ligne} [${typeParId(types.get(nom)).nom.toLowerCase()}]` : ligne
      })
      .join('\n')

    const reponse = await discuter([
      {
        role: 'system',
        content: `Tu aides un agent de maintenance à dire ce qu'il veut voir dans la base de la GMAO. Tu reformules sa demande en UNE phrase courte, avec des trous à remplir (les choix), et tu indiques les tables à relier. Réponds uniquement par ce JSON :
{"phrase": [{"texte": "Je veux voir les "}, {"table": "nom_table"}, {"texte": " du parc "}, {"choix": "c1"}, {"texte": "."}],
 "depart": "la table principale : ce qu'on veut voir (une ligne du résultat = une ligne de cette table)",
 "tables": ["depart d'abord, puis toutes les tables nécessaires aux choix, y compris les tables de liaison"],
 "choix": [{"id": "c1", "question": "Quel parc ?", "table": "table qui porte la valeur", "colonne": "colonne à filtrer", "affichage": "colonne lisible de la même table (désignation), facultatif", "options": null}]}
Règles :
- Uniquement des tables et des colonnes de la STRUCTURE ci-dessous, écrites exactement.
- Un choix = une précision que l'agent doit donner (quel parc, quelle fiche, quel type, coché oui/non…). Laisse "options" à null : BiRTEC lira les valeurs dans la base. Donne des options seulement pour un oui/non ou une liste fermée évidente : [{"libelle": "Oui", "valeur": "1"}, {"libelle": "Non", "valeur": "0"}].
- Le texte de la phrase est en français simple, sans nom de colonne.
- Les tables [principale] sont les objets qu'on veut voir ; [intermédiaire] relient deux tables ; [référentiel] portent les listes de codes.`,
      },
      { role: 'user', content: `STRUCTURE :\n${description}\n\n${lireModele() ? 'IMPORTANT : ne crée AUCUN choix pour le parc, la machine ou une fiche technique (BiRTEC les propose lui-même, guidés) ; cite seulement la table principale et ce qu\'il faut relier.\n\n' : ''}DEMANDE : ${texte}` },
    ], { temperature: 0, maxMots: 450 })
    const p = extraireJson(reponse)
    if (!p) throw new ErreurHttp(502, 'L’IA n’a pas rendu de phrase lisible : reformulez, ou construisez le chemin à la main.')
    const phrase = await completerPhrase(p, schema)
    phrase.guides = await guidesDe(texte, phrase, schema)
    // Les choix que l'IA a ajoutés malgré tout pour ce que les choix guidés couvrent (parc, machine, fiche) : retirés.
    const couvert = [phrase.guides.parc || phrase.guides.machine ? /parc|machine|[ée]quipement|ligne|zone|secteur|arbo/i : null, phrase.guides.fiche ? /fiche|technique/i : null].filter(Boolean)
    const retires = new Set(phrase.choix.filter((c) => couvert.some((motif) => motif.test(`${c.question} ${c.table}`))).map((c) => c.id))
    phrase.choix = phrase.choix.filter((c) => !retires.has(c.id))
    phrase.phrase = phrase.phrase.filter((m) => !(m.choix && retires.has(m.choix)))
    return phrase
  })

  // ---- les choix guidés (parc, machine, fiche technique), d'après le modèle de données du site

  // Les machines d'un parc (et de tout ce qui est dessous), les plus proches de q en tête.
  r.get('/api/phrase/machines', async (ctx) => {
    const arbre = await lireArbre()
    if (!arbre) throw new ErreurHttp(409, 'Arborescence illisible : il faut la connexion et la requête d’arborescence (réglée dans PDRTEC).')
    const parc = lireParcs().find((x) => x.id === String(ctx.query.parc || ''))
    const noeuds = parc ? sousLesNoeuds(arbre, parc.racines) : [...arbre.noeuds.values()]
    return machinesProches(arbre, noeuds, String(ctx.query.q || ''), 400)
  })

  // Les modèles de fiche technique utilisés pour un type d'objet, leurs champs, et les valeurs d'un champ.
  r.get('/api/phrase/fiche/modeles', async (ctx) => listeFiche('modeles', ctx.query))
  r.get('/api/phrase/fiche/champs', async (ctx) => listeFiche('champs', ctx.query))
  r.get('/api/phrase/fiche/valeurs', async (ctx) => listeFiche('valeurs', ctx.query))

  // ---- le modèle de données (administrateur)
  r.get('/api/modele', (ctx) => {
    ctx.exigerModeAdmin?.()
    return { modele: lireModele() }
  })
  r.post('/api/modele/reconnaitre', async (ctx) => {
    ctx.exigerModeAdmin?.()
    return { modele: await reconnaitreModele(await obtenirSchema()) }
  })
  r.post('/api/modele', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const { modele } = await ctx.json()
    verifierModele(modele, await obtenirSchema())
    enregistrerModele(modele)
    return { modele: lireModele() }
  })

  // { depart, jointures, filtres, apercu? } → { nombre, apercu: { colonnes, lignes }, sql? (administrateur) }
  r.post('/api/phrase/compter', async (ctx) => {
    const spec = await ctx.json()
    if (!etatConnexion().ouverte) throw new ErreurHttp(409, 'Connexion à la GMAO indisponible.')
    const schema = await obtenirSchema()
    const { from, where } = await morceauxSql(spec, schema)
    // Les jointures multiplient les lignes (une RI et ses trois machines) : on compte les lignes distinctes de la
    // table de départ, par sa clé.
    const depart = tableDe(schema, spec.depart)
    const cle = depart.colonnes.find((c) => c.cle)
    const compte = await executerRequete(`SELECT COUNT(${cle ? `DISTINCT ${depart.nom}.${cle.nom}` : '*'}) AS n ${from}${where}`, 1)
    const reponse = { nombre: Number(compte.lignes[0]?.[0] ?? 0) }
    if (spec.apercu) {
      const colonnes = depart.colonnes.slice(0, 8).map((c) => `${depart.nom}.${c.nom}`).join(', ')
      const r5 = await executerRequete(`SELECT DISTINCT ${colonnes} ${from}${where}`, 5)
      reponse.apercu = { colonnes: r5.colonnes.map((c) => c.nom), lignes: r5.lignes }
    }
    if (ctx.modeAdmin) reponse.sql = `SELECT *\n${from}${where}`
    return reponse
  })

  // { titre, spec } : la requête de la phrase, rangée dans les requêtes du site (administrateur).
  r.post('/api/phrase/enregistrer', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const { titre = '', description = '', spec } = await ctx.json()
    if (!String(titre).trim()) throw new ErreurHttp(400, 'Donnez un nom à la requête.')
    const schema = await obtenirSchema()
    const { from, where } = await morceauxSql(spec, schema)
    const sql = `SELECT *\n${from}${where}`
    enregistrerRequete({ titre: titre.trim(), sql, description, source: `constellation:${titre.trim().toLowerCase()}` })
    return { sql }
  })
}

// ---------------------------------------------------------------- vérification de la phrase

const tableDe = (schema, nom) => schema.tables.find((t) => t.nom.toLowerCase() === String(nom || '').toLowerCase())
const colonneDe = (table, nom) => table?.colonnes.find((c) => c.nom.toLowerCase() === String(nom || '').toLowerCase())

async function completerPhrase(p, schema) {
  const depart = tableDe(schema, p.depart) || tableDe(schema, p.tables?.[0])
  if (!depart) throw new ErreurHttp(422, 'L’IA n’a pas trouvé de table principale pour cette demande : reformulez avec le nom de ce que vous voulez voir.')
  const tables = [depart.nom]
  for (const nom of p.tables || []) {
    const t = tableDe(schema, nom)
    if (t && !tables.includes(t.nom)) tables.push(t.nom)
  }
  const choix = []
  for (const c of Array.isArray(p.choix) ? p.choix : []) {
    const table = tableDe(schema, c.table)
    const colonne = colonneDe(table, c.colonne)
    if (!table || !colonne) continue // inventé : on l'oublie
    if (!tables.includes(table.nom)) tables.push(table.nom)
    // La colonne lisible des pastilles : celle donnée par l'IA, sinon une désignation de la même table
    // (pour ne pas proposer des identifiants).
    const affichage = colonneDe(table, c.affichage) || colonneLisible(table, colonne)
    let options = Array.isArray(c.options) && c.options.length ? c.options.map((o) => ({ libelle: String(o.libelle ?? o.valeur), valeur: String(o.valeur ?? o.libelle) })) : null
    if (!options && etatConnexion().ouverte) options = await valeursDe(table, colonne, affichage, affichage ? null : libelleParLien(schema, table, colonne))
    choix.push({ id: String(c.id || `c${choix.length + 1}`), question: String(c.question || colonne.libelle || colonne.nom), table: table.nom, colonne: colonne.nom, options: options || [] })
  }
  const ids = new Set(choix.map((c) => c.id))
  const phrase = (Array.isArray(p.phrase) ? p.phrase : [])
    .map((m) => (m.choix ? (ids.has(String(m.choix)) ? { choix: String(m.choix) } : null) : m.table ? (tableDe(schema, m.table) ? { table: tableDe(schema, m.table).nom } : { texte: String(m.table) }) : { texte: String(m.texte ?? '') }))
    .filter(Boolean)
  return { phrase, depart: depart.nom, tables, choix }
}

function colonneLisible(table, colonne) {
  if (!colonne.cle && !/^id_|_id$/i.test(colonne.nom)) return null
  const texte = (c) => !c.cle && !/^id_|_id$/i.test(c.nom) && !/^(int|bigint|smallint|tinyint|decimal|float|double|date|datetime|time)/i.test(c.type || '')
  return table.colonnes.find((c) => texte(c) && /desi|libel|intitul|nom\b|^nom/i.test(c.nom))
    || table.colonnes.find((c) => texte(c) && c.nom.toLowerCase() === table.nom.toLowerCase())
    || table.colonnes.find((c) => texte(c) && /code|ref/i.test(c.nom))
    || null
}

// Pas de colonne lisible dans la table (une arborescence, une table de liaison) : la désignation d'une table
// liée, par la première clé étrangère qui mène à une table qui en a une. → { table, colonne, versColonne, libelle }
function libelleParLien(schema, table, colonne) {
  if (!colonne.cle && !/^id_|_id$/i.test(colonne.nom)) return null
  for (const l of table.liens) {
    const cible = tableDe(schema, l.versTable)
    const lisible = cible && colonneLisible(cible, { cle: true, nom: 'ID' })
    if (lisible) return { table: cible.nom, colonne: l.colonne, versColonne: l.versColonne, libelle: lisible.nom }
  }
  return null
}

// Les valeurs les plus fréquentes d'une colonne (avec sa désignation si l'IA l'a donnée) : les pastilles.
async function valeursDe(table, colonne, affichage, parLien = null) {
  const lib = parLien ? `${parLien.table}.${parLien.libelle}` : `${table.nom}.${affichage && affichage.nom !== colonne.nom ? affichage.nom : colonne.nom}`
  const jointure = parLien ? ` LEFT JOIN ${parLien.table} ON ${table.nom}.${parLien.colonne} = ${parLien.table}.${parLien.versColonne}` : ''
  const col = `${table.nom}.${colonne.nom}`
  try {
    const r = await executerRequete(
      `SELECT ${col} AS valeur, ${lib} AS libelle, COUNT(*) AS n FROM ${table.nom}${jointure} WHERE ${col} IS NOT NULL AND ${col} <> '' GROUP BY ${col}, ${lib} ORDER BY n DESC LIMIT ${VALEURS_MAX}`,
      VALEURS_MAX,
    )
    return r.lignes.map((l) => ({ valeur: String(l[0]), libelle: String(l[1] ?? l[0]), nombre: Number(l[2]) }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------- SQL construit ici

// La description du chemin et des filtres, vérifiée sur la structure : chaque table et chaque colonne doit exister ;
// les valeurs sont écrites entre apostrophes (doublées). → { from, where }
export async function morceauxSql(spec, schema) {
  const depart = tableDe(schema, spec?.depart)
  if (!depart) throw new ErreurHttp(400, 'Table de départ inconnue.')
  const jointes = new Set([depart.nom])
  const lignes = [`FROM ${depart.nom}`]
  for (const j of Array.isArray(spec.jointures) ? spec.jointures : []) {
    const table = tableDe(schema, j.table)
    const de = tableDe(schema, j.de)
    const vers = tableDe(schema, j.vers)
    if (!table || !de || !vers || !colonneDe(de, j.colonne) || !colonneDe(vers, j.versColonne)) throw new ErreurHttp(400, 'Jointure inconnue dans la structure.')
    if (![de.nom, vers.nom].includes(table.nom) || !jointes.has(de.nom === table.nom ? vers.nom : de.nom)) throw new ErreurHttp(400, 'Jointures dans le désordre.')
    if (jointes.has(table.nom)) continue
    jointes.add(table.nom)
    lignes.push(`LEFT JOIN ${table.nom} ON ${de.nom}.${colonneDe(de, j.colonne).nom} = ${vers.nom}.${colonneDe(vers, j.versColonne).nom}`)
  }
  const conditions = []
  for (const f of Array.isArray(spec.filtres) ? spec.filtres : []) {
    if (f.guide) {
      const condition = await conditionGuidee(f, jointes, depart, schema)
      if (condition) conditions.push(condition)
      continue
    }
    const table = tableDe(schema, f.table)
    const colonne = colonneDe(table, f.colonne)
    const valeurs = (Array.isArray(f.valeurs) ? f.valeurs : [f.valeurs]).filter((v) => v !== undefined && v !== null && v !== '')
    if (!table || !colonne || !valeurs.length) continue
    if (!jointes.has(table.nom)) throw new ErreurHttp(400, `La table ${table.nom} d’un filtre n’est pas dans le chemin.`)
    conditions.push(`${table.nom}.${colonne.nom} IN (${valeurs.map(litteral).join(', ')})`)
  }
  return { from: lignes.join('\n'), where: conditions.length ? `\nWHERE ${conditions.join('\n  AND ')}` : '' }
}

const litteral = (v) => (/^-?\d+(\.\d+)?$/.test(String(v)) ? String(v) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`)

// ---------------------------------------------------------------- choix guidés

const sansAccents = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Les machines (nœuds de l'arborescence) les plus proches des mots donnés : { code, libelle, chemin }.
function machinesProches(arbre, noeuds, q, max) {
  const mots = sansAccents(q).split(/[^a-z0-9]+/).filter(Boolean)
  // Un mot entier compte plus qu'un bout de mot (« chargement » n'est pas « déchargement »), un nombre plus encore.
  const score = (n) => {
    const texte = sansAccents(`${n.code} ${n.desi}`)
    const entiers = new Set(texte.split(/[^a-z0-9]+/))
    return mots.reduce((s, m) => s + (entiers.has(m) ? (/^\d+$/.test(m) ? 5 : 3) : texte.includes(m) ? 1 : 0), 0)
  }
  return noeuds
    .filter((n) => n.code)
    .map((n) => ({ n, s: score(n) }))
    .sort((a, b) => b.s - a.s || a.n.code.localeCompare(b.n.code, 'fr', { numeric: true }))
    .slice(0, max)
    .map(({ n, s }) => ({ code: n.code, libelle: n.desi && n.desi !== n.code ? `${n.code} — ${n.desi}` : n.code, chemin: cheminDe(arbre, n), score: s }))
}

// Le type d'objet d'une table pour les fiches techniques (la valeur de la colonne « type »), d'après le modèle.
const typeDeTable = (modele, table) => Object.entries(modele?.objets || {}).find(([, o]) => o.table.toLowerCase() === String(table).toLowerCase())?.[0] || null

async function listeFiche(quoi, q) {
  const m = lireModele()
  const ft = m?.ficheTechnique
  if (!ft) throw new ErreurHttp(409, 'Fiches techniques non décrites : Configuration › Modèle de données.')
  const type = q.type || typeDeTable(m, q.table)
  if (!type) return []
  const v = ft.valeurs
  const typeSql = litteral(type)
  if (quoi === 'modeles') {
    const r = await executerRequete(`SELECT ${ft.modeles.table}.${ft.modeles.cle}, ${ft.modeles.table}.${ft.modeles.code || ft.modeles.cle}, ${ft.modeles.table}.${ft.modeles.nom || ft.modeles.code}, COUNT(*) FROM ${v.table} JOIN ${ft.modeles.table} ON ${ft.modeles.table}.${ft.modeles.cle} = ${v.table}.${v.modele} WHERE ${v.table}.${v.typeObjet} = ${typeSql} GROUP BY 1, 2, 3 ORDER BY 2 LIMIT 300`, 300)
    return r.lignes.map((l) => ({ valeur: String(l[0]), libelle: l[2] && l[2] !== l[1] ? `${l[1]} — ${l[2]}` : String(l[1]), code: String(l[1]), type }))
  }
  if (quoi === 'champs') {
    const r = await executerRequete(`SELECT ${ft.champs.table}.${ft.champs.cle}, ${ft.champs.table}.${ft.champs.code || ft.champs.cle}, ${ft.champs.table}.${ft.champs.nom || ft.champs.code}, COUNT(*) FROM ${v.table} JOIN ${ft.champs.table} ON ${ft.champs.table}.${ft.champs.cle} = ${v.table}.${v.champ} WHERE ${v.table}.${v.typeObjet} = ${typeSql} AND ${v.table}.${v.modele} = ${litteral(q.modele)} GROUP BY 1, 2, 3 ORDER BY 3 LIMIT 300`, 300)
    return r.lignes.map((l) => ({ valeur: String(l[0]), libelle: String(l[2] || l[1]), code: String(l[1]) }))
  }
  const r = await executerRequete(`SELECT ${v.valeur}, COUNT(*) FROM ${v.table} WHERE ${v.typeObjet} = ${typeSql} AND ${v.modele} = ${litteral(q.modele)} AND ${v.champ} = ${litteral(q.champ)} AND ${v.valeur} IS NOT NULL AND ${v.valeur} <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, 40)
  return r.lignes.map((l) => ({ valeur: String(l[0]), libelle: String(l[0]), nombre: Number(l[1]) }))
}

// Ce que l'IA a compris des choix guidés, rapproché des vraies valeurs : le parc (parmi ceux d'AITEC), les mots
// de la machine, et la fiche technique (modèle, champ, valeur) parmi celles utilisées pour la table de départ.
async function guidesDe(texte, phrase, schema) {
  const m = lireModele()
  const guides = {}
  const parcs = lireParcs()
  const proche = (liste, mots, champ = 'libelle') => {
    const cible = sansAccents(mots)
    if (!cible) return null
    return liste.find((x) => sansAccents(x[champ]) === cible) || liste.find((x) => sansAccents(x[champ]).includes(cible) || cible.includes(sansAccents(x[champ]))) || null
  }
  if (parcs.length && m?.machine) {
    const mots = sansAccents(texte)
    const parc = parcs.find((x) => x.nom && mots.includes(sansAccents(x.nom)))
    guides.parc = { options: parcs.map((x) => ({ valeur: x.id, libelle: x.nom })), choisi: parc?.id || null }
    // Les mots de la machine : ce qui reste de la demande une fois retirés les mots courants et le parc.
    const vides = new Set('je veux voir les des du de la le l d qui ont a avec dans fiche technique oui non coche cochee parc ri di fi et en sur pour'.split(' '))
    const restes = mots.split(/[^a-z0-9]+/).filter((w) => w && !vides.has(w) && !(parc && sansAccents(parc.nom).includes(w)))
    guides.machine = { table: m.machine.table, mots: parc ? restes.join(' ') : '' }
    // La table des machines n'entre dans le chemin que si un parc est cité (sinon, quand on en choisit un).
    if (parc && !phrase.tables.some((x) => x.toLowerCase() === m.machine.table.toLowerCase())) phrase.tables.push(m.machine.table)
  }
  const type = typeDeTable(m, phrase.depart)
  if (m?.ficheTechnique && type && /fiche|technique|\bft\b|coch/i.test(sansAccents(texte))) {
    try {
      const modeles = await listeFiche('modeles', { type })
      const mot = (sansAccents(texte).match(/(?:technique|ft)\s+([a-z0-9_]+)/) || [])[1] || ''
      const choisi = modeles.find((x) => sansAccents(x.code) === mot) || proche(modeles, mot, 'code')
      guides.fiche = { type, modeles, choisi: choisi?.valeur || null, valeur: /\boui\b/i.test(texte) ? 'oui' : /\bnon\b/i.test(texte) ? 'non' : null }
    } catch {}
  }
  return guides
}

// La condition SQL d'un choix guidé. Parc ou machine : les machines de l'arborescence sous le parc ou la machine
// (elle comprise), par leur code ; fiche technique : la table qui la porte a une valeur pour ce modèle et ce champ.
async function conditionGuidee(f, jointes, depart, schema) {
  const m = lireModele()
  if (f.guide === 'parc' || f.guide === 'machine') {
    if (!m?.machine) throw new ErreurHttp(409, 'Machines non décrites : Configuration › Modèle de données.')
    if (!jointes.has(tableDe(schema, m.machine.table)?.nom)) throw new ErreurHttp(400, 'La table des machines n’est pas dans le chemin : ajoutez-la (Ctrl + Maj + clic).')
    const arbre = await lireArbre()
    if (!arbre) throw new ErreurHttp(409, 'Arborescence illisible (requête réglée dans PDRTEC).')
    let racines = []
    if (f.guide === 'parc') racines = lireParcs().find((x) => x.id === String(f.valeur))?.racines || []
    else racines = [...arbre.noeuds.values()].filter((n) => n.code === String(f.valeur)).map((n) => n.id)
    const codes = [...new Set(sousLesNoeuds(arbre, racines).map((n) => n.code).filter(Boolean))]
    if (!codes.length) return '1 = 0'
    return `${tableDe(schema, m.machine.table).nom}.${m.machine.code} IN (${codes.map(litteral).join(', ')})`
  }
  if (f.guide === 'fiche') {
    const ft = m?.ficheTechnique
    const objet = m?.objets?.[f.type]
    if (!ft || !objet) throw new ErreurHttp(409, 'Fiches techniques non décrites : Configuration › Modèle de données.')
    const table = tableDe(schema, objet.table)
    if (!table || !jointes.has(table.nom)) throw new ErreurHttp(400, `La table ${objet.table} n’est pas dans le chemin.`)
    const v = ft.valeurs
    const valeurs = (Array.isArray(f.valeurs) ? f.valeurs : [f.valeur]).filter((x) => x !== undefined && x !== null && x !== '')
    return `EXISTS (SELECT 1 FROM ${v.table} ft WHERE ft.${v.typeObjet} = ${litteral(f.type)} AND ft.${v.idObjet} = ${table.nom}.${objet.cle} AND ft.${v.modele} = ${litteral(f.modele)}${f.champ ? ` AND ft.${v.champ} = ${litteral(f.champ)}` : ''}${valeurs.length ? ` AND ft.${v.valeur} IN (${valeurs.map(litteral).join(', ')})` : ''})`
  }
  return null
}

// Le modèle de données enregistré : chaque table et chaque colonne doit exister (rien d'autre n'entre dans le SQL).
function verifierModele(modele, schema) {
  const verifier = (table, colonnes) => {
    const t = tableDe(schema, table)
    if (!t) throw new ErreurHttp(400, `Table inconnue : ${table}`)
    for (const c of colonnes.filter(Boolean)) if (!colonneDe(t, c)) throw new ErreurHttp(400, `Colonne inconnue : ${table}.${c}`)
  }
  const ft = modele?.ficheTechnique
  if (ft) {
    verifier(ft.valeurs.table, [ft.valeurs.modele, ft.valeurs.champ, ft.valeurs.valeur, ft.valeurs.typeObjet, ft.valeurs.idObjet])
    verifier(ft.modeles.table, [ft.modeles.cle, ft.modeles.code, ft.modeles.nom])
    verifier(ft.champs.table, [ft.champs.cle, ft.champs.code, ft.champs.nom])
  }
  for (const o of Object.values(modele?.objets || {})) verifier(o.table, [o.cle, o.nom])
  if (modele?.machine) verifier(modele.machine.table, [modele.machine.cle, modele.machine.code, modele.machine.nom])
}
