// Préparation de BiRTEC sur un poste : à lancer une seule fois (puis pour changer de modèle).
//
// Lancée par « Preparer BiRTEC.bat » (Windows) ou « preparer-birtec.sh » (Linux),
// qui ont déjà téléchargé Node. Étapes :
//   1. copie de BiRTEC dans le profil de l'utilisateur
//   2. téléchargement de llama.cpp (le moteur d'IA), de Java, du moteur BIRT et du pilote MySQL
//   3. analyse du poste : mémoire, carte graphique
//   4. choix du modèle d'IA (proposé selon l'analyse, modifiable)
//   5. téléchargement des modèles (dans un dossier commun du poste sous Windows)
//   6. essai de l'IA
//   7. raccourcis sur le Bureau et dans le menu
//
// Version hors ligne : si le dossier contient un kit « hors-ligne/ » (fabriqué par
// outils/fabriquer-kit-hors-ligne.js), rien n'est téléchargé : Node, llama.cpp et les modèles sont copiés du kit.
//
// Options :
//   --ici                     préparer dans le dossier actuel, sans copie (pour le développement)
//   --modele mini|petit|moyen|grand   imposer un modèle
//   --dossier-modeles <dossier>       ranger les modèles ailleurs
//   --oui                     ne poser aucune question
//   --sans-raccourcis         ne pas créer de raccourcis

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WINDOWS = process.platform === 'win32'
const options = lireOptions(process.argv.slice(2))
const catalogue = JSON.parse(fs.readFileSync(path.join(SOURCE, 'outils', 'catalogue.json'), 'utf8'))
const KIT = path.join(SOURCE, 'hors-ligne')
const kit = fs.existsSync(path.join(KIT, 'kit.json')) ? JSON.parse(fs.readFileSync(path.join(KIT, 'kit.json'), 'utf8')) : null

// Ces modules sont importés après coup : ils viennent du dossier d'installation.
let telecharger, tailleLisible, decompresser, telechargerDepuisHuggingFace, modeleConseille

main().catch((erreur) => {
  console.error('\n✗ ' + erreur.message)
  console.error("\nLa préparation n'est pas terminée. Vous pouvez la relancer : elle reprendra où elle s'était arrêtée.")
  process.exitCode = 1
})

