// Le modèle de données du site : ce que BiRTEC doit savoir de la base pour guider LA PHRASE, sans qu'aucun nom
// de table ne soit écrit dans le code. Le code ne connaît que des notions génériques :
//
//   ficheTechnique : une fiche technique « à étages » — un modèle, ses champs, et des valeurs rattachées à un
//                    objet par deux colonnes (le type de l'objet, son identifiant) ;
//   objets         : pour chaque type d'objet (la valeur de la colonne « type »), la table et sa clé ;
//   machine        : la table des machines et la colonne dont la valeur est le code des nœuds de l'arborescence.
//
// L'arborescence elle-même est la requête réglée dans PDRTEC, et les parcs ceux d'AITEC (même fichier .ktec).
// Les liens vers les vraies tables sont rangés dans le .ktec (info « birtec.modele_donnees ») ; BiRTEC les
// propose en reconnaissant la FORME des tables (reconnaitreModele), l'administrateur les valide.

import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { lireInfo, ecrireInfo, ktec, lireTexteProtege } from 'ktec/ktec.js'

const CLE = 'birtec.modele_donnees'
export const lireModele = () => lireInfo(CLE, null)
export const enregistrerModele = (modele) => ecrireInfo(CLE, { ...modele, enregistreLe: new Date().toISOString() })

const minus = (t) => String(t || '').toLowerCase()
const estCle = (c) => c.cle || /^id_|_id$|^id$/i.test(c.nom)
const estTexte = (c) => /char|text/i.test(c.type || '')
const estEntier = (c) => /int/i.test(c.type || '')

// La colonne lisible d'une table : une désignation, un libellé, un nom ; sinon le premier texte.
export function colonneNom(table) {
  const textes = table.colonnes.filter((c) => estTexte(c) && !estCle(c))
  return textes.find((c) => /desi/i.test(c.nom)) || textes.find((c) => /libel|intitul|^nom|nom$/i.test(c.nom) && minus(c.nom) !== minus(table.nom)) || textes[0] || null
}
// La colonne « code » d'une table : un texte court qui porte presque le nom de la table, sinon le premier texte.
function colonneCode(table) {
  const textes = table.colonnes.filter((c) => estTexte(c) && !estCle(c))
  return textes.find((c) => minus(c.nom) === minus(table.nom)) || textes.find((c) => /code|ref/i.test(c.nom)) || textes[0] || null
}
const cleDe = (table) => table.colonnes.find((c) => c.cle) || table.colonnes.find((c) => estCle(c))

// ---------------------------------------------------------------- reconnaissance par la forme

// Propose le modèle de données en regardant la structure et quelques valeurs (il faut la connexion).
export async function reconnaitreModele(schema) {
  if (!etatConnexion().ouverte) throw Object.assign(new Error('Connexion à la GMAO indisponible : la reconnaissance lit quelques valeurs dans la base.'), { statut: 409 })
  const parNom = new Map(schema.tables.map((t) => [minus(t.nom), t]))
  const ficheTechnique = await reconnaitreFiche(schema, parNom)
  const objets = {}
  for (const code of ficheTechnique?.typesObjets || []) {
    const table = parNom.get(minus(code))
    const cle = table && cleDe(table)
    if (table && cle) objets[code] = { table: table.nom, cle: cle.nom, nom: colonneNom(table)?.nom || cle.nom }
  }
  if (ficheTechnique) delete ficheTechnique.typesObjets
  const machine = await reconnaitreMachine(schema, objets)
  return { ficheTechnique, objets, machine }
}

