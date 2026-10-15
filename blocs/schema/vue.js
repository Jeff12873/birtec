// Schéma des liens (« araignée ») : une table au centre, les tables qui lui sont liées autour.
// Un clic sur une table la décrit (nom clair, description, prise en compte par l'IA) ou la met au centre ;
// un clic sur un lien permet de le nommer et de le décrire. Tout est gardé dans le fichier .birtec
// (dictionnaire) et donné à l'IA pour choisir ses jointures.

import { h, vider, ic, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'

const SVG = 'http://www.w3.org/2000/svg'
const LARGEUR = 1000
const HAUTEUR = 720
const VOISINS_MAX = 22

let deuxiemeCercle = false

export default {
  chemin: 'schema',
  titre: 'Schéma',
  icone: 'reseau',
  menu: true,
  aide: 'schema',

  async afficher(zone, { id }) {
    const schema = await api('/api/schema')
    const parNom = new Map(schema.tables.map((t) => [t.nom.toLowerCase(), t]))
    const centre = parNom.get(String(id || '').toLowerCase())
      || schema.tables.find((t) => t.libelle && !t.exclue)
      || schema.tables[0]
    if (!centre) return vider(zone, h('div', { class: 'carte vide' }, 'Structure de la base inconnue : connectez-vous à MySQL ou importez un export de structure.'))

    const panneau = h('div', { class: 'carte', style: { position: 'sticky', top: '86px' } })
    const recherche = h('input', { type: 'search', placeholder: 'Mettre une table au centre…', list: 'birtec-tables' })
    recherche.addEventListener('change', () => {
      const t = parNom.get(recherche.value.trim().toLowerCase())
      if (t) location.hash = `#/schema/${encodeURIComponent(t.nom)}`
    })
    const caseCercle = h('input', { type: 'checkbox', checked: deuxiemeCercle, onchange: () => { deuxiemeCercle = caseCercle.checked; window.birtec.recharger() } })

    const graphe = construireGraphe(centre, schema, parNom)
    const dessin = dessiner(graphe, {
      surTable: (t) => vider(panneau, panneauTable(t, centre)),
      surLien: (l) => vider(panneau, panneauLien(l)),
    })
    vider(panneau, panneauTable(centre, centre))

    vider(
      zone,
      h('div', { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Schéma des liens'), h('p', { class: 'sous-titre' }, 'Cliquez une table pour la décrire ou la mettre au centre, un lien pour le nommer. L’IA se sert de ces noms pour choisir ses jointures.')),
        h('div', { class: 'actions' }, recherche, h('datalist', { id: 'birtec-tables' }, schema.tables.map((t) => h('option', { value: t.nom }, t.libelle || '')))),
      ),
      h('div', { class: 'schema-grille' },
        h('div', { class: 'carte', style: { padding: '8px' } },
          dessin,
          h('div', { class: 'discret', style: { fontSize: '12px', display: 'flex', gap: '16px', flexWrap: 'wrap', padding: '6px 8px' } },
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, caseCercle, 'Afficher le 2e cercle (tables liées aux voisines)'),
            graphe.caches ? h('span', {}, `${graphe.caches} autre(s) table(s) liée(s) non affichée(s) (les tables décrites passent en premier)`) : null,
            h('span', {}, 'Tables grisées : écartées de l’IA.'),
          ),
        ),
        panneau,
      ),
    )
  },
}

// ---------------------------------------------------------------- graphe

function construireGraphe(centre, schema, parNom) {
  const voisinsDe = (table) => {
    const liens = []
    for (const l of table.liens) {
      const autre = parNom.get(l.versTable.toLowerCase())
      if (autre && autre !== table) liens.push({ de: table, vers: autre, lien: l })
    }
    for (const t of schema.tables) {
      if (t === table) continue
      for (const l of t.liens) if (l.versTable.toLowerCase() === table.nom.toLowerCase()) liens.push({ de: t, vers: table, lien: l })
    }
    return liens
  }
  const rang = (t) => (t.exclue ? 2 : t.libelle ? 0 : 1)

  const liensCentre = voisinsDe(centre)
  const voisins = [...new Set(liensCentre.map((l) => (l.de === centre ? l.vers : l.de)))].sort((a, b) => rang(a) - rang(b) || a.nom.localeCompare(b.nom))
  const affiches = voisins.slice(0, VOISINS_MAX)
  const noeuds = [{ table: centre, x: LARGEUR / 2, y: HAUTEUR / 2, niveau: 0 }]
  affiches.forEach((t, i) => {
    const angle = (2 * Math.PI * i) / affiches.length - Math.PI / 2
    noeuds.push({ table: t, x: LARGEUR / 2 + Math.cos(angle) * 250, y: HAUTEUR / 2 + Math.sin(angle) * 230, niveau: 1, angle })
  })
  const aretes = liensCentre.filter((l) => affiches.includes(l.de) || affiches.includes(l.vers))

  if (deuxiemeCercle) {
    const deja = new Set(noeuds.map((n) => n.table))
    for (const n of noeuds.filter((x) => x.niveau === 1)) {
      if (n.table.exclue) continue
      const suivants = voisinsDe(n.table).filter((l) => !deja.has(l.de === n.table ? l.vers : l.de) && !(l.de === n.table ? l.vers : l.de).exclue).slice(0, 3)
      suivants.forEach((l, j) => {
        const t = l.de === n.table ? l.vers : l.de
        deja.add(t)
        const angle = n.angle + (j - (suivants.length - 1) / 2) * 0.12
        noeuds.push({ table: t, x: LARGEUR / 2 + Math.cos(angle) * 420, y: HAUTEUR / 2 + Math.sin(angle) * 330, niveau: 2 })
        aretes.push(l)
      })
    }
  }
  return { noeuds, aretes, caches: voisins.length - affiches.length }
}

function el(nom, attributs = {}, ...enfants) {
  const e = document.createElementNS(SVG, nom)
  for (const [cle, valeur] of Object.entries(attributs)) {
    if (cle.startsWith('on')) e.addEventListener(cle.slice(2), valeur)
    else e.setAttribute(cle, valeur)
  }
  for (const enfant of enfants.flat()) if (enfant) e.append(enfant instanceof Node ? enfant : document.createTextNode(enfant))
  return e
}

function dessiner(graphe, { surTable, surLien }) {
  const position = new Map(graphe.noeuds.map((n) => [n.table, n]))
  const svg = el('svg', { viewBox: `0 0 ${LARGEUR} ${HAUTEUR}`, class: 'schema-liens', role: 'img' })

  for (const a of graphe.aretes) {
    const p1 = position.get(a.de)
    const p2 = position.get(a.vers)
    if (!p1 || !p2) continue
    const etiquette = a.lien.libelle || a.lien.colonne
    // Le nom du lien est placé plus près de la table la plus éloignée du centre (moins de chevauchements).
    const t = p1.niveau < p2.niveau ? 0.62 : p1.niveau > p2.niveau ? 0.38 : 0.5
    const mx = p1.x + (p2.x - p1.x) * t
    const my = p1.y + (p2.y - p1.y) * t
    svg.append(el('g', { class: `arete ${a.lien.libelle ? 'nommee' : ''}`, onclick: () => surLien(a) },
      el('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'trait' }),
      el('line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: 'zone-clic' }),
      el('text', { x: mx, y: my - 4, 'text-anchor': 'middle', class: 'etiquette-lien' }, etiquette.length > 26 ? etiquette.slice(0, 25) + '…' : etiquette),
      el('title', {}, `${a.de.nom}.${a.lien.colonne} → ${a.vers.nom}.${a.lien.versColonne}${a.lien.description ? ` — ${a.lien.description}` : ''}`),
    ))
  }

  for (const n of graphe.noeuds) {
    const t = n.table
    const largeur = n.niveau === 2 ? 110 : 150
    const hauteur = t.libelle && n.niveau < 2 ? 42 : 28
    const libelle = t.libelle ? (t.libelle.length > 24 ? t.libelle.slice(0, 23) + '…' : t.libelle) : ''
    svg.append(el('g', {
      class: `noeud niveau-${n.niveau} ${t.exclue ? 'ecartee' : ''} ${t.libelle ? 'decrite' : ''}`,
      transform: `translate(${n.x - largeur / 2}, ${n.y - hauteur / 2})`,
      onclick: () => surTable(t),
      ondblclick: () => (location.hash = `#/schema/${encodeURIComponent(t.nom)}`),
    },
      el('rect', { width: largeur, height: hauteur, rx: 8 }),
      el('text', { x: largeur / 2, y: libelle && n.niveau < 2 ? 17 : 18, 'text-anchor': 'middle', class: 'nom-table' }, t.nom),
      libelle && n.niveau < 2 ? el('text', { x: largeur / 2, y: 33, 'text-anchor': 'middle', class: 'libelle-table' }, libelle) : null,
      el('title', {}, [t.libelle, t.description].filter(Boolean).join(' — ') || t.nom),
    ))
  }
  return svg
}

// ---------------------------------------------------------------- panneau de droite

function enregistreur(entree, action) {
  entree.addEventListener('change', async () => {
    await action(entree.value.trim())
    entree.classList.add('enregistre')
    setTimeout(() => entree.classList.remove('enregistre'), 1200)
  })
  return entree
}

function panneauTable(t, centre) {
  const dico = (cle) => (valeur) => api('/api/dictionnaire', { methode: 'POST', corps: { table: t.nom, [cle]: valeur } })
  const coche = h('input', { type: 'checkbox', checked: !t.exclue, onchange: async () => { await api('/api/dictionnaire', { methode: 'POST', corps: { table: t.nom, exclue: !coche.checked } }); notifier(coche.checked ? 'Table prise en compte par l’IA' : 'Table écartée de l’IA'); window.birtec.recharger() } })
  return [
    h('h2', { class: 'mono', style: { marginBottom: '10px' } }, t.nom),
    h('label', { class: 'champ' }, h('span', {}, 'Nom clair'), enregistreur(h('input', { type: 'text', value: t.libelle || '', placeholder: 'ex. Rapport d’intervention' }), dico('libelle'))),
    h('label', { class: 'champ', style: { marginTop: '10px' } }, h('span', {}, 'Description (pour l’IA)'), enregistreur(h('textarea', { rows: 4 }, t.description || ''), dico('description'))),
    h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px' } }, coche, 'Prise en compte par l’IA'),
    h('p', { class: 'discret', style: { fontSize: '13px' } }, `${t.colonnes.length} colonnes, ${t.liens.length} lien(s) vers d’autres tables.`),
    h('div', { class: 'actions', style: { marginTop: '10px' } },
      t !== centre ? h('a', { class: 'bouton petit', href: `#/schema/${encodeURIComponent(t.nom)}` }, ic('reseau', 14), 'Mettre au centre') : null,
      h('a', { class: 'bouton petit discret', href: `#/base/${encodeURIComponent(t.nom)}` }, ic('table', 14), 'Colonnes'),
    ),
    t === centre ? ajoutLien(t) : null,
  ]
}

function panneauLien(a) {
  const lien = (cle) => (valeur) => api('/api/dictionnaire/lien', { methode: 'POST', corps: { deTable: a.de.nom, deColonne: a.lien.colonne, versTable: a.vers.nom, libelle: cle === 'libelle' ? valeur : a.lien.libelle || '', description: cle === 'description' ? valeur : a.lien.description || '' } }).then(() => { a.lien[cle] = valeur })
  return [
    h('h2', { style: { marginBottom: '6px' } }, 'Lien'),
    h('p', { class: 'mono', style: { fontSize: '13px' } }, `${a.de.nom}.${a.lien.colonne}`, h('br'), `→ ${a.vers.nom}.${a.lien.versColonne}`),
    h('label', { class: 'champ' }, h('span', {}, 'Nom du lien'), enregistreur(h('input', { type: 'text', value: a.lien.libelle || '', placeholder: 'ex. équipement de la demande' }), lien('libelle'))),
    h('label', { class: 'champ', style: { marginTop: '10px' } }, h('span', {}, 'Description (pour l’IA)'), enregistreur(h('textarea', { rows: 4 }, a.lien.description || ''), lien('description'))),
    h('p', { class: 'discret', style: { fontSize: '12px' } }, 'Jointure : ', h('span', { class: 'mono' }, `${a.de.nom}.${a.lien.colonne} = ${a.vers.nom}.${a.lien.versColonne}`)),
  ]
}

// Un lien que la base ne déclare pas et que BiRTEC n'a pas su déduire (nom de colonne inhabituel).
function ajoutLien(t) {
  const colonne = h('select', {}, t.colonnes.map((c) => h('option', { value: c.nom }, c.nom)))
  const cible = h('input', { type: 'text', placeholder: 'table visée', list: 'birtec-tables' })
  const colonneCible = h('input', { type: 'text', placeholder: 'colonne visée (même nom si vide)' })
  return h('details', { style: { marginTop: '16px' } },
    h('summary', { class: 'discret' }, 'Ajouter un lien manquant'),
    h('div', { class: 'grille', style: { marginTop: '8px' } },
      colonne, cible, colonneCible,
      h('button', {
        class: 'petit',
        onclick: async () => {
          if (!cible.value.trim()) return notifier('Indiquez la table visée.', 'erreur')
          await api('/api/dictionnaire/lien', { methode: 'POST', corps: { nouveau: true, deTable: t.nom, deColonne: colonne.value, versTable: cible.value.trim(), versColonne: colonneCible.value.trim() || colonne.value } })
          notifier('Lien ajouté')
          await api('/api/schema?rafraichir=1').catch(() => {})
          window.birtec.recharger()
        },
      }, ic('plus', 14), 'Ajouter'),
    ),
  )
}
