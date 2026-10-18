// La structure de la base (tables, colonnes, liens), gardée en mémoire le temps de la session,
// et son résumé pour l'IA.
//
// Une base de GMAO compte souvent des centaines de tables : on ne peut pas toutes les donner à l'IA.
// Pour chaque question, on choisit les tables dont le nom, les colonnes, les commentaires ou le
// dictionnaire (noms clairs et descriptions du fichier .ktec) ressemblent aux mots de la question,
// plus les tables qui leur sont liées. Les tables écartées dans le dictionnaire ne sont jamais données.

import { lireSchema, etatConnexion } from 'ktec/mysql.js'
import { enregistrerTables, lireTables, lireLiens, enregistrerLiens, deduireLiens, lireDictionnaire, lireLiensDictionnaire } from 'ktec/ktec.js'

let schema = null

// Connexion ouverte : la structure est lue sur MySQL puis recopiée dans le fichier .ktec.
// Connexion fermée : on se sert de celle du fichier .ktec (l'assistant reste utile hors connexion).
// Dans les deux cas, les liens du .ktec (importés ou déduits) complètent ceux que la base déclare.
export async function obtenirSchema({ rafraichir = false } = {}) {
  if (etatConnexion().ouverte) {
    if (!schema?.direct || rafraichir) {
      const lu = await lireSchema()
      enregistrerTables(lu.tables, `mysql:${lu.base}`)
      enregistrerLiens(deduireLiens(lu.tables), 'déduit')
      schema = { ...lu, direct: true }
    }
  } else if (!schema || schema.direct || rafraichir) {
    schema = { base: 'structure du fichier .ktec', tables: lireTables().map((t) => ({ ...t, type: 'TABLE', liens: [] })), direct: false }
  }
  return completerDictionnaire(completerLiens(schema))
}

// Noms clairs, descriptions et exclusions du dictionnaire (relus à chaque fois : ils changent souvent).
function completerDictionnaire(schema) {
  const dico = lireDictionnaire()
  const liensDico = lireLiensDictionnaire()
  for (const t of schema.tables) {
    const d = dico.tables.get(t.nom.toLowerCase()) || {}
    t.libelle = d.libelle || ''
    t.description = d.description || ''
    t.exclue = Boolean(d.exclue)
    for (const c of t.colonnes) {
      const dc = dico.colonnes.get(`${t.nom}.${c.nom}`.toLowerCase()) || {}
      c.libelle = dc.libelle || ''
      c.description = dc.description || ''
    }
    for (const l of t.liens) {
      const dl = liensDico.get(`${t.nom}.${l.colonne}>${l.versTable}`.toLowerCase()) || {}
      l.libelle = dl.libelle || ''
      l.description = dl.description || ''
    }
  }
  return schema
}

function completerLiens(schema) {
  const parTable = new Map(schema.tables.map((t) => [t.nom.toLowerCase(), t]))
  for (const lien of lireLiens()) {
    const table = parTable.get(lien.deTable.toLowerCase())
    if (!table || !parTable.has(lien.versTable.toLowerCase())) continue
    if (table.liens.some((l) => l.colonne === lien.deColonne && l.versTable === lien.versTable)) continue
    table.liens.push({ colonne: lien.deColonne, versTable: lien.versTable, versColonne: lien.versColonne })
  }
  return schema
}

export function oublierSchema() {
  schema = null
}

const MOTS_VIDES = new Set('le la les de des du un une et ou à au aux en pour par sur dans avec est sont quel quelle quels quelles comment combien que qui quoi ce cette ces mois année liste nombre total par'.split(' '))

function mots(texte) {
  return String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((m) => m.length >= 2 && !MOTS_VIDES.has(m))
}

