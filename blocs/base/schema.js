// La structure de la base (tables, colonnes, liens), gardée en mémoire le temps de la session,
// et son résumé pour l'IA.
//
// Une base de GMAO compte souvent des centaines de tables : on ne peut pas toutes les donner à l'IA.
// Pour chaque question, on choisit les tables dont le nom, les colonnes ou les commentaires
// ressemblent aux mots de la question, plus les tables qui leur sont liées.

import { lireSchema } from '../../serveur/socle/mysql.js'

let schema = null

export async function obtenirSchema({ rafraichir = false } = {}) {
  if (!schema || rafraichir) schema = await lireSchema()
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
export function tablesUtiles(schema, question, nombre = 12) {
  const recherches = mots(question)
  const scores = schema.tables.map((table) => {
    const texte = [table.nom, table.commentaire, ...table.colonnes.flatMap((c) => [c.nom, c.commentaire])].join(' ')
    const sesMots = mots(texte)
    let score = 0
    for (const m of recherches) {
      if (mots(table.nom).some((t) => t.startsWith(m) || m.startsWith(t))) score += 3
      else if (sesMots.some((t) => t.startsWith(m) || (m.length > 3 && t.includes(m)))) score += 1
    }
    return { table, score }
  })
  const choisies = scores.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, nombre).map((s) => s.table)
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

// Description compacte d'une liste de tables, lisible par l'IA.
export function decrireTables(tables) {
  return tables
    .map((t) => {
      const colonnes = t.colonnes.map((c) => `${c.nom} ${c.type}${c.cle ? ' (clé)' : ''}${c.commentaire ? ` -- ${c.commentaire}` : ''}`).join(', ')
      const liens = t.liens.length ? `\n  liens : ${t.liens.map((l) => `${l.colonne} → ${l.versTable}.${l.versColonne}`).join(', ')}` : ''
      return `TABLE ${t.nom}${t.commentaire ? ` -- ${t.commentaire}` : ''}\n  colonnes : ${colonnes}${liens}`
    })
    .join('\n')
}
