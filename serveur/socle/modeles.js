// Les modèles d'IA : catalogue, modèle conseillé pour un poste, téléchargement, changement de modèle.
// Utilisé par la préparation (outils/preparer.js) et par l'écran Administration › Réglages.
// La liste des modèles est dans outils/catalogue.json (voir docs/MODELES.md).

import fs from 'node:fs'
import path from 'node:path'
import { RACINE, chemins, installation, ecrireJson, journal } from './installation.js'
import { telecharger } from './telechargement.js'

export function lireCatalogue() {
  return JSON.parse(fs.readFileSync(path.join(RACINE, 'outils', 'catalogue.json'), 'utf8'))
}

// Le plus grand modèle que le poste peut faire tourner confortablement.
export function modeleConseille(catalogue, ramGo, vramGo) {
  return [...catalogue.modeles].reverse().find((m) => ramGo >= m.ram_min || vramGo >= m.vram_min) || catalogue.modeles[0]
}

// Télécharge un fichier depuis Hugging Face en vérifiant sa taille et son empreinte.
export async function telechargerDepuisHuggingFace(depot, fichier, destination, surProgression) {
  const infos = await fetch(`https://huggingface.co/api/models/${depot}?blobs=true`).then((r) => r.json())
  const fiche = infos.siblings?.find((s) => s.rfilename === fichier)
  if (!fiche) throw new Error(`Fichier ${fichier} introuvable sur Hugging Face (${depot})`)
  await telecharger(`https://huggingface.co/${depot}/resolve/main/${fichier}`, destination, {
    taille: fiche.size,
    sha256: fiche.lfs?.sha256,
    surProgression,
  })
  return destination
}

// ---------------------------------------------------------------- dans l'application

// Téléchargement en cours (un seul à la fois) : { code, recu, total, erreur }
let telechargement = null

export function etatModeles() {
  const config = installation()
  const catalogue = lireCatalogue()
  if (!config) return { installe: false, modeles: [], telechargement }
  const conseille = modeleConseille(catalogue, config.poste?.ramGo || 0, config.poste?.vramGo || 0)
  return {
    installe: true,
    actif: config.modele.code,
    conseille: conseille.code,
    poste: config.poste,
    telechargement,
    modeles: catalogue.modeles.map((m) => ({
      code: m.code,
      nom: m.nom,
      pour: m.pour,
      tailleGo: m.taille_go,
      present: fs.existsSync(path.join(config.dossierModeles, m.local)) && fs.existsSync(path.join(config.dossierModeles, m.vision_local)),
    })),
  }
}

// Utilise un modèle : le télécharge d'abord s'il n'est pas sur le poste (en arrière-plan).
// « apresChangement » est appelé quand le modèle est prêt (pour arrêter l'ancien).
export function utiliserModele(code, apresChangement) {
  const config = installation()
  if (!config) throw new Error("L'IA n'est pas installée sur ce poste : lancez d'abord la préparation.")
  const modele = lireCatalogue().modeles.find((m) => m.code === code)
  if (!modele) throw new Error('Modèle inconnu')
  if (telechargement && !telechargement.erreur && !telechargement.fini) throw new Error('Un téléchargement est déjà en cours.')

  const fichier = path.join(config.dossierModeles, modele.local)
  const vision = path.join(config.dossierModeles, modele.vision_local)
  const changer = () => {
    const nouvelle = { ...installation(), modele: { code: modele.code, nom: modele.nom, fichier, vision } }
    ecrireJson(chemins.installation, nouvelle)
    journal(`Modèle d'IA changé : ${modele.nom}`)
    apresChangement?.()
  }

  if (fs.existsSync(fichier) && fs.existsSync(vision)) {
    changer()
    return { pret: true }
  }

  telechargement = { code, recu: 0, total: Math.round(modele.taille_go * 1e9), erreur: null, fini: false }
  const deja = { modele: 0 }
  ;(async () => {
    try {
      await telechargerDepuisHuggingFace(modele.depot, modele.fichier, fichier, (recu, total) => {
        deja.modele = total
        telechargement.recu = recu
      })
      await telechargerDepuisHuggingFace(modele.depot, modele.vision, vision, (recu) => {
        telechargement.recu = deja.modele + recu
      })
      telechargement.fini = true
      changer()
    } catch (erreur) {
      telechargement.erreur = erreur.message
      journal(`Téléchargement du modèle ${modele.nom} impossible : ${erreur.message}`)
    }
  })()
  return { pret: false }
}
