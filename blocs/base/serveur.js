// Base de données : structure des tables, dictionnaire (noms clairs, descriptions, tables écartées),
// et requêtes de lecture (console SQL).

import { ErreurHttp } from '../../serveur/socle/http.js'
import { executerRequete, etatConnexion } from '../../serveur/socle/mysql.js'
import { enregistrerDictionnaire, enregistrerLienDictionnaire, ajouterLien, lireInfo, ecrireInfo } from '../../serveur/socle/birtec.js'
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

  // ---- disposition du schéma des liens (positions des bulles, bulles figées), gardée dans le .birtec

  r.get('/api/schema/disposition', () => lireInfo('disposition_schema', { positions: {} }))

  r.post('/api/schema/disposition', async (ctx) => {
    const { positions } = await ctx.json()
    if (!positions || typeof positions !== 'object') throw new ErreurHttp(400, 'Positions attendues.')
    ecrireInfo('disposition_schema', { positions })
  })

  // ---- dictionnaire (gardé dans le fichier .birtec)

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