async function main() {
  titre(kit ? 'Préparation de BiRTEC (version hors ligne)' : 'Préparation de BiRTEC')
  if (kit && kit.systeme !== (WINDOWS ? 'windows' : 'linux')) throw new Error(`Ce kit hors ligne est fait pour ${kit.systeme}, pas pour ce système.`)

  // 1. Copie dans le profil de l'utilisateur ------------------------------------------
  const { dossierInstallationParDefaut, dossierModelesParDefaut } = await import('../serveur/socle/installation.js')
  const dossier = options.ici ? SOURCE : dossierInstallationParDefaut()
  etape(1, `Installation dans ${dossier}`)
  if (!options.ici && path.resolve(dossier) !== SOURCE) copierApplication(SOURCE, dossier)
  ;({ telecharger, tailleLisible } = await import(urlDe(dossier, 'serveur/socle/telechargement.js')))
  ;({ decompresser } = await import(urlDe(dossier, 'serveur/socle/zip.js')))
  ;({ telechargerDepuisHuggingFace, modeleConseille } = await import(urlDe(dossier, 'serveur/socle/modeles.js')))

  // 2. Moteur d'IA ---------------------------------------------------------------
  etape(2, `Moteur d'IA (llama.cpp ${catalogue.llama})`)
  let llama = await installerLlama(dossier, 'vulkan')
  let appareils = listerAppareils(llama)
  if (appareils === null) {
    console.log('  La version pour carte graphique ne fonctionne pas ici : on prend la version pour processeur.')
    llama = await installerLlama(dossier, 'cpu')
    appareils = listerAppareils(llama) || []
  }

  // 2 bis. Java, moteur BIRT et pilote MySQL ------------------------------------------------
  etape(2, `Java ${catalogue.java.version}, moteur BIRT ${catalogue.birt.version} et pilote MySQL`)
  const java = await installerJava(dossier)
  const birt = await installerBirt(dossier)
  const connecteur = await installerConnecteur(dossier)
  const moteurJava = compilerMoteurJava(dossier, java, birt, connecteur)

  // 3. Analyse du poste ----------------------------------------------------------------
  etape(3, 'Analyse du poste')
  const ram = Math.round(os.totalmem() / 1024 ** 3)
  const disque = espaceLibre(options.dossierModeles || dossierModelesParDefaut())
  const carte = choisirCarte(appareils)
  console.log(`  Système          : ${WINDOWS ? 'Windows' : 'Linux'} (${os.arch()})`)
  console.log(`  Processeur       : ${os.cpus()[0]?.model?.trim() || 'inconnu'} (${os.cpus().length} cœurs)`)
  console.log(`  Mémoire vive     : ${ram} Go`)
  for (const a of appareils) console.log(`  Carte graphique  : ${a.nom} (${a.memoireGo} Go${a.integree ? ', intégrée au processeur' : ''})`)
  if (!appareils.length) console.log('  Carte graphique  : aucune utilisable')
  if (disque !== null) console.log(`  Disque libre     : ${disque} Go`)
  console.log(`  L'IA utilisera   : ${carte ? carte.nom : 'le processeur seul'}`)

  // 4. Choix du modèle -----------------------------------------------------------------
  etape(4, 'Choix du modèle')
  const vram = carte ? carte.memoireGo : 0
  // Hors ligne, on ne peut choisir que parmi les modèles présents dans le kit.
  const disponibles = kit ? catalogue.modeles.filter((m) => kit.modeles.includes(m.code)) : catalogue.modeles
  const propose = modeleConseille({ modeles: disponibles }, ram, vram)
  disponibles.forEach((m, i) => console.log(`  ${i + 1}. ${m.nom.padEnd(28)} ${m.code === propose.code ? '← conseillé' : ''}\n     ${m.pour}`))
  if (kit) console.log(`  (version hors ligne : seuls les modèles du kit sont proposés)`)
  let modele = disponibles.find((m) => m.code === options.modele) || propose
  if (!options.oui && !options.modele) {
    const reponse = await demander(`\n  Modèle à installer [Entrée = ${modele.nom}, ou 1 à ${disponibles.length}] : `)
    if (disponibles[Number(reponse) - 1]) modele = disponibles[Number(reponse) - 1]
  }
  console.log(`  → ${modele.nom}`)

  // 5. Téléchargement des modèles ------------------------------------------------------------
  let dossierModeles = options.dossierModeles || dossierModelesParDefaut()
  etape(5, `Modèles d'IA, dans ${dossierModeles}`)
  try {
    fs.mkdirSync(dossierModeles, { recursive: true })
  } catch {
    dossierModeles = path.join(dossier, 'modeles')
    console.log(`  Dossier commun inaccessible : les modèles iront dans ${dossierModeles}`)
    fs.mkdirSync(dossierModeles, { recursive: true })
  }
  const fichierModele = await telechargerModele(modele.depot, modele.fichier, path.join(dossierModeles, modele.local))
  const fichierVision = await telechargerModele(modele.depot, modele.vision, path.join(dossierModeles, modele.vision_local))
  const recherche = catalogue.recherche
  const fichierRecherche = await telechargerModele(recherche.depot, recherche.fichier, path.join(dossierModeles, recherche.local))

  const config = {
    prepareLe: new Date().toISOString(),
    llama,
    java: java.java,
    birt,
    connecteur,
    moteurJava,
    appareil: carte ? carte.code : 'none',
    appareilNom: carte ? carte.nom : 'processeur',
    poste: { systeme: WINDOWS ? 'Windows' : 'Linux', ramGo: ram, carte: carte?.nom || null, vramGo: vram },
    dossierModeles,
    modele: { code: modele.code, nom: modele.nom, fichier: fichierModele, vision: fichierVision },
    recherche: { nom: recherche.nom, fichier: fichierRecherche, dimensions: recherche.dimensions },
  }
  fs.writeFileSync(path.join(dossier, 'installation.json'), JSON.stringify(config, null, 2) + '\n')

  // 6. Essai -----------------------------------------------------------------------------------
  etape(6, "Essai de l'IA (le premier chargement peut prendre une minute)")
  const ia = await import(urlDe(dossier, 'serveur/socle/ia.js'))
  try {
    const debut = Date.now()
    const reponse = await ia.discuter([{ role: 'user', content: 'Réponds seulement « Prêt. » en français.' }], { maxMots: 20 })
    console.log(`  Réponse du modèle : ${reponse}  (${Math.round((Date.now() - debut) / 1000)} s)`)
    const [vecteur] = await ia.vecteurs(['Essai de la recherche'])
    console.log(`  Recherche par le sens : OK (${vecteur.length} dimensions)`)
  } finally {
    ia.arreterIA()
  }

  // 7. Raccourcis ------------------------------------------------------------------------------
  etape(7, 'Raccourcis')
  if (options.raccourcis) await creerRaccourcis(dossier)
  else console.log('  (aucun raccourci demandé)')

  titre('BiRTEC est prêt')
  console.log(`  Lancez-le avec le raccourci « BiRTEC » du Bureau${WINDOWS ? ' ou du menu Démarrer' : ' ou du menu des applications'}.`)
  console.log('  Au premier lancement, renseignez la connexion MySQL dans Configuration.\n')
  process.exit(0)
}