// Les tables les plus utiles pour une question (au plus « nombre »), avec leurs voisines.
// « imposees » : noms de tables à prendre d'office (ex. celles des requêtes du site proches de la question).
export function tablesUtiles(schema, question, nombre = 12, imposees = []) {
  const recherches = mots(question)
  const disponibles = schema.tables.filter((t) => !t.exclue)
  const scores = disponibles.map((table) => {
    const texte = [table.nom, table.commentaire, table.description, ...table.colonnes.flatMap((c) => [c.nom, c.commentaire, c.libelle])].join(' ')
    const sesMots = mots(texte)
    const nomClair = mots(table.libelle)
    let score = 0
    for (const m of recherches) {
      if (mots(table.nom).some((t) => t.startsWith(m) || m.startsWith(t))) score += 3
      else if (nomClair.some((t) => t.startsWith(m) || (m.length > 3 && m.startsWith(t)))) score += 3
      else if (sesMots.some((t) => t.startsWith(m) || (m.length > 3 && t.includes(m)))) score += 1
    }
    return { table, score }
  })
  schema = { ...schema, tables: disponibles }
  const dOffice = imposees.map((nom) => schema.tables.find((t) => t.nom.toLowerCase() === nom.toLowerCase())).filter(Boolean).slice(0, Math.ceil(nombre / 2))
  const choisies = [...new Set([...dOffice, ...scores.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.table)])].slice(0, nombre)
  // Petite base, ou aucun mot reconnu : on donne tout (dans la limite).
  if (!choisies.length || schema.tables.length <= nombre) return schema.tables.slice(0, Math.max(nombre, choisies.length))
  // On ajoute les tables liées (pour pouvoir faire les jointures).
  const noms = new Set(choisies.map((t) => t.nom))
  for (const table of [...choisies]) {
    for (const lien of table.liens) {
      if (noms.size >= nombre + 6) break
      if (!noms.has(lien.versTable)) {
        const voisine = schema.tables.find((t) => t.nom === lien.versTable)
        if (voisine) {
          noms.add(voisine.nom)
          choisies.push(voisine)
        }
      }
    }
  }
  return choisies
}

// Description compacte d'une liste de tables, lisible par l'IA, avec les noms clairs du dictionnaire :
//   TABLE ri « Rapport d'intervention » -- description
//     colonnes : TPS_ARRET_P decimal « Temps d'arrêt production (h) », …
export function decrireTables(tables) {
  const clair = (o) => `${o.libelle ? ` « ${o.libelle} »` : ''}${o.description ? ` (${o.description})` : ''}`
  return tables
    .map((t) => {
      // Les colonnes décrites d'abord : ce sont les plus utiles.
      const colonnes = [...t.colonnes].sort((a, b) => Boolean(b.libelle) - Boolean(a.libelle))
        .map((c) => `${c.nom} ${c.type}${c.cle ? ' (clé)' : ''}${clair(c)}${c.commentaire ? ` -- ${c.commentaire}` : ''}`).join(', ')
      const liens = t.liens.length ? `\n  liens : ${t.liens.map((l) => `${l.colonne} → ${l.versTable}.${l.versColonne}${l.libelle ? ` « ${l.libelle} »` : ''}`).join(', ')}` : ''
      return `TABLE ${t.nom}${clair(t)}${t.commentaire ? ` -- ${t.commentaire}` : ''}\n  colonnes : ${colonnes}${liens}`
    })
    .join('\n')
}

// ---------------------------------------------------------------- connaissances du site pour l'IA

