// Petit serveur web : routes de l'API et fichiers de l'interface.
//
// Chaque bloc ajoute ses routes avec routes.get('/api/…', fonction), routes.post(…), etc.
// La fonction reçoit un « contexte » :
//   ctx.params   → morceaux variables du chemin (/api/machines/:id → ctx.params.id)
//   ctx.query    → paramètres après le « ? »
//   ctx.json()   → corps de la requête lu comme du JSON
//   ctx.octets() → corps brut (fichiers envoyés)
// Elle renvoie un objet (envoyé en JSON) ou utilise ctx.res directement (fichiers, flux).

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { chemins, journal } from './installation.js'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.bcmap': 'application/octet-stream',
}

export class ErreurHttp extends Error {
  constructor(statut, message) {
    super(message)
    this.statut = statut
  }
}

export function creerRoutes() {
  const liste = []
  const ajouter = (methode) => (motif, action) => {
    const noms = []
    const expression = new RegExp('^' + motif.replace(/:(\w+)/g, (_, nom) => (noms.push(nom), '([^/]+)')) + '$')
    liste.push({ methode, expression, noms, action })
  }
  return { liste, get: ajouter('GET'), post: ajouter('POST'), put: ajouter('PUT'), delete: ajouter('DELETE') }
}

export function demarrerServeur(routes, port) {
  const serveur = http.createServer((req, res) => traiter(routes, req, res))
  return new Promise((ok, echec) => {
    serveur.on('error', echec)
    // Uniquement sur ce poste : personne d'autre sur le réseau ne peut s'y connecter.
    serveur.listen(port, '127.0.0.1', () => ok(serveur))
  })
}

async function traiter(routes, req, res) {
  const url = new URL(req.url, 'http://localhost')
  try {
    if (url.pathname.startsWith('/api/')) {
      await traiterApi(routes, req, res, url)
    } else {
      envoyerFichierStatique(res, url.pathname)
    }
  } catch (erreur) {
    const statut = erreur.statut || 500
    if (statut === 500) journal(`Erreur ${req.method} ${url.pathname} : ${erreur.stack}`)
    if (res.headersSent) return res.end()
    envoyerJson(res, statut, { erreur: erreur.message })
  }
}

async function traiterApi(routes, req, res, url) {
  // Protection contre les autres sites web ouverts dans le navigateur de l'agent :
  // - l'adresse demandée doit être celle de ce poste (parade au « DNS rebinding ») ;
  // - toute requête qui modifie quelque chose doit porter l'en-tête X-BIRTEC, qu'une page
  //   d'un autre site ne peut pas ajouter sans l'accord du serveur (que l'on ne donne jamais).
  const hote = (req.headers.host || '').replace(/:\d+$/, '')
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hote)) throw new ErreurHttp(403, 'Adresse refusée')
  if (req.method !== 'GET' && req.headers['x-birtec'] !== '1') throw new ErreurHttp(403, 'Requête refusée')

  for (const route of routes.liste) {
    if (route.methode !== req.method) continue
    const correspondance = url.pathname.match(route.expression)
    if (!correspondance) continue

    const params = Object.fromEntries(route.noms.map((nom, i) => [nom, decodeURIComponent(correspondance[i + 1])]))
    const ctx = {
      req,
      res,
      params,
      query: Object.fromEntries(url.searchParams),
      octets: () => lireCorps(req),
      json: async () => JSON.parse((await lireCorps(req)).toString('utf8') || '{}'),
    }
    const resultat = await route.action(ctx)
    if (!res.headersSent && !res.writableEnded) envoyerJson(res, 200, resultat ?? { ok: true })
    return
  }
  throw new ErreurHttp(404, 'Adresse inconnue : ' + url.pathname)
}

export function envoyerJson(res, statut, donnees) {
  res.writeHead(statut, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(donnees))
}

// Corps de la requête, 2 Go au plus (gros documents).
function lireCorps(req, limite = 2 * 1024 ** 3) {
  return new Promise((ok, echec) => {
    const morceaux = []
    let taille = 0
    req.on('data', (morceau) => {
      taille += morceau.length
      if (taille > limite) {
        echec(new ErreurHttp(413, 'Fichier trop gros'))
        req.destroy()
      } else morceaux.push(morceau)
    })
    req.on('end', () => ok(Buffer.concat(morceaux)))
    req.on('error', echec)
  })
}


// Fichiers de l'interface. On ne sert que interface/ et, dans blocs/, les fichiers vue.js et .css :
// le code serveur des blocs n'est jamais envoyé au navigateur.
function envoyerFichierStatique(res, chemin) {
  let fichier
  if (chemin.startsWith('/blocs/')) {
    if (!/^\/blocs\/[\w-]+\/(vue\.js|[\w-]+\.css)$/.test(chemin)) throw new ErreurHttp(404, 'Introuvable')
    fichier = path.join(chemins.blocs, chemin.slice('/blocs/'.length))
  } else {
    fichier = path.join(chemins.interface, chemin === '/' ? 'index.html' : decodeURIComponent(chemin))
    if (!fichier.startsWith(chemins.interface)) throw new ErreurHttp(404, 'Introuvable')
  }
  if (!fs.existsSync(fichier) || !fs.statSync(fichier).isFile()) throw new ErreurHttp(404, 'Introuvable : ' + chemin)

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  })
  fs.createReadStream(fichier).pipe(res)
}

// Envoie un fichier au navigateur (document enregistré dans la base, sauvegarde…).
export function envoyerOctets(res, octets, { type = 'application/octet-stream', nom, telecharger = false } = {}) {
  const entetes = { 'Content-Type': type, 'Content-Length': octets.length, 'Cache-Control': 'no-store' }
  if (nom) entetes['Content-Disposition'] = `${telecharger ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(nom)}`
  res.writeHead(200, entetes)
  res.end(octets)
}

// Flux d'évènements (réponses de l'IA affichées au fur et à mesure).
export function ouvrirFlux(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
  return {
    envoyer(type, donnees) {
      res.write(`event: ${type}\ndata: ${JSON.stringify(donnees)}\n\n`)
    },
    fermer() {
      res.end()
    },
  }
}
