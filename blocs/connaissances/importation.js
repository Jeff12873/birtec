// Importation d'un dossier de documents dans le fichier .birtec.
//
// BiRTEC parcourt le dossier (et ses sous-dossiers) et range ce qu'il reconnaît :
//   export « CREATE TABLE » (.sql, .txt)        → structure des tables (+ liens déduits des noms ID_xxx)
//   tableau de liens (.csv : table_source;…)    → liens entre tables
//   autres .sql, .txt contenant une requête     → requêtes du site (exemples pour l'IA)
//   .md, .txt, .docx                            → notes
//   .rptdesign, .rpttemplate                    → rapports modèles (+ leurs requêtes, comme exemples)
//   .rptlibrary, .css, .properties              → ressources BIRT
// Les fichiers de connexion contenant un mot de passe (profils BIRT) sont volontairement ignorés.

import fs from 'node:fs'
import path from 'node:path'
import { lireZip, lireTexteDansZip } from '../../serveur/socle/zip.js'
import {
  enregistrerTables, enregistrerLiens, deduireLiens, lireTables, enregistrerRequete,
  enregistrerNote, enregistrerFichier,
} from '../../serveur/socle/birtec.js'

// Dossiers d'un BIRT Designer ou d'outils : rien d'utile pour l'assistant.
const DOSSIERS_IGNORES = new Set(['plugins', 'features', 'p2', 'configuration', '.metadata', 'node_modules', '.git', 'jre', 'dropins', 'readme'])
const TAILLE_MAX = 30 * 1024 * 1024

export function importerDossier(dossier) {
  dossier = path.resolve(dossier)
  if (!fs.existsSync(dossier) || !fs.statSync(dossier).isDirectory()) throw Object.assign(new Error(`Dossier introuvable : ${dossier}`), { statut: 404 })
  const bilan = { tables: 0, liens: 0, requetes: 0, notes: 0, modeles: 0, ressources: 0, ignores: [] }

  for (const fichier of parcourir(dossier)) {
    const relatif = path.relative(dossier, fichier).split(path.sep).join('/')
    try {
      importerFichier(fichier, relatif, bilan)
    } catch (erreur) {
      bilan.ignores.push(`${relatif} : ${erreur.message}`)
    }
  }

  // Liens déduits des noms de colonnes (utile quand la base ne déclare pas ses clés étrangères).
  const deduits = deduireLiens(lireTables())
  enregistrerLiens(deduits, 'déduit')
  bilan.liensDeduits = deduits.length
  return bilan
}

function* parcourir(dossier) {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name)
    if (entree.isDirectory()) {
      if (!DOSSIERS_IGNORES.has(entree.name.toLowerCase())) yield* parcourir(chemin)
    } else if (entree.isFile()) yield chemin
  }
}

function importerFichier(fichier, relatif, bilan) {
  const ext = path.extname(fichier).toLowerCase()
  const nom = path.basename(fichier)
  const taille = fs.statSync(fichier).size
  if (!['.sql', '.txt', '.md', '.csv', '.docx', '.rptdesign', '.rpttemplate', '.rptlibrary', '.css', '.properties', '.xml'].includes(ext)) return
  if (taille > TAILLE_MAX) return bilan.ignores.push(`${relatif} : trop gros`)
  const octets = fs.readFileSync(fichier)

  if (ext === '.xml') {
    // Profils de connexion BIRT : ils contiennent le mot de passe de la base, on ne les garde pas.
    if (/odaPassword/i.test(octets.toString('utf8'))) bilan.ignores.push(`${relatif} : contient un mot de passe, non importé`)
    return
  }
  if (ext === '.rptdesign' || ext === '.rpttemplate') {
    enregistrerFichier('modeles', nom, octets, relatif)
    bilan.modeles++
    for (const r of requetesDuRapport(octets.toString('utf8'))) {
      enregistrerRequete({ titre: `${nom} — ${r.nom}`, sql: r.sql, description: `Jeu de données « ${r.nom} » du rapport ${nom}`, source: `${relatif}#${r.nom}` })
      bilan.requetes++
    }
    return
  }
  if (['.rptlibrary', '.css', '.properties'].includes(ext)) {
    enregistrerFichier('ressources', nom, octets, relatif)
    bilan.ressources++
    return
  }
  if (ext === '.docx') {
    const texte = texteWord(octets).trim()
    if (texte) {
      enregistrerNote({ titre: nom.replace(/\.docx$/i, ''), contenu: texte, source: relatif })
      bilan.notes++
    }
    return
  }

  const texte = octets.toString('utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n')
  if (ext === '.csv') {
    const liens = liensDuCsv(texte)
    if (!liens.length) return bilan.ignores.push(`${relatif} : tableau non reconnu`)
    enregistrerLiens(liens, relatif)
    bilan.liens += liens.length
    return
  }
  if (/CREATE TABLE/i.test(texte)) {
    const tables = tablesDuDDL(texte)
    if (tables.length) {
      enregistrerTables(tables, relatif)
      bilan.tables += tables.length
      return
    }
  }
  if (ext === '.sql' || (ext === '.txt' && /^\s*(SELECT|WITH)\b/im.test(texte))) {
    enregistrerRequete({ titre: titreDuSql(texte, nom), sql: texte.trim(), description: commentaireDeTete(texte), source: relatif })
    bilan.requetes++
    return
  }
  if (texte.trim()) {
    enregistrerNote({ titre: nom.replace(/\.(md|txt)$/i, ''), contenu: texte.trim(), source: relatif })
    bilan.notes++
  }
}