// Une table de valeurs : au moins deux clés étrangères (le modèle, le champ), une colonne texte dont les valeurs
// sont des noms de tables (le type de l'objet) et une colonne entière à côté (son identifiant).
async function reconnaitreFiche(schema, parNom) {
  const candidates = schema.tables.filter((t) => new Set(t.liens.map((l) => minus(l.versTable))).size >= 2 && t.colonnes.some(estTexte))
  // Toutes les colonnes texte courtes des tables candidates, lues d'un coup (une seule requête : le moteur Java
  // ne démarre qu'une fois) : quelques valeurs distinctes de chacune.
  const essais = []
  for (const t of candidates) {
    const cles = new Set(t.liens.map((l) => minus(l.colonne)))
    for (const c of t.colonnes.filter((x) => estTexte(x) && !/text/i.test(x.type) && !cles.has(minus(x.nom)) && (!x.taille || x.taille <= 100))) essais.push({ t, c, cles })
  }
  if (!essais.length) return null
  const valeursDe = new Map()
  for (let i = 0; i < essais.length; i += 150) {
    const lot = essais.slice(i, i + 150)
    // Le moteur n'accepte qu'une requête qui commence par SELECT : l'union est enveloppée.
    const sql = `SELECT n, v FROM (${lot.map(({ t, c }, k) => `(SELECT ${i + k} AS n, v FROM (SELECT DISTINCT ${c.nom} AS v FROM ${t.nom} WHERE ${c.nom} IS NOT NULL AND ${c.nom} <> '' LIMIT 12) x${k})`).join(' UNION ALL ')}) tout`
    try {
      for (const [n, v] of (await executerRequete(sql, 150 * 12)).lignes) valeursDe.set(Number(n), [...(valeursDe.get(Number(n)) || []), String(v)])
    } catch {}
  }
  for (const [n, valeurs] of valeursDe) {
    const { t, c, cles } = essais[n]
    const tables = valeurs.filter((v) => parNom.has(minus(v)))
    if (!tables.length || tables.length < valeurs.length * 0.6) continue
    // L'identifiant : une colonne entière qui n'est ni la clé ni une clé étrangère, au nom le plus proche du type.
    const entieres = t.colonnes.filter((x) => estEntier(x) && !cles.has(minus(x.nom)))
    const idObjet = entieres.find((x) => minus(x.nom).includes(minus(c.nom))) || entieres.find((x) => !x.cle && !/user|util/i.test(x.nom))
    if (!idObjet) continue
    // Le champ : la table liée qui a une colonne « type » ; le modèle : une autre table liée.
    const cibles = [...new Set(t.liens.map((l) => minus(l.versTable)))].map((x) => parNom.get(x)).filter(Boolean)
    // (des mots courants, pas des noms de tables : « modèle », « champ »… ; sinon la forme)
    const champs = cibles.find((x) => /champ|libel|field|attrib/i.test(x.nom) && x.colonnes.some((y) => /type/i.test(y.nom))) || cibles.find((x) => x.colonnes.some((y) => /type/i.test(y.nom) && !estCle(y)))
    const modeles = cibles.find((x) => x !== champs && /mod[eè]l|templat|gabarit/i.test(x.nom)) || cibles.find((x) => x !== champs && colonneNom(x))
    if (!champs || !modeles) continue
    const lienVers = (table) => t.liens.find((l) => minus(l.versTable) === minus(table.nom))
    const valeur = t.colonnes.filter((x) => estTexte(x) && x !== c && !cles.has(minus(x.nom))).sort((a, b) => /valeur/i.test(b.nom) - /valeur/i.test(a.nom))[0]
    if (!valeur) continue
    // Tous les types d'objets (pas seulement les 12 premières valeurs lues).
    let types = tables
    try {
      types = (await executerRequete(`SELECT DISTINCT ${c.nom} FROM ${t.nom} WHERE ${c.nom} IS NOT NULL AND ${c.nom} <> ''`, 100)).lignes.map((l) => String(l[0])).filter((v) => parNom.has(minus(v)))
    } catch {}
    return {
      valeurs: { table: t.nom, modele: lienVers(modeles).colonne, champ: lienVers(champs).colonne, valeur: valeur.nom, typeObjet: c.nom, idObjet: idObjet.nom },
      modeles: { table: modeles.nom, cle: lienVers(modeles).versColonne, code: colonneCode(modeles)?.nom, nom: colonneNom(modeles)?.nom },
      champs: { table: champs.nom, cle: lienVers(champs).versColonne, code: colonneCode(champs)?.nom, nom: colonneNom(champs)?.nom },
      typesObjets: types,
    }
  }
  return null
}

