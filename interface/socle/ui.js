// Petits outils pour construire l'interface sans bibliothèque.
//
//   h('button', { class: 'principal', onclick: … }, 'Enregistrer')  → crée un élément
//   fenetre({ titre, contenu, boutons })                            → fenêtre par-dessus la page
//   notifier('Enregistré')                                          → petit message en bas à droite
//   formulaire(champs, valeurs)                                     → formulaire à partir d'une liste de champs
//   tableau({ colonnes, lignes, surClic })                          → tableau de données

import { icone } from './icones.js'

export function h(balise, attributs = {}, ...enfants) {
  const element = document.createElement(balise)
  for (const [nom, valeur] of Object.entries(attributs || {})) {
    if (valeur === undefined || valeur === null || valeur === false) continue
    if (nom.startsWith('on')) element.addEventListener(nom.slice(2), valeur)
    else if (nom === 'class') element.className = valeur
    else if (nom === 'style' && typeof valeur === 'object') Object.assign(element.style, valeur)
    else if (nom === 'html') element.innerHTML = valeur
    else if (nom in element && typeof valeur !== 'string') element[nom] = valeur
    else element.setAttribute(nom, valeur === true ? '' : valeur)
  }
  ajouter(element, enfants)
  return element
}

function ajouter(parent, enfants) {
  for (const enfant of enfants.flat(Infinity)) {
    if (enfant === null || enfant === undefined || enfant === false) continue
    parent.append(enfant instanceof Node ? enfant : document.createTextNode(String(enfant)))
  }
}

export function vider(element, ...enfants) {
  element.replaceChildren()
  ajouter(element, enfants)
  return element
}

// Élément SVG à partir d'un texte (icônes, graphiques).
export function svg(texte) {
  const modele = document.createElement('template')
  modele.innerHTML = texte.trim()
  return modele.content.firstElementChild
}

export function ic(nom, taille = 18) {
  return svg(icone(nom, taille))
}

// ---------------------------------------------------------------- notifications

export function notifier(message, type = 'info') {
  const zone = document.getElementById('notifications')
  const element = h('div', { class: `notification ${type}` }, message)
  zone.append(element)
  setTimeout(() => element.remove(), type === 'erreur' ? 7000 : 3500)
}

// Exécute une action et affiche l'erreur éventuelle, sans faire planter l'écran.
export async function essayer(action, messageReussite) {
  try {
    const resultat = await action()
    if (messageReussite) notifier(messageReussite)
    return resultat
  } catch (erreur) {
    notifier(erreur.message, 'erreur')
    return undefined
  }
}

// ---------------------------------------------------------------- fenêtres

// Ouvre une fenêtre. Chaque bouton : { texte, classe, action }. Si action renvoie false, la fenêtre reste ouverte.
// Renvoie une promesse résolue avec la valeur du bouton cliqué (ou null si on ferme).
export function fenetre({ titre, contenu, boutons = [], large = false }) {
  return new Promise((resoudre) => {
    const fermer = (valeur) => {
      voile.remove()
      document.removeEventListener('keydown', surTouche)
      resoudre(valeur)
    }
    const surTouche = (e) => e.key === 'Escape' && fermer(null)
    const pied = h(
      'div',
      { class: 'fenetre-pied' },
      boutons.map((b) =>
        h(
          'button',
          {
            class: b.classe || '',
            onclick: async (e) => {
              const bouton = e.currentTarget
              bouton.disabled = true
              try {
                const resultat = b.action ? await b.action() : b.valeur
                if (resultat !== false) fermer(resultat === undefined ? b.valeur : resultat)
              } catch (erreur) {
                notifier(erreur.message, 'erreur')
              } finally {
                bouton.disabled = false
              }
            },
          },
          b.texte,
        ),
      ),
    )
    const voile = h(
      'div',
      { class: 'voile', onmousedown: (e) => e.target === voile && fermer(null) },
      h(
        'div',
        { class: `fenetre ${large ? 'large' : ''}`, role: 'dialog' },
        h('div', { class: 'fenetre-entete' }, h('h2', {}, titre), h('button', { class: 'discret icone-seule', title: 'Fermer', onclick: () => fermer(null) }, ic('x'))),
        h('div', { class: 'fenetre-corps' }, contenu),
        boutons.length ? pied : null,
      ),
    )
    document.body.append(voile)
    document.addEventListener('keydown', surTouche)
    voile.querySelector('input, textarea, select')?.focus()
  })
}

export function fenetreOuverte() {
  return Boolean(document.querySelector('.voile'))
}

