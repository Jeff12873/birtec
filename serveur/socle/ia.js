// Pilotage de l'IA : deux petits serveurs llama.cpp lancés à la demande.
//
//   « chat »      → le modèle qui répond aux questions et lit les images (Qwen3.5)
//   « recherche » → le petit modèle qui transforme un texte en vecteur pour la recherche par le sens
//
// Chacun démarre au premier besoin et s'arrête après un moment sans utilisation
// (réglage « arretIAMinutes ») pour rendre la mémoire au poste.
// Tout ce qui concerne la machine (carte graphique, fichiers) vient de installation.json.

import { spawn } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import { installation, reglagesPoste, journal } from './installation.js'

const moteurs = {
  chat: nouveauMoteur('chat'),
  recherche: nouveauMoteur('recherche'),
}

function nouveauMoteur(nom) {
  return { nom, processus: null, port: 0, etat: 'arrêté', demarrage: null, derniereUtilisation: 0, enCours: 0, dernieresLignes: [], surProcesseur: false }
}

// ---------------------------------------------------------------- état

export function iaInstallee() {
  const config = installation()
  return Boolean(config && fs.existsSync(config.llama) && fs.existsSync(config.modele.fichier))
}

export function etatIA() {
  const config = installation()
  return {
    installee: iaInstallee(),
    modele: config?.modele?.nom || null,
    appareil: config?.appareilNom || 'processeur',
    chat: moteurs.chat.etat,
    recherche: moteurs.recherche.etat,
  }
}

// ---------------------------------------------------------------- démarrage et arrêt

function argumentsDuMoteur(nom, config, port, surProcesseur) {
  const communs = ['--host', '127.0.0.1', '--port', String(port), '--no-webui']
  if (config.appareil && config.appareil !== 'none' && !surProcesseur) communs.push('--device', config.appareil)
  else communs.push('--device', 'none', '-ngl', '0')

  if (nom === 'chat') {
    const args = [...communs, '-m', config.modele.fichier, '-c', '32768', '-np', '2', '--jinja', '--reasoning', 'off']
    if (config.modele.vision && fs.existsSync(config.modele.vision)) args.push('--mmproj', config.modele.vision)
    return args
  }
  return [...communs, '-m', config.recherche.fichier, '--embedding', '--pooling', 'last', '-c', '8192', '-ub', '8192', '-np', '1']
}

async function demarrer(moteur) {
  if (moteur.etat === 'prêt') return
  if (moteur.demarrage) return moteur.demarrage

  const config = installation()
  if (!iaInstallee()) throw new Error("L'IA n'est pas installée sur ce poste : lancez la préparation (voir l'aide).")

  moteur.demarrage = lancer(moteur, config).catch((erreur) => {
    // Carte graphique pleine (autre logiciel, autre agent du poste…) : on se rabat sur le processeur.
    if (config.appareil === 'none' || moteur.surProcesseur) throw erreur
    journal(`IA ${moteur.nom} : démarrage impossible sur la carte graphique, essai sur le processeur`)
    moteur.surProcesseur = true
    return lancer(moteur, config)
  })

  try {
    await moteur.demarrage
  } finally {
    moteur.demarrage = null
  }
}