// La table des machines : celle dont une colonne texte contient les codes des nœuds de l'arborescence.
async function reconnaitreMachine(schema, objets) {
  const codes = (await lireArbre().catch(() => null))?.noeuds
  if (!codes?.size) return null
  const echantillon = [...codes.values()].map((n) => n.code).filter(Boolean).slice(0, 60)
  const litteraux = echantillon.map((c) => `'${c.replace(/'/g, "''")}'`).join(', ')
  const parNom = new Map(schema.tables.map((t) => [minus(t.nom), t]))
  // D'abord les tables des objets des fiches techniques, puis les tables les plus référencées.
  const entrants = new Map()
  for (const t of schema.tables) for (const l of t.liens) entrants.set(minus(l.versTable), (entrants.get(minus(l.versTable)) || 0) + 1)
  const ordre = [...new Set([...Object.values(objets).map((o) => minus(o.table)), ...[...entrants].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n]) => n)])]
  // Chaque colonne texte de ces tables : combien de codes de l'arborescence elle contient (une seule requête).
  const essais = []
  for (const nom of ordre) {
    const table = parNom.get(nom)
    if (table) for (const c of table.colonnes.filter((x) => estTexte(x) && !estCle(x)).slice(0, 6)) essais.push({ table, colonne: c })
  }
  let meilleur = null
  if (essais.length) {
    const sql = essais.map(({ table, colonne }, k) => `SELECT ${k} AS n, COUNT(DISTINCT ${colonne.nom}) AS c FROM ${table.nom} WHERE ${colonne.nom} IN (${litteraux})`).join(' UNION ALL ')
    try {
      for (const [n, c] of (await executerRequete(sql, essais.length)).lignes) if (Number(c) > (meilleur?.n || 0)) meilleur = { n: Number(c), ...essais[Number(n)] }
    } catch {}
  }
  if (!meilleur || meilleur.n < echantillon.length * 0.3) return null
  return { table: meilleur.table.nom, cle: cleDe(meilleur.table)?.nom, code: meilleur.colonne.nom, nom: colonneNom(meilleur.table)?.nom || meilleur.colonne.nom }
}

// ---------------------------------------------------------------- arborescence (PDRTEC) et parcs (AITEC)

// L'arbre des nœuds, lu avec la requête de PDRTEC (gardé 10 minutes) : { noeuds: Map(id → { id, parent, code,
// desi, enfants }) }. Colonnes attendues : noeud, parent, code, designation.
let cacheArbre = { sql: null, date: 0, promesse: null }
export function lireArbre() {
  const sql = lireInfo('pdrtec.arborescence', null)?.arbre
  if (!sql || !etatConnexion().ouverte) return Promise.resolve(null)
  if (cacheArbre.sql !== sql || Date.now() - cacheArbre.date > 10 * 60_000) {
    cacheArbre = { sql, date: Date.now(), promesse: (async () => {
      const r = await executerRequete(sql.replace(/--[^\n]*/g, ''), 1_000_000)
      const i = (nom) => r.colonnes.findIndex((c) => minus(c.nom) === nom)
      const [iN, iP, iC, iD] = ['noeud', 'parent', 'code', 'designation'].map(i)
      if (iN < 0 || iP < 0 || iC < 0) return null
      const noeuds = new Map(r.lignes.map((l) => [String(l[iN]), { id: String(l[iN]), parent: String(l[iP] ?? ''), code: String(l[iC] ?? '').trim(), desi: String(l[iD] ?? '').trim(), enfants: [] }]))
      for (const n of noeuds.values()) noeuds.get(n.parent)?.enfants.push(n)
      return { noeuds }
    })() }
    cacheArbre.promesse.catch(() => (cacheArbre = { sql: null, date: 0, promesse: null }))
  }
  return cacheArbre.promesse
}

// Les parcs d'AITEC (réglage « parcs » du même .ktec) : [{ id, nom, racines: [id de nœud] }].
export function lireParcs() {
  try {
    const ligne = ktec().prepare("SELECT valeur FROM reglages WHERE cle = 'parcs'").get()
    const r = ligne?.valeur ? JSON.parse(lireTexteProtege(ligne.valeur)) : null
    return (r?.groupes || []).map((g) => ({ id: String(g.id), nom: String(g.nom || ''), racines: ['production', 'maintenance', 'autres'].flatMap((role) => (g[role] || []).map(String)) })).filter((p) => p.racines.length)
  } catch {
    return []
  }
}

// Les nœuds sous des racines (elles comprises).
export function sousLesNoeuds(arbre, racines) {
  const vus = new Set()
  const pile = racines.map((id) => arbre.noeuds.get(String(id))).filter(Boolean)
  while (pile.length) {
    const n = pile.pop()
    if (vus.has(n)) continue
    vus.add(n)
    pile.push(...n.enfants)
  }
  return [...vus]
}

// Le chemin lisible d'un nœud : « Production › Peinture › Robot 2 ».
export function cheminDe(arbre, noeud) {
  const morceaux = []
  for (let n = noeud, garde = 0; n && garde < 20; n = arbre.noeuds.get(n.parent), garde++) morceaux.unshift(n.desi || n.code)
  return morceaux.join(' › ')
}
