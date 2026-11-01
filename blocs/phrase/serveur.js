// LA PHRASE : le bandeau au-dessus de la constellation. L'utilisateur construit lui-même, par des choix
// cliquables, ce qu'il veut consulter : la table, puis des conditions (« qui ont », « qui contiennent »…) liées
// par ET / OU et groupées entre parenthèses, puis l'ordre. Pas d'IA : les listes viennent de la structure et de
// la base.
//
// Le SQL (comptage, aperçu, requête enregistrée) est construit ici, à partir d'une description (tables, clés,
// conditions, tri) vérifiée sur la structure : aucun SQL ne vient du navigateur.

import { ErreurHttp } from 'ktec/http.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { enregistrerRequete, lireInfo, ecrireInfo } from 'ktec/ktec.js'
import { obtenirSchema } from '../base/schema.js'
import { lireModele, enregistrerModele, reconnaitreModele, lireArbre, lireParcs, sousLesNoeuds, cheminDe } from './modele.js'

const VALEURS_MAX = 30

export function routes(r) {
  // Les valeurs proposées pour une colonne (les plus fréquentes, avec leur désignation si elle existe).
  r.get('/api/phrase/valeurs', async (ctx) => {
    if (!etatConnexion().ouverte) return []
    const schema = await obtenirSchema()
    const table = tableDe(schema, ctx.query.table)
    const colonne = colonneDe(table, ctx.query.colonne)
    if (!table || !colonne) throw new ErreurHttp(400, 'Colonne inconnue.')
    const affichage = colonneLisible(table, colonne)
    return valeursDe(table, colonne, affichage, affichage ? null : libelleParLien(schema, table, colonne))
  })

  // Quelques valeurs d'exemple de chaque colonne d'une table (les plus récentes lignes), pour la bulle des champs.
  r.get('/api/phrase/exemples', async (ctx) => {
    if (!etatConnexion().ouverte) return {}
    const table = tableDe(await obtenirSchema(), ctx.query.table)
    if (!table) throw new ErreurHttp(400, 'Table inconnue.')
    const cle = table.colonnes.find((c) => c.cle)
    const r200 = await executerRequete(`SELECT * FROM ${table.nom}${cle ? ` ORDER BY ${cle.nom} DESC` : ''}`, 200)
    const exemples = {}
    r200.colonnes.forEach((c, i) => {
      const vus = new Set()
      for (const l of r200.lignes) {
        const v = l[i] === null || l[i] === undefined ? '' : String(l[i]).trim()
        if (v && !vus.has(v)) vus.add(v)
        if (vus.size >= 3) break
      }
      exemples[c.nom] = [...vus].map((v) => (v.length > 60 ? `${v.slice(0, 57)}…` : v))
    })
    return exemples
  })

  // Les colonnes proposées dans LA PHRASE, table par table (choisies par l'administrateur ; absent : toutes).
  r.get('/api/phrase/colonnes', () => lireInfo('colonnes_phrase') || {})
  r.post('/api/phrase/colonnes', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const { table, colonnes } = await ctx.json()
    const t = tableDe(await obtenirSchema(), table)
    if (!t) throw new ErreurHttp(400, 'Table inconnue.')
    const toutes = { ...(lireInfo('colonnes_phrase') || {}) }
    if (Array.isArray(colonnes)) toutes[t.nom] = colonnes.map((c) => colonneDe(t, c)?.nom).filter(Boolean)
    else delete toutes[t.nom]
    ecrireInfo('colonnes_phrase', toutes)
    return toutes
  })

  // Les choix guidés possibles pour une table de départ : parcs d'AITEC, table des machines, type de fiche technique.
  r.get('/api/phrase/guides', async (ctx) => {
    const m = lireModele()
    const parcs = lireParcs()
    const type = typeDeTable(m, ctx.query.depart)
    return {
      parcs: m?.machine && parcs.length ? parcs.map((x) => ({ valeur: x.id, libelle: x.nom })) : [],
      machines: m?.machine ? { table: m.machine.table } : null,
      fiche: m?.ficheTechnique && type ? { type, table: m.objets[type].table } : null,
    }
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

  // { depart, jointures, conditions, tri, apercu? } → { nombre, apercu: { colonnes, lignes }, sql? (administrateur) }
  r.post('/api/phrase/compter', async (ctx) => {
    const spec = await ctx.json()
    if (!etatConnexion().ouverte) throw new ErreurHttp(409, 'Connexion à la GMAO indisponible.')
    const schema = await obtenirSchema()
    const { from, where, tri } = await morceauxSql(spec, schema)
    // Les jointures multiplient les lignes (une RI et ses trois machines) : on compte les lignes distinctes de la
    // table de départ, par sa clé.
    const depart = tableDe(schema, spec.depart)
    const cle = depart.colonnes.find((c) => c.cle)
    const compte = await executerRequete(`SELECT COUNT(${cle ? `DISTINCT ${depart.nom}.${cle.nom}` : '*'}) AS n ${from}${where}`, 1)
    const reponse = { nombre: Number(compte.lignes[0]?.[0] ?? 0) }
    if (spec.apercu) {
      // Les colonnes montrées, table par table. La table de départ : sa clé (verrouillée), puis les colonnes cochées
      // par l'utilisateur, sinon les premières colonnes proposées. Les autres tables : la colonne de chaque
      // condition (verrouillée : elle montre la jointure ou le filtre), puis les colonnes cochées.
      // Les colonnes du tri sont lues en plus (DISTINCT l'exige), puis retirées de l'aperçu.
      const jointes = new Set([depart.nom, ...(spec.jointures || []).map((j) => tableDe(schema, j.table)?.nom)])
      const choisies = spec.apercu?.affichees && typeof spec.apercu.affichees === 'object' ? spec.apercu.affichees : {}
      const cochees = (t) => (Array.isArray(choisies[t.nom]) ? t.colonnes.filter((c) => choisies[t.nom].includes(c.nom)) : null)
      const sources = []
      const ajouter = (c) => { if (!sources.some((x) => x.table === c.table && x.colonne === c.colonne)) sources.push(c) }
      const cleDepart = depart.colonnes.find((c) => c.cle)
      if (cleDepart) ajouter({ table: depart.nom, colonne: cleDepart.nom, verrouillee: true })
      const proposees = (lireInfo('colonnes_phrase') || {})[depart.nom]
      const premieres = proposees?.length ? depart.colonnes.filter((c) => proposees.includes(c.nom)) : depart.colonnes
      for (const c of cochees(depart) || premieres.slice(0, 8)) ajouter({ table: depart.nom, colonne: c.nom })
      const conditions = colonnesDesConditions(spec.conditions, schema)
      for (const c of conditions) ajouter({ ...c, condition: true, verrouillee: true })
      for (const nom of [...new Set([...conditions.map((c) => c.table), ...Object.keys(choisies)])]) {
        const t = tableDe(schema, nom)
        if (!t || t.nom === depart.nom || !jointes.has(t.nom)) continue
        for (const c of cochees(t) || []) ajouter({ table: t.nom, colonne: c.nom })
      }
      // Regroupées par table, dans l'ordre d'arrivée des tables.
      const ordre = [...new Set(sources.map((c) => c.table))]
      sources.sort((a, b) => ordre.indexOf(a.table) - ordre.indexOf(b.table))
      const colonnes = sources.map((c, i) => `${c.table}.${c.colonne} AS c_${i}`)
      const r5 = await executerRequete(`SELECT DISTINCT ${[...colonnes, ...tri.map((t, i) => `${t.expression} AS tri_${i}`)].join(', ')} ${from}${where}${tri.length ? `\nORDER BY ${tri.map((t, i) => `tri_${i} ${t.sens}`).join(', ')}` : ''}`, 5)
      reponse.apercu = { colonnes: sources, lignes: r5.lignes.map((l) => l.slice(0, colonnes.length)) }
    }
    if (ctx.modeAdmin) reponse.sql = sqlComplet(from, where, tri)
    return reponse
  })

  // { titre, spec } : la requête de la phrase, rangée dans les requêtes du site (administrateur).
  r.post('/api/phrase/enregistrer', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const { titre = '', description = '', spec } = await ctx.json()
    if (!String(titre).trim()) throw new ErreurHttp(400, 'Donnez un nom à la requête.')
    const schema = await obtenirSchema()
    const { from, where, tri } = await morceauxSql(spec, schema)
    const sql = sqlComplet(from, where, tri)
    enregistrerRequete({ titre: titre.trim(), sql, description, source: `constellation:${titre.trim().toLowerCase()}` })
    return { sql }
  })
}

