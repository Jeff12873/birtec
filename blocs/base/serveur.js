// Base de données : structure des tables et requêtes de lecture (console SQL).

import { ErreurHttp } from '../../serveur/socle/http.js'
import { executerRequete } from '../../serveur/socle/mysql.js'
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
}
