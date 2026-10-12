// Point de départ de BiRTEC (lancé par « Lancer BiRTEC.bat » ou « lancer-birtec.sh »).
//
// 1. si BiRTEC tourne déjà pour cet utilisateur, on ouvre simplement le navigateur ;
// 2. sinon : on charge les blocs et on démarre le serveur web (sur ce poste uniquement) ;
// 3. on ouvre le navigateur sur http://127.0.0.1:<port>.
//
// Option : --sans-navigateur (pour les essais).

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { creerRoutes, demarrerServeur } from './socle/http.js'
import { arreterIA } from './socle/ia.js'
import { RACINE, WINDOWS, chemins, version, journal, lireJson, ecrireJson } from './socle/installation.js'

const PREMIER_PORT = 47900 // IASSITEC utilise 47800 : les deux peuvent tourner ensemble
const fichierServeur = path.join(chemins.cache, 'serveur.json')
const identifiant = crypto.createHash('sha256').update(RACINE).digest('hex').slice(0, 16)
const sansNavigateur = process.argv.includes('--sans-navigateur')

// ---- 1. déjà lancé ?
const precedent = lireJson(fichierServeur, null)
if (precedent && (await repond(precedent.port))) {
  console.log('BiRTEC est déjà lancé : ouverture du navigateur.')
  if (!sansNavigateur) ouvrirNavigateur(`http://127.0.0.1:${precedent.port}`)
  process.exit(0)
}

// ---- 2. démarrage
journal(`Démarrage de BiRTEC ${version()} (${RACINE})`)
const routes = creerRoutes()
routes.get('/api/ping', () => ({ identifiant }))
for (const nom of fs.readdirSync(chemins.blocs).sort()) {
  const fichier = path.join(chemins.blocs, nom, 'serveur.js')
  if (!fs.existsSync(fichier)) continue
  const bloc = await import(pathToFileURL(fichier).href)
  bloc.routes(routes)
}

const port = await demarrerSurUnPortLibre()
ecrireJson(fichierServeur, { port, pid: process.pid })
const adresse = `http://127.0.0.1:${port}`
journal(`BiRTEC prêt : ${adresse}`)
console.log(`\n  BiRTEC est ouvert dans votre navigateur : ${adresse}\n  Fermer cette fenêtre arrête BiRTEC.\n`)
if (!sansNavigateur) ouvrirNavigateur(adresse)

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    arreterIA()
    process.exit(0)
  })
}

// ---------------------------------------------------------------- outils

async function demarrerSurUnPortLibre() {
  for (let p = PREMIER_PORT; p < PREMIER_PORT + 100; p++) {
    try {
      await demarrerServeur(routes, p)
      return p
    } catch (erreur) {
      if (erreur.code !== 'EADDRINUSE') throw erreur
    }
  }
  throw new Error(`Aucun port libre entre ${PREMIER_PORT} et ${PREMIER_PORT + 99}`)
}

async function repond(port) {
  try {
    const reponse = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1500) })
    return (await reponse.json()).identifiant === identifiant
  } catch {
    return false
  }
}

function ouvrirNavigateur(adresse) {
  const [commande, args] = WINDOWS ? ['cmd', ['/c', 'start', '', adresse]] : ['xdg-open', [adresse]]
  try {
    spawn(commande, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch {
    console.log(`Ouvrez ce lien dans votre navigateur : ${adresse}`)
  }
}