// ---------------------------------------------------------------- structure

const tableDe = (schema, nom) => schema.tables.find((t) => t.nom.toLowerCase() === String(nom || '').toLowerCase())
const colonneDe = (table, nom) => table?.colonnes.find((c) => c.nom.toLowerCase() === String(nom || '').toLowerCase())

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

// Les colonnes que touchent les conditions (groupes compris) ; parc et machine : le repère de la table des machines.
function colonnesDesConditions(liste, schema) {
  const m = lireModele()
  return (Array.isArray(liste) ? liste : []).flatMap((c) => {
    if (Array.isArray(c.groupe)) return colonnesDesConditions(c.groupe, schema)
    if (c.guide === 'parc' || c.guide === 'machine') return m?.machine ? [{ table: tableDe(schema, m.machine.table)?.nom, colonne: m.machine.code }] : []
    if (c.guide) return []
    const t = tableDe(schema, c.table)
    const col = c.colonne ? colonneDe(t, c.colonne) : t && cleDe(t)
    return t && col ? [{ table: t.nom, colonne: col.nom }] : []
  }).filter((c) => c.table)
}

// Une jointure sur un identifiant d'objet « à type » (comme celui des fiches techniques : l'identifiant ne dit
// rien sans le type d'objet à côté) : le type de l'autre table est ajouté à la jointure. Sans type connu pour
// cette table, la jointure ne ramène rien (sinon elle prendrait les objets d'un autre type au même numéro).
function conditionDeType(de, colDe, vers, colVers) {
  const m = lireModele()
  const v = m?.ficheTechnique?.valeurs
  if (!v?.idObjet || !v?.typeObjet) return ''
  for (const [cote, col, autre] of [[de, colDe, vers], [vers, colVers, de]]) {
    if (col.nom.toLowerCase() !== v.idObjet.toLowerCase()) continue
    const colType = colonneDe(cote, v.typeObjet)
    if (!colType) continue
    const type = typeDeTable(m, autre.nom)
    return type ? ` AND ${cote.nom}.${colType.nom} = ${litteral(type)}` : ' AND 1 = 0'
  }
  return ''
}

