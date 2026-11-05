// BiRTEC éco+ : LA PHRASE et la constellation de BiRTEC dans une seule page HTML, sans K.NOVA ni base de données.
// On y glisse le fichier de schéma exporté par K.NOVA (tables, colonnes, liens, noms clairs) : la phrase donne le
// SQL à copier, le rapport .rptdesign à télécharger ; un .rptdesign se relit en phrase ; un export Excel s'affiche
// dans « Aperçu ». Tout reste sur le poste.
import './tampon.js'
import { h, vider, ic, notifier } from '/socle/ui.js'
import { brancherRouteur } from './routeur.js'
import { chargerMagasin, definirSchema, magasin } from './cales/magasin.js'
import { definirAssociations } from '../blocs/phrase/serveur.js'
import constellation from '../blocs/schema/vue.js'
import { apercu } from './apercu.js'

brancherRouteur()
const racine = document.getElementById('appli')
const zone = h('main', { class: 'contenu' })
const onglets = h('div', { class: 'segments petits' })
let ecran = 'constellation'

window.ktec = { recharger: () => afficher() }
// Après un rapport, la constellation renvoie vers « Rapports » : ici, on reste sur l'écran affiché.
window.addEventListener('hashchange', () => { if (location.hash) history.replaceState(null, '', location.pathname) })

function choisirSchema() {
  const choix = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } })
  choix.addEventListener('change', () => lireFichierSchema(choix.files[0]))
  document.body.append(choix)
  choix.click()
  setTimeout(() => choix.remove(), 60_000)
}
async function lireFichierSchema(fichier) {
  if (!fichier) return
  try {
    const d = await definirSchema(JSON.parse(await fichier.text()))
    appliquerAssociations()
    notifier(`Schéma chargé : ${d.schema.tables.length} tables${d.base ? ` (${d.base})` : ''}`)
    afficher()
  } catch (erreur) {
    notifier(erreur.message.startsWith('Ce n’est pas') ? erreur.message : `Fichier illisible : ${erreur.message}`, 'erreur')
  }
}
const appliquerAssociations = () => definirAssociations(magasin()?.associations || [])

function barre() {
  const m = magasin()
  vider(onglets, [['constellation', 'Constellation et LA PHRASE', 'reseau'], ['apercu', 'Aperçu d’un export', 'tableau']].map(([cle, texte, icone]) =>
    h('button', { class: ecran === cle ? 'choisi' : '', onclick: () => { ecran = cle; afficher() } }, ic(icone, 15), texte)))
  return h('header', { class: 'barre-eco' },
    h('div', { class: 'marque-eco' }, h('span', { class: 'nom-eco' }, 'BiR', h('b', {}, 'TEC')), h('span', { class: 'pastille-eco' }, 'éco+')),
    m ? onglets : null,
    h('div', { class: 'actions-eco' },
      m ? h('span', { class: 'discret', title: m.le ? `Exporté par K.NOVA le ${new Date(m.le).toLocaleString('fr-FR')}` : '' }, `${m.schema.tables.length} tables${m.base ? ` · ${m.base}` : ''}`) : null,
      h('button', { class: 'petit', onclick: choisirSchema }, ic('dossier', 14), m ? 'Changer de schéma' : 'Ouvrir un schéma')))
}

function accueil() {
  const depot = h('div', { class: 'depot-eco' },
    ic('base', 40),
    h('h2', {}, 'Glissez ici le fichier de schéma'),
    h('p', { class: 'texte-2' }, 'Le fichier « birtec-schema….json » s’exporte depuis K.NOVA : BiRTEC › Constellation › « Pour BiRTEC éco+ ». Il contient la structure de la base (tables, colonnes, liens, noms clairs), jamais de mot de passe ni de données.'),
    h('button', { class: 'principal', onclick: choisirSchema }, ic('dossier', 16), 'Choisir le fichier'))
  for (const evenement of ['dragover', 'dragenter']) depot.addEventListener(evenement, (e) => { e.preventDefault(); depot.classList.add('survol') })
  depot.addEventListener('dragleave', () => depot.classList.remove('survol'))
  depot.addEventListener('drop', (e) => { e.preventDefault(); depot.classList.remove('survol'); lireFichierSchema(e.dataTransfer.files[0]) })
  return h('div', { class: 'accueil-eco' }, depot,
    h('ul', { class: 'texte-2 atouts-eco' },
      h('li', {}, h('b', {}, 'LA PHRASE → SQL'), ' : écrivez votre question, copiez la requête.'),
      h('li', {}, h('b', {}, 'Rapport BIRT'), ' : « Créer un rapport » télécharge le .rptdesign.'),
      h('li', {}, h('b', {}, 'Relire un .rptdesign'), ' : sa requête redevient une phrase.'),
      h('li', {}, h('b', {}, 'Aperçu'), ' : un export Excel ou CSV, trié et filtré.')))
}

async function afficher() {
  const m = magasin()
  vider(racine, h('div', { class: 'appli-eco' }, barre(), zone))
  vider(zone)
  if (!m) return vider(zone, accueil())
  try {
    if (ecran === 'apercu') return apercu(zone)
    await constellation.afficher(zone, { id: null, query: {} })
  } catch (erreur) {
    vider(zone, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
  }
}

await chargerMagasin()
// Téléchargée depuis le portail de K.NOVA (pastille « Eco+ ») : le schéma du site est dans la page ; il remplace
// un schéma plus ancien gardé par le navigateur.
const site = window.BIRTEC_ECO_SITE
if (site && String(magasin()?.le || '') < String(site.le || '')) await definirSchema(site).catch(() => {})
appliquerAssociations()
// Un schéma glissé n'importe où sur la page remplace le précédent.
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => {
  const f = e.dataTransfer?.files?.[0]
  if (f && /\.json$/i.test(f.name) && !e.defaultPrevented) { e.preventDefault(); lireFichierSchema(f) }
})
afficher()
