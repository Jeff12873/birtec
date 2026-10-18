// Base de données : structure des tables, dictionnaire (noms clairs, descriptions, tables écartées),
// et requêtes de lecture (console SQL).

import { ErreurHttp, envoyerOctets } from 'ktec/http.js'
import { creerZip } from 'ktec/zip.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { enregistrerDictionnaire, enregistrerLienDictionnaire, ajouterLien, lireInfo, ecrireInfo } from 'ktec/ktec.js'
import { obtenirSchema } from './schema.js'

export function routes(r) {
  // GET /api/schema?rafraichir=1
  r.get('/api/schema', (ctx) => obtenirSchema({ rafraichir: Boolean(ctx.query.rafraichir) }))

  // POST /api/requete { sql, limite }  → { colonnes, lignes, tronque, dureeMs }
  r.post('/api/requete', async (ctx) => {
    const { sql, limite = 200 } = await ctx.json()
    if (!sql?.trim()) throw new ErreurHttp(400, 'Requête vide.')
    return executerRequete(sql, Math.min(5000, Number(limite) || 200))
  })

  // Aperçu d'une table : ses 20 premières lignes.
  r.get('/api/table/:nom', async (ctx) => {
    const schema = await obtenirSchema()
    const table = schema.tables.find((t) => t.nom === ctx.params.nom)
    if (!table) throw new ErreurHttp(404, 'Table inconnue')
    return executerRequete(`SELECT * FROM \`${table.nom.replaceAll('`', '')}\``, 20)
  })

  // ---- extraction : les tables choisies, en CSV dans un .zip (avec leur structure et un lisez-moi)

  // POST /api/extraction { tables: [noms], limite? } → fichier .zip
  r.post('/api/extraction', async (ctx) => {
    const { tables: demandees = [], limite = LIGNES_MAX_EXTRACTION } = await ctx.json()
    if (!demandees.length) throw new ErreurHttp(400, 'Choisissez au moins une table.')
    if (!etatConnexion().ouverte) throw new ErreurHttp(409, 'Connexion MySQL fermée : saisissez le mot de passe pour extraire les données.')
    const schema = await obtenirSchema()
    const fichiers = []
    const bilan = []
    const structure = [['table', 'nom clair de la table', 'colonne', 'type', 'clé', 'nom clair', 'description']]
    for (const nom of demandees) {
      const table = schema.tables.find((t) => t.nom.toLowerCase() === String(nom).toLowerCase())
      if (!table) continue
      const max = Math.min(Number(limite) || LIGNES_MAX_EXTRACTION, LIGNES_MAX_EXTRACTION)
      const r = await executerRequete(`SELECT * FROM \`${table.nom.replaceAll('`', '')}\``, max)
      fichiers.push({ nom: `${table.nom}.csv`, octets: csv([r.colonnes.map((c) => c.nom), ...r.lignes]) })
      bilan.push(`${table.nom}${table.libelle ? ` (${table.libelle})` : ''} : ${r.lignes.length} ligne(s)${r.tronque ? ` — LIMITÉE aux ${max} premières` : ''}`)
      for (const c of table.colonnes) structure.push([table.nom, table.libelle || '', c.nom, c.type + (c.taille ? `(${c.taille})` : ''), c.cle ? 'oui' : '', c.libelle || '', c.description || c.commentaire || ''])
    }
    const base = schema.base
    const date = new Date().toLocaleString('fr-FR')
    fichiers.push({ nom: '_structure.csv', octets: csv(structure) })
    fichiers.push({ nom: '_LISEZ-MOI.txt', octets: Buffer.from([
      `Extraction BiRTEC — base « ${base} » — ${date}`,
      '',
      ...bilan,
      '',
      'Un fichier .csv par table (séparateur « ; », encodage UTF-8 : s’ouvre directement dans Excel).',
      '_structure.csv : les colonnes de chaque table, avec les noms clairs et descriptions du dictionnaire.',
      `Au plus ${LIGNES_MAX_EXTRACTION} lignes par table.`,
    ].join('\r\n'), 'utf8') })
    const horodatage = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
    envoyerOctets(ctx.res, creerZip(fichiers), { type: 'application/zip', nom: `extraction-${base.replace(/[^\w.-]+/g, '_')}-${horodatage}.zip`, telecharger: true })
  })

  // ---- disposition du schéma des liens (positions des bulles, bulles figées), gardée dans le .ktec

  r.get('/api/schema/disposition', () => lireInfo('disposition_schema', { positions: {} }))

  r.post('/api/schema/disposition', async (ctx) => {
    const { positions } = await ctx.json()
    if (!positions || typeof positions !== 'object') throw new ErreurHttp(400, 'Positions attendues.')
    ecrireInfo('disposition_schema', { positions })
  })

  // ---- dictionnaire (gardé dans le fichier .ktec)

  // POST /api/dictionnaire { table, colonne?, libelle?, description?, exclue? }
  r.post('/api/dictionnaire', async (ctx) => {
    const entree = await ctx.json()
    if (!entree.table) throw new ErreurHttp(400, 'Table manquante.')
    enregistrerDictionnaire(entree)
  })

  // POST /api/dictionnaire/lien { deTable, deColonne, versTable, versColonne?, libelle, description, nouveau? }
  r.post('/api/dictionnaire/lien', async (ctx) => {
    const lien = await ctx.json()
    if (!lien.deTable || !lien.deColonne || !lien.versTable) throw new ErreurHttp(400, 'Lien incomplet.')
    if (lien.nouveau) ajouterLien({ ...lien, versColonne: lien.versColonne || lien.deColonne })
    enregistrerLienDictionnaire(lien)
  })

  // Écarte les tables vides (nombre de lignes lu dans information_schema) : il faut la connexion.
  r.post('/api/dictionnaire/ecarter-vides', async () => {
    if (!etatConnexion().ouverte) throw new ErreurHttp(409, 'Connexion MySQL fermée : impossible de savoir quelles tables sont vides.')
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
