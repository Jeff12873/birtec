// Le fichier .birtec : toutes les connaissances propres au site, en un seul fichier (base SQLite).
//
// On y range ce que BiRTEC apprend de la GMAO et que l'assistant doit connaître :
//   notes      → conventions et explications (les notes « toujours » sont données à l'IA à chaque question)
//   tables     → structure des tables (lue sur MySQL ou importée d'un export « CREATE TABLE »)
//   liens      → liens entre tables (la base n'en déclare pas toujours : ils sont alors déduits ou importés)
//   requetes   → requêtes SQL du site, servant d'exemples à l'IA
//   fichiers   → rapports modèles, bibliothèques, feuilles de style… (le contenu des fichiers)
//   indicateurs→ indicateurs de la GMAO (requête indicateur + requête liste)
//   dictionnaire → nom clair et description des tables et colonnes, tables écartées de l'IA
//   liens_dico → nom clair et description des liens entre tables
//   infos      → réglages propres au site : charte des rapports, fenêtres des indicateurs…
//
// Rien de tout cela n'est dans le programme ni sur GitHub : le programme est une « coquille vide ».
// Le fichier se copie, s'envoie ou se sauvegarde comme n'importe quel document.

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { reglagesPoste, modifierReglagesPoste, dossierTravail, journal } from './installation.js'

export const FORMAT = 1 // à augmenter si la structure change (et ajouter la migration dans preparer())

let base = null
let cheminOuvert = null

// Le fichier en cours (celui des réglages du poste, sinon <dossier de travail>/connaissances.birtec).
export function cheminBirtec() {
  return reglagesPoste().fichierBirtec || path.join(dossierTravail(), 'connaissances.birtec')
}

export function birtec() {
  const chemin = cheminBirtec()
  if (base && cheminOuvert === chemin) return base
  base?.close()
  fs.mkdirSync(path.dirname(chemin), { recursive: true })
  base = new DatabaseSync(chemin)
  base.exec('PRAGMA journal_mode = DELETE') // le fichier reste toujours en un seul morceau
  cheminOuvert = chemin
  preparer(base)
  return base
}

// Ouvre (ou crée) un autre fichier .birtec et le retient pour les prochaines ouvertures.
export function changerBirtec(chemin) {
  chemin = path.resolve(chemin)
  if (path.extname(chemin).toLowerCase() !== '.birtec') throw Object.assign(new Error('Le fichier doit avoir l’extension .birtec'), { statut: 400 })
  if (!fs.existsSync(path.dirname(chemin))) throw Object.assign(new Error(`Dossier introuvable : ${path.dirname(chemin)}`), { statut: 404 })
  modifierReglagesPoste({ fichierBirtec: chemin })
  birtec()
  journal(`Fichier de connaissances : ${chemin}`)
  return chemin
}

