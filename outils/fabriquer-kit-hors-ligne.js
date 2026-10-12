// Fabrique la version hors ligne de BiRTEC : un dossier qui contient tout (programme, Node, llama.cpp,
// modèles d'IA), à copier sur une clé USB ou un partage pour installer des postes sans Internet.
// La version en ligne (BiRTEC.zip sur GitHub, qui télécharge au moment de la préparation) ne change pas.
//
// À lancer sur un PC connecté à Internet, Windows ou Linux : un kit Windows peut être fabriqué depuis Linux
// et inversement. Le plus simple : double-cliquer sur « Fabriquer kit hors ligne.bat » (Windows) ou lancer
// « sh fabriquer-kit-hors-ligne.sh » (Linux), qui posent les questions. Ou directement :
//     node outils/fabriquer-kit-hors-ligne.js
//
// Options :
//   --modeles petit,moyen      modèles à inclure (petit, moyen par défaut ; ajouter « grand » pour le lourd, +23,5 Go)
//   --systeme windows|linux    système des postes à installer (windows par défaut)
//   --dossier <dossier>        où créer le kit (par défaut : BiRTEC-hors-ligne-<système>, à côté de BiRTEC)
//   --choisir                  poser les questions (système, modèles, dossier) au lieu de prendre les valeurs par défaut
//
// Les fichiers déjà téléchargés sur ce PC (modèles de la préparation) sont repris, sans nouveau téléchargement.
// Sur le poste : copier le dossier, puis lancer « Preparer BiRTEC.bat » (ou preparer-birtec.sh).

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { RACINE, installation, dossierModelesParDefaut, version } from '../serveur/socle/installation.js'
import { telecharger, tailleLisible } from '../serveur/socle/telechargement.js'
import { telechargerDepuisHuggingFace, lireCatalogue } from '../serveur/socle/modeles.js'
import { decompresser } from '../serveur/socle/zip.js'
import { extraireTarGz } from '../serveur/socle/tar.js'

const options = lireOptions(process.argv.slice(2))
const catalogue = lireCatalogue()
const nodeVersion = fs.readFileSync(path.join(RACINE, 'Preparer BiRTEC.bat'), 'utf8').match(/NODE_VERSION=(v[\d.]+)/)[1]
let sortie, kit, temporaire

// Ce qui est copié du programme dans le kit.
const FICHIERS_DU_PROGRAMME = ['serveur', 'blocs', 'interface', 'outils', 'docs', 'moteur-java', 'VERSION', 'package.json', 'README.md',
  'Lancer BiRTEC.bat', 'Preparer BiRTEC.bat', 'Fabriquer kit hors ligne.bat', 'lancer-birtec.sh', 'preparer-birtec.sh', 'fabriquer-kit-hors-ligne.sh']

main().catch((erreur) => {
  console.error('\n✗ ' + erreur.message)
  console.error('Le kit n’est pas terminé. Relancez la commande : les fichiers déjà prêts ne sont pas refaits.')
  process.exitCode = 1
})

