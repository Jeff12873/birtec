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
    // Trop près du bord droit de l'écran : la bulle passe à gauche de la liste.
    const aGauche = liste.getBoundingClientRect().right + 310 > innerWidth
    Object.assign(infobulle.style, aGauche ? { left: 'auto', right: 'calc(100% + 8px)' } : { left: '', right: '' })
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
  const dehors = (e) => { if (!zone.contains(e.target) && !liste.contains(e.target)) fermer() }
  function ouvrir() {
    document.querySelectorAll('.menu-theme-liste').forEach((l) => (l.hidden = true))
    if (filtre) filtre.value = ''
    dessiner()
    liste.hidden = false
    if (flottant) {
      // Posée sur la page elle-même (au-dessus de tout, constellation comprise), juste sous le bouton.
      document.body.append(liste)
      Object.assign(liste.style, { position: 'fixed', zIndex: '1000', minWidth: '220px', width: 'max-content', maxWidth: 'min(420px, 90vw)' })
      const r = bouton.getBoundingClientRect()
      const largeur = liste.offsetWidth
      const hauteur = liste.offsetHeight
      const enBas = r.bottom + 6 + hauteur <= innerHeight - 8 || r.top < hauteur + 14
      Object.assign(liste.style, {
        left: `${Math.max(8, Math.min(r.left, innerWidth - largeur - 8))}px`,
        top: `${enBas ? r.bottom + 6 : r.top - 6 - hauteur}px`,
      })
      addEventListener('scroll', surDefilement, { capture: true })
    }
    ;(filtre || bouton).focus()
    options.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
    document.addEventListener('pointerdown', dehors)
  }
  // Un défilement de la page ferme la liste flottante (sauf celui de la liste elle-même).
  function surDefilement(e) { if (!liste.contains(e.target)) fermer() }
  function fermer() {
    liste.hidden = true
    if (flottant) {
      removeEventListener('scroll', surDefilement, { capture: true })
      zone.append(liste)
    }
    if (infobulle) infobulle.hidden = true
    document.removeEventListener('pointerdown', dehors)
  }

  bouton.onclick = () => (liste.hidden ? ouvrir() : fermer())
  filtre?.addEventListener('input', dessiner)
  const clavier = (e) => {
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
  }
  zone.addEventListener('keydown', clavier)
  // La liste flottante n'est plus dans le menu quand elle est ouverte : elle écoute le clavier elle-même.
  if (flottant) liste.addEventListener('keydown', (e) => { e.stopPropagation(); clavier(e) })
  return zone
}
