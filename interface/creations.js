// Les écrans « Mes créations » (Rapports, Indicateurs GMAO) : des vignettes simples, avec une description courte
// écrite par l'IA et, pour celles qui viennent de la constellation, une petite constellation animée de leurs
// tables. Un clic sur la vignette ouvre le détail à droite ; un clic sur la constellation (administrateur)
// propose de la rouvrir dans la constellation pour la modifier.

import { h, vider, ic, fenetre, confirmer, dateHeureFr } from '/socle/ui.js'
import { modeAdmin } from '/socle/etat.js'

const NS = 'http://www.w3.org/2000/svg'
const COULEURS = ['#ff5c7a', '#c45bff', '#3d9bff', '#ece8e1', '#ff5c7a', '#3d9bff']

// Les tables d'un chemin en petite constellation : posées en zigzag, reliées dans l'ordre, qui scintillent.
export function miniConstellation(c) {
  const tables = (c?.tables || []).slice(0, 7)
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 72 44')
  svg.setAttribute('class', 'mini-constellation')
  const points = tables.map((_, i) => [8 + (i * 56) / Math.max(1, tables.length - 1 || 1), i % 2 ? 31 : 13 + (i % 3) * 3])
  if (tables.length === 1) points[0] = [36, 22]
  points.slice(1).forEach(([x, y], i) => {
    const l = document.createElementNS(NS, 'line')
    for (const [k, v] of Object.entries({ x1: points[i][0], y1: points[i][1], x2: x, y2: y })) l.setAttribute(k, v)
    svg.append(l)
  })
  points.forEach(([x, y], i) => {
    const e = document.createElementNS(NS, 'circle')
    for (const [k, v] of Object.entries({ cx: x, cy: y, r: i === 0 ? 3.6 : 2.6, fill: COULEURS[i % COULEURS.length] })) e.setAttribute(k, v)
    e.style.animationDelay = `${(i * 0.37) % 2.2}s`
    svg.append(e)
  })
  return svg
}

const NOMS_CONTENU = { tableau: 'tableau', graphique: 'graphique', croise: 'tableau croisé', chiffre: 'chiffre clé', texte: 'texte' }
export const texteContenu = (contenu = {}) => Object.entries(contenu).map(([type, n]) => `${n} ${NOMS_CONTENU[type] || type}${n > 1 ? 's' : ''}`).join(', ')

// L'écran : titre centré, vignettes ; avec un élément choisi, les vignettes se resserrent à gauche et le détail
// s'ouvre à droite.
// elements : [{ id, titre, resume, meta, modifie, constellation }] ; lien(e) : l'adresse de son détail ;
// detail(e) : son panneau (promesse) ; ecrireResume(e) : demande la description à l'IA (promesse du texte) ;
// corrigerResume(e, texte) ; rouvrir(e) : le rouvrir dans la constellation.
export async function ecranCreations(zone, { titre, sousTitre, elements, choisi, lien, detail, ecrireResume, corrigerResume, rouvrir, vide }) {
  const grille = h('div', { class: 'grille-creations' })
  const panneau = h('div', { class: 'detail-creation' })
  const conteneur = h('div', { class: `creations${choisi ? ' avec-detail' : ''}` }, grille, choisi ? panneau : null)

  const vignettes = elements.map((e) => {
    const resume = h('p', { class: 'resume-creation' }, e.resume || h('span', { class: 'discret curseur' }, 'Description en cours'))
    const etoiles = e.constellation?.tables?.length
      ? h('button', {
        class: 'bouton-constellation',
        title: `${e.constellation.deduite ? 'Tables lues dans son SQL' : 'Créé avec la constellation'} : ${e.constellation.tables.join(' → ')}${modeAdmin() ? '\nCliquer pour le rouvrir dans la constellation' : ''}`,
        onclick: async (ev) => {
          ev.preventDefault()
          ev.stopPropagation()
          if (!modeAdmin()) return
          if (await confirmer('Rouvrir dans la constellation pour le modifier ? Le chemin et ses filtres s’allument ; « Et maintenant ? » permet ensuite de mettre à jour.', { texte: 'Rouvrir' })) rouvrir(e)
        },
      }, miniConstellation(e.constellation))
      : null
    const crayon = modeAdmin() && corrigerResume ? h('button', { class: 'discret icone-seule petit crayon-resume', title: 'Corriger la description', onclick: async (ev) => {
      ev.preventDefault()
      ev.stopPropagation()
      const champ = h('textarea', { rows: 3 }, e.resume || '')
      const texte = await fenetre({ titre: 'Description de la vignette', contenu: champ, boutons: [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Enregistrer', classe: 'principal', action: () => champ.value }] })
      if (texte === null || texte === undefined) return
      e.resume = await corrigerResume(e, texte)
      vider(resume, e.resume)
    } }, ic('crayon', 13)) : null
    const carte = h('a', { class: `vignette-creation${choisi && e.id === choisi.id ? ' choisie' : ''}`, href: lien(e) },
      h('div', { class: 'tete-creation' }, h('h3', {}, e.titre), etoiles),
      resume,
      h('div', { class: 'pied-creation' }, h('span', {}, [e.meta, e.modifie ? dateHeureFr(e.modifie) : ''].filter(Boolean).join(' · ')), crayon))
    return { e, carte, resume }
  })

  vider(zone,
    h('div', { class: 'entete-page entete-centree' }, h('div', {}, h('h1', {}, titre), h('p', { class: 'sous-titre' }, sousTitre))),
    elements.length ? conteneur : h('div', { class: 'carte vide' }, vide))
  vider(grille, vignettes.map((v) => v.carte))
  if (choisi) {
    vider(panneau, h('p', { class: 'discret curseur' }, 'Ouverture'))
    detail(choisi).then((el) => vider(panneau, el)).catch((err) => vider(panneau, h('div', { class: 'bandeau' }, ic('alerte'), err.message)))
  }

  // Les descriptions manquantes : demandées une à une à l'IA, puis gardées.
  for (const v of vignettes.filter((x) => !x.e.resume)) {
    if (!v.carte.isConnected) break
    try {
      v.e.resume = await ecrireResume(v.e)
      vider(v.resume, v.e.resume)
    } catch {
      vider(v.resume, h('span', { class: 'discret' }, 'Pas de description pour l’instant.'))
    }
  }
}

// Rouvre un rapport ou un indicateur dans la constellation (son chemin, ses filtres, sa phrase).
export function rouvrirDansLaConstellation(constellation, origine) {
  sessionStorage.setItem('birtec-rouvrir', JSON.stringify({ ...constellation, origine }))
  location.hash = '#/schema'
}
