// Où se trouvent les choses sur ce poste.
//
// BiRTEC tourne depuis le dossier où il est installé (le profil de l'utilisateur) :
//   installation.json    → écrit par la préparation : moteur d'IA, Java, BIRT, pilote MySQL, carte graphique
//   reglages-poste.json  → réglages : connexion MySQL (sans le mot de passe), dossier de travail…
//   cache/               → fichiers temporaires (aperçus de rapports…)
//   moteur/              → Node, llama.cpp, Java, moteur BIRT

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

export const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const WINDOWS = process.platform === 'win32'

export const chemins = {
  installation: path.join(RACINE, 'installation.json'),
  reglagesPoste: path.join(RACINE, 'reglages-poste.json'),
  cache: path.join(RACINE, 'cache'),
  interface: path.join(RACINE, 'interface'),
  blocs: path.join(RACINE, 'blocs'),
  journal: path.join(RACINE, 'journal.txt'),
}

export function version() {
  try {
    return fs.readFileSync(path.join(RACINE, 'VERSION'), 'utf8').trim()
  } catch {
    return 'développement'
  }
}

// Dossier d'installation par défaut, dans le profil de l'utilisateur
// (les programmes ne peuvent pas être lancés ailleurs sur les postes verrouillés).
export function dossierInstallationParDefaut() {
  if (WINDOWS) {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
    return path.join(local, 'BiRTEC')
  }
  const donnees = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  return path.join(donnees, 'birtec')
}

// Les modèles sont de simples fichiers de données : sous Windows, on les range dans
// un dossier commun du poste pour ne pas les télécharger une fois par agent.
export function dossierModelesParDefaut() {
  // Les modèles sont les mêmes que ceux d'IASSITEC : s'il est installé sur le poste, on partage son dossier.
  const iassitec = WINDOWS
    ? path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'IASSITEC', 'modeles')
    : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'iassitec', 'modeles')
  if (fs.existsSync(iassitec)) return iassitec
  if (WINDOWS) {
    const public_ = process.env.PUBLIC || 'C:\\Users\\Public'
    return path.join(public_, 'BiRTEC', 'modeles')
  }
  return path.join(dossierInstallationParDefaut(), 'modeles')
}

export function lireJson(fichier, defaut) {
  try {
    return JSON.parse(fs.readFileSync(fichier, 'utf8'))
  } catch {
    return defaut
  }
}

export function ecrireJson(fichier, donnees) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true })
  fs.writeFileSync(fichier, JSON.stringify(donnees, null, 2) + '\n')
}

// installation.json : null si la préparation n'a pas encore été faite (l'IA est alors absente).
export function installation() {
  return lireJson(chemins.installation, null)
}

const REGLAGES_DEFAUT = {
  // Connexion MySQL. Le mot de passe n'est jamais enregistré : il est demandé à chaque ouverture.
  mysql: { serveur: '', port: 3306, base: '', utilisateur: '' },
  dossierTravail: '',   // rapports, modèles et fichiers BIRT (vide = Documents/BiRTEC)
  arretIAMinutes: 20,   // l'IA libère la mémoire après ce délai sans question
}

export function reglagesPoste() {
  const lus = lireJson(chemins.reglagesPoste, {})
  return { ...REGLAGES_DEFAUT, ...lus, mysql: { ...REGLAGES_DEFAUT.mysql, ...(lus.mysql || {}) } }
}

// Le dossier de travail : rapports (.rptdesign), modèles, bibliothèques et ressources BIRT.
export function dossierTravail() {
  const dossier = reglagesPoste().dossierTravail || path.join(os.homedir(), 'Documents', 'BiRTEC')
  for (const sous of ['rapports', 'modeles', 'ressources']) fs.mkdirSync(path.join(dossier, sous), { recursive: true })
  return dossier
}

export function modifierReglagesPoste(changements) {
  const reglages = { ...reglagesPoste(), ...changements }
  ecrireJson(chemins.reglagesPoste, reglages)
  return reglages
}

// Petit journal pour comprendre un problème après coup (journal.txt, 200 Ko au plus).
export function journal(...morceaux) {
  const ligne = `${new Date().toISOString()}  ${morceaux.join(' ')}\n`
  process.stdout.write(ligne)
  try {
    if (fs.existsSync(chemins.journal) && fs.statSync(chemins.journal).size > 200_000) {
      fs.renameSync(chemins.journal, chemins.journal + '.ancien')
    }
    fs.appendFileSync(chemins.journal, ligne)
  } catch {
    // le journal ne doit jamais empêcher l'application de fonctionner
  }
}