// ---------------------------------------------------------------- lecteurs

// Export de structure MySQL (« SHOW CREATE TABLE », mysqldump --no-data, DBeaver…).
export function tablesDuDDL(texte) {
  const tables = []
  for (const bloc of texte.split(/CREATE TABLE\s+/i).slice(1)) {
    const nom = bloc.match(/^(?:IF NOT EXISTS\s+)?`?(?:[\w$]+`?\.`?)?([\w$]+)`?\s*\(/i)?.[1]
    if (!nom) continue
    const fin = bloc.search(/\)\s*(ENGINE|DEFAULT CHARSET|COMMENT|;)/i)
    const corps = fin > 0 ? bloc.slice(0, fin) : bloc
    const cles = new Set((corps.match(/PRIMARY KEY\s*\(([^)]*)\)/i)?.[1] || '').replace(/`/g, '').split(',').map((c) => c.trim()))
    const colonnes = []
    for (const ligne of corps.split('\n')) {
      const m = ligne.match(/^\s*`([^`]+)`\s+([a-z]+(?:\([^)]*\))?(?:\s+unsigned)?)/i)
      if (!m) continue
      const commentaire = ligne.match(/COMMENT\s+'((?:[^'\\]|\\.|'')*)'/i)?.[1] || ''
      colonnes.push({ nom: m[1], type: m[2].toLowerCase(), cle: cles.has(m[1]), commentaire })
    }
    const commentaireTable = bloc.slice(fin).match(/^[^;]*COMMENT\s*=\s*'((?:[^'\\]|\\.|'')*)'/i)?.[1] || ''
    if (colonnes.length) tables.push({ nom, commentaire: commentaireTable, colonnes })
  }
  return tables
}

// Tableau de liens : en-tête avec la table source, la colonne et la table cible (séparateur ; ou ,).
function liensDuCsv(texte) {
  const lignes = texte.split('\n').filter((l) => l.trim())
  const separateur = lignes[0]?.includes(';') ? ';' : ','
  const entete = lignes[0]?.toLowerCase().split(separateur).map((c) => c.trim()) || []
  const iSource = entete.findIndex((c) => /table.*(source|origine)|^de_table$/.test(c))
  const iColonne = entete.findIndex((c) => /colonne|column|fk/.test(c))
  const iCible = entete.findIndex((c) => /table.*(cible|dest)|^vers_table$/.test(c))
  const iJointure = entete.findIndex((c) => /jointure|join/.test(c))
  if (iSource < 0 || iColonne < 0 || iCible < 0) return []
  return lignes.slice(1).map((l) => l.split(separateur)).filter((c) => c[iSource] && c[iCible]).map((c) => ({
    deTable: c[iSource].trim(),
    deColonne: c[iColonne].trim(),
    versTable: c[iCible].trim(),
    // « a.X = b.Y » : la colonne visée est Y ; à défaut, même nom que la colonne source.
    versColonne: (iJointure >= 0 && c[iJointure]?.match(/=\s*[\w$]+\.([\w$]+)/)?.[1]) || c[iColonne].trim(),
  }))
}

// Les requêtes des jeux de données d'un rapport BIRT.
export function requetesDuRapport(xml) {
  const requetes = []
  for (const m of xml.matchAll(/<oda-data-set [^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/oda-data-set>/g)) {
    const sql = m[2].match(/<xml-property name="queryText"><!\[CDATA\[([\s\S]*?)\]\]><\/xml-property>/)?.[1]
    if (sql?.trim() && /\b(SELECT|WITH)\b/i.test(sql)) requetes.push({ nom: decoder(m[1]), sql: sql.trim() })
  }
  return requetes
}

// Titre d'un fichier SQL : sa première ligne de commentaire parlante, sinon le nom du fichier.
function titreDuSql(texte, nom) {
  const ligne = texte.split('\n').map((l) => l.replace(/^\s*(--|#|\/\*+|\*)\s?/, '').trim()).find((l) => l && !/^[=\-*_ ]+$/.test(l) && !/^(SELECT|WITH)\b/i.test(l))
  return ligne && ligne.length < 120 ? ligne : nom
}

function commentaireDeTete(texte) {
  const lignes = []
  for (const l of texte.split('\n')) {
    if (/^\s*(--|#)/.test(l)) lignes.push(l.replace(/^\s*(--|#)\s?/, ''))
    else if (l.trim()) break
  }
  return lignes.filter((l) => !/^[=\-*_ ]+$/.test(l)).join('\n').trim()
}

function texteWord(octets) {
  const xml = lireTexteDansZip(lireZip(octets), 'word/document.xml') || ''
  return decoder(
    xml.split(/<\/w:p>/).map((p) => p.replace(/<w:tab\/>/g, '\t').replace(/<\/w:tc>/g, ' | ').replace(/<[^>]+>/g, '')).join('\n'),
  ).replace(/\n{3,}/g, '\n\n')
}

function decoder(texte) {
  return texte.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&')
}
