// Page d'accueil : quelques indicateurs (chiffre du jour) et des raccourcis vers les rapports enregistrés.
// « Organiser » permet d'en ajouter, d'en retirer et de les ranger par glisser-déposer.
// Le choix et l'ordre sont gardés dans le fichier .ktec.

import { h, vider, ic } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat } from '/socle/etat.js'
import { demanderMotDePasse } from '../configuration/vue.js'
import { afficherQuestion } from '../assistant/vue.js'

let organiser = false

export default {
  chemin: 'accueil',
  titre: 'Accueil',
  icone: 'accueil',
  menu: true,
  aide: 'premiers-pas',
  rafraichir: false, // ne pas recharger l'écran pendant une question

  async afficher(zone) {
    const donnees = await api('/api/accueil')
    let indicateurs = donnees.indicateurs
    let rapports = donnees.rapports

    const enregistrer = () => api('/api/accueil', { methode: 'POST', corps: { indicateurs: indicateurs.map((i) => i.id), rapports: rapports.map((r) => r.nom) } })
    const redessiner = () => window.ktec.recharger()

    // Glisser-déposer à l'intérieur d'une liste : l'élément lâché prend la place de celui survolé.
    function rangeable(element, liste, index, quandChange) {
      if (!organiser) return element
      element.draggable = true
      element.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(index))
        element.classList.add('deplace')
      })
      element.addEventListener('dragend', () => element.classList.remove('deplace'))
      element.addEventListener('dragover', (e) => e.preventDefault())
      element.addEventListener('drop', async (e) => {
        e.preventDefault()
        const depart = Number(e.dataTransfer.getData('text/plain'))
        if (Number.isNaN(depart) || depart === index) return
        const [deplace] = liste.splice(depart, 1)
        liste.splice(index, 0, deplace)
        await quandChange()
      })
      return element
    }

    const tuile = (i, index) => {
      const valeur = h('strong', { class: 'valeur-tuile' }, '…')
      if (etat.connexion.ouverte) api(`/api/itm/indicateurs/${i.id}/valeur`).then((r) => (valeur.textContent = r.valeur ?? '—')).catch(() => (valeur.textContent = '!'))
      else valeur.textContent = '—'
      const element = h(organiser ? 'div' : 'a', { class: 'tuile-indicateur', href: organiser ? null : `#/itm/${i.id}`, title: i.fenetre ? `Fenêtre : ${i.fenetre}` : '' },
        organiser ? h('span', { class: 'poignee' }, ic('poignee', 14)) : null,
        valeur,
        h('span', { class: 'nom-tuile' }, i.nom),
        organiser ? h('button', { class: 'petit discret retirer', title: 'Retirer de l’accueil', onclick: async () => { indicateurs = indicateurs.filter((x) => x !== i); await enregistrer(); redessiner() } }, ic('x', 14)) : null)
      return rangeable(element, indicateurs, index, async () => { await enregistrer(); redessiner() })
    }

    const raccourci = (r, index) => {
      const element = h(organiser ? 'div' : 'a', { class: 'raccourci-rapport', href: organiser ? null : `#/rapports/${encodeURIComponent(r.nom)}` },
        organiser ? h('span', { class: 'poignee' }, ic('poignee', 14)) : ic('document', 18),
        h('span', {}, r.titre),
        organiser ? h('button', { class: 'petit discret retirer', title: 'Retirer de l’accueil', onclick: async () => { rapports = rapports.filter((x) => x !== r); await enregistrer(); redessiner() } }, ic('x', 14)) : null)
      return rangeable(element, rapports, index, async () => { await enregistrer(); redessiner() })
    }

    const ajout = (disponibles, libelle, ajouter) => {
      if (!organiser || !disponibles.length) return null
      const choix = h('select', {}, h('option', { value: '' }, libelle), disponibles.map(([valeur, texte]) => h('option', { value: valeur }, texte)))
      choix.addEventListener('change', async () => {
        if (!choix.value) return
        ajouter(choix.value)
        await enregistrer()
        redessiner()
      })
      return h('div', { style: { marginTop: '12px', maxWidth: '420px' } }, choix)
    }

    // Question libre à l'IA, directement sur l'accueil.
    const question = h('div')
    vider(
      zone,
      h('div', { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Accueil'), h('p', { class: 'sous-titre' }, organiser ? 'Glissez les éléments pour les ranger, ajoutez-en ou retirez-en.' : 'Vos indicateurs du jour et vos rapports')),
        h('div', { class: 'actions' },
          !etat.connexion.ouverte ? h('button', { onclick: () => demanderMotDePasse().then(redessiner) }, ic('cadenas', 16), 'Se connecter') : null,
          h('button', { class: organiser ? 'principal' : 'discret', onclick: () => { organiser = !organiser; redessiner() } }, ic(organiser ? 'coche' : 'crayon', 16), organiser ? 'Terminer' : 'Organiser'),
        ),
      ),
      h('div', { class: 'carte', style: { marginBottom: '16px' } },
        h('div', { class: 'carte-entete' }, h('h2', {}, ic('etincelle', 18), 'Une question ?'), h('a', { class: 'bouton petit', href: '#/constructeur' }, ic('plus', 14), 'Nouveau rapport ou indicateur')),
        question),
      h('div', { class: 'carte', style: { marginBottom: '16px' } },
        h('div', { class: 'carte-entete' }, h('h2', {}, ic('graphique', 18), 'Indicateurs')),
        indicateurs.length
          ? h('div', { class: 'tuiles-indicateurs' }, indicateurs.map(tuile))
          : h('p', { class: 'discret' }, organiser ? 'Choisissez des indicateurs ci-dessous.' : 'Aucun indicateur sur l’accueil : « Organiser » pour en ajouter.'),
        ajout(donnees.tousIndicateurs.filter((i) => !indicateurs.some((x) => x.id === i.id)).map((i) => [i.id, i.nom]), 'Ajouter un indicateur…', (id) => indicateurs.push(donnees.tousIndicateurs.find((i) => String(i.id) === id))),
      ),
      h('div', { class: 'carte' },
        h('div', { class: 'carte-entete' }, h('h2', {}, ic('document', 18), 'Rapports')),
        rapports.length
          ? h('div', { class: 'raccourcis-rapports' }, rapports.map(raccourci))
          : h('p', { class: 'discret' }, organiser ? 'Choisissez des rapports ci-dessous.' : 'Aucun raccourci : « Organiser » pour ajouter vos rapports.'),
        ajout(donnees.tousRapports.filter((r) => !rapports.some((x) => x.nom === r.nom)).map((r) => [r.nom, r.titre]), 'Ajouter un rapport…', (nom) => rapports.push(donnees.tousRapports.find((r) => r.nom === nom))),
      ),
    )
    await afficherQuestion(question, { compact: true })
  },
}
