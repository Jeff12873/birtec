// Indicateurs ITM : l'historique des indicateurs créés (depuis l'assistant) ou relevés dans la GMAO.
// Pour chacun : la requête indicateur et la requête liste à copier dans la GMAO, l'essai sur la base,
// et la retouche (à la main, ou en le confiant à l'assistant).

import { h, vider, ic, fenetre, notifier, confirmer, dateHeureFr, deuxPanneaux } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat } from '/socle/etat.js'
import { demanderMotDePasse } from '/blocs/configuration/vue.js'
import { tableauResultats } from '/blocs/base/vue.js'

export default {
  chemin: 'itm',
  titre: 'Indicateurs ITM',
  icone: 'graphique',
  menu: true,
  aide: 'itm',

  async afficher(zone, { id }) {
    const indicateurs = await api('/api/itm/indicateurs')
    const choisi = indicateurs.find((i) => String(i.id) === id) || null
    const filtre = h('input', { type: 'search', placeholder: 'Filtrer…' })
    const liste = h('div', { class: 'liste-tables' })
    const dessinerListe = () => {
      const texte = filtre.value.toLowerCase()
      vider(liste, indicateurs.filter((i) => !texte || i.nom.toLowerCase().includes(texte)).map((i) =>
        h('a', { href: `#/itm/${i.id}`, class: i === choisi ? 'actif' : '', title: `${i.fenetre || ''} — ${dateHeureFr(i.modifie)}` }, ic('graphique', 14), ' ', i.nom)))
      if (!indicateurs.length) liste.append(h('p', { class: 'discret' }, 'Aucun indicateur pour l’instant.'))
    }
    filtre.addEventListener('input', dessinerListe)
    dessinerListe()

    vider(
      zone,
      h('div', { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Indicateurs ITM'), h('p', { class: 'sous-titre' }, 'Requête indicateur et requête liste, essayées sur la base, à coller dans la GMAO')),
        h('div', { class: 'actions' },
          h('button', { class: 'principal', onclick: () => demanderALAssistant('Je veux créer un indicateur ITM.') }, ic('etincelle', 16), 'Créer avec l’assistant'),
          h('button', { class: 'discret', onclick: modifierReglages }, ic('reglages', 16), 'Variables'),
        ),
      ),
      deuxPanneaux(
        h('div', { class: 'carte', style: { padding: '12px' } }, filtre, h('div', { style: { height: '10px' } }), liste),
        choisi ? detail(choisi) : h('div', { class: 'carte' }, h('p', { class: 'texte-2' },
          'Les indicateurs se créent dans l’assistant : décrivez ce qu’il faut compter, il pose ses questions, puis « Créer l’indicateur » assemble les deux requêtes, les vérifie sur la base et les range ici. Choisissez un indicateur à gauche pour copier ses requêtes.')),
        { cle: 'itm', largeur: 380 },
      ),
    )
  },
}

function demanderALAssistant(question) {
  sessionStorage.setItem('birtec-question', question)
  location.hash = '#/assistant'
}

function detail(indicateur) {
  const requeteIndicateur = h('textarea', { class: 'sql', rows: 10, spellcheck: false }, indicateur.requeteIndicateur || '')
  const requeteListe = h('textarea', { class: 'sql', rows: 14, spellcheck: false }, indicateur.requeteListe || '')
  const resultat = h('div')
  const copier = (zoneTexte, libelle) => h('button', { class: 'petit discret', onclick: () => navigator.clipboard.writeText(zoneTexte.value).then(() => notifier(`${libelle} copiée`)) }, ic('copier', 14), 'Copier')

  async function tester() {
    if (!etat.connexion.ouverte) await demanderMotDePasse().catch(() => {})
    vider(resultat, h('p', { class: 'discret curseur' }, 'Essai des deux requêtes'))
    try {
      vider(resultat, dessinerResultat(await api('/api/itm/tester', { methode: 'POST', corps: { requeteIndicateur: requeteIndicateur.value, requeteListe: requeteListe.value } })))
    } catch (erreur) {
      vider(resultat, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
    }
  }

  async function enregistrer() {
    await api('/api/itm/indicateurs', { methode: 'POST', corps: { ...indicateur, requeteIndicateur: requeteIndicateur.value, requeteListe: requeteListe.value } })
    notifier('Indicateur enregistré dans le fichier .birtec')
    window.birtec.recharger()
  }

  async function supprimer() {
    if (!(await confirmer(`Supprimer l’indicateur « ${indicateur.nom} » ?`, { texte: 'Supprimer', danger: true }))) return
    await api(`/api/itm/indicateurs/${indicateur.id}`, { methode: 'DELETE' })
    location.hash = '#/itm'
  }

  if (etat.connexion.ouverte) setTimeout(tester, 0)

  return h('div', { class: 'grille' },
    h('div', { class: 'carte' },
      h('div', { class: 'carte-entete' },
        h('h2', {}, ic('graphique', 18), indicateur.nom),
        h('div', { class: 'actions' },
          h('button', { class: 'petit', onclick: tester }, ic('lecture', 14), 'Tester'),
          h('button', { class: 'petit discret', onclick: () => demanderALAssistant(`Modifie l’indicateur ITM « ${indicateur.nom} » : `) }, ic('etincelle', 14), 'Modifier avec l’assistant'),
          h('button', { class: 'petit discret danger', onclick: supprimer }, ic('poubelle', 14)),
        ),
      ),
      h('p', { class: 'texte-2', style: { margin: 0 } },
        indicateur.fenetre ? ['Fenêtre à ouvrir dans la GMAO : ', h('strong', {}, indicateur.fenetre), '. '] : null,
        indicateur.demande || indicateur.definition?.explication || '',
        indicateur.source ? h('span', { class: 'discret' }, ` (${indicateur.source})`) : null),
    ),
    h('div', { class: 'carte' },
      h('div', { class: 'carte-entete' }, h('h2', {}, 'Requête indicateur'), copier(requeteIndicateur, 'Requête indicateur')),
      requeteIndicateur,
      h('div', { class: 'carte-entete', style: { marginTop: '16px' } }, h('h2', {}, 'Requête liste'), copier(requeteListe, 'Requête liste')),
      requeteListe,
      h('div', { class: 'actions', style: { marginTop: '10px' } },
        h('button', { onclick: tester }, ic('lecture', 16), 'Tester'),
        h('button', { class: 'discret', onclick: enregistrer }, ic('coche', 16), 'Enregistrer les retouches'),
      ),
      resultat,
    ),
  )
}

function dessinerResultat(r) {
  const erreurs = r.erreurs || []
  return h('div', { style: { marginTop: '14px' } },
    erreurs.map((e) => h('div', { class: 'bandeau' }, ic('alerte'), e)),
    (r.avertissements || []).map((a) => h('p', { class: 'discret', style: { fontSize: '13px', margin: '4px 0' } }, '• ', a)),
    r.valeur !== undefined && r.valeur !== null
      ? h('div', { class: 'chiffres' },
          h('div', { class: 'chiffre' }, h('strong', {}, String(r.valeur)), h('span', {}, 'valeur (VAL)')),
          r.liste ? h('div', { class: 'chiffre' }, h('strong', {}, String(r.liste.total)), h('span', {}, 'lignes dans la liste')) : null,
          !erreurs.length ? h('div', { class: 'chiffre' }, h('strong', {}, '✓'), h('span', {}, 'requêtes concordantes')) : null)
      : null,
    r.liste ? tableauResultats(r.liste) : null,
  )
}

// Variables de la GMAO (et fenêtres décrites à la main, en plus de celles déduites de la structure).
async function modifierReglages() {
  const reglages = await api('/api/itm/reglages')
  const { deduites, ...aGarder } = reglages
  const zoneTexte = h('textarea', { class: 'sql', rows: 20, spellcheck: false }, JSON.stringify(aGarder, null, 2))
  const ok = await fenetre({
    titre: 'Variables des indicateurs',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, `Variables de la GMAO utilisables dans les indicateurs : nom tel qu’écrit dans la requête, valeur d’essai pour tester sur MySQL ({debutMois}, {aujourdhui}, {debutAnnee} sont remplacés par la date du jour), description pour l’IA. Les tables qui ont la forme d’une fiche sont reconnues automatiquement (${deduites} aujourd’hui) : inutile de les décrire.`),
      zoneTexte),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: () => api('/api/itm/reglages', { methode: 'POST', corps: JSON.parse(zoneTexte.value) }).then(() => true) },
    ],
  })
  if (ok) notifier('Réglages enregistrés')
}
