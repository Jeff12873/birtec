// Création d'indicateurs ITM : description en français → requête indicateur + requête liste,
// essayées sur la base, à copier dans l'écran des indicateurs de la GMAO.

import { h, vider, ic, fenetre, notifier, essayer, confirmer, dateHeureFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat } from '/socle/etat.js'
import { demanderMotDePasse } from '/blocs/configuration/vue.js'
import { tableauResultats } from '/blocs/base/vue.js'

// Indicateur en cours d'écriture (gardé si l'on change d'écran).
let brouillon = nouveau()

function nouveau() {
  return { id: null, nom: '', fenetre: '', demande: '', definition: null, requeteIndicateur: '', requeteListe: '', resultat: null }
}

export default {
  chemin: 'itm',
  titre: 'Indicateurs ITM',
  icone: 'graphique',
  menu: true,
  aide: 'itm',
  rafraichir: false,

  async afficher(zone, { id }) {
    const [reglages, indicateurs] = await Promise.all([api('/api/itm/reglages'), api('/api/itm/indicateurs')])
    if (id) {
      const choisi = indicateurs.find((i) => String(i.id) === id)
      if (choisi && brouillon.id !== choisi.id) brouillon = { ...nouveau(), ...choisi, resultat: null }
    }

    const liste = h('div', { class: 'liste-tables' },
      indicateurs.length
        ? indicateurs.map((i) => h('a', { href: `#/itm/${i.id}`, class: i.id === brouillon.id ? 'actif' : '', title: `${i.fenetre || ''} — ${dateHeureFr(i.modifie)}` }, ic('graphique', 14), ' ', i.nom))
        : h('p', { class: 'discret' }, 'Aucun indicateur enregistré.'))

    vider(
      zone,
      h('div', { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Création d’indicateurs ITM'), h('p', { class: 'sous-titre' }, 'Requête indicateur et requête liste, essayées sur la base, à coller dans la GMAO')),
        h('div', { class: 'actions' },
          h('button', { onclick: () => { brouillon = nouveau(); location.hash = '#/itm'; window.birtec.recharger() } }, ic('plus', 16), 'Nouvel indicateur'),
          h('button', { class: 'discret', onclick: () => modifierReglages(reglages) }, ic('reglages', 16), 'Réglages'),
        ),
      ),
      !reglages.fenetres.length ? h('div', { class: 'bandeau' }, ic('alerte'), 'Aucune fenêtre n’est définie : ouvrez « Réglages » pour décrire les fenêtres de la GMAO (table, identifiant, code…).') : null,
      h('div', { style: { display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: '16px', alignItems: 'start' } },
        h('div', { class: 'carte', style: { padding: '12px' } }, liste),
        editeur(reglages),
      ),
    )
  },
}

// ---------------------------------------------------------------- édition d'un indicateur

function editeur(reglages) {
  const nom = h('input', { type: 'text', value: brouillon.nom, placeholder: '[Maintenance] - FI à exécuter', oninput: () => (brouillon.nom = nom.value) })
  const choixFenetre = h('select', { onchange: () => (brouillon.fenetre = choixFenetre.value) },
    h('option', { value: '' }, '(l’IA choisit)'),
    reglages.fenetres.map((f) => h('option', { value: f.libelle, selected: f.libelle === brouillon.fenetre }, f.libelle)))
  const demande = h('textarea', { rows: 4, placeholder: 'Ex. : les fiches d’intervention préventives à faire, issues d’une DI de niveau 1, triées par date limite', oninput: () => (brouillon.demande = demande.value) }, brouillon.demande)
  const definition = h('textarea', { class: 'sql', rows: 12, spellcheck: false }, brouillon.definition ? JSON.stringify(brouillon.definition, null, 2) : '')
  const requeteIndicateur = h('textarea', { class: 'sql', rows: 10, spellcheck: false, oninput: () => (brouillon.requeteIndicateur = requeteIndicateur.value) }, brouillon.requeteIndicateur)
  const requeteListe = h('textarea', { class: 'sql', rows: 14, spellcheck: false, oninput: () => (brouillon.requeteListe = requeteListe.value) }, brouillon.requeteListe)
  const resultat = h('div')
  const boutonIA = h('button', { class: 'principal', onclick: ecrireAvecIA }, ic('etincelle', 16), 'Écrire avec l’IA')

  function montrer(r) {
    brouillon.resultat = r
    if (r.definition) {
      brouillon.definition = r.definition
      definition.value = JSON.stringify(r.definition, null, 2)
      if (!nom.value && r.definition.nom) nom.value = brouillon.nom = r.definition.nom
      if (r.definition.fenetre) choixFenetre.value = brouillon.fenetre = r.definition.fenetre
    }
    if (r.requeteIndicateur) requeteIndicateur.value = brouillon.requeteIndicateur = r.requeteIndicateur
    if (r.requeteListe) requeteListe.value = brouillon.requeteListe = r.requeteListe
    vider(resultat, dessinerResultat(r))
  }

  async function ecrireAvecIA() {
    if (!demande.value.trim()) return notifier('Décrivez l’indicateur voulu.', 'erreur')
    if (!etat.connexion.ouverte) await demanderMotDePasse().catch(() => {})
    boutonIA.disabled = true
    vider(resultat, h('p', { class: 'discret curseur' }, 'L’IA écrit l’indicateur, puis BiRTEC l’essaie sur la base'))
    try {
      montrer(await api('/api/itm/generer', { methode: 'POST', corps: { demande: demande.value, fenetre: choixFenetre.value, nom: nom.value } }))
    } catch (erreur) {
      vider(resultat, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
    } finally {
      boutonIA.disabled = false
    }
  }

  async function reassembler() {
    let lue
    try {
      lue = JSON.parse(definition.value)
    } catch {
      return notifier('Définition illisible : ce doit être du JSON.', 'erreur')
    }
    if (nom.value) lue.nom = nom.value
    if (choixFenetre.value) lue.fenetre = choixFenetre.value
    const r = await api('/api/itm/assembler', { methode: 'POST', corps: { definition: lue } })
    if (r.erreurs.length) return vider(resultat, dessinerResultat(r))
    montrer({ ...r, definition: lue })
    await tester()
  }

  async function tester() {
    if (!etat.connexion.ouverte) await demanderMotDePasse().catch(() => {})
    vider(resultat, h('p', { class: 'discret curseur' }, 'Essai des deux requêtes'))
    try {
      montrer(await api('/api/itm/tester', { methode: 'POST', corps: { requeteIndicateur: requeteIndicateur.value, requeteListe: requeteListe.value } }))
    } catch (erreur) {
      vider(resultat, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
    }
  }

  async function enregistrer() {
    if (!nom.value.trim()) return notifier('Donnez un nom à l’indicateur.', 'erreur')
    const { id } = await api('/api/itm/indicateurs', {
      methode: 'POST',
      corps: { id: brouillon.id, nom: nom.value.trim(), fenetre: choixFenetre.value, demande: demande.value, definition: brouillon.definition, requeteIndicateur: requeteIndicateur.value, requeteListe: requeteListe.value },
    })
    brouillon.id = id
    notifier('Indicateur enregistré dans le fichier .birtec')
    location.hash = `#/itm/${id}`
    window.birtec.recharger()
  }

  const copier = (zoneTexte, libelle) => h('button', { class: 'petit discret', onclick: () => navigator.clipboard.writeText(zoneTexte.value).then(() => notifier(`${libelle} copiée`)) }, ic('copier', 14), 'Copier')

  if (brouillon.resultat) vider(resultat, dessinerResultat(brouillon.resultat))

  return h('div', { class: 'grille' },
    h('div', { class: 'carte' },
      h('div', { class: 'grille grille-2' },
        h('label', { class: 'champ' }, h('span', {}, 'Nom de l’indicateur'), nom),
        h('label', { class: 'champ' }, h('span', {}, 'Fenêtre à ouvrir'), choixFenetre),
      ),
      h('label', { class: 'champ', style: { marginTop: '12px' } }, h('span', {}, 'Ce que l’indicateur doit compter'), demande),
      h('div', { class: 'actions', style: { marginTop: '12px' } },
        boutonIA,
        h('button', { onclick: tester }, ic('lecture', 16), 'Tester'),
        h('button', { onclick: enregistrer }, ic('coche', 16), 'Enregistrer'),
        brouillon.id ? h('button', { class: 'discret danger', onclick: async () => { if (await confirmer(`Supprimer l’indicateur « ${nom.value} » ?`, { texte: 'Supprimer', danger: true })) { await api(`/api/itm/indicateurs/${brouillon.id}`, { methode: 'DELETE' }); brouillon = nouveau(); location.hash = '#/itm'; window.birtec.recharger() } } }, ic('poubelle', 16)) : null,
      ),
      h('details', { style: { marginTop: '12px' } },
        h('summary', { class: 'discret' }, 'Définition (jointures, conditions, date, tri)'),
        h('p', { class: 'discret', style: { fontSize: '13px' } }, 'Les deux requêtes sont tirées de cette définition : modifiez-la puis « Refaire les requêtes » pour qu’elles restent identiques.'),
        definition,
        h('div', { class: 'actions', style: { marginTop: '8px' } }, h('button', { class: 'petit', onclick: reassembler }, ic('rafraichir', 14), 'Refaire les requêtes')),
      ),
    ),
    h('div', { class: 'carte' },
      h('div', { class: 'carte-entete' }, h('h2', {}, 'Requête indicateur'), copier(requeteIndicateur, 'Requête indicateur')),
      requeteIndicateur,
      h('div', { class: 'carte-entete', style: { marginTop: '16px' } }, h('h2', {}, 'Requête liste'), copier(requeteListe, 'Requête liste')),
      requeteListe,
      resultat,
    ),
  )
}

function dessinerResultat(r) {
  const erreurs = r.erreurs || []
  const avertissements = r.avertissements || []
  return h('div', { style: { marginTop: '14px' } },
    r.corrections?.length ? h('p', { class: 'discret' }, `Corrigé automatiquement ${r.corrections.length} fois.`) : null,
    erreurs.map((e) => h('div', { class: 'bandeau' }, ic('alerte'), e)),
    avertissements.map((a) => h('p', { class: 'discret', style: { fontSize: '13px', margin: '4px 0' } }, '• ', a)),
    r.valeur !== undefined && r.valeur !== null
      ? h('div', { class: 'chiffres' },
          h('div', { class: 'chiffre' }, h('strong', {}, String(r.valeur)), h('span', {}, 'valeur (VAL)')),
          r.liste ? h('div', { class: 'chiffre' }, h('strong', {}, String(r.liste.total)), h('span', {}, 'lignes dans la liste')) : null,
          !erreurs.length ? h('div', { class: 'chiffre' }, h('strong', {}, '✓'), h('span', {}, 'requêtes concordantes')) : null)
      : null,
    r.definition?.explication ? h('p', { class: 'texte-2' }, r.definition.explication) : null,
    r.liste ? tableauResultats(r.liste) : null,
  )
}

// ---------------------------------------------------------------- réglages (fenêtres et variables de la GMAO)

async function modifierReglages(reglages) {
  const zoneTexte = h('textarea', { class: 'sql', rows: 22, spellcheck: false }, JSON.stringify(reglages, null, 2))
  const ok = await fenetre({
    titre: 'Réglages des indicateurs',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, 'Rangés dans le fichier .birtec. Fenêtres : libellé affiché par la GMAO, table principale, colonnes identifiant, code, désignation, état, et variable de filtre d’arborescence. Variables : nom tel qu’écrit dans la requête, valeur d’essai pour tester sur MySQL ({debutMois}, {aujourdhui}, {debutAnnee} sont remplacés par la date du jour).'),
      zoneTexte),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: async () => api('/api/itm/reglages', { methode: 'POST', corps: JSON.parse(zoneTexte.value) }).then(() => true) },
    ],
  })
  if (ok) {
    notifier('Réglages enregistrés')
    window.birtec.recharger()
  }
}
