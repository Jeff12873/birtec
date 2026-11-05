// Base de données : structure des tables, dictionnaire (noms clairs, descriptions, tables écartées),
// et requêtes de lecture (console SQL).

import { ErreurHttp, envoyerOctets } from 'ktec/http.js'
import { creerZip } from 'ktec/zip.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { enregistrerDictionnaire, enregistrerLienDictionnaire, ajouterLien, lireInfo, ecrireInfo } from 'ktec/ktec.js'
import { obtenirSchema, lireTypesChoisis } from './schema.js'
import { TYPES } from '../../interface/types.js'
import { classeurPowerQuery } from './classeur.js'
import { lirePreference, ecrirePreference } from 'ktec/preferences.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { schemaEco } from '../phrase/serveur.js'

// BiRTEC éco+ : la page est dans le paquet (eco/BiRTEC-eco.html) ; en développement, on la fabrique dans cache/.
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
function pageEco() {
  const paquet = path.join(RACINE, 'eco', 'BiRTEC-eco.html')
  if (fs.existsSync(paquet)) return fs.readFileSync(paquet, 'utf8')
  const fabriquee = path.join(RACINE, 'cache', 'BiRTEC-eco.html')
  fs.mkdirSync(path.dirname(fabriquee), { recursive: true })
  execFileSync(process.execPath, [path.join(RACINE, 'eco', 'fabriquer.js'), fabriquee], { cwd: RACINE, stdio: 'ignore' })
  return fs.readFileSync(fabriquee, 'utf8')
}

// Réglages et SQL : réservés à l'administrateur (ctx.exigerModeAdmin, KTEC 0.6 et plus).
const reserve = (r) => Object.fromEntries(['get', 'post', 'delete'].map((m) => [m, (chemin, action) => r[m](chemin, (ctx) => {
  ctx.exigerModeAdmin?.()
  return action(ctx)
})]))