// ---------------------------------------------------------------- étape 1

function copierApplication(source, destination) {
  const aCopier = ['serveur', 'blocs', 'interface', 'outils', 'docs', 'moteur-java', 'VERSION', 'package.json', 'README.md', 'LICENCE',
    'Lancer BiRTEC.bat', 'Preparer BiRTEC.bat', 'Fabriquer kit hors ligne.bat', 'lancer-birtec.sh', 'preparer-birtec.sh', 'fabriquer-kit-hors-ligne.sh']
  fs.mkdirSync(destination, { recursive: true })
  for (const nom of aCopier) {
    const depuis = path.join(source, nom)
    if (!fs.existsSync(depuis)) continue
    fs.rmSync(path.join(destination, nom), { recursive: true, force: true })
    fs.cpSync(depuis, path.join(destination, nom), { recursive: true })
  }
  console.log('  Fichiers copiés.')
}

// ---------------------------------------------------------------- étape 2

async function installerLlama(dossier, variante) {
  const cible = path.join(dossier, 'moteur', `llama-${variante}`)
  const executable = trouverFichier(cible, WINDOWS ? 'llama-server.exe' : 'llama-server')
  if (executable && fs.existsSync(path.join(cible, catalogue.llama))) {
    console.log(`  Déjà installé (${variante}).`)
    return executable
  }

  const nomArchive = WINDOWS
    ? `llama-${catalogue.llama}-bin-win-${variante}-x64.zip`
    : `llama-${catalogue.llama}-bin-ubuntu-${variante === 'cpu' ? '' : variante + '-'}x64.tar.gz`
  const url = `https://github.com/ggml-org/llama.cpp/releases/download/${catalogue.llama}/${nomArchive}`
  fs.rmSync(cible, { recursive: true, force: true })
  if (kit) {
    // Version hors ligne : llama.cpp est déjà décompressé dans le kit.
    if (!fs.existsSync(path.join(KIT, `llama-${variante}`))) throw new Error(`llama.cpp (${variante}) absent du kit hors ligne`)
    fs.cpSync(path.join(KIT, `llama-${variante}`), cible, { recursive: true })
    console.log(`  Copié depuis le kit (${variante}).`)
  } else {
    const archive = path.join(dossier, 'moteur', nomArchive)
    await telecharger(url, archive, { surProgression: progression(nomArchive) })
    finProgression()
    fs.mkdirSync(cible, { recursive: true })
    if (WINDOWS) decompresser(fs.readFileSync(archive), cible)
    else execFileSync('tar', ['-xzf', archive, '-C', cible])
    fs.rmSync(archive, { force: true })
  }
  fs.writeFileSync(path.join(cible, catalogue.llama), '') // repère de la version installée

  const installe = trouverFichier(cible, WINDOWS ? 'llama-server.exe' : 'llama-server')
  if (!installe) throw new Error('llama-server introuvable dans ' + nomArchive)
  if (!WINDOWS) fs.chmodSync(installe, 0o755)
  return installe
}