function preparer(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS infos (cle TEXT PRIMARY KEY, valeur TEXT);
    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY, titre TEXT NOT NULL, contenu TEXT NOT NULL DEFAULT '',
      toujours INTEGER NOT NULL DEFAULT 0, source TEXT, modifie TEXT);
    CREATE TABLE IF NOT EXISTS tables_base (
      nom TEXT PRIMARY KEY, commentaire TEXT, colonnes TEXT NOT NULL, source TEXT, modifie TEXT);
    CREATE TABLE IF NOT EXISTS liens (
      de_table TEXT, de_colonne TEXT, vers_table TEXT, vers_colonne TEXT, source TEXT,
      PRIMARY KEY (de_table, de_colonne, vers_table));
    CREATE TABLE IF NOT EXISTS requetes (
      id INTEGER PRIMARY KEY, titre TEXT NOT NULL, sql TEXT NOT NULL, description TEXT,
      source TEXT UNIQUE, modifie TEXT);
    CREATE TABLE IF NOT EXISTS indicateurs (
      id INTEGER PRIMARY KEY, nom TEXT NOT NULL, fenetre TEXT, demande TEXT, definition TEXT,
      requete_indicateur TEXT, requete_liste TEXT, source TEXT, modifie TEXT);
    CREATE TABLE IF NOT EXISTS dictionnaire (
      table_nom TEXT NOT NULL, colonne TEXT NOT NULL DEFAULT '', libelle TEXT, description TEXT,
      exclue INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (table_nom, colonne));
    CREATE TABLE IF NOT EXISTS liens_dico (
      de_table TEXT, de_colonne TEXT, vers_table TEXT, libelle TEXT, description TEXT,
      PRIMARY KEY (de_table, de_colonne, vers_table));
    CREATE TABLE IF NOT EXISTS fichiers (
      categorie TEXT, nom TEXT, contenu BLOB, taille INTEGER, source TEXT, modifie TEXT,
      PRIMARY KEY (categorie, nom));
  `)
  db.prepare('INSERT OR IGNORE INTO infos VALUES (?, ?)').run('format', String(FORMAT))
  db.prepare('INSERT OR IGNORE INTO infos VALUES (?, ?)').run('cree', new Date().toISOString())
}

const maintenant = () => new Date().toISOString()

// ---------------------------------------------------------------- réglages du site (infos)

// Valeur JSON rangée dans la table infos (ex. « charte », « itm »), ou la valeur par défaut.
export function lireInfo(cle, defaut = null) {
  const ligne = birtec().prepare('SELECT valeur FROM infos WHERE cle = ?').get(cle)
  if (!ligne) return defaut
  try {
    return JSON.parse(ligne.valeur)
  } catch {
    return defaut
  }
}

export function ecrireInfo(cle, valeur) {
  birtec().prepare('INSERT OR REPLACE INTO infos VALUES (?, ?)').run(cle, JSON.stringify(valeur))
}

// ---------------------------------------------------------------- indicateurs

export function listerIndicateurs() {
  return birtec().prepare('SELECT id, nom, fenetre, demande, definition, requete_indicateur AS requeteIndicateur, requete_liste AS requeteListe, source, modifie FROM indicateurs ORDER BY nom').all()
    .map((i) => ({ ...i, definition: i.definition ? JSON.parse(i.definition) : null }))
}

export function enregistrerIndicateur({ id, nom, fenetre, demande = '', definition = null, requeteIndicateur, requeteListe, source = null }) {
  const db = birtec()
  const valeurs = [nom, fenetre, demande, definition ? JSON.stringify(definition) : null, requeteIndicateur, requeteListe, source, maintenant()]
  if (id) {
    db.prepare('UPDATE indicateurs SET nom = ?, fenetre = ?, demande = ?, definition = ?, requete_indicateur = ?, requete_liste = ?, source = ?, modifie = ? WHERE id = ?').run(...valeurs, id)
    return id
  }
  return Number(db.prepare('INSERT INTO indicateurs (nom, fenetre, demande, definition, requete_indicateur, requete_liste, source, modifie) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(...valeurs).lastInsertRowid)
}

export function supprimerIndicateur(id) {
  birtec().prepare('DELETE FROM indicateurs WHERE id = ?').run(id)
}

// ---------------------------------------------------------------- résumé

export function resumeBirtec() {
  const db = birtec()
  const compter = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
  const chemin = cheminBirtec()
  return {
    chemin,
    taille: fs.existsSync(chemin) ? fs.statSync(chemin).size : 0,
    notes: compter('notes'),
    tables: compter('tables_base'),
    liens: compter('liens'),
    requetes: compter('requetes'),
    indicateurs: compter('indicateurs'),
    fichiers: Object.fromEntries(db.prepare('SELECT categorie, COUNT(*) AS n FROM fichiers GROUP BY categorie').all().map((l) => [l.categorie, l.n])),
  }
}

// ---------------------------------------------------------------- notes

export function listerNotes() {
  return birtec().prepare('SELECT id, titre, contenu, toujours, source, modifie FROM notes ORDER BY toujours DESC, titre').all()
}

export function enregistrerNote({ id, titre, contenu = '', toujours = false, source = null }) {
  const db = birtec()
  if (id) {
    db.prepare('UPDATE notes SET titre = ?, contenu = ?, toujours = ?, modifie = ? WHERE id = ?').run(titre, contenu, toujours ? 1 : 0, maintenant(), id)
    return id
  }
  // Une note importée remplace celle qui vient du même fichier.
  if (source) {
    const existante = db.prepare('SELECT id FROM notes WHERE source = ?').get(source)
    if (existante) {
      db.prepare('UPDATE notes SET titre = ?, contenu = ?, modifie = ? WHERE id = ?').run(titre, contenu, maintenant(), existante.id)
      return existante.id
    }
  }
  return Number(db.prepare('INSERT INTO notes (titre, contenu, toujours, source, modifie) VALUES (?, ?, ?, ?, ?)').run(titre, contenu, toujours ? 1 : 0, source, maintenant()).lastInsertRowid)
}

export function supprimerNote(id) {
  birtec().prepare('DELETE FROM notes WHERE id = ?').run(id)
}

// ---------------------------------------------------------------- structure des tables et liens

// tables : [{ nom, commentaire, colonnes: [{ nom, type, cle, commentaire }] }]
export function enregistrerTables(tables, source) {
  const db = birtec()
  const ecrire = db.prepare('INSERT OR REPLACE INTO tables_base (nom, commentaire, colonnes, source, modifie) VALUES (?, ?, ?, ?, ?)')
  db.exec('BEGIN')
  for (const t of tables) ecrire.run(t.nom, t.commentaire || '', JSON.stringify(t.colonnes), source, maintenant())
  db.exec('COMMIT')
}

export function lireTables() {
  return birtec()
    .prepare('SELECT nom, commentaire, colonnes FROM tables_base ORDER BY nom')
    .all()
    .map((t) => ({ nom: t.nom, commentaire: t.commentaire, colonnes: JSON.parse(t.colonnes) }))
}

// liens : [{ deTable, deColonne, versTable, versColonne }]
export function enregistrerLiens(liens, source) {
  const db = birtec()
  // Un lien importé ou déclaré l'emporte sur un lien déduit ; l'inverse ne remplace rien.
  const ecrire = db.prepare(source === 'déduit'
    ? 'INSERT OR IGNORE INTO liens VALUES (?, ?, ?, ?, ?)'
    : 'INSERT OR REPLACE INTO liens VALUES (?, ?, ?, ?, ?)')
  db.exec('BEGIN')
  for (const l of liens) ecrire.run(l.deTable, l.deColonne, l.versTable, l.versColonne, source)
  db.exec('COMMIT')
}

export function lireLiens() {
  return birtec().prepare('SELECT de_table AS deTable, de_colonne AS deColonne, vers_table AS versTable, vers_colonne AS versColonne, source FROM liens').all()
}

// Liens déduits des noms de colonnes, pour les bases qui ne déclarent pas leurs clés étrangères :
// une colonne ID_XXX (ou id_xxx) pointe vers la table xxx si celle-ci a une colonne du même nom.
export function deduireLiens(tables) {
  const parNom = new Map(tables.map((t) => [t.nom.toLowerCase(), t]))
  const liens = []
  for (const table of tables) {
    for (const colonne of table.colonnes) {
      const cible = colonne.nom.match(/^id_(.+)$/i)?.[1]?.toLowerCase()
      if (!cible || cible === table.nom.toLowerCase()) continue
      const versTable = parNom.get(cible)
      const versColonne = versTable?.colonnes.find((c) => c.nom.toLowerCase() === colonne.nom.toLowerCase())
      if (versTable && versColonne) liens.push({ deTable: table.nom, deColonne: colonne.nom, versTable: versTable.nom, versColonne: versColonne.nom })
    }
  }
  return liens
}

// ---------------------------------------------------------------- dictionnaire (noms clairs, descriptions, tables écartées)

// { tables: Map(nom → { libelle, description, exclue }), colonnes: Map('table.colonne' → { libelle, description }) }
// Les clés sont en minuscules : MySQL sous Windows ne distingue pas FI de fi.
export function lireDictionnaire() {
  const tables = new Map()
  const colonnes = new Map()
  for (const l of birtec().prepare('SELECT table_nom, colonne, libelle, description, exclue FROM dictionnaire').all()) {
    const entree = { libelle: l.libelle || '', description: l.description || '', exclue: Boolean(l.exclue) }
    if (l.colonne) colonnes.set(`${l.table_nom}.${l.colonne}`.toLowerCase(), entree)
    else tables.set(l.table_nom.toLowerCase(), entree)
  }
  return { tables, colonnes }
}

// Enregistre le nom clair, la description ou l'exclusion d'une table (colonne vide) ou d'une colonne.
// Seuls les champs fournis sont modifiés.
export function enregistrerDictionnaire({ table, colonne = '', libelle, description, exclue }) {
  const db = birtec()
  const actuel = db.prepare('SELECT libelle, description, exclue FROM dictionnaire WHERE table_nom = ? AND colonne = ?').get(table, colonne) || {}
  db.prepare('INSERT OR REPLACE INTO dictionnaire (table_nom, colonne, libelle, description, exclue) VALUES (?, ?, ?, ?, ?)').run(
    table, colonne,
    libelle ?? actuel.libelle ?? '',
    description ?? actuel.description ?? '',
    exclue === undefined ? (actuel.exclue ?? 0) : (exclue ? 1 : 0),
  )
}

export function lireLiensDictionnaire() {
  const liens = new Map()
  for (const l of birtec().prepare('SELECT * FROM liens_dico').all()) liens.set(`${l.de_table}.${l.de_colonne}>${l.vers_table}`.toLowerCase(), { libelle: l.libelle || '', description: l.description || '' })
  return liens
}

export function enregistrerLienDictionnaire({ deTable, deColonne, versTable, libelle = '', description = '' }) {
  birtec().prepare('INSERT OR REPLACE INTO liens_dico VALUES (?, ?, ?, ?, ?)').run(deTable, deColonne, versTable, libelle, description)
}

// Ajoute un lien saisi à la main (ex. une colonne au nom inhabituel) : il l'emporte sur un lien déduit.
export function ajouterLien({ deTable, deColonne, versTable, versColonne }) {
  birtec().prepare('INSERT OR REPLACE INTO liens VALUES (?, ?, ?, ?, ?)').run(deTable, deColonne, versTable, versColonne, 'saisi')
}

// ---------------------------------------------------------------- requêtes du site

export function enregistrerRequete({ titre, sql, description = '', source }) {
  birtec()
    .prepare(`INSERT INTO requetes (titre, sql, description, source, modifie) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(source) DO UPDATE SET titre = excluded.titre, sql = excluded.sql, description = excluded.description, modifie = excluded.modifie`)
    .run(titre, sql, description, source, maintenant())
}

export function listerRequetes() {
  return birtec().prepare('SELECT id, titre, sql, description, source, modifie FROM requetes ORDER BY titre').all()
}

export function supprimerRequete(id) {
  birtec().prepare('DELETE FROM requetes WHERE id = ?').run(id)
}

// ---------------------------------------------------------------- fichiers (modèles, ressources, documents)

export function enregistrerFichier(categorie, nom, contenu, source = null) {
  birtec()
    .prepare('INSERT OR REPLACE INTO fichiers (categorie, nom, contenu, taille, source, modifie) VALUES (?, ?, ?, ?, ?, ?)')
    .run(categorie, nom, contenu, contenu.length, source, maintenant())
}

export function listerFichiers(categorie) {
  return birtec().prepare('SELECT nom, taille, source, modifie FROM fichiers WHERE categorie = ? ORDER BY nom').all(categorie)
}

export function lireFichier(categorie, nom) {
  return birtec().prepare('SELECT contenu FROM fichiers WHERE categorie = ? AND nom = ?').get(categorie, nom)?.contenu ?? null
}

export function supprimerFichier(categorie, nom) {
  birtec().prepare('DELETE FROM fichiers WHERE categorie = ? AND nom = ?').run(categorie, nom)
}

// Les ressources BIRT (bibliothèques, feuilles de style…) recopiées dans un dossier, pour le moteur BIRT.
export function dossierRessources(dossierCache) {
  const dossier = path.join(dossierCache, 'ressources')
  fs.rmSync(dossier, { recursive: true, force: true })
  fs.mkdirSync(dossier, { recursive: true })
  for (const { nom, contenu } of birtec().prepare("SELECT nom, contenu FROM fichiers WHERE categorie = 'ressources'").all()) {
    fs.writeFileSync(path.join(dossier, path.basename(nom)), contenu)
  }
  return dossier
}
