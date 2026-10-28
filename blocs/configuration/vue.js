// Configuration : connexion MySQL (commune à toutes les applications KTEC, voir /socle/reglages.js), réglages du poste. (Fichiers BIRT et connaissances : écran « Connaissances ».)

import { h, vider } from '/socle/ui.js'
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
      h('div', { class: 'grille grille-2' }, carteMySQL(() => window.ktec.recharger()), cartePoste(() => window.ktec.recharger())),
    )
  },
}

// ---------------------------------------------------------------- mot de passe (à chaque ouverture)

// La demande du mot de passe est commune à toutes les applications KTEC (une seule connexion).
export { demanderMotDePasse } from '/socle/connexion.js'