async function main() {
  if (options.choisir) await poserLesQuestions()
  sortie = path.resolve(options.dossier || path.join(RACINE, '..', `BiRTEC-hors-ligne-${options.systeme}`))
  kit = path.join(sortie, 'hors-ligne')
  temporaire = path.join(sortie, 'temporaire') // dans le kit : même disque, pour pouvoir déplacer les fichiers
  const modeles = options.modeles.map((code) => catalogue.modeles.find((m) => m.code === code) || erreur(`Modèle inconnu : ${code}`))
  const total = modeles.reduce((s, m) => s + m.taille_go, 0) + 0.7
  console.log(`\nKit hors ligne de BiRTEC pour ${options.systeme}`)
  console.log(`  Dossier : ${sortie}`)
  console.log(`  Modèles : ${modeles.map((m) => m.nom).join(', ')} (environ ${total.toFixed(1).replace('.', ',')} Go en tout)\n`)
  fs.mkdirSync(kit, { recursive: true })
  fs.mkdirSync(temporaire, { recursive: true })

  // 1. Le programme ---------------------------------------------------------------
  console.log('[1/5] Programme')
  for (const nom of FICHIERS_DU_PROGRAMME) {
    fs.rmSync(path.join(sortie, nom), { recursive: true, force: true })
    fs.cpSync(path.join(RACINE, nom), path.join(sortie, nom), { recursive: true })
  }
  if (options.systeme === 'linux' && process.platform !== 'win32') for (const sh of ['lancer-birtec.sh', 'preparer-birtec.sh', 'fabriquer-kit-hors-ligne.sh']) fs.chmodSync(path.join(sortie, sh), 0o755)

  // 2. Node -----------------------------------------------------------------------
  console.log(`[2/5] Node ${nodeVersion}`)
  if (!fs.existsSync(path.join(kit, 'node'))) {
    const nom = options.systeme === 'windows' ? `node-${nodeVersion}-win-x64` : `node-${nodeVersion}-linux-x64`
    const archive = path.join(temporaire, options.systeme === 'windows' ? `${nom}.zip` : `${nom}.tar.gz`)
    await telecharger(`https://nodejs.org/dist/${nodeVersion}/${path.basename(archive)}`, archive, { surProgression: progression(path.basename(archive)) })
    finProgression()
    // Nos propres lecteurs ZIP et tar : le kit se fabrique de la même façon sous Windows et sous Linux.
    if (options.systeme === 'windows') decompresser(fs.readFileSync(archive), temporaire)
    else extraireTarGz(fs.readFileSync(archive), temporaire)
    fs.renameSync(path.join(temporaire, nom), path.join(kit, 'node'))
  }

  // 3. llama.cpp, versions carte graphique (Vulkan) et processeur --------------------------
  console.log(`[3/5] Moteur d'IA llama.cpp ${catalogue.llama}`)
  for (const variante of ['vulkan', 'cpu']) {
    const cible = path.join(kit, `llama-${variante}`)
    if (fs.existsSync(path.join(cible, catalogue.llama))) continue
    const nomArchive =
      options.systeme === 'windows'
        ? `llama-${catalogue.llama}-bin-win-${variante}-x64.zip`
        : `llama-${catalogue.llama}-bin-ubuntu-${variante === 'cpu' ? '' : variante + '-'}x64.tar.gz`
    const archive = path.join(temporaire, nomArchive)
    await telecharger(`https://github.com/ggml-org/llama.cpp/releases/download/${catalogue.llama}/${nomArchive}`, archive, { surProgression: progression(nomArchive) })
    finProgression()
    fs.rmSync(cible, { recursive: true, force: true })
    fs.mkdirSync(cible, { recursive: true })
    if (options.systeme === 'windows') decompresser(fs.readFileSync(archive), cible)
    else extraireTarGz(fs.readFileSync(archive), cible)
    fs.writeFileSync(path.join(cible, catalogue.llama), '')
  }

  // 4. Java, moteur BIRT, pilote MySQL ---------------------------------------------
  console.log(`[4/5] Java ${catalogue.java.version}, moteur BIRT ${catalogue.birt.version}, pilote MySQL`)
  if (!fs.existsSync(path.join(kit, 'java'))) {
    const archive = path.join(temporaire, options.systeme === 'windows' ? 'java.zip' : 'java.tar.gz')
    await telecharger(catalogue.java[options.systeme], archive, { surProgression: progression('Java') })
    finProgression()
    fs.mkdirSync(path.join(kit, 'java'), { recursive: true })
    if (options.systeme === 'windows') decompresser(fs.readFileSync(archive), path.join(kit, 'java'))
    else extraireTarGz(fs.readFileSync(archive), path.join(kit, 'java'))
  }
  // Le moteur BIRT et le pilote MySQL sont en Java : les mêmes pour Windows et Linux.
  const birtLocal = installation()?.birt
  if (!fs.existsSync(path.join(kit, 'birt', catalogue.birt.version))) {
    fs.rmSync(path.join(kit, 'birt'), { recursive: true, force: true })
    if (birtLocal && fs.existsSync(path.join(birtLocal, catalogue.birt.version))) {
      fs.cpSync(birtLocal, path.join(kit, 'birt'), { recursive: true })
    } else {
      const archive = path.join(temporaire, 'birt.zip')
      await telecharger(catalogue.birt.url, archive, { surProgression: progression('Moteur BIRT') })
      finProgression()
      decompresser(fs.readFileSync(archive), temporaire, (nom) => nom.startsWith('ReportEngine/'))
      fs.renameSync(path.join(temporaire, 'ReportEngine'), path.join(kit, 'birt'))
      fs.writeFileSync(path.join(kit, 'birt', catalogue.birt.version), '')
    }
  }
  const connecteur = path.join(kit, `mysql-connector-j-${catalogue.connecteur.version}.jar`)
  if (!fs.existsSync(connecteur)) {
    const local = installation()?.connecteur
    if (local && fs.existsSync(local) && path.basename(local) === path.basename(connecteur)) fs.copyFileSync(local, connecteur)
    else await telecharger(catalogue.connecteur.url, connecteur)
  }

  // 5. Modèles d'IA ---------------------------------------------------------------
  console.log('[5/5] Modèles d’IA')
  const dossierModeles = path.join(kit, 'modeles')
  fs.mkdirSync(dossierModeles, { recursive: true })
  const fichiers = [
    ...modeles.flatMap((m) => [
      { depot: m.depot, fichier: m.fichier, local: m.local },
      { depot: m.depot, fichier: m.vision, local: m.vision_local },
    ]),
    { depot: catalogue.recherche.depot, fichier: catalogue.recherche.fichier, local: catalogue.recherche.local },
  ]
  // Où chercher des modèles déjà présents : installation de ce PC, dossier commun, kit d'où l'on part.
  const dejaSurCePC = [installation()?.dossierModeles, dossierModelesParDefaut(), path.join(RACINE, 'hors-ligne', 'modeles')].filter(Boolean)
  for (const f of fichiers) {
    const destination = path.join(dossierModeles, f.local)
    const existant = dejaSurCePC.map((d) => path.join(d, f.local)).find((chemin) => fs.existsSync(chemin) && path.resolve(chemin) !== path.resolve(destination))
    if (!fs.existsSync(destination) && existant) {
      console.log(`  ${f.local} : copié depuis ce PC`)
      fs.copyFileSync(existant, destination)
    }
    // Vérifie (taille et empreinte) le fichier copié, ou le télécharge.
    await telechargerDepuisHuggingFace(f.depot, f.fichier, destination, progression(f.local))
    finProgression()
    console.log(`  ${f.local} : prêt (${tailleLisible(fs.statSync(destination).size)})`)
  }

  fs.writeFileSync(
    path.join(kit, 'kit.json'),
    JSON.stringify({ systeme: options.systeme, version: version(), llama: catalogue.llama, node: nodeVersion, modeles: modeles.map((m) => m.code), creeLe: new Date().toISOString() }, null, 2) + '\n',
  )
  fs.writeFileSync(path.join(sortie, 'LISEZ-MOI (hors ligne).txt'), lisezMoi(modeles), options.systeme === 'windows' ? { encoding: 'utf8' } : undefined)
  fs.rmSync(temporaire, { recursive: true, force: true })
  console.log(`\nKit prêt : ${sortie}\nCopiez ce dossier entier (clé USB, partage) puis, sur le poste, lancez ${options.systeme === 'windows' ? '« Preparer BiRTEC.bat »' : 'preparer-birtec.sh'}.\n`)
}

