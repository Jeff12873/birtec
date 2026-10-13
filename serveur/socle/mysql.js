// La connexion à MySQL, par le moteur Java (moteur-java/Moteur.java).
//
// Le mot de passe est demandé à chaque ouverture de BiRTEC et gardé en mémoire seulement :
// il n'est jamais écrit sur le disque, et il est transmis au moteur Java par son entrée standard.
// Les autres informations (serveur, port, base, utilisateur) sont dans reglages-poste.json.

import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { installation, reglagesPoste, journal } from './installation.js'

let motDePasse = null // en mémoire seulement
let infosServeur = null // { serveur, base, compteEnEcriture } après une connexion réussie

export function etatConnexion() {
  const { mysql } = reglagesPoste()
  return {
    configuree: Boolean(mysql.serveur && mysql.base && mysql.utilisateur),
    ouverte: motDePasse !== null,
    ...mysql,
    infos: infosServeur,
  }
}

// Ouvre la session : vérifie le mot de passe auprès de MySQL, puis le garde en mémoire.
export async function ouvrirSession(mdp) {
  const resultat = await moteurJava('tester', {}, { motDePasse: mdp })
  motDePasse = mdp
  infosServeur = resultat
  journal(`Connexion MySQL ouverte : ${resultat.serveur}, base ${resultat.base}`)
  return resultat
}

export function fermerSession() {
  motDePasse = null
  infosServeur = null
}

export function lireSchema() {
  exigerSession()
  return moteurJava('schema', {}, { motDePasse })
}

// Requête de lecture (le moteur Java refuse tout ce qui n'est pas SELECT, WITH, SHOW, DESCRIBE, EXPLAIN).
export function executerRequete(sql, limite = 200) {
  exigerSession()
  return moteurJava('requete', { limite }, { motDePasse, texte: sql })
}

// Fait tourner un rapport dans le moteur BIRT (aperçu HTML ou export). Renvoie { erreurs }.
export function rendreRapport(fichier, format, sortie, parametres = {}, ressources = null) {
  exigerSession()
  const options = { rapport: fichier, format, sortie }
  if (ressources) options.ressources = ressources
  const parametresListe = Object.entries(parametres).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([nom, valeur]) => `${nom}=${valeur}`)
  return moteurJava('rendu', options, { motDePasse, parametres: parametresListe, delai: 300_000 })
}

// Vérifie un .rptdesign sans le faire tourner (pas besoin de mot de passe). Renvoie { ok, erreurs }.
export function verifierRapport(fichier) {
  return moteurJava('verifier', { rapport: fichier })
}

function exigerSession() {
  if (motDePasse === null) throw Object.assign(new Error('Connexion MySQL fermée : saisissez le mot de passe.'), { statut: 401 })
}

// ---------------------------------------------------------------- lancement du moteur Java

function urlJdbc() {
  const { mysql } = reglagesPoste()
  if (!mysql.serveur || !mysql.base) throw Object.assign(new Error('Connexion MySQL à renseigner dans Configuration.'), { statut: 409 })
  return `jdbc:mysql://${mysql.serveur}:${mysql.port || 3306}/${mysql.base}`
}

export function javaInstalle() {
  const config = installation()
  return Boolean(config?.java && fs.existsSync(config.java) && fs.existsSync(config.moteurJava))
}

// Lance une commande du moteur Java et renvoie sa réponse (JSON). Lance une erreur si le moteur en signale une.
export function moteurJava(commande, options = {}, { motDePasse: mdp = '', texte = '', delai = 120_000, parametres = [] } = {}) {
  const config = installation()
  if (!javaInstalle()) throw Object.assign(new Error("Java n'est pas installé sur ce poste : lancez la préparation."), { statut: 409 })
  const { mysql } = reglagesPoste()
  const classes = [config.moteurJava, config.connecteur, path.join(config.birt, 'lib', '*')].join(path.delimiter)
  const args = ['-cp', classes, 'Moteur', commande, '--url', urlJdbc(), '--utilisateur', mysql.utilisateur]
  for (const [nom, valeur] of Object.entries(options)) args.push(`--${nom}`, String(valeur))
  for (const parametre of parametres) args.push('--param', parametre) // paramètres de rapport « nom=valeur »

  return new Promise((ok, echec) => {
    const processus = spawn(config.java, args, { windowsHide: true })
    let sortie = ''
    let erreurs = ''
    const minuterie = setTimeout(() => processus.kill(), delai)
    processus.stdout.on('data', (morceau) => (sortie += morceau))
    processus.stderr.on('data', (morceau) => (erreurs += morceau))
    processus.on('error', echec)
    processus.on('close', () => {
      clearTimeout(minuterie)
      const ligne = sortie.trim().split('\n').pop() // la réponse JSON est la dernière ligne
      let reponse
      try {
        reponse = JSON.parse(ligne)
      } catch {
        journal(`Moteur Java (${commande}) : réponse illisible\n${erreurs.slice(-2000)}`)
        return echec(new Error('Le moteur Java a échoué (voir journal.txt).'))
      }
      if (reponse.erreur) return echec(Object.assign(new Error(reponse.erreur), { statut: 400 }))
      ok(reponse)
    })
    processus.stdin.end(`${mdp}\n${texte}`)
  })
}
