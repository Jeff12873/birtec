// Indicateurs GMAO : l'historique des indicateurs créés (depuis l'assistant) ou relevés dans la GMAO.
// Pour chacun : la requête indicateur et la requête liste à copier dans la GMAO, l'essai sur la base,
// et la retouche (à la main, ou en le confiant à l'assistant).

import { h, vider, ic, fenetre, notifier, confirmer, dateHeureFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat, modeAdmin } from '/socle/etat.js'
import { ecranCreations, rouvrirDansLaConstellation } from '../../interface/creations.js'
import { demanderMotDePasse } from '../configuration/vue.js'
import { tableauResultats } from '../base/vue.js'

export default {
  chemin: 'indicateurs',
  titre: 'Indicateurs GMAO',
  icone: 'graphique',
  menu: true,
  groupe: 'Mes créations',
  aide: 'indicateurs',

  async afficher(zone, { id }) {
    const [vignettes, indicateurs] = await Promise.all([api('/api/indicateurs/vignettes'), api('/api/indicateurs/indicateurs')])
    const elements = vignettes.map((v) => ({ id: String(v.id), titre: v.nom, resume: v.resume, meta: v.fenetre ? `fenêtre ${v.fenetre}` : '', modifie: v.modifie, constellation: v.constellation }))
    await ecranCreations(zone, {
      titre: 'Indicateurs GMAO',
      sousTitre: 'Requête indicateur et requête liste, essayées sur la base, à coller dans la GMAO',
      elements,
      choisi: elements.find((e) => e.id === id) || null,
      lien: (e) => `#/indicateurs/${e.id}`,
      detail: async (e) => detail(indicateurs.find((i) => String(i.id) === e.id)),
      ecrireResume: (e) => api(`/api/indicateurs/indicateurs/${e.id}/resume`, { methode: 'POST', corps: {} }).then((r) => r.resume),
      corrigerResume: (e, texte) => api(`/api/indicateurs/indicateurs/${e.id}/resume`, { methode: 'POST', corps: { texte } }).then((r) => r.resume),
      rouvrir: (e) => rouvrirDansLaConstellation(e.constellation, { type: 'indicateur', id: e.id, titre: e.titre }),
      vide: modeAdmin() ? 'Aucun indicateur pour l’instant : construisez un chemin dans la constellation, puis « Et maintenant ? › Indicateur GMAO ».' : 'Aucun indicateur pour l’instant.',
    })
    // Les variables de la GMAO (administrateur), sous le titre.
    if (modeAdmin()) zone.querySelector('.entete-page')?.append(h('div', { class: 'actions' }, h('button', { class: 'discret petit', onclick: modifierReglages }, ic('reglages', 14), 'Variables')))
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
      // L'utilisateur essaie l'indicateur tel qu'il est enregistré ; l'administrateur, ses retouches.
      const corps = modeAdmin() ? { requeteIndicateur: requeteIndicateur.value, requeteListe: requeteListe.value } : { id: indicateur.id }
      vider(resultat, dessinerResultat(await api('/api/indicateurs/tester', { methode: 'POST', corps })))
    } catch (erreur) {
      vider(resultat, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
    }
  }

  async function enregistrer() {
    await api('/api/indicateurs/indicateurs', { methode: 'POST', corps: { ...indicateur, requeteIndicateur: requeteIndicateur.value, requeteListe: requeteListe.value } })
    notifier('Indicateur enregistré dans le fichier .ktec')
    window.ktec.recharger()
  }

  async function supprimer() {
    if (!(await confirmer(`Supprimer l’indicateur « ${indicateur.nom} » ?`, { texte: 'Supprimer', danger: true }))) return
    await api(`/api/indicateurs/indicateurs/${indicateur.id}`, { methode: 'DELETE' })
    location.hash = '#/indicateurs'
  }

  if (etat.connexion.ouverte) setTimeout(tester, 0)

  return h('div', { class: 'grille' },
    h('div', { class: 'carte' },
      h('div', { class: 'carte-entete' },
        h('h2', {}, ic('graphique', 18), indicateur.nom),
        h('div', { class: 'actions' },
          h('button', { class: 'petit', onclick: tester }, ic('lecture', 14), 'Tester'),
          !modeAdmin() ? null : indicateur.definition?.constructeur
            ? h('button', { class: 'petit discret', onclick: () => { sessionStorage.setItem('birtec-indicateur', JSON.stringify({ etat: indicateur.definition.constructeur, nom: indicateur.nom, dateIndicateur: indicateur.definition.dateIndicateur, arborescence: indicateur.definition.arborescence, id: indicateur.id, constellation: indicateur.definition.constellation })); location.hash = '#/indicateur' } }, ic('crayon', 14), 'Modifier (formulaire)')
            : h('button', { class: 'petit discret', onclick: () => demanderALAssistant(`Modifie l’indicateur GMAO « ${indicateur.nom} » : `) }, ic('etincelle', 14), 'Modifier avec l’assistant'),
          modeAdmin() ? h('button', { class: 'petit discret danger', onclick: supprimer }, ic('poubelle', 14)) : null,
        ),
      ),
      h('p', { class: 'texte-2', style: { margin: 0 } },
        indicateur.fenetre ? ['Fenêtre à ouvrir dans la GMAO : ', h('strong', {}, indicateur.fenetre), '. '] : null,
        indicateur.demande || indicateur.definition?.explication || '',
        indicateur.source ? h('span', { class: 'discret' }, ` (${indicateur.source})`) : null),
    ),
    // Les requêtes (SQL à coller dans la GMAO) : pour l'administrateur ; l'utilisateur voit le résultat.
    !modeAdmin() ? h('div', { class: 'carte' }, resultat) : h('div', { class: 'carte' },
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
  const reglages = await api('/api/indicateurs/reglages')
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
      { texte: 'Enregistrer', classe: 'principal', action: () => api('/api/indicateurs/reglages', { methode: 'POST', corps: JSON.parse(zoneTexte.value) }).then(() => true) },
    ],
  })
  if (ok) notifier('Réglages enregistrés')
}