export function confirmer(message, { texte = 'Confirmer', danger = false } = {}) {
  return fenetre({
    titre: 'Confirmation',
    contenu: h('p', {}, message),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: false },
      { texte, classe: danger ? 'danger' : 'principal', valeur: true },
    ],
  }).then(Boolean)
}

// ---------------------------------------------------------------- formulaires

// champs : [{ nom, libelle, type: 'texte'|'nombre'|'date'|'zone'|'choix'|'mot-de-passe', choix: [], large, aide, suggestions: [] }]
export function formulaire(champs, valeurs = {}) {
  const elements = {}
  const element = h(
    'div',
    { class: 'formulaire' },
    champs.map((champ) => {
      let saisie
      const valeur = valeurs[champ.nom] ?? champ.defaut ?? ''
      if (champ.type === 'zone') saisie = h('textarea', { name: champ.nom }, valeur)
      else if (champ.type === 'choix') {
        saisie = h('select', { name: champ.nom }, champ.choix.map((c) => {
          const [val, texte] = Array.isArray(c) ? c : [c, c]
          return h('option', { value: val, selected: String(val) === String(valeur) }, texte)
        }))
      } else {
        const type = { nombre: 'number', date: 'date', 'mot-de-passe': 'password' }[champ.type] || 'text'
        const liste = champ.suggestions?.length ? `liste-${champ.nom}` : null
        saisie = h('input', { name: champ.nom, type, value: valeur ?? '', step: champ.type === 'nombre' ? 'any' : null, list: liste, autocomplete: 'off' })
        if (liste) saisie = [saisie, h('datalist', { id: liste }, champ.suggestions.map((s) => h('option', { value: s })))]
      }
      elements[champ.nom] = Array.isArray(saisie) ? saisie[0] : saisie
      return h('label', { class: `champ ${champ.large || champ.type === 'zone' ? 'large' : ''}` }, h('span', {}, champ.libelle + (champ.obligatoire ? ' *' : '')), saisie, champ.aide ? h('small', { class: 'aide' }, champ.aide) : null)
    }),
  )
  return {
    element,
    lire() {
      const resultat = {}
      for (const champ of champs) {
        const brut = elements[champ.nom].value
        resultat[champ.nom] = champ.type === 'nombre' ? (brut === '' ? null : Number(brut)) : brut.trim()
        if (champ.obligatoire && (resultat[champ.nom] === '' || resultat[champ.nom] === null)) throw new Error(`« ${champ.libelle} » est obligatoire.`)
      }
      return resultat
    },
  }
}

// ---------------------------------------------------------------- tableaux

// colonnes : [{ titre, valeur: (ligne) => texte ou élément, classe }]
export function tableau({ colonnes, lignes, surClic, vide = 'Rien à afficher.' }) {
  if (!lignes.length) return h('div', { class: 'tableau-conteneur' }, h('div', { class: 'vide' }, ic('boite', 32), vide))
  return h(
    'div',
    { class: 'tableau-conteneur' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {}, colonnes.map((c) => h('th', { class: c.classe || '' }, c.titre)))),
      h(
        'tbody',
        {},
        lignes.map((ligne) =>
          h('tr', { class: surClic ? 'cliquable' : '', onclick: surClic ? () => surClic(ligne) : null }, colonnes.map((c) => h('td', { class: c.classe || '' }, c.valeur(ligne) ?? ''))),
        ),
      ),
    ),
  )
}

// ---------------------------------------------------------------- formats français

export function dateFr(date) {
  if (!date) return ''
  const [a, m, j] = String(date).slice(0, 10).split('-')
  return j ? `${j}/${m}/${a}` : date
}

export function dateHeureFr(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function heureFr(iso) {
  return iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''
}

export function nombreFr(nombre, decimales = 0) {
  if (nombre === null || nombre === undefined || nombre === '') return ''
  return Number(nombre).toLocaleString('fr-FR', { maximumFractionDigits: decimales })
}

export function tailleFr(octets) {
  if (octets >= 1e9) return nombreFr(octets / 1e9, 1) + ' Go'
  if (octets >= 1e6) return nombreFr(octets / 1e6, 1) + ' Mo'
  return nombreFr(Math.max(1, octets / 1e3)) + ' Ko'
}

export function ilYa(iso) {
  if (!iso) return ''
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return "à l'instant"
  if (minutes < 60) return `il y a ${minutes} min`
  if (minutes < 24 * 60) return `il y a ${Math.round(minutes / 60)} h`
  return `le ${dateHeureFr(iso)}`
}

// Attendre un peu avant d'agir (recherche pendant la frappe).
export function apresPause(action, delai = 300) {
  let minuterie
  return (...args) => {
    clearTimeout(minuterie)
    minuterie = setTimeout(() => action(...args), delai)
  }
}