function lisezMoi(modeles) {
  const texte = `BiRTEC — version hors ligne (${options.systeme === 'windows' ? 'Windows' : 'Linux'})
=================================================

Ce dossier contient tout ce qu'il faut pour installer BiRTEC sur un poste SANS connexion à Internet :
le programme, Node, le moteur d'IA llama.cpp, Java, le moteur BIRT, le pilote MySQL et les modèles suivants :
${modeles.map((m) => `  - ${m.nom}`).join('\n')}

Installation sur un poste :
  1. Copier ce dossier entier sur le poste (ou le laisser sur la clé USB / le partage).
  2. ${options.systeme === 'windows' ? 'Double-cliquer sur « Preparer BiRTEC.bat ».' : 'Lancer : sh preparer-birtec.sh'}
     BiRTEC est installé dans le profil de l'utilisateur, les modèles copiés, puis l'IA est essayée.
  3. Lancer BiRTEC avec le raccourci créé sur le Bureau.

Ensuite, le poste n'a plus besoin de ce dossier.

Mises à jour : la version hors ligne ne se met pas à jour toute seule. Fabriquer un nouveau kit
(node outils/fabriquer-kit-hors-ligne.js sur un PC connecté) et relancer la préparation sur le poste :
le fichier de l'atelier et les réglages sont gardés.

Version de BiRTEC : ${version()} — fabriqué le ${new Date().toLocaleDateString('fr-FR')}
`
  return options.systeme === 'windows' ? texte.replace(/\n/g, '\r\n') : texte
}

