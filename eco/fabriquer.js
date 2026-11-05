// Fabrique BiRTEC éco+ : une seule page HTML, sans K.NOVA ni base. Les vrais modules de BiRTEC (constellation, LA
// PHRASE, générateur de .rptdesign) et du socle de K.NOVA (interface) y sont embarqués tels quels ; ce qui demande
// le serveur ou la base est remplacé par les « cales » (eco/cales). Chaque module devient une adresse data: d'une
// carte d'import (importmap), ses imports réécrits vers ces adresses.
//
//   node eco/fabriquer.js <sortie.html> [--ktec <dossier de K.NOVA>]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = path.dirname(fileURLToPath(import.meta.url))
const RACINE = path.dirname(ICI)
const args = process.argv.slice(2)
const option = (nom, defaut) => { const i = args.indexOf(nom); return i < 0 ? defaut : args[i + 1] }
const KTEC = path.resolve(option('--ktec', path.join(RACINE, '..', 'KTEC')))
const SOCLE = path.join(KTEC, 'interface', 'socle')

// Ce que les cales remplacent (chemins réels → cale).
const CALES = {
  [path.join(SOCLE, 'etat.js')]: 'cales/etat.js',
  [path.join(RACINE, 'blocs/base/vue.js')]: 'cales/base-vue.js',
  [path.join(RACINE, 'blocs/base/schema.js')]: 'cales/schema.js',
  [path.join(RACINE, 'blocs/rapports/serveur.js')]: 'cales/rapports.js',
  [path.join(RACINE, 'blocs/indicateurs/serveur.js')]: 'cales/indicateurs.js',
}
const KTEC_CALES = { 'ktec/http.js': 'cales/http.js', 'ktec/mysql.js': 'cales/mysql.js', 'ktec/ktec.js': 'cales/ktec.js', 'ktec/installation.js': 'cales/installation.js' }
const TYPES = { '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' }

function resoudre(specificateur, depuis) {
  let fichier
  if (specificateur.startsWith('/socle/')) fichier = path.join(SOCLE, specificateur.slice('/socle/'.length))
  else if (KTEC_CALES[specificateur]) fichier = path.join(ICI, KTEC_CALES[specificateur])
  else if (specificateur.startsWith('.')) fichier = path.resolve(path.dirname(depuis), specificateur)
  else throw new Error(`Import inconnu dans ${depuis} : ${specificateur}`)
  return CALES[fichier] ? path.join(ICI, CALES[fichier]) : fichier
}
// L'identifiant d'un module dans la carte d'import (sans « / » de tête ni « . » : un nom « nu »).
const identifiant = (fichier) => {
  const dans = (dossier, nom) => (fichier.startsWith(dossier + path.sep) ? `eco/${nom}/${path.relative(dossier, fichier).split(path.sep).join('/')}` : null)
  return dans(RACINE, 'birtec') || dans(KTEC, 'ktec') || (() => { throw new Error(`Module hors de BiRTEC et de K.NOVA : ${fichier}`) })()
}
const dataUrl = (fichier) => `data:${TYPES[path.extname(fichier)]};base64,${fs.readFileSync(fichier).toString('base64')}`

const modules = new Map()
function ajouter(fichier) {
  const id = identifiant(fichier)
  if (modules.has(id)) return id
  modules.set(id, null)
  let code = fs.readFileSync(fichier, 'utf8')
  // L'application de la page : aucune (les routes /api/… gardent leur nom, le routeur de la page y répond).
  if (fichier === path.join(SOCLE, 'api.js')) code = code.replace(/export const appli = [^\n]+/, 'export const appli = null')
  code = code.replace(/((?:import|export)\s[^'"]*?from\s*|import\(\s*|import\s+)(['"])([^'"]+)\2/g, (tout, debut, guillemet, spec) => {
    if (spec.startsWith('node:')) throw new Error(`Module Node dans la page : ${spec} (${fichier})`)
    return `${debut}${guillemet}${ajouter(resoudre(spec, fichier))}${guillemet}`
  })
  // Les images trouvées à côté du module (new URL('…', import.meta.url)) voyagent dans la page.
  code = code.replace(/new URL\((['"])([^'"]+)\1,\s*import\.meta\.url\)\.href/g, (_, g, rel) => JSON.stringify(dataUrl(path.resolve(path.dirname(fichier), rel))))
  modules.set(id, `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`)
  return id
}

const entree = ajouter(path.join(ICI, 'amorce.js'))
const lire = (f) => fs.readFileSync(f, 'utf8')
const css = [lire(path.join(KTEC, 'interface', 'theme.css')), lire(path.join(RACINE, 'interface', 'app.css')).replace(/url\((['"]?)([\w.-]+\.webp)\1\)/g, (_, g, nom) => `url("${dataUrl(path.join(RACINE, 'interface', nom))}")`), lire(path.join(ICI, 'eco.css'))].join('\n')
const sansFinDeScript = (t) => t.replace(/<\/script/gi, '<\\/script')
const version = lire(path.join(RACINE, 'VERSION')).trim()
const remplacements = {
  __VERSION__: version,
  __CSS__: css,
  __ICONE__: dataUrl(path.join(RACINE, 'interface', 'icone.svg')),
  __XLSX__: sansFinDeScript(lire(path.join(ICI, 'vendor', 'xlsx.full.min.js'))),
  __CARTE__: JSON.stringify({ imports: Object.fromEntries(modules) }),
  __ENTREE__: entree,
}
let html = lire(path.join(ICI, 'modele.html'))
for (const [cle, valeur] of Object.entries(remplacements)) html = html.split(cle).join(valeur)

const sortie = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--ktec')
if (!sortie) {
  console.error('Usage : node eco/fabriquer.js <sortie.html> [--ktec <dossier de K.NOVA>]')
  process.exit(1)
}
fs.writeFileSync(sortie, html)
console.log(`BiRTEC éco+ ${version} : ${sortie} (${modules.size} modules, ${Math.round(html.length / 1024)} Ko)`)