// Les notes « toujours » (conventions du site), puis les requêtes et notes les plus proches de la question.
export function connaissancesUtiles(question, tables, { notes, requetes }) {
  const recherches = new Set([...mots(question), ...tables.map((t) => t.nom.toLowerCase())])
  const score = (texte) => {
    const sesMots = new Set(mots(texte))
    let n = 0
    for (const m of recherches) if (sesMots.has(m)) n++
    return n
  }
  const conventions = notes.filter((n) => n.toujours)
  const autresNotes = notes
    .filter((n) => !n.toujours)
    .map((n) => ({ n, s: score(`${n.titre} ${n.titre} ${n.contenu}`) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map((x) => x.n)
  const exemples = requetes
    // Le titre et la description comptent davantage que le texte SQL (souvent long, donc plein de mots).
    .map((r) => ({ r, s: 3 * score(`${r.titre} ${r.description}`) + score(r.sql) }))
    .filter((x) => x.s >= 4)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.r)

  const parties = []
  if (conventions.length) parties.push(`CONVENTIONS DU SITE (à respecter) :\n${conventions.map((n) => `## ${n.titre}\n${n.contenu.slice(0, 4000)}`).join('\n\n')}`)
  if (autresNotes.length) parties.push(`NOTES DU SITE EN RAPPORT AVEC LA DEMANDE :\n${autresNotes.map((n) => `## ${n.titre}\n${n.contenu.slice(0, 2000)}`).join('\n\n')}`)
  if (exemples.length) parties.push(`REQUÊTES DÉJÀ ÉCRITES SUR CE SITE (exemples, à adapter) :\n${exemples.map((r) => `-- ${r.titre}\n${r.sql.slice(0, 1800)}`).join('\n\n')}`)
  return { texte: parties.join('\n\n'), notes: [...conventions, ...autresNotes].map((n) => n.titre), requetes: exemples.map((r) => r.titre), exemples }
}

// Les tables citées par des requêtes (après FROM ou JOIN), les plus fréquentes d'abord.
export function tablesDesRequetes(requetes) {
  const compte = new Map()
  for (const r of requetes) for (const m of r.sql.matchAll(/\b(?:FROM|JOIN)\s+`?([\w$]+)`?/gi)) compte.set(m[1], (compte.get(m[1]) || 0) + 1)
  return [...compte].sort((a, b) => b[1] - a[1]).map(([nom]) => nom)
}

// Les tables citées dans les lignes des conventions qui parlent du sujet de la question
// (ex. une ligne « atelier = niveau 2 de l'arborescence » pour une question sur les ateliers).
export function tablesDesConventions(notes, question, schema) {
  const recherches = new Set(mots(question))
  const noms = new Set(schema.tables.map((t) => t.nom.toLowerCase()))
  const lignes = notes.filter((n) => n.toujours).flatMap((n) => n.contenu.split('\n')).map((texte) => ({ texte, mots: new Set(mots(texte)) }))
  // Un mot rare compte plus qu'un mot présent dans presque toutes les lignes.
  const frequence = (m) => lignes.filter((l) => l.mots.has(m)).length
  const classees = lignes
    .map((l) => ({ ...l, score: [...recherches].filter((m) => l.mots.has(m)).reduce((total, m) => total + 1 / frequence(m), 0) }))
    .filter((l) => l.score > 0)
    .sort((a, b) => b.score - a.score)
  const trouvees = []
  for (const l of classees) {
    for (const mot of l.texte.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) if (noms.has(mot) && !trouvees.includes(mot)) trouvees.push(mot)
  }
  return trouvees
}

// ---------------------------------------------------------------- chemins de jointure

// Les chemins de jointure les plus courts entre les tables principales de la question, calculés sur les
// liens connus (déclarés, déduits, importés ou saisis). Un lien nommé dans le dictionnaire, ou vers une
// table « fille » (ot_equipement pour ot), coûte moins : c'est le chemin habituel du site.
// Renvoie des lignes du genre : « ot → equipement : ot_equipement.ID_OT = ot.ID_OT ; ot_equipement.ID_EQUIPEMENT = equipement.ID_EQUIPEMENT »
export function cheminsDeJointure(noms, schema, longueurMax = 3) {
  const tables = new Map(schema.tables.filter((t) => !t.exclue).map((t) => [t.nom.toLowerCase(), t]))
  const voisins = new Map([...tables.keys()].map((n) => [n, []]))
  for (const t of tables.values()) {
    for (const l of t.liens) {
      const a = t.nom.toLowerCase()
      const b = l.versTable.toLowerCase()
      if (!tables.has(b) || a === b) continue
      const cout = l.libelle ? 0.6 : a.startsWith(b) || b.startsWith(a) ? 0.8 : 1
      const jointure = `${t.nom}.${l.colonne} = ${tables.get(b).nom}.${l.versColonne}`
      voisins.get(a).push({ vers: b, cout, jointure })
      voisins.get(b).push({ vers: a, cout, jointure })
    }
  }
  const chemin = (depart, arrivee) => {
    // Dijkstra sur un petit graphe, limité en nombre d'étapes.
    const meilleurs = new Map([[depart, { cout: 0, etapes: [] }]])
    const aTraiter = [depart]
    while (aTraiter.length) {
      aTraiter.sort((x, y) => meilleurs.get(x).cout - meilleurs.get(y).cout)
      const courant = aTraiter.shift()
      const etat = meilleurs.get(courant)
      if (courant === arrivee) return etat.etapes
      if (etat.etapes.length >= longueurMax) continue
      for (const v of voisins.get(courant) || []) {
        const cout = etat.cout + v.cout
        if (!meilleurs.has(v.vers) || meilleurs.get(v.vers).cout > cout) {
          meilleurs.set(v.vers, { cout, etapes: [...etat.etapes, v.jointure] })
          aTraiter.push(v.vers)
        }
      }
    }
    return null
  }
  const lignes = []
  const liste = [...new Set(noms.map((n) => n.toLowerCase()))].filter((n) => tables.has(n))
  for (let i = 0; i < liste.length; i++) {
    for (let j = i + 1; j < liste.length; j++) {
      const etapes = chemin(liste[i], liste[j])
      if (etapes?.length) lignes.push(`${tables.get(liste[i]).nom} → ${tables.get(liste[j]).nom} : ${etapes.join(' ; ')}`)
    }
  }
  return lignes
}
