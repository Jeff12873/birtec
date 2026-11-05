// Le « serveur » de BiRTEC éco+, dans la page : les vraies routes de LA PHRASE (blocs/phrase/serveur.js), plus
// celles du schéma, répondent aux fetch('/api/…') de la constellation. Le reste du web n'est pas touché.
import { ErreurHttp } from './cales/http.js'
import { magasin, lireInfo, ecrireInfo } from './cales/magasin.js'
import { routes as routesPhrase } from '../blocs/phrase/serveur.js'

const table = []
const ajouter = (methode) => (chemin, action) => {
  const noms = []
  const motif = new RegExp(`^${chemin.replace(/:(\w+)/g, (_, n) => { noms.push(n); return '([^/]+)' })}$`)
  table.push({ methode, motif, noms, action })
}
const r = { get: ajouter('GET'), post: ajouter('POST'), put: ajouter('PUT'), delete: ajouter('DELETE') }

routesPhrase(r)

// La structure de la base et la disposition de la constellation.
r.get('/api/schema', async () => {
  const s = magasin()?.schema
  return s || { base: '', tables: [] }
})
r.get('/api/schema/disposition', () => lireInfo('disposition_schema', { positions: {} }))
r.post('/api/schema/disposition', async (ctx) => ecrireInfo('disposition_schema', { positions: (await ctx.json()).positions || {} }))
for (const chemin of ['/api/dictionnaire', '/api/dictionnaire/lien', '/api/dictionnaire/ecarter-vides', '/api/schema/type']) {
  r.post(chemin, () => { throw new ErreurHttp(409, 'Le dictionnaire (noms clairs, types de tables) se modifie dans K.NOVA ; exportez ensuite un nouveau schéma.') })
}

const repondre = (statut, corps) => new Response(corps === undefined ? '' : JSON.stringify(corps), { status: statut, headers: { 'Content-Type': 'application/json' } })

async function traiter(url, init = {}) {
  const methode = (init.method || 'GET').toUpperCase()
  for (const route of table) {
    if (route.methode !== methode) continue
    const m = url.pathname.match(route.motif)
    if (!m) continue
    const corps = init.body
    const texte = async () => (corps instanceof Blob ? await corps.text() : String(corps ?? ''))
    const ctx = {
      query: Object.fromEntries(url.searchParams),
      params: Object.fromEntries(route.noms.map((n, i) => [n, decodeURIComponent(m[i + 1])])),
      json: async () => JSON.parse((await texte()) || '{}'),
      octets: async () => { const t = await texte(); return { toString: () => t } },
      exigerModeAdmin: () => {},
      exigerAdmin: () => {},
    }
    try {
      return repondre(200, await route.action(ctx))
    } catch (erreur) {
      return repondre(erreur.statut || 500, { erreur: erreur.message })
    }
  }
  return repondre(404, { erreur: `Indisponible dans BiRTEC éco+ : ${url.pathname}` })
}

export function brancherRouteur() {
  const fetchOriginal = window.fetch.bind(window)
  window.fetch = (entree, init) => {
    const brut = typeof entree === 'string' ? entree : entree?.url
    if (typeof brut === 'string' && brut.startsWith('/api/')) return traiter(new URL(brut, 'http://eco.local'), init)
    return fetchOriginal(entree, init)
  }
}
