// Configuration : connexion MySQL (commune à toutes les applications KTEC, voir /socle/reglages.js), réglages du poste. (Fichiers BIRT et connaissances : écran « Connaissances ».)

import { h, vider, ic, essayer, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { carteMySQL, cartePoste } from '/socle/reglages.js'

export default {
  chemin: 'configuration',
  titre: 'Configuration',
  icone: 'reglages',
  menu: 'admin',
  groupe: 'Réglages',
  aide: 'configuration',

  async afficher(zone) {
    vider(
      zone,
      h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, 'Configuration'), h('p', { class: 'sous-titre' }, 'Connexion à la base et réglages de ce poste'))),
      h('div', { class: 'grille grille-2' }, carteMySQL(() => window.ktec.recharger()), cartePoste(() => window.ktec.recharger()), carteModele()),
    )
  },
}

// ---------------------------------------------------------------- modèle de données

// Le modèle de données du site (blocs/phrase/modele.js) : ce que LA PHRASE doit savoir de la base pour guider
// (machines, fiches techniques). Rangé dans le fichier .ktec ; BiRTEC le propose en reconnaissant la forme des
// tables, l'administrateur vérifie, corrige au besoin, et enregistre.
function carteModele() {
  const resume = h('div')
  const texte = h('textarea', { class: 'sql', rows: 14, spellcheck: false })
  const details = h('details', {}, h('summary', { class: 'discret' }, 'Corriger à la main'), texte)
  const montrer = (modele, provisoire = false) => {
    texte.value = modele ? JSON.stringify(modele, null, 2) : ''
    const ft = modele?.ficheTechnique
    const ligne = (titre, valeur) => h('div', { class: 'ligne-modele' }, h('span', { class: 'discret' }, titre), h('span', { class: 'mono' }, valeur || '—'))
    vider(resume,
      provisoire ? h('div', { class: 'bandeau info' }, ic('etincelle'), 'Proposition : vérifiez, puis « Enregistrer ».') : null,
      !modele ? h('p', { class: 'texte-2' }, 'Pas encore de modèle de données : « Reconnaître » le propose d’après la base.') : [
        ligne('Machines', modele.machine ? `${modele.machine.table} (code ${modele.machine.code}, nom ${modele.machine.nom})` : null),
        ligne('Fiches techniques : valeurs', ft ? `${ft.valeurs.table} — objet ${ft.valeurs.typeObjet} / ${ft.valeurs.idObjet}` : null),
        ligne('… modèles', ft ? `${ft.modeles.table}.${ft.modeles.code}` : null),
        ligne('… champs', ft ? `${ft.champs.table}.${ft.champs.code}` : null),
        ligne('Objets', Object.entries(modele.objets || {}).map(([code, o]) => `${code} → ${o.table}`).join(', ')),
      ])
  }
  api('/api/modele').then((r) => montrer(r.modele)).catch(() => montrer(null))
  return h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('reseau', 18), 'Modèle de données')),
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Ce que LA PHRASE doit savoir de la base pour guider : la table des machines (reliée à l’arborescence de PDRTEC et aux parcs d’AITEC) et les fiches techniques (modèle, champ, valeur, et les objets auxquels elles se rattachent). Gardé dans le fichier .ktec : rien de la base n’est écrit dans le logiciel.'),
    resume,
    details,
    h('div', { class: 'actions', style: { marginTop: '12px' } },
      h('button', { onclick: async () => { const r = await essayer(() => api('/api/modele/reconnaitre', { methode: 'POST', corps: {} })); if (r) montrer(r.modele, true) } }, ic('etincelle', 16), 'Reconnaître'),
      h('button', { class: 'principal', onclick: async () => {
        let modele
        try { modele = JSON.parse(texte.value) } catch { return notifier('Le modèle corrigé n’est pas lisible (JSON).', 'erreur') }
        const r = await essayer(() => api('/api/modele', { methode: 'POST', corps: { modele } }), 'Modèle de données enregistré')
        if (r) montrer(r.modele)
      } }, 'Enregistrer')))
}

// ---------------------------------------------------------------- mot de passe (à chaque ouverture)

// La demande du mot de passe est commune à toutes les applications KTEC (une seule connexion).
export { demanderMotDePasse } from '/socle/connexion.js'
