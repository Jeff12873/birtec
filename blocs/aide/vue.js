// L'aide est maintenant dans le wiki de K.NOVA (/wiki/) : pages dans interface/wiki/, sommaire dans
// interface/wiki/sommaire.json. Cet écran ne reste que pour les anciens liens « #/aide/… ».

import { h, vider, ic } from '/socle/ui.js'

export default {
  chemin: 'aide',
  titre: 'Aide',
  icone: 'aide',
  menu: false,
  aide: 'premiers-pas',

  afficher(zone, { id }) {
    const adresse = `/wiki/#/birtec/${id || 'premiers-pas'}`
    vider(zone, h('div', { class: 'bandeau info' }, ic('livre'), 'L’aide est dans le wiki de K.NOVA. ', h('a', { href: adresse, target: 'knova-wiki' }, 'Ouvrir le wiki')))
  },
}