// Demande à llama.cpp les cartes qu'il voit. null = le moteur ne démarre même pas.
function listerAppareils(llama) {
  let sortie
  try {
    sortie = execFileSync(llama, ['--list-devices'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000, windowsHide: true })
  } catch (erreur) {
    if (!erreur.stdout && !erreur.stderr) return null
    sortie = `${erreur.stdout || ''}${erreur.stderr || ''}`
    if (!/Available devices/.test(sortie)) return null
  }
  // Exemple de ligne : « Vulkan0: NVIDIA GeForce RTX 4060 (8188 MiB, 7900 MiB free) »
  const appareils = []
  for (const [, code, nom, memoire] of sortie.matchAll(/^\s*(\w+\d+): (.+?) \((\d+) MiB/gm)) {
    appareils.push({ code, nom, memoireGo: Math.round(memoire / 1024), integree: estIntegree(nom) })
  }
  return appareils
}

// Les cartes intégrées au processeur partagent la mémoire vive : on ne s'en sert pas.
function estIntegree(nom) {
  return /llvmpipe|Ryzen|Raphael|Mendocino|Phoenix|Rembrandt|Renoir|Cezanne|Radeon\(TM\) Graphics|Radeon Graphics|Vega \d|Intel\(R\) (UHD|HD|Iris|Graphics)|Intel.*Arc.*Graphics$|Microsoft Basic/i.test(nom)
}

function choisirCarte(appareils) {
  const dediees = appareils.filter((a) => !a.integree && a.memoireGo >= 3)
  return dediees.sort((a, b) => b.memoireGo - a.memoireGo)[0] || null
}

// ---------------------------------------------------------------- étape 2 bis : Java, BIRT, pilote MySQL

// Java portable (Eclipse Temurin, JDK : le compilateur sert à préparer le moteur Java de BiRTEC).
async function installerJava(dossier) {
  const cible = path.join(dossier, 'moteur', 'java')
  const nomJava = WINDOWS ? 'java.exe' : 'java'
  let java = trouverFichier(cible, nomJava)
  if (!java) {
    fs.rmSync(cible, { recursive: true, force: true })
    fs.mkdirSync(cible, { recursive: true })
    if (kit) {
      fs.cpSync(path.join(KIT, 'java'), cible, { recursive: true })
      console.log('  Java copié depuis le kit.')
    } else {
      const archive = path.join(dossier, 'moteur', WINDOWS ? 'java.zip' : 'java.tar.gz')
      await telecharger(catalogue.java[WINDOWS ? 'windows' : 'linux'], archive, { surProgression: progression('Java') })
      finProgression()
      if (WINDOWS) decompresser(fs.readFileSync(archive), cible)
      else execFileSync('tar', ['-xzf', archive, '-C', cible])
      fs.rmSync(archive, { force: true })
    }
    java = trouverFichier(cible, nomJava)
    if (!java) throw new Error('Java introuvable après installation')
  }
  const javac = path.join(path.dirname(java), WINDOWS ? 'javac.exe' : 'javac')
  if (!WINDOWS) for (const f of [java, javac]) fs.chmodSync(f, 0o755)
  const versionJava = spawnSync(java, ['-version'], { encoding: 'utf8' }).stderr.split('\n')[0] // java -version écrit sur la sortie d'erreur
  console.log(`  ${versionJava || 'Java prêt.'}`)
  return { java, javac }
}

// Moteur BIRT (seulement la partie « ReportEngine » de l'archive : 100 Mo au lieu de 300).
async function installerBirt(dossier) {
  const cible = path.join(dossier, 'moteur', 'birt')
  if (fs.existsSync(path.join(cible, 'lib')) && fs.existsSync(path.join(cible, catalogue.birt.version))) {
    console.log(`  Moteur BIRT ${catalogue.birt.version} déjà installé.`)
    return cible
  }
  fs.rmSync(cible, { recursive: true, force: true })
  if (kit) {
    fs.cpSync(path.join(KIT, 'birt'), cible, { recursive: true })
  } else {
    const archive = path.join(dossier, 'moteur', 'birt.zip')
    await telecharger(catalogue.birt.url, archive, { surProgression: progression('Moteur BIRT') })
    finProgression()
    const temporaire = path.join(dossier, 'moteur', 'birt-temporaire')
    decompresser(fs.readFileSync(archive), temporaire, (nom) => nom.startsWith('ReportEngine/'))
    fs.renameSync(path.join(temporaire, 'ReportEngine'), cible)
    fs.rmSync(temporaire, { recursive: true, force: true })
    fs.rmSync(archive, { force: true })
  }
  fs.writeFileSync(path.join(cible, catalogue.birt.version), '')
  console.log(`  Moteur BIRT ${catalogue.birt.version} prêt.`)
  return cible
}

async function installerConnecteur(dossier) {
  const fichier = path.join(dossier, 'moteur', `mysql-connector-j-${catalogue.connecteur.version}.jar`)
  if (!fs.existsSync(fichier)) {
    if (kit) fs.copyFileSync(path.join(KIT, path.basename(fichier)), fichier)
    else await telecharger(catalogue.connecteur.url, fichier)
  }
  console.log(`  Pilote MySQL ${catalogue.connecteur.version} prêt.`)
  return fichier
}

// Compile moteur-java/Moteur.java (le programme Java de BiRTEC) dans moteur/classes.
function compilerMoteurJava(dossier, { javac }, birt, connecteur) {
  const classes = path.join(dossier, 'moteur', 'classes')
  fs.mkdirSync(classes, { recursive: true })
  const chemin = [connecteur, path.join(birt, 'lib', '*')].join(path.delimiter)
  execFileSync(javac, ['-encoding', 'UTF-8', '-d', classes, '-cp', chemin, path.join(dossier, 'moteur-java', 'Moteur.java')], { stdio: 'inherit' })
  console.log('  Moteur Java de BiRTEC compilé.')
  return classes
}

// ---------------------------------------------------------------- étape 5

async function telechargerModele(depot, fichier, destination) {
  const nom = path.basename(destination)
  if (kit) {
    await copierDuKit(path.join(KIT, 'modeles', nom), destination)
    console.log(`  ${nom} : prêt (${tailleLisible(fs.statSync(destination).size)})`)
    return destination
  }
  await telechargerDepuisHuggingFace(depot, fichier, destination, progression(nom))
  finProgression()
  console.log(`  ${nom} : prêt (${tailleLisible(fs.statSync(destination).size)})`)
  return destination
}

// Copie d'un gros fichier du kit (clé USB, partage…) avec avancement. Déjà présent et de même taille : rien à faire.
async function copierDuKit(source, destination) {
  if (!fs.existsSync(source)) throw new Error(`${path.basename(source)} absent du kit hors ligne`)
  const total = fs.statSync(source).size
  if (fs.existsSync(destination) && fs.statSync(destination).size === total) return
  const partiel = destination + '.partiel'
  const afficher = progression(path.basename(destination))
  let copie = 0
  await new Promise((ok, echec) => {
    fs.createReadStream(source)
      .on('data', (morceau) => afficher((copie += morceau.length), total))
      .on('error', echec)
      .pipe(fs.createWriteStream(partiel))
      .on('finish', ok)
      .on('error', echec)
  })
  finProgression()
  fs.renameSync(partiel, destination)
}

// ---------------------------------------------------------------- étape 7

async function creerRaccourcis(dossier) {
  // Les raccourcis pointent vers la copie de l'icône dans cache/ : BiRTEC la remplace
  // quand l'administrateur importe une nouvelle icône.
  const { mettreAJourIconeLocale, ICONE_PNG_LOCALE, ICONE_ICO_LOCALE } = await import(urlDe(dossier, 'serveur/socle/icone.js'))
  mettreAJourIconeLocale(null)
  const icone = ICONE_PNG_LOCALE
  if (WINDOWS) {
    const lanceur = path.join(dossier, 'Lancer BiRTEC.bat')
    const iconeIco = ICONE_ICO_LOCALE
    const bureau = execFileSync('powershell.exe', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('Desktop')"], { encoding: 'utf8' }).trim()
    const menu = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    for (const dossierRaccourci of [bureau, menu]) {
      const raccourci = path.join(dossierRaccourci, 'BiRTEC.lnk')
      // WindowStyle 7 = fenêtre réduite : on ne voit que le navigateur.
      const script = `$r = (New-Object -ComObject WScript.Shell).CreateShortcut('${raccourci}'); $r.TargetPath = '${lanceur}'; $r.WorkingDirectory = '${dossier}'; $r.IconLocation = '${iconeIco}'; $r.WindowStyle = 7; $r.Save()`
      try {
        execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { stdio: 'ignore' })
        console.log(`  Raccourci créé : ${raccourci}`)
      } catch {
        console.log(`  Raccourci impossible dans ${dossierRaccourci} : lancez « Lancer BiRTEC.bat » dans ${dossier}`)
      }
    }
    return
  }

  const lanceur = path.join(dossier, 'lancer-birtec.sh')
  fs.chmodSync(lanceur, 0o755)
  const fiche = `[Desktop Entry]\nType=Application\nName=BiRTEC\nComment=Assistant IA pour la maintenance\nExec=sh "${lanceur}"\nIcon=${icone}\nTerminal=false\nCategories=Office;Utility;\n`
  const applications = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications')
  fs.mkdirSync(applications, { recursive: true })
  fs.writeFileSync(path.join(applications, 'birtec.desktop'), fiche)
  console.log('  Ajouté au menu des applications.')
  try {
    const bureau = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' }).trim()
    if (bureau && fs.existsSync(bureau) && bureau !== os.homedir()) {
      fs.writeFileSync(path.join(bureau, 'birtec.desktop'), fiche, { mode: 0o755 })
      console.log('  Raccourci créé sur le Bureau.')
    }
  } catch {
    // pas de dossier Bureau : le menu suffit
  }
}

// ---------------------------------------------------------------- petits outils

function lireOptions(args) {
  const options = { ici: false, oui: false, raccourcis: true, modele: null, dossierModeles: null }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ici') options.ici = true
    else if (args[i] === '--oui') options.oui = true
    else if (args[i] === '--sans-raccourcis') options.raccourcis = false
    else if (args[i] === '--modele') options.modele = args[++i]
    else if (args[i] === '--dossier-modeles') options.dossierModeles = args[++i]
  }
  return options
}

