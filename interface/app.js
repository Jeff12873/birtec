// L'interface de BiRTEC : le menu, la barre du haut, et l'écran du bloc choisi.
//
// Chaque écran est un « bloc » (dossier blocs/<nom>/vue.js) qui exporte :
//   { chemin, titre, icone, menu, aide, afficher(zone, { id, query }) }
// Pour ajouter un écran : créer son bloc puis l'ajouter à la liste BLOCS.

import { h, vider, ic, fenetreOuverte, notifier } from './socle/ui.js'
import { etat, suivreEtat, surChangement } from './socle/etat.js'
import accueil from '/blocs/accueil/vue.js'
import constructeur from '/blocs/constructeur/vue.js'
import assistant from '/blocs/assistant/vue.js'
import base from '/blocs/base/vue.js'
import rapports from '/blocs/rapports/vue.js'
import connaissances from '/blocs/connaissances/vue.js'
import itm from '/blocs/itm/vue.js'
import schema from '/blocs/schema/vue.js'
import configuration, { demanderMotDePasse } from '/blocs/configuration/vue.js'
import aide from '/blocs/aide/vue.js'

// L'ordre est celui du menu.
const BLOCS = [accueil, constructeur, rapports, itm, base, schema, connaissances, assistant, configuration, aide]

const racine = document.getElementById('appli')
const menu = h('nav', { class: 'menu' })
const barre = h('header', { class: 'barre' })
const zone = h('main', { class: 'contenu' })
let contenuBarre = ''

await suivreEtat()
vider(racine, h('div', { class: 'appli' }, menu, h('div', { class: 'zone-principale' }, barre, zone)))
surChangement(quandEtatChange)
window.addEventListener('hashchange', afficherBloc)

// Premier lancement : la connexion MySQL est à renseigner. Ensuite : le mot de passe est demandé à l'ouverture.
if (!etat.connexion.configuree) location.hash = '#/configuration'
else if (!etat.connexion.ouverte) demanderMotDePasse()
dessinerMenu()
dessinerBarre()
afficherBloc()

// ---------------------------------------------------------------- écrans

function routeActuelle() {
  const [chemin = '', ...reste] = location.hash.replace(/^#\/?/, '').split('?')[0].split('/')
  const query = Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''))
  const bloc = BLOCS.find((b) => b.chemin === chemin) || accueil
  return { bloc, id: reste.join('/') || null, query }
}

async function afficherBloc() {
  const { bloc, id, query } = routeActuelle()
  dessinerMenu()
  vider(zone)
  try {
    await bloc.afficher(zone, { id, query })
  } catch (erreur) {
    vider(zone, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
  }
}

function dessinerMenu() {
  const actuel = routeActuelle().bloc
  vider(
    menu,
    h('div', { class: 'menu-titre' }, h('img', { src: '/icone.svg', alt: '' }), h('div', {}, h('strong', {}, 'BiRTEC'), h('span', {}, 'Rapports BIRT'))),
    // Les écrans par groupe (« groupe » de chaque bloc) : un titre discret avant chaque nouveau groupe.
    // Le groupe « Réglages » est poussé en bas du menu.
    BLOCS.filter((b) => b.menu).map((b, i, liste) => [
      b.groupe && b.groupe !== liste[i - 1]?.groupe
        ? h('div', { class: `menu-groupe ${b.groupe === 'Réglages' ? 'en-bas' : ''}` }, b.groupe)
        : null,
      h('a', { href: `#/${b.chemin}`, class: b === actuel ? 'actif' : '' }, ic(b.icone, 19), h('span', {}, b.titre)),
    ]),
    h('div', { class: 'pied' }, `Version ${etat.version}`),
  )
}

// ---------------------------------------------------------------- barre du haut

function dessinerBarre() {
  const c = etat.connexion
  const cle = JSON.stringify([etat.ia, c])
  if (cle === contenuBarre) return
  contenuBarre = cle
  vider(
    barre,
    h('div', { class: 'espace' }),
    etiquetteIA(),
    etiquetteMySQL(c),
    h('button', { class: 'discret icone-seule', title: 'Aide sur cet écran', onclick: () => (location.hash = `#/aide/${routeActuelle().bloc.aide || 'premiers-pas'}`) }, ic('aide', 19)),
  )
}

function etiquetteIA() {
  const ia = etat.ia || {}
  if (!ia.installee) return h('span', { class: 'etiquette rouge', title: 'Lancez la préparation de BiRTEC sur ce poste' }, h('span', { class: 'point' }), 'IA non installée')
  const titre = `${ia.modele} sur ${ia.appareil}`
  if (ia.chat === 'démarrage') return h('span', { class: 'etiquette orange', title: titre }, h('span', { class: 'point anime' }), "Chargement de l'IA…")
  if (ia.chat === 'prêt') return h('span', { class: 'etiquette accent', title: titre }, h('span', { class: 'point' }), 'IA prête')
  return h('span', { class: 'etiquette', title: titre }, h('span', { class: 'point' }), 'IA en veille')
}

function etiquetteMySQL(c) {
  if (!c.configuree) return h('a', { class: 'etiquette orange', href: '#/configuration' }, ic('base', 15), 'MySQL à configurer')
  if (!c.ouverte) return h('button', { class: 'etiquette orange', onclick: demanderMotDePasse, title: 'Saisir le mot de passe MySQL' }, ic('cadenas', 15), `${c.base} : connexion fermée`)
  const avertissement = c.infos?.compteEnEcriture ? ' — attention : ce compte peut modifier la base' : ''
  return h('span', { class: `etiquette ${avertissement ? 'orange' : 'accent'}`, title: `${c.utilisateur}@${c.serveur}:${c.port} — ${c.infos?.serveur || ''}${avertissement}` }, ic('base', 15), `${c.base} sur ${c.serveur}`)
}

function quandEtatChange(nouveau) {
  if (nouveau.injoignable) return notifier('BiRTEC ne répond plus : relancez-le avec son raccourci.', 'erreur')
  dessinerBarre()
  if (fenetreOuverte()) return
}

window.birtec = { recharger: afficherBloc }
