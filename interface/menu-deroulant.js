// Un menu déroulant aux couleurs du thème, quel que soit le navigateur (les listes natives prennent sinon
// les couleurs du système). Au-delà de 12 choix, un champ en haut de la liste filtre en tapant.
//   menuDeroulant({ choix: [{ valeur, libelle, nombre }], valeur, surChoix: (valeur) => …, haut, classe, bulle })
// haut : la liste s'ouvre au-dessus du bouton (menus posés en bas de l'écran).
// classe : classe en plus sur le menu ; bulle(valeur) : texte (ou promesse) montré dans une bulle à côté du choix
// survolé, par exemple quelques valeurs d'exemple d'une colonne.
// flottant : la liste flotte au-dessus de la page (pour un menu posé dans un cadre qui défile, comme un tableau).

import { h } from '/socle/ui.js'

export function menuDeroulant({ choix, valeur = '', surChoix, haut = false, classe = '', bulle = null, flottant = false }) {
  const actuel = choix.find((c) => c.valeur === valeur) || choix[0]
  const bouton = h('button', { type: 'button', class: 'menu-theme-bouton' }, h('span', {}, actuel?.libelle || ''))
  const liste = h('div', { class: 'menu-theme-liste', hidden: true })
  const filtre = choix.length > 12 ? h('input', { type: 'search', class: 'menu-theme-filtre', placeholder: 'Filtrer…' }) : null
  const options = h('div', { class: 'menu-theme-options' })
  liste.append(...[filtre, options].filter(Boolean))
  const infobulle = bulle ? h('div', { class: 'menu-theme-bulle', hidden: true }) : null
  if (infobulle) liste.append(infobulle)
  const zone = h('div', { class: `menu-theme${haut ? ' haut' : ''}${classe ? ` ${classe}` : ''}` }, bouton, liste)
  let demandeBulle = 0
  async function montrerBulle(element, c) {
    if (!infobulle) return
    const numero = ++demandeBulle
    const texte = c.valeur === '' ? null : await bulle(c.valeur)
    if (numero !== demandeBulle || liste.hidden) return
    if (!texte) { infobulle.hidden = true; return }
    infobulle.replaceChildren(texte)
    infobulle.style.top = `${element.offsetTop - options.scrollTop + options.offsetTop}px`
    infobulle.hidden = false
  }
  let surligne = -1

  const visibles = () => [...options.children]
  function dessiner() {
    const texte = (filtre?.value || '').trim().toLowerCase()
    options.replaceChildren(...choix.filter((c) => !texte || c.libelle.toLowerCase().includes(texte)).map((c) =>
      h('div', { class: `menu-theme-choix${c.valeur === actuel?.valeur ? ' on' : ''}`, onclick: () => choisir(c), onmouseenter: (e) => montrerBulle(e.currentTarget, c) },
        h('span', {}, c.libelle), c.nombre !== undefined ? h('small', {}, String(c.nombre)) : null)))
    surligne = -1
  }
  function marquer(i) {
    const v = visibles()
    if (!v.length) return
    surligne = (i + v.length) % v.length
    v.forEach((e, j) => e.classList.toggle('vise', j === surligne))
    v[surligne].scrollIntoView({ block: 'nearest' })
    const texte = (filtre?.value || '').trim().toLowerCase()
    const c = choix.filter((x) => !texte || x.libelle.toLowerCase().includes(texte))[surligne]
    if (c) montrerBulle(v[surligne], c)
  }
  function choisir(c) {
    fermer()
    if (c.valeur !== actuel?.valeur) surChoix(c.valeur)
  }
  const dehors = (e) => { if (!zone.contains(e.target)) fermer() }
  function ouvrir() {
    document.querySelectorAll('.menu-theme-liste').forEach((l) => (l.hidden = true))
    if (filtre) filtre.value = ''
    dessiner()
    liste.hidden = false
    if (flottant) {
      const r = bouton.getBoundingClientRect()
      Object.assign(liste.style, { position: 'fixed', top: `${r.bottom + 6}px`, left: `${Math.min(r.left, innerWidth - liste.offsetWidth - 8)}px` })
      addEventListener('scroll', fermer, { capture: true, once: true })
    }
    ;(filtre || bouton).focus()
    options.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
    document.addEventListener('pointerdown', dehors)
  }
  function fermer() {
    liste.hidden = true
    if (infobulle) infobulle.hidden = true
    document.removeEventListener('pointerdown', dehors)
  }

  bouton.onclick = () => (liste.hidden ? ouvrir() : fermer())
  filtre?.addEventListener('input', dessiner)
  zone.addEventListener('keydown', (e) => {
    if (liste.hidden) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { if (e.target === bouton) { e.preventDefault(); ouvrir() } }
      return
    }
    if (e.key === 'Escape') { e.preventDefault(); fermer(); bouton.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); marquer(surligne + 1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marquer(surligne - 1) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const texte = (filtre?.value || '').trim().toLowerCase()
      const parmi = choix.filter((c) => !texte || c.libelle.toLowerCase().includes(texte))
      const c = parmi[surligne >= 0 ? surligne : 0]
      if (c) choisir(c)
    }
  })
  return zone
}