function trouverFichier(dossier, nom) {
  if (!fs.existsSync(dossier)) return null
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    const chemin = path.join(dossier, entree.name)
    if (entree.isFile() && entree.name === nom) return chemin
    if (entree.isDirectory()) {
      const trouve = trouverFichier(chemin, nom)
      if (trouve) return trouve
    }
  }
  return null
}

function espaceLibre(dossier) {
  try {
    let existant = dossier
    while (!fs.existsSync(existant)) existant = path.dirname(existant)
    const infos = fs.statfsSync(existant)
    return Math.round((infos.bavail * infos.bsize) / 1024 ** 3)
  } catch {
    return null
  }
}

function urlDe(dossier, fichier) {
  return pathToFileURL(path.join(dossier, fichier)).href
}

async function demander(question) {
  const lecteur = readline.createInterface({ input: process.stdin, output: process.stdout })
  const reponse = await lecteur.question(question)
  lecteur.close()
  return reponse.trim()
}

let derniereMiseAJour = 0
function progression(nom) {
  return (recu, total) => {
    if (Date.now() - derniereMiseAJour < 500 && recu < total) return
    derniereMiseAJour = Date.now()
    const pourcent = total ? Math.floor((recu / total) * 100) : 0
    process.stdout.write(`\r  ${nom} : ${tailleLisible(recu)} / ${tailleLisible(total)} (${pourcent} %)      `)
  }
}

function finProgression() {
  process.stdout.write('\r' + ' '.repeat(90) + '\r')
}

function titre(texte) {
  console.log(`\n══ ${texte} ${'═'.repeat(Math.max(0, 60 - texte.length))}\n`)
}

function etape(numero, texte) {
  console.log(`\n[${numero}/7] ${texte}`)
}