export function routes(r) {
  const admin = reserve(r)
  // GET /api/schema?rafraichir=1
  r.get('/api/schema', (ctx) => obtenirSchema({ rafraichir: Boolean(ctx.query.rafraichir) }))

  // GET /api/eco : BiRTEC éco+ (pastille « Eco+ » du portail), avec le schéma du site déjà dans la page.
  r.get('/api/eco', async (ctx) => {
    const site = JSON.stringify(await schemaEco()).replace(/</g, '\\u003c')
    const html = pageEco().replace('<meta charset="utf-8">', () => `<meta charset="utf-8">\n<script>window.BIRTEC_ECO_SITE = ${site}</script>`) // le premier : celui de la page, en tête ; une fonction : les « $ » du schéma restent tels quels
    const version = fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim()
    envoyerOctets(ctx.res, Buffer.from(html, 'utf8'), { type: 'text/html; charset=utf-8', nom: `BiRTEC eco+ ${version}.html`, telecharger: true })
  })

  // POST /api/requete { sql, limite }  → { colonnes, lignes, tronque, dureeMs }
  admin.post('/api/requete', async (ctx) => {
    const { sql, limite = 200 } = await ctx.json()
    if (!sql?.trim()) throw new ErreurHttp(400, 'Requête vide.')
    return executerRequete(sql, Math.min(5000, Number(limite) || 200))
  })

  // Aperçu d'une table : ses 20 premières lignes.
  admin.get('/api/table/:nom', async (ctx) => {
    const schema = await obtenirSchema()
    const table = schema.tables.find((t) => t.nom === ctx.params.nom)
    if (!table) throw new ErreurHttp(404, 'Table inconnue')
    return executerRequete(`SELECT * FROM \`${table.nom.replaceAll('`', '')}\``, 20)
  })

  // ---- extraction : les tables choisies, prêtes pour Power Query, dans un .zip :
  //   sources/<table>.csv (tables entières), analyse.xlsx (une requête par CSV, en chemin relatif),
  //   constellation.png (le chemin et ses jointures, envoyé par la constellation) et un lisez-moi.

  // POST /api/extraction { tables: [noms], limite?, image? (data:image/png;base64,…), sql? } → fichier .zip
  r.post('/api/extraction', async (ctx) => {
    const { tables: demandees = [], limite = LIGNES_MAX_EXTRACTION, image = null, sql = '' } = await ctx.json()
    if (!demandees.length) throw new ErreurHttp(400, 'Choisissez au moins une table.')
    if (!etatConnexion().ouverte) throw new ErreurHttp(409, 'Connexion à la GMAO indisponible : impossible d’extraire les données.')
    const schema = await obtenirSchema()
    const fichiers = []
    const bilan = []
    const lues = []
    for (const nom of demandees) {
      const table = schema.tables.find((t) => t.nom.toLowerCase() === String(nom).toLowerCase())
      if (!table) continue
      const max = Math.min(Number(limite) || LIGNES_MAX_EXTRACTION, LIGNES_MAX_EXTRACTION)
      const r = await executerRequete(`SELECT * FROM \`${table.nom.replaceAll('`', '')}\``, max)
      fichiers.push({ nom: `sources/${table.nom}.csv`, octets: csv([r.colonnes.map((c) => c.nom), ...r.lignes]) })
      lues.push({ nom: table.nom, lignes: r.lignes.length })
      bilan.push(`${table.nom}${table.libelle ? ` (${table.libelle})` : ''} : ${r.lignes.length} ligne(s)${r.tronque ? ` — LIMITÉE aux ${max} premières` : ''}`)
    }
    const base = schema.base
    const date = new Date().toLocaleString('fr-FR')
    fichiers.push({ nom: 'analyse.xlsx', octets: classeurPowerQuery(lues, { titre: `Extraction BiRTEC du ${date}` }) })
    const png = /^data:image\/png;base64,(.+)$/.exec(String(image || ''))
    if (png) fichiers.push({ nom: 'constellation.png', octets: Buffer.from(png[1], 'base64') })
    fichiers.push({ nom: 'LISEZ-MOI.txt', octets: Buffer.from([
      `Extraction BiRTEC — ${date}`,
      '',
      ...bilan,
      '',
      'Dézippez le dossier sur un disque local (pas dans OneDrive ni SharePoint), puis ouvrez analyse.xlsx :',
      'ses requêtes Power Query (Données › Requêtes et connexions) lisent les fichiers du dossier « sources »',
      'à côté du classeur, en chemin relatif. Clic droit sur une requête › Charger dans… pour l’afficher.',
      '',
      'sources : un fichier .csv par table, entière (séparateur « ; », UTF-8).',
      png ? 'constellation.png : le chemin dans la constellation et ses jointures.' : '',
      sql ? `\nLe SQL du chemin :\n${sql}` : '',
      `Au plus ${LIGNES_MAX_EXTRACTION} lignes par table.`,
    ].filter((l) => l !== '').join('\r\n'), 'utf8') })
    const horodatage = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
    envoyerOctets(ctx.res, creerZip(fichiers), { type: 'application/zip', nom: `extraction-${base.replace(/[^\w.-]+/g, '_')}-${horodatage}.zip`, telecharger: true })
  })

  // ---- disposition du schéma des liens (positions des bulles, bulles figées), gardée dans le .ktec

  // Disposition propre à ce poste (préférence locale ; l'ancienne, rangée dans le .ktec, est reprise).
  r.get('/api/schema/disposition', () => lirePreference('disposition_schema', () => lireInfo('disposition_schema', { positions: {} })))

  admin.post('/api/schema/disposition', async (ctx) => {
    const { positions } = await ctx.json()
    if (!positions || typeof positions !== 'object') throw new ErreurHttp(400, 'Positions attendues.')
    ecrirePreference('disposition_schema', { positions })
  })

  // ---- dictionnaire (gardé dans le fichier .ktec)

  // POST /api/dictionnaire { table, colonne?, libelle?, description?, exclue? }
  admin.post('/api/dictionnaire', async (ctx) => {
    const entree = await ctx.json()
    if (!entree.table) throw new ErreurHttp(400, 'Table manquante.')
    enregistrerDictionnaire(entree)
  })

  // POST /api/schema/type { table, type } : corrige le type deviné d'une table ('' : revenir au type deviné).
  admin.post('/api/schema/type', async (ctx) => {
    const { table, type = '' } = await ctx.json()
    if (!table) throw new ErreurHttp(400, 'Table manquante.')
    if (type && !TYPES.some((t) => t.id === type)) throw new ErreurHttp(400, 'Type inconnu.')
    const choisis = { ...lireTypesChoisis() }
    if (type) choisis[String(table).toLowerCase()] = type
    else delete choisis[String(table).toLowerCase()]
    ecrireInfo('types_tables', choisis)
    return { type }
  })

  // POST /api/dictionnaire/lien { deTable, deColonne, versTable, versColonne?, libelle, description, nouveau? }
  admin.post('/api/dictionnaire/lien', async (ctx) => {
    const lien = await ctx.json()
    if (!lien.deTable || !lien.deColonne || !lien.versTable) throw new ErreurHttp(400, 'Lien incomplet.')
    if (lien.nouveau) ajouterLien({ ...lien, versColonne: lien.versColonne || lien.deColonne })
    enregistrerLienDictionnaire(lien)
  })

  // Écarte les tables vides (nombre de lignes lu dans information_schema) : il faut la connexion.
  admin.post('/api/dictionnaire/ecarter-vides', async () => {
    if (!etatConnexion().ouverte) throw new ErreurHttp(409, 'Connexion à la GMAO indisponible : impossible de savoir quelles tables sont vides.')
    const schema = await obtenirSchema()
    const r = await executerRequete('SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()', 5000)
    let ecartees = 0
    for (const [nom, lignes] of r.lignes) {
      if (Number(lignes) > 0) continue
      const table = schema.tables.find((t) => t.nom.toLowerCase() === String(nom).toLowerCase())
      if (table && !table.exclue && !table.libelle) {
        enregistrerDictionnaire({ table: table.nom, exclue: true })
        ecartees++
      }
    }
    return { ecartees }
  })
}

const LIGNES_MAX_EXTRACTION = 200_000

// Un CSV lisible par Excel en français : séparateur « ; », guillemets si besoin, UTF-8 avec BOM, fins de ligne CRLF.
function csv(lignes) {
  const cellule = (v) => {
    if (v === null || v === undefined) return ''
    const texte = String(v)
    return /[;"\r\n]/.test(texte) ? `"${texte.replaceAll('"', '""')}"` : texte
  }
  return Buffer.from('\uFEFF' + lignes.map((l) => l.map(cellule).join(';')).join('\r\n') + '\r\n', 'utf8')
}