// Lance un serveur llama.cpp et attend que le modèle soit chargé.
async function lancer(moteur, config) {
  moteur.port = await portLibre()
  moteur.etat = 'démarrage'
  moteur.dernieresLignes = []
  journal(`IA ${moteur.nom} : démarrage sur le port ${moteur.port}`)

  const processus = spawn(config.llama, argumentsDuMoteur(moteur.nom, config, moteur.port, moteur.surProcesseur), {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  moteur.processus = processus
  const garderLignes = (morceau) => {
    moteur.dernieresLignes.push(...morceau.toString().split('\n').filter(Boolean))
    moteur.dernieresLignes = moteur.dernieresLignes.slice(-40)
  }
  processus.stdout.on('data', garderLignes)
  processus.stderr.on('data', garderLignes)
  processus.on('exit', (code, signal) => {
    journal(`IA ${moteur.nom} : arrêtée (code ${code ?? signal})`)
    if (moteur.etat !== 'arrêt') {
      // Arrêt imprévu : souvent la carte graphique saturée (une image demande plus de mémoire).
      // Au prochain démarrage, on passe sur le processeur.
      journal(moteur.dernieresLignes.slice(-10).join('\n'))
      if (config.appareil !== 'none') moteur.surProcesseur = true
    }
    moteur.processus = null
    moteur.etat = 'arrêté'
  })

  // On attend que le modèle soit chargé (jusqu'à 5 minutes pour un gros modèle sur un disque lent).
  const limite = Date.now() + 5 * 60_000
  while (Date.now() < limite) {
    if (!moteur.processus) throw new Error(`Le moteur d'IA n'a pas pu démarrer :\n${moteur.dernieresLignes.slice(-5).join('\n')}`)
    try {
      const reponse = await fetch(`http://127.0.0.1:${moteur.port}/health`)
      if (reponse.ok) {
        moteur.etat = 'prêt'
        moteur.derniereUtilisation = Date.now()
        journal(`IA ${moteur.nom} : prête`)
        return
      }
    } catch {
      // pas encore à l'écoute
    }
    await pause(500)
  }
  arreter(moteur)
  throw new Error("Le moteur d'IA met trop de temps à démarrer.")
}

function arreter(moteur) {
  moteur.surProcesseur = false // au prochain démarrage, on réessaie la carte graphique
  if (!moteur.processus) return
  moteur.etat = 'arrêt'
  moteur.processus.kill()
}

export function arreterIA() {
  arreter(moteurs.chat)
  arreter(moteurs.recherche)
}

// Arrêt automatique après un moment sans utilisation.
setInterval(() => {
  const delai = (reglagesPoste().arretIAMinutes || 20) * 60_000
  for (const moteur of Object.values(moteurs)) {
    if (moteur.etat === 'prêt' && moteur.enCours === 0 && Date.now() - moteur.derniereUtilisation > delai) {
      journal(`IA ${moteur.nom} : arrêt après ${delai / 60_000} min sans utilisation`)
      arreter(moteur)
    }
  }
}, 60_000).unref()

process.on('exit', arreterIA)

// L'IA tourne-t-elle sur le processeur (poste sans carte graphique, ou carte saturée) ? Elle est alors
// beaucoup plus lente : certains traitements en font moins (voir lecteur-images.js).
export function surProcesseur() {
  return installation()?.appareil === 'none' || moteurs.chat.surProcesseur
}

// ---------------------------------------------------------------- appels

// Pose une question au modèle.
//   messages   : [{ role: 'system'|'user'|'assistant', content }]
//   surMorceau : si fourni, reçoit le texte au fur et à mesure (affichage progressif)
// Renvoie le texte complet de la réponse.
export async function discuter(messages, { surMorceau, temperature = 0.3, maxMots = 1500, signal } = {}) {
  const moteur = moteurs.chat
  await demarrer(moteur)
  moteur.enCours++
  try {
    const reponse = await fetch(`http://127.0.0.1:${moteur.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, temperature, max_tokens: maxMots, stream: true }),
      signal,
    })
    if (!reponse.ok) throw new Error(`L'IA a refusé la demande (${reponse.status}) : ${await reponse.text()}`)

    let texte = ''
    for await (const evenement of lireFluxSSE(reponse.body)) {
      const morceau = evenement.choices?.[0]?.delta?.content
      if (morceau) {
        texte += morceau
        surMorceau?.(morceau)
      }
    }
    return texte.trim()
  } finally {
    moteur.enCours--
    moteur.derniereUtilisation = Date.now()
  }
}

// Lit le texte d'une image (page scannée, photo de plaque signalétique…). JPEG, PNG, GIF ou BMP.
// « maxMots » : longueur maximale de la réponse (en jetons), pour éviter les transcriptions interminables.
export async function lireImage(octets, consigne, type = 'image/jpeg', maxMots = 3000) {
  const image = `data:${type};base64,${Buffer.from(octets).toString('base64')}`
  return discuter(
    [{ role: 'user', content: [{ type: 'image_url', image_url: { url: image } }, { type: 'text', text: consigne }] }],
    { temperature: 0.1, maxMots },
  )
}

// Transforme des textes en vecteurs pour la recherche par le sens.
// « question » : les questions reçoivent une consigne en plus (c'est ce qu'attend le modèle Qwen3-Embedding).
export async function vecteurs(textes, { question = false } = {}) {
  const moteur = moteurs.recherche
  const config = installation()
  await demarrer(moteur)
  moteur.enCours++
  try {
    const entrees = textes.map((texte) =>
      question ? `Instruct: Retrouver les passages de documentation technique qui répondent à la question\nQuery:${texte}` : texte,
    )
    const reponse = await fetch(`http://127.0.0.1:${moteur.port}/v1/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: entrees }),
    })
    if (!reponse.ok) throw new Error(`Recherche par le sens indisponible (${reponse.status})`)
    const { data } = await reponse.json()
    return data.map((ligne) => normaliser(ligne.embedding.slice(0, config.recherche.dimensions)))
  } finally {
    moteur.enCours--
    moteur.derniereUtilisation = Date.now()
  }
}

function normaliser(valeurs) {
  const vecteur = Float32Array.from(valeurs)
  let somme = 0
  for (const v of vecteur) somme += v * v
  const norme = Math.sqrt(somme) || 1
  for (let i = 0; i < vecteur.length; i++) vecteur[i] /= norme
  return vecteur
}

// ---------------------------------------------------------------- outils

async function* lireFluxSSE(corps) {
  const decodeur = new TextDecoder()
  let tampon = ''
  for await (const morceau of corps) {
    tampon += decodeur.decode(morceau, { stream: true })
    let fin
    while ((fin = tampon.indexOf('\n')) >= 0) {
      const ligne = tampon.slice(0, fin).trim()
      tampon = tampon.slice(fin + 1)
      if (!ligne.startsWith('data:')) continue
      const donnees = ligne.slice(5).trim()
      if (donnees === '[DONE]') return
      yield JSON.parse(donnees)
    }
  }
}

function portLibre() {
  return new Promise((ok, echec) => {
    const serveur = net.createServer()
    serveur.listen(0, '127.0.0.1', () => {
      const { port } = serveur.address()
      serveur.close(() => ok(port))
    })
    serveur.on('error', echec)
  })
}

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms))