const sqlComplet = (from, where, tri) => `SELECT *\n${from}${where}${tri.length ? `\nORDER BY ${tri.map((t) => `${t.expression} ${t.sens}`).join(', ')}` : ''}`

// La description du chemin, des conditions et du tri, vérifiée sur la structure : chaque table et chaque colonne
// doit exister et être dans le chemin ; les valeurs sont écrites entre apostrophes (doublées).
// conditions : [{ table, colonne, op, valeurs, lien } | { guide, op, … , lien } | { groupe: [ … ], lien }],
// lien = 'et' | 'ou' avec l'élément précédent. Comme à la lecture, ET passe avant OU ; un groupe change cet ordre.
// Les anciennes constellations (filtres : une valeur par colonne, tous en ET) restent comprises.
// → { from, where, tri: [{ expression, sens }] }
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
    lignes.push(`LEFT JOIN ${table.nom} ON ${de.nom}.${colonneDe(de, j.colonne).nom} = ${vers.nom}.${colonneDe(vers, j.versColonne).nom}${conditionDeType(de, colonneDe(de, j.colonne), vers, colonneDe(vers, j.versColonne))}`)
  }
  const ciblee = (f) => {
    const table = tableDe(schema, f.table)
    const colonne = colonneDe(table, f.colonne)
    if (!table || !colonne) throw new ErreurHttp(400, 'Colonne inconnue dans la structure.')
    if (!jointes.has(table.nom)) throw new ErreurHttp(400, `La table ${table.nom} n’est pas dans le chemin.`)
    return { e: `${table.nom}.${colonne.nom}`, colonne }
  }
  const conditionDe = async (f) => {
    if (f.guide) {
      const c = await conditionGuidee(f, jointes, depart, schema)
      return c && f.op === 'different' ? `NOT COALESCE((${c}), FALSE)` : c
    }
    // Une table seule, sans champ : « ont » = une ligne liée existe dans cette table, « n'ont pas » = aucune.
    if (f.table && !f.colonne) {
      const t = tableDe(schema, f.table)
      if (!t || !jointes.has(t.nom)) throw new ErreurHttp(400, `La table ${f.table} n’est pas dans le chemin.`)
      const e = `${t.nom}.${cleDe(t).nom}`
      return f.op === 'different' ? `${e} IS NULL` : `${e} IS NOT NULL`
    }
    const { e, colonne } = ciblee(f)
    const v = (Array.isArray(f.valeurs) ? f.valeurs : [f.valeurs]).filter((x) => x !== undefined && x !== null && x !== '')
    const lit = (x) => litteralPour(colonne, x)
    const motif = (x) => `'${echapper(String(x).replace(/[%_]/g, (m) => `\\${m}`))}'`
    switch (f.op || 'egal') {
      // Sans valeur : « ont » = le champ est rempli, « n'ont pas » = il est vide.
      case 'egal': return v.length ? `${e} IN (${v.map(lit).join(', ')})` : rempli(e, colonne)
      case 'different': return v.length ? `(${e} IS NULL OR ${e} NOT IN (${v.map(lit).join(', ')}))` : `NOT (${rempli(e, colonne)})`
      case 'contient': return v.length ? `${e} LIKE CONCAT('%', ${motif(v[0])}, '%')` : null
      case 'ne_contient': return v.length ? `(${e} IS NULL OR ${e} NOT LIKE CONCAT('%', ${motif(v[0])}, '%'))` : null
      case 'commence': return v.length ? `${e} LIKE CONCAT(${motif(v[0])}, '%')` : null
      case 'finit': return v.length ? `${e} LIKE CONCAT('%', ${motif(v[0])})` : null
      case 'sup': return v.length ? `${e} > ${lit(v[0])}` : null
      case 'inf': return v.length ? `${e} < ${lit(v[0])}` : null
      case 'entre': return v.length === 2 ? `${e} BETWEEN ${lit(v[0])} AND ${lit(v[1])}` : null
      case 'vide': return `(${e} IS NULL OR ${e} = '')`
      case 'non_vide': return `(${e} IS NOT NULL AND ${e} <> '')`
      default: throw new ErreurHttp(400, `Opérateur inconnu : ${f.op}`)
    }
  }
  const combiner = async (liste) => {
    const morceaux = []
    for (const f of Array.isArray(liste) ? liste : []) {
      const sql = Array.isArray(f.groupe) ? await combiner(f.groupe) : await conditionDe(f)
      if (sql) morceaux.push(`${morceaux.length ? (f.lien === 'ou' ? '\n  OR ' : '\n  AND ') : ''}(${sql})`)
    }
    return morceaux.length ? morceaux.join('') : null
  }
  const anciens = (Array.isArray(spec.filtres) ? spec.filtres : []).map((f) => ({ ...f, op: f.op || 'egal', lien: 'et' }))
  const where = await combiner([...anciens, ...(Array.isArray(spec.conditions) ? spec.conditions : [])])
  const tri = (Array.isArray(spec.tri) ? spec.tri : []).map((t) => ({ expression: ciblee(t).e, sens: t.sens === 'desc' ? 'DESC' : 'ASC' }))
  return { from: lignes.join('\n'), where: where ? `\nWHERE ${where}` : '', tri }
}

// La clé d'une table (sinon sa première colonne) : sert à dire qu'une ligne liée existe.
const cleDe = (t) => t.colonnes.find((c) => c.cle) || t.colonnes[0]
// Un champ rempli : non nul (et, pour un texte, pas vide).
const rempli = (e, colonne) => (NUMERIQUE.test(colonne.type || '') ? `${e} IS NOT NULL` : `(${e} IS NOT NULL AND ${e} <> '')`)
const echapper = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")
const litteral = (v) => (/^-?\d+(\.\d+)?$/.test(String(v)) ? String(v) : `'${echapper(v)}'`)
// Une colonne texte garde ses zéros (« 0012 ») : la valeur reste entre apostrophes.
const NUMERIQUE = /^(int|bigint|smallint|tinyint|mediumint|decimal|numeric|float|double)/i
const litteralPour = (colonne, v) => (NUMERIQUE.test(colonne.type || '') && /^-?\d+(\.\d+)?$/.test(String(v)) ? String(v) : `'${echapper(v)}'`)

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