// Les trois questions des lanceurs « Fabriquer kit hors ligne ».
async function poserLesQuestions() {
  // On lit les réponses ligne par ligne (fonctionne aussi quand les réponses arrivent toutes d'un coup).
  const lecteur = readline.createInterface({ input: process.stdin })
  const lignes = lecteur[Symbol.asyncIterator]()
  const demander = async (question) => {
    process.stdout.write(question)
    const { value } = await lignes.next()
    return (value || '').trim()
  }
  console.log('\nFabrication d’un kit hors ligne de BiRTEC (à copier sur une clé USB pour des postes sans Internet)\n')

  const systeme = await demander('Pour quels postes ?\n  1. Windows\n  2. Linux\nVotre choix [1] : ')
  options.systeme = systeme === '2' ? 'linux' : 'windows'

  const formules = [
    ['petit', 'moyen'],
    ['moyen'],
    ['moyen', 'grand'],
    ['petit', 'moyen', 'grand'],
  ]
  const nom = (codes) => codes.map((c) => catalogue.modeles.find((m) => m.code === c).nom).join(' + ')
  const taille = (codes) => (codes.reduce((s, c) => s + catalogue.modeles.find((m) => m.code === c).taille_go, 0) + 0.7).toFixed(0)
  console.log('\nQuels modèles d’IA ?')
  formules.forEach((f, i) => console.log(`  ${i + 1}. ${nom(f)} (environ ${taille(f)} Go)`))
  const choix = Number(await demander('Votre choix [1] : ')) || 1
  options.modeles = formules[choix - 1] || formules[0]

  const parDefaut = path.resolve(path.join(RACINE, '..', `BiRTEC-hors-ligne-${options.systeme}`))
  const dossier = await demander(`\nDossier du kit [${parDefaut}] : `)
  options.dossier = dossier || parDefaut
  lecteur.close()
}

function lireOptions(args) {
  const options = { modeles: ['petit', 'moyen'], systeme: 'windows', dossier: null, choisir: false }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--choisir') options.choisir = true
    else if (args[i] === '--modeles') options.modeles = args[++i].split(',').map((c) => c.trim()).filter(Boolean)
    else if (args[i] === '--systeme') options.systeme = args[++i]
    else if (args[i] === '--dossier') options.dossier = args[++i]
  }
  if (!['windows', 'linux'].includes(options.systeme)) erreur('--systeme : windows ou linux')
  return options
}

function erreur(message) {
  throw new Error(message)
}

let derniere = 0
function progression(nom) {
  return (recu, total) => {
    if (Date.now() - derniere < 500 && recu < total) return
    derniere = Date.now()
    process.stdout.write(`\r  ${nom} : ${tailleLisible(recu)} / ${tailleLisible(total)} (${total ? Math.floor((recu / total) * 100) : 0} %)      `)
  }
}

function finProgression() {
  process.stdout.write('\r' + ' '.repeat(90) + '\r')
}
