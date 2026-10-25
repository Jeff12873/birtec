// Constellation (schéma des liens) : toutes les tables en bulles, reliées par leurs liens, disposées par une petite
// simulation physique (les bulles se repoussent, les liens les rapprochent), à la manière du graphe d'Obsidian.
//
//   molette : zoom          glisser le fond : se déplacer          glisser une bulle : la déplacer
//   clic sur une bulle : la décrire (nom clair, description, prise en compte par l'IA) — c'est la source
//   Ctrl + clic sur une autre bulle : chemin de jointure le plus court entre les deux (tables et clés)
//   Ctrl + Maj + clic : construire le chemin soi-même, table par table
//   clic sur un lien : le nommer et le décrire
//   curseurs : force des liens (attraction) et écartement des bulles (répulsion)
//   « Figer en lâchant » : une bulle déplacée reste où on la lâche ; double-clic sur une bulle figée : la libérer
//   « Imprimer / PDF » : page A3 paysage mise en forme, à enregistrer en PDF
//   menu des motifs : ranger autrement (anneaux, hiérarchie, galaxies…) ; « Ma disposition » ramène chaque bulle
//   à sa place, « Garder cette disposition » enregistre le motif à la place (bulles figées)
//   étincelle : rejouer l'allumage des étoiles
// La disposition (positions, bulles figées) est gardée dans le fichier .ktec.
//
// Tout ce qui est saisi est gardé dans le fichier .ktec (dictionnaire) et sert à l'IA.

import { h, vider, ic, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat } from '/socle/etat.js'
import { extraireTables } from '../base/vue.js'
import { pdfDepuisJpeg } from '/socle/pdf.js'
import { MOTIFS, disposer } from '../../interface/motifs.js'
import { menuDeroulant } from '../../interface/menu-deroulant.js'

let voirEcartees = false
// Positions des bulles { x, y, fige } : chargées du .ktec, gardées d'une visite à l'autre.
const positions = new Map()
let dispositionChargee = false
// L'allumage des étoiles ne se joue qu'à la première ouverture de l'écran.
let allumageJoue = false
const DUREE_ALLUMAGE = 3.4 // secondes

// Réglages de la simulation (gardés sur ce poste).
const reglages = { attraction: 1, ecartement: 1, figer: true, cles: false, raccourcis: true }
try {
  Object.assign(reglages, JSON.parse(localStorage.getItem('birtec-schema-reglages') || '{}'))
} catch {
  // stockage indisponible : réglages par défaut
}
function garderReglages() {
  try {
    localStorage.setItem('birtec-schema-reglages', JSON.stringify(reglages))
  } catch {}
}

// Enregistre la disposition dans le .ktec (un peu après le dernier changement, pour ne pas écrire sans arrêt).
let minuterieDisposition = null
function enregistrerDisposition() {
  clearTimeout(minuterieDisposition)
  minuterieDisposition = setTimeout(() => {
    const donnees = Object.fromEntries([...positions].map(([nom, p]) => [nom, { x: Math.round(p.x), y: Math.round(p.y), ...(p.fige ? { fige: true } : {}) }]))
    api('/api/schema/disposition', { methode: 'POST', corps: { positions: donnees } }).catch(() => {})
  }, 1500)
}

export default {
  chemin: 'schema',
  titre: 'Constellation',
  icone: 'reseau',
  menu: true,
  groupe: 'Ma base',
  aide: 'schema',
  rafraichir: false,

  async afficher(zone, { id }) {
    const schema = await api('/api/schema')
    if (!dispositionChargee) {
      const disposition = await api('/api/schema/disposition').catch(() => ({ positions: {} }))
      for (const [nom, p] of Object.entries(disposition.positions || {})) positions.set(nom, p)
      dispositionChargee = true
    }
    if (!schema.tables.length) return vider(zone, h('div', { class: 'carte vide' }, 'Structure de la base inconnue : connectez-vous à MySQL ou importez un export de structure.'))

    const graphe = construireGraphe(schema)
    const panneau = h('div', { class: 'carte panneau-schema' })
    const toile = h('canvas', { class: 'toile-schema' })
    const ciel = h('canvas', { class: 'ciel-schema' })
    const vue = new VueGraphe(toile, graphe, {
      surSelection: (n) => vider(panneau, panneauTable(n, vue)),
      surChemin: (chemin) => vider(panneau, panneauChemin(chemin, vue, panneau)),
      surLien: (l) => vider(panneau, panneauLien(l)),
      surMotif: () => dessinerMotif(),
    })

    // Le menu des motifs, et « Garder » tant qu'un motif est affiché.
    const zoneMotif = h('div', { class: 'zone-motif' })
    function dessinerMotif() {
      vider(zoneMotif,
        menuDeroulant({ choix: MOTIFS.map((m) => ({ valeur: m.id, libelle: m.nom })), valeur: vue.motif || 'libre', surChoix: (id) => vue.appliquerMotif(id) }),
        vue.motif ? h('button', { class: 'discret', title: 'Enregistre ce rangement à la place de votre disposition (les bulles sont figées)', onclick: () => vue.garderMotif() }, ic('coche', 16), 'Garder') : null)
    }
    dessinerMotif()

    const recherche = h('input', { type: 'search', placeholder: 'Chercher une table…', list: 'birtec-tables' })
    const chercher = () => {
      const n = graphe.parNom.get(recherche.value.trim().toLowerCase())
      if (n) vue.centrerSur(n, true)
    }
    recherche.addEventListener('change', chercher)
    recherche.addEventListener('keydown', (e) => e.key === 'Enter' && chercher())
    const caseEcartees = h('input', { type: 'checkbox', checked: voirEcartees, onchange: () => { voirEcartees = caseEcartees.checked; window.ktec.recharger() } })

    vider(panneau, aideSchema(graphe))
    vider(
      zone,
      h('div', { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Constellation des tables'), h('p', { class: 'sous-titre' }, `${graphe.noeuds.length} tables, ${graphe.liens.length} liens. Clic : une table ; Ctrl + clic : chemin le plus court jusqu’à une autre.`)),
        h('div', { class: 'actions' },
          recherche,
          h('datalist', { id: 'birtec-tables' }, graphe.noeuds.map((n) => h('option', { value: n.table.nom }, n.table.libelle || ''))),
          zoneMotif,
          h('button', { class: 'discret icone-seule', title: 'Rejouer l’allumage des étoiles', onclick: () => vue.rejouer() }, ic('etincelle', 16)),
          h('button', { class: 'discret', title: 'Voir tout le graphe', onclick: () => vue.toutVoir() }, ic('rafraichir', 16), 'Tout voir'),
          h('button', { title: 'Enregistre toute la constellation, telle qu’elle est disposée, dans un fichier PDF (A3 paysage)', onclick: () => telechargerPdf(graphe, vue, schema).catch((e) => notifier(`PDF impossible : ${e.message}`, 'erreur')) }, ic('document', 16), 'Constellation en PDF'),
          h('button', { class: 'discret', title: 'La même page, envoyée à l’imprimante', onclick: () => imprimer(graphe, vue, schema) }, ic('document', 16), 'Imprimer'),
        ),
      ),
      h('div', { class: 'schema-grille' },
        h('div', { class: 'carte carte-ciel', style: { padding: '0', overflow: 'hidden', position: 'relative' } },
          ciel,
          toile,
          cadreRaccourcis(),
          reglagesSchema(vue, caseEcartees),
        ),
        panneau,
      ),
    )
    vue.demarrer()
    animerCiel(ciel, vue)
    const choisi = graphe.parNom.get(String(id || '').toLowerCase())
    if (choisi) setTimeout(() => vue.centrerSur(choisi, true), 400)
  },
}

// ---------------------------------------------------------------- données du graphe

function construireGraphe(schema) {
  const tables = schema.tables.filter((t) => voirEcartees || !t.exclue)
  const parNom = new Map()
  const noeuds = tables.map((table, i) => {
    const p = positions.get(table.nom) || depart(table.nom, i, tables.length)
    const n = { table, x: p.x, y: p.y, vx: 0, vy: 0, degre: 0, voisins: new Set(), fige: Boolean(p.fige) }
    parNom.set(table.nom.toLowerCase(), n)
    return n
  })
  // Un lien par paire de tables (avec toutes les colonnes qui les relient).
  const parPaire = new Map()
  for (const n of noeuds) {
    for (const l of n.table.liens) {
      const m = parNom.get(l.versTable.toLowerCase())
      if (!m || m === n) continue
      const cle = [n.table.nom, m.table.nom].sort().join('|')
      if (!parPaire.has(cle)) parPaire.set(cle, { a: n, b: m, jointures: [] })
      parPaire.get(cle).jointures.push({ de: n.table.nom, colonne: l.colonne, vers: m.table.nom, versColonne: l.versColonne, libelle: l.libelle || '', description: l.description || '' })
    }
  }
  const liens = [...parPaire.values()]
  for (const l of liens) {
    // Le lien nommé passe en premier : c'est lui que montrent le chemin et l'impression.
    l.jointures.sort((x, y) => Boolean(y.libelle) - Boolean(x.libelle))
    l.a.degre++
    l.b.degre++
    l.a.voisins.add(l.b)
    l.b.voisins.add(l.a)
  }
  const niveaux = niveauxDu(noeuds)
  for (const n of noeuds) {
    n.rayon = 4 + Math.sqrt(n.degre) * 2.6
    n.niveau = niveaux.find((v) => n.degre >= v.min)
  }
  return { noeuds, liens, parNom, niveaux }
}

// La clé de liaison d'un lien : « ID_DI », ou « ID_PERE = ID_ARTICLE » quand les deux colonnes diffèrent.
// Plusieurs colonnes entre les deux mêmes tables : séparées par « · ».
function texteCle(lien) {
  return lien.jointures.map((j) => (j.colonne === j.versColonne ? j.colonne : `${j.colonne} = ${j.versColonne}`)).join(' · ')
}

// Position de départ stable (dépend du nom) : le graphe se dessine pareil d'une fois à l'autre.
function depart(nom, i, total) {
  let graine = 0
  for (const c of nom) graine = (graine * 31 + c.charCodeAt(0)) >>> 0
  const angle = (i / total) * Math.PI * 2 + (graine % 100) / 100
  const rayon = 150 + (graine % 300)
  return { x: Math.cos(angle) * rayon, y: Math.sin(angle) * rayon }
}

// Chemin le plus court : un lien nommé dans le dictionnaire, ou vers une table « fille », coûte moins
// (mêmes règles que les chemins donnés à l'IA).
function cheminLePlusCourt(graphe, depart, arrivee) {
  const cout = (lien) => {
    const nomme = lien.jointures.some((j) => j.libelle)
    const a = lien.a.table.nom.toLowerCase()
    const b = lien.b.table.nom.toLowerCase()
    return nomme ? 0.6 : a.startsWith(b) || b.startsWith(a) ? 0.8 : 1
  }
  const parNoeud = new Map(graphe.noeuds.map((n) => [n, []]))
  for (const l of graphe.liens) {
    parNoeud.get(l.a).push({ vers: l.b, lien: l })
    parNoeud.get(l.b).push({ vers: l.a, lien: l })
  }
  const meilleurs = new Map([[depart, { cout: 0, precedent: null, lien: null }]])
  const aTraiter = new Set([depart])
  const faits = new Set()
  while (aTraiter.size) {
    let courant = null
    for (const n of aTraiter) if (!courant || meilleurs.get(n).cout < meilleurs.get(courant).cout) courant = n
    aTraiter.delete(courant)
    faits.add(courant)
    if (courant === arrivee) break
    for (const { vers, lien } of parNoeud.get(courant)) {
      if (faits.has(vers)) continue
      const c = meilleurs.get(courant).cout + cout(lien)
      if (!meilleurs.has(vers) || meilleurs.get(vers).cout > c) {
        meilleurs.set(vers, { cout: c, precedent: courant, lien })
        aTraiter.add(vers)
      }
    }
  }
  if (!meilleurs.has(arrivee)) return null
  const etapes = []
  for (let n = arrivee; meilleurs.get(n).precedent; n = meilleurs.get(n).precedent) etapes.unshift({ de: meilleurs.get(n).precedent, vers: n, lien: meilleurs.get(n).lien })
  return { depart, arrivee, etapes }
}

// ---------------------------------------------------------------- dessin interactif

class VueGraphe {
  constructor(toile, graphe, rappels) {
    this.toile = toile
    this.graphe = graphe
    this.rappels = rappels
    this.vue = { x: 0, y: 0, k: 0.8 }
    this.chaleur = positions.size ? 0.3 : 1 // énergie de la simulation : elle s'arrête quand tout est en place
    this.survol = null
    this.source = null
    this.chemin = null
    this.lienChoisi = null
    this.tenu = null
    this.couleurs = couleursDuTheme()
    this.allumage = allumageJoue ? null : { debut: 0 }
    allumageJoue = true
    this.motif = null // motif affiché (null : la disposition de l'utilisateur)
    this.utilisateur = null // positions de l'utilisateur, gardées pendant qu'un motif est affiché
    this.transition = null
    this.etiquettes = []
    this.trace = null // dessin en filigrane d'un motif (silhouette)
    this.liensDiscrets = false
    this.ecouter()
  }

  demarrer() {
    const ajuster = () => {
      const r = this.toile.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      this.toile.width = r.width * ratio
      this.toile.height = r.height * ratio
      this.ratio = ratio
      this.dessiner()
    }
    new ResizeObserver(ajuster).observe(this.toile)
    ajuster()
    // Premier affichage : on laisse la disposition se faire un peu avant de cadrer.
    const premiere = !positions.size
    if (premiere) for (let i = 0; i < 120; i++) this.simuler()
    if (this.allumage) this.preparerAllumage()
    this.toutVoir()
    const boucle = () => {
      if (!this.toile.isConnected) return // écran quitté
      if (this.transition) {
        this.avancerTransition()
        this.dessiner()
      } else if (this.chaleur > 0.004 && !this.motif) {
        this.simuler()
        this.dessiner()
      } else if (this.allumage) {
        this.dessiner()
      }
      requestAnimationFrame(boucle)
    }
    requestAnimationFrame(boucle)
  }

  // L'allumage : les étoiles s'allument une à une (blanches, puis elles prennent leur couleur), et les liens
  // se tracent ensuite en partant de la table la plus reliée, de proche en proche.
  preparerAllumage() {
    const { noeuds, liens } = this.graphe
    for (const l of liens) delete l.trace
    for (const n of noeuds) n.allumage = Math.random() * 1.1
    const ordre = []
    const vus = new Set()
    for (const racine of [...noeuds].sort((x, y) => y.degre - x.degre)) {
      if (vus.has(racine)) continue
      vus.add(racine)
      const file = [racine]
      while (file.length) {
        const n = file.shift()
        for (const l of liens) {
          if (l.trace || (l.a !== n && l.b !== n)) continue
          const autre = l.a === n ? l.b : l.a
          l.trace = { de: n, vers: autre }
          ordre.push(l)
          if (!vus.has(autre)) { vus.add(autre); file.push(autre) }
        }
      }
    }
    ordre.forEach((l, i) => { l.trace.delai = 1.2 + (i / Math.max(1, ordre.length)) * 1.6 })
    this.allumage.debut = performance.now()
  }

  rejouer() {
    this.allumage = { debut: 0 }
    this.preparerAllumage()
  }

  // Un motif : les bulles glissent vers leurs nouvelles places (et la vue se recadre). « libre » : retour aux
  // positions de l'utilisateur, notées au premier motif choisi.
  appliquerMotif(id) {
    let cibles
    if (id === 'libre') {
      if (!this.utilisateur) return
      cibles = this.utilisateur
      this.etiquettes = []
      this.trace = null
      this.liensDiscrets = false
    } else {
      if (!this.utilisateur) this.utilisateur = new Map(this.graphe.noeuds.map((n) => [n, { x: n.x, y: n.y, fige: n.fige }]))
      const r = disposer(id, this.graphe, { source: this.source })
      cibles = r.positions
      this.etiquettes = r.etiquettes
      this.trace = r.trace || null
      this.liensDiscrets = Boolean(r.liensDiscrets)
    }
    this.motif = id === 'libre' ? null : id
    const depart = new Map(this.graphe.noeuds.map((n) => [n, { x: n.x, y: n.y }]))
    this.transition = { debut: performance.now(), depart, cibles, vueDepart: { ...this.vue }, vueArrivee: this.cadrage([...cibles.values()]), retour: id === 'libre' }
    this.rappels.surMotif?.()
  }

  avancerTransition() {
    const t = Math.min(1, (performance.now() - this.transition.debut) / 900)
    const doux = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
    const { depart, cibles, vueDepart, vueArrivee } = this.transition
    for (const n of this.graphe.noeuds) {
      const a = depart.get(n)
      const b = cibles.get(n) || a
      n.x = a.x + (b.x - a.x) * doux
      n.y = a.y + (b.y - a.y) * doux
    }
    for (const cle of ['x', 'y', 'k']) this.vue[cle] = vueDepart[cle] + (vueArrivee[cle] - vueDepart[cle]) * doux
    if (t < 1) return
    if (this.transition.retour) {
      for (const [n, p] of this.utilisateur) n.fige = p.fige
      this.utilisateur = null
    }
    this.transition = null
  }

  // Enregistre le motif affiché comme disposition de l'utilisateur : toutes les bulles figées à leur place.
  garderMotif() {
    if (!this.motif || this.transition) return
    for (const n of this.graphe.noeuds) {
      n.fige = true
      positions.set(n.table.nom, { x: n.x, y: n.y, fige: true })
    }
    enregistrerDisposition()
    this.motif = null
    this.utilisateur = null
    this.etiquettes = []
    this.trace = null
    this.liensDiscrets = false
    this.rappels.surMotif?.()
    this.dessiner()
    notifier('Disposition enregistrée (double-clic sur une bulle pour la libérer)')
  }

  // Un pas de simulation : répulsion entre bulles, attraction le long des liens, légère gravité vers le centre.
  simuler() {
    const noeuds = this.graphe.noeuds
    const alpha = this.chaleur
    for (let i = 0; i < noeuds.length; i++) {
      const a = noeuds[i]
      for (let j = i + 1; j < noeuds.length; j++) {
        const b = noeuds[j]
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d2 = dx * dx + dy * dy
        if (d2 > 160000 * reglages.ecartement) continue // trop loin pour compter
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1 }
        const force = (900 * reglages.ecartement * alpha) / d2
        a.vx -= dx * force
        a.vy -= dy * force
        b.vx += dx * force
        b.vy += dy * force
      }
    }
    for (const l of this.graphe.liens) {
      const dx = l.b.x - l.a.x
      const dy = l.b.y - l.a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const ideal = (30 + l.a.rayon + l.b.rayon) / Math.sqrt(reglages.attraction)
      const force = ((d - ideal) / d) * 0.06 * reglages.attraction * alpha
      l.a.vx += dx * force
      l.a.vy += dy * force
      l.b.vx -= dx * force
      l.b.vy -= dy * force
    }
    for (const n of noeuds) {
      n.vx -= n.x * 0.004 * alpha
      n.vy -= n.y * 0.004 * alpha
      if (n === this.tenu || n.fige) {
        n.vx = n.vy = 0
        positions.set(n.table.nom, { x: n.x, y: n.y, fige: n.fige })
        continue
      }
      n.vx *= 0.6
      n.vy *= 0.6
      n.x += Math.max(-20, Math.min(20, n.vx))
      n.y += Math.max(-20, Math.min(20, n.vy))
      positions.set(n.table.nom, { x: n.x, y: n.y, fige: false })
    }
    this.chaleur *= 0.985
    // La disposition est enregistrée quand le graphe s'est posé.
    if (this.chaleur <= 0.004) enregistrerDisposition()
  }

  versEcran(x, y) {
    const r = this.toile.getBoundingClientRect()
    return { x: (x - this.vue.x) * this.vue.k + r.width / 2, y: (y - this.vue.y) * this.vue.k + r.height / 2 }
  }

  versMonde(ex, ey) {
    const r = this.toile.getBoundingClientRect()
    return { x: (ex - r.width / 2) / this.vue.k + this.vue.x, y: (ey - r.height / 2) / this.vue.k + this.vue.y }
  }

  noeudSous(ex, ey) {
    const p = this.versMonde(ex, ey)
    let meilleur = null
    let distance = Infinity
    for (const n of this.graphe.noeuds) {
      const d = Math.hypot(n.x - p.x, n.y - p.y)
      if (d < n.rayon + 4 / this.vue.k && d < distance) {
        meilleur = n
        distance = d
      }
    }
    return meilleur
  }

  lienSous(ex, ey) {
    const p = this.versMonde(ex, ey)
    const tolerance = 5 / this.vue.k
    for (const l of this.graphe.liens) {
      const dx = l.b.x - l.a.x
      const dy = l.b.y - l.a.y
      const t = Math.max(0, Math.min(1, ((p.x - l.a.x) * dx + (p.y - l.a.y) * dy) / (dx * dx + dy * dy || 1)))
      if (Math.hypot(l.a.x + t * dx - p.x, l.a.y + t * dy - p.y) < tolerance) return l
    }
    return null
  }

  ecouter() {
    const t = this.toile
    let glisse = null // { type: 'fond' | 'noeud', … }
    const position = (e) => {
      const r = t.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    t.addEventListener('wheel', (e) => {
      e.preventDefault()
      const p = position(e)
      const avant = this.versMonde(p.x, p.y)
      this.vue.k = Math.max(0.08, Math.min(8, this.vue.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      const apres = this.versMonde(p.x, p.y)
      this.vue.x += avant.x - apres.x
      this.vue.y += avant.y - apres.y
      this.dessiner()
    }, { passive: false })
    t.addEventListener('pointerdown', (e) => {
      const p = position(e)
      const n = this.noeudSous(p.x, p.y)
      glisse = n ? { type: 'noeud', noeud: n, depart: p, bouge: false } : { type: 'fond', depart: p, vue: { ...this.vue }, bouge: false }
      t.setPointerCapture(e.pointerId)
    })
    t.addEventListener('pointermove', (e) => {
      const p = position(e)
      if (glisse) {
        if (Math.hypot(p.x - glisse.depart.x, p.y - glisse.depart.y) > 3) glisse.bouge = true
        if (!glisse.bouge) return
        if (glisse.type === 'fond') {
          this.vue.x = glisse.vue.x - (p.x - glisse.depart.x) / this.vue.k
          this.vue.y = glisse.vue.y - (p.y - glisse.depart.y) / this.vue.k
        } else {
          const m = this.versMonde(p.x, p.y)
          glisse.noeud.x = m.x
          glisse.noeud.y = m.y
          this.tenu = glisse.noeud
          this.chaleur = Math.max(this.chaleur, 0.25)
        }
        this.dessiner()
        return
      }
      const n = this.noeudSous(p.x, p.y)
      if (n !== this.survol) {
        this.survol = n
        this.dessiner()
      }
      t.style.cursor = n || this.lienSous(p.x, p.y) ? 'pointer' : 'grab'
    })
    t.addEventListener('dblclick', (e) => {
      const p = position(e)
      const n = this.noeudSous(p.x, p.y)
      if (n?.fige && !this.motif) {
        this.liberer(n)
        notifier(`${n.table.nom} libérée`)
      }
    })
    t.addEventListener('pointerleave', () => {
      if (this.survol) {
        this.survol = null
        this.dessiner()
      }
    })
    t.addEventListener('pointerup', (e) => {
      const p = position(e)
      const g = glisse
      glisse = null
      this.tenu = null
      if (g?.bouge && g.type === 'noeud' && !this.motif) {
        // Lâchée : elle reste là si « figer » est coché, sinon elle repart avec les autres.
        g.noeud.fige = reglages.figer
        positions.set(g.noeud.table.nom, { x: g.noeud.x, y: g.noeud.y, fige: g.noeud.fige })
        enregistrerDisposition()
        this.dessiner()
      }
      if (!g || g.bouge) return
      if (g.type === 'noeud') {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
          this.ajouterAuChemin(g.noeud)
        } else if ((e.ctrlKey || e.metaKey) && this.source && this.source !== g.noeud) {
          this.chemin = cheminLePlusCourt(this.graphe, this.source, g.noeud)
          this.rappels.surChemin(this.chemin || { depart: this.source, arrivee: g.noeud, etapes: null })
        } else {
          this.source = g.noeud
          this.chemin = null
          this.lienChoisi = null
          this.rappels.surSelection(g.noeud)
        }
      } else {
        const l = this.lienSous(p.x, p.y)
        if (l) {
          this.lienChoisi = l
          this.rappels.surLien(l)
        }
      }
      this.dessiner()
    })
  }

  // Chemin construit à la main (Ctrl + Maj + clic) : chaque table cliquée prolonge le chemin. Si elle n'est pas
  // directement liée à la précédente, le plus court passage entre les deux est ajouté.
  ajouterAuChemin(n) {
    const actuel = this.chemin?.manuel ? this.chemin : null
    const derniere = actuel ? actuel.arrivee : this.source
    if (!derniere || derniere === n) {
      this.source = n
      this.chemin = { depart: n, arrivee: n, etapes: [], manuel: true }
    } else {
      const direct = this.graphe.liens.find((l) => (l.a === derniere && l.b === n) || (l.b === derniere && l.a === n))
      let morceau = direct ? [{ de: derniere, vers: n, lien: direct }] : null
      if (!morceau) {
        // Pas de lien direct : on part de la table du chemin la plus proche, pas forcément la dernière,
        // pour ne pas repasser par des tables déjà prises (aller-retour ri → riperso → ri…).
        const presentes = actuel ? [actuel.depart, ...actuel.etapes.map((e) => e.vers)] : [derniere]
        for (const depart of new Set(presentes)) {
          const essai = cheminLePlusCourt(this.graphe, depart, n)?.etapes
          if (essai && (!morceau || essai.length < morceau.length)) morceau = essai
        }
      }
      if (!morceau) {
        notifier(`Aucun lien connu entre ${derniere.table.nom} et ${n.table.nom}.`, 'erreur')
        return
      }
      if (!direct) notifier(`${n.table.nom} n’est pas liée directement à ${derniere.table.nom} : rattachée par ${[morceau[0].de, ...morceau.slice(0, -1).map((e) => e.vers)].map((t) => t.table.nom).join(', ')}.`)
      this.chemin = { depart: actuel ? actuel.depart : derniere, arrivee: n, etapes: [...(actuel?.etapes || []), ...morceau], manuel: true }
    }
    this.rappels.surChemin(this.chemin)
    this.dessiner()
  }

  // Retire la dernière table du chemin construit.
  retirerDernier() {
    if (!this.chemin?.manuel) return
    const etapes = this.chemin.etapes.slice(0, -1)
    this.chemin = { ...this.chemin, etapes, arrivee: etapes.at(-1)?.vers || this.chemin.depart }
    this.rappels.surChemin(this.chemin)
    this.dessiner()
  }

  // Double-clic sur une bulle figée : elle est libérée et reprend sa place dans la simulation.
  liberer(n) {
    n.fige = false
    positions.set(n.table.nom, { x: n.x, y: n.y, fige: false })
    this.relancer(0.3)
    enregistrerDisposition()
  }

  libererTout() {
    if (this.motif) return
    for (const n of this.graphe.noeuds) n.fige = false
    this.relancer(0.6)
    enregistrerDisposition()
  }

  // Remet de l'énergie : le graphe se réorganise selon les réglages.
  relancer(chaleur = 0.5) {
    if (this.motif) return
    this.chaleur = Math.max(this.chaleur, chaleur)
  }

  toutVoir() {
    if (!this.graphe.noeuds.length) return
    this.vue = this.cadrage(this.graphe.noeuds)
    this.dessiner()
  }

  // La vue qui montre tous ces points ({ x, y }).
  cadrage(points) {
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const r = this.toile.getBoundingClientRect()
    const largeur = Math.max(...xs) - Math.min(...xs) + 80
    const hauteur = Math.max(...ys) - Math.min(...ys) + 110
    const barre = 70 // la barre des réglages, en bas de la toile, ne doit rien cacher
    const k = Math.min(2, Math.max(0.08, Math.min(r.width / largeur, (r.height - barre) / hauteur)))
    return { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 - 10 + barre / 2 / k, k }
  }

  centrerSur(n, choisir = false) {
    this.vue = { x: n.x, y: n.y, k: Math.max(this.vue.k, 1.8) }
    if (choisir) {
      this.source = n
      this.chemin = null
      this.rappels.surSelection(n)
    }
    this.dessiner()
  }

  effacerChemin() {
    this.chemin = null
    this.dessiner()
  }

  dessiner() {
    const c = this.toile.getContext('2d')
    const r = this.toile.getBoundingClientRect()
    const { k } = this.vue
    const couleurs = this.couleurs
    c.setTransform(this.ratio || 1, 0, 0, this.ratio || 1, 0, 0)
    c.clearRect(0, 0, r.width, r.height)
    const t = this.allumage ? (performance.now() - this.allumage.debut) / 1000 : Infinity
    if (t > DUREE_ALLUMAGE) this.allumage = null
    const borne = (x) => Math.max(0, Math.min(1, x))

    const surChemin = new Set()
    const liensChemin = new Set()
    if (this.chemin?.etapes) {
      for (const e of this.chemin.etapes) {
        surChemin.add(e.de)
        surChemin.add(e.vers)
        liensChemin.add(e.lien)
      }
    }
    const focus = this.survol
    const attenue = (n) => (focus ? n !== focus && !focus.voisins.has(n) : surChemin.size > 0 && !surChemin.has(n))

    // Filigrane du motif (la silhouette du concombre masqué), qui apparaît une fois les bulles en place.
    if (this.trace && !this.transition) {
      c.beginPath()
      this.trace.forEach((p, i) => { const e = this.versEcran(p.x, p.y); i ? c.lineTo(e.x, e.y) : c.moveTo(e.x, e.y) })
      c.closePath()
      c.strokeStyle = couleurs.accent
      c.globalAlpha = 0.7
      c.lineWidth = 2
      c.setLineDash([6, 6])
      c.shadowColor = couleurs.accent
      c.shadowBlur = 8
      c.stroke()
      c.shadowBlur = 0
      c.setLineDash([])
      c.globalAlpha = 1
    }

    // Liens
    for (const l of this.graphe.liens) {
      let a = this.versEcran(l.a.x, l.a.y)
      let b = this.versEcran(l.b.x, l.b.y)
      if (this.allumage && l.trace) {
        // Pendant l'allumage, le lien se trace depuis la table déjà atteinte.
        const avance = borne((t - l.trace.delai) / 0.5)
        if (!avance) continue
        a = this.versEcran(l.trace.de.x, l.trace.de.y)
        const fin = this.versEcran(l.trace.vers.x, l.trace.vers.y)
        b = { x: a.x + (fin.x - a.x) * avance, y: a.y + (fin.y - a.y) * avance }
      }
      const surLeChemin = liensChemin.has(l)
      const actif = surLeChemin || l === this.lienChoisi || (focus && (l.a === focus || l.b === focus))
      c.strokeStyle = surLeChemin ? couleurs.chemin : actif ? couleurs.accent : couleurs.lien
      c.globalAlpha = (actif ? 1 : focus || surChemin.size ? 0.1 : l.jointures.some((j) => j.libelle) ? 0.7 : 0.4) * (this.liensDiscrets && !actif ? 0.3 : 1)
      c.lineWidth = surLeChemin ? 3 : actif ? 1.6 : 0.8
      c.beginPath()
      c.moveTo(a.x, a.y)
      c.lineTo(b.x, b.y)
      c.stroke()
    }
    c.globalAlpha = 1

    // Clés de liaison, écrites le long de chaque ligne (dans son axe, jamais à l'envers).
    if (reglages.cles && !this.allumage) {
      c.font = `${Math.round(10 + Math.min(3, k))}px ui-monospace, monospace`
      c.textAlign = 'center'
      c.textBaseline = 'bottom'
      for (const l of this.graphe.liens) {
        const pale = focus ? !(l.a === focus || l.b === focus) : surChemin.size > 0 && !liensChemin.has(l)
        if (pale) continue
        const a = this.versEcran(l.a.x, l.a.y)
        const b = this.versEcran(l.b.x, l.b.y)
        const longueur = Math.hypot(b.x - a.x, b.y - a.y)
        const texte = texteCle(l)
        const place = longueur - (l.a.rayon + l.b.rayon) * Math.sqrt(k) - 8
        if (place < c.measureText(texte).width) continue // ligne trop courte à cet écran : on zoome pour la voir
        let angle = Math.atan2(b.y - a.y, b.x - a.x)
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI // toujours lisible de gauche à droite
        c.save()
        c.translate((a.x + b.x) / 2, (a.y + b.y) / 2)
        c.rotate(angle)
        c.fillStyle = liensChemin.has(l) ? couleurs.chemin : l.jointures.some((j) => j.libelle) ? couleurs.decrite : couleurs.texte2
        c.fillText(texte, 0, -3)
        c.restore()
      }
      c.textBaseline = 'alphabetic'
    }

    // Étiquettes du motif (nom d'un anneau, d'un groupe…)
    if (this.etiquettes.length && !this.transition) {
      c.font = '600 11px system-ui, sans-serif'
      c.textAlign = 'center'
      c.fillStyle = couleurs.texte2
      c.globalAlpha = 0.85
      for (const e of this.etiquettes) {
        const p = this.versEcran(e.x, e.y)
        c.fillText(e.texte.toUpperCase(), p.x, p.y)
      }
      c.globalAlpha = 1
    }

    // Bulles et noms
    const grands = new Set([...this.graphe.noeuds].sort((x, y) => y.degre - x.degre).slice(0, 12))
    for (const n of this.graphe.noeuds) {
      const p = this.versEcran(n.x, n.y)
      const rayon = Math.max(2.5, n.rayon * Math.sqrt(k))
      if (p.x < -rayon - 80 || p.y < -rayon - 40 || p.x > r.width + rayon + 80 || p.y > r.height + rayon + 40) continue
      const pale = attenue(n)
      let couleur = n === this.source ? couleurs.accent : surChemin.has(n) ? couleurs.chemin : n.niveau.ecran
      let eclat = 1
      let rayonVu = rayon
      if (this.allumage) {
        // Un point blanc qui s'allume, puis prend sa couleur.
        eclat = borne((t - n.allumage) / 0.35)
        if (!eclat) continue
        couleur = melange('#ffffff', couleur, borne((t - n.allumage - 0.35) / 0.7))
        rayonVu = rayon * (0.4 + 0.6 * eclat)
      }
      const opacite = (pale ? 0.15 : n.table.exclue ? 0.4 : 1) * eclat
      // Halo : la lueur douce d'une étoile.
      if (!pale && /^#[0-9a-f]{6}$/i.test(couleur)) {
        const halo = c.createRadialGradient(p.x, p.y, rayonVu * 0.6, p.x, p.y, rayonVu * 2.6)
        halo.addColorStop(0, couleur + '55')
        halo.addColorStop(1, couleur + '00')
        c.globalAlpha = opacite
        c.fillStyle = halo
        c.beginPath()
        c.arc(p.x, p.y, rayonVu * 2.6, 0, Math.PI * 2)
        c.fill()
      }
      c.globalAlpha = opacite
      c.fillStyle = couleur
      c.beginPath()
      c.arc(p.x, p.y, rayonVu, 0, Math.PI * 2)
      c.fill()
      if (n === focus || n === this.source || surChemin.has(n)) {
        c.strokeStyle = couleurs.texte
        c.lineWidth = 1.5
        c.stroke()
      }
      // Bulle figée : un petit point sombre au centre (comme une punaise).
      if (n.fige && !pale) {
        c.fillStyle = '#0b1210'
        c.beginPath()
        c.arc(p.x, p.y, Math.max(1.5, rayon * 0.32), 0, Math.PI * 2)
        c.fill()
      }
      // Noms : en zoomant, ou pour les tables importantes, survolées, choisies, sur le chemin.
      const visible = k > 1.1 || n === focus || n === this.source || surChemin.has(n) || (focus && focus.voisins.has(n)) || (k > 0.45 && grands.has(n))
      if (visible && !pale && t > DUREE_ALLUMAGE - 1) {
        c.globalAlpha = (n.table.exclue ? 0.5 : 1) * borne(t - (DUREE_ALLUMAGE - 1))
        c.fillStyle = couleurs.texte
        c.font = `${n === focus || surChemin.has(n) ? '600 ' : ''}${Math.round(11 + Math.min(4, k))}px system-ui, sans-serif`
        c.textAlign = 'center'
        c.fillText(n.table.nom, p.x, p.y + rayon + 12)
        if (n.table.libelle && (k > 1.8 || n === focus || surChemin.has(n))) {
          c.fillStyle = couleurs.texte2
          c.font = `${Math.round(10 + Math.min(3, k / 2))}px system-ui, sans-serif`
          c.fillText(n.table.libelle.length > 34 ? n.table.libelle.slice(0, 33) + '…' : n.table.libelle, p.x, p.y + rayon + 25)
        }
      }
    }
    c.globalAlpha = 1
  }
}

// Couleur d'une bulle selon son nombre de liens : les carrefours ressortent, les tables de passage
// (1 ou 2 liens) restent discrètes. Les seuils suivent la base affichée : de 3 liens jusqu'au plus relié,
// l'écart est coupé en trois. « ecran » pour le fond sombre, « papier » pour le PDF.
function niveauxDu(noeuds) {
  const max = Math.max(3, ...noeuds.map((n) => n.degre))
  const pas = Math.max(1, Math.ceil((max - 2) / 3))
  const fourchette = (de, a) => (de >= a ? `${de}` : `${de} à ${a}`)
  const niveaux = [
    { min: 3 + 2 * pas, nom: 'carrefour', ecran: '#ff4d4d', papier: '#e00000' },
    { min: 3 + pas, nom: 'très reliée', ecran: '#c45bff', papier: '#9000d8' },
    { min: 3, nom: 'reliée', ecran: '#3d9bff', papier: '#0066ff' },
    { min: 0, nom: 'passage', ecran: '#8b95a7', papier: '#a3a9b4' },
  ].filter((v, i, liste) => i === 0 || v.min < liste[i - 1].min) // petites bases : pas de niveau vide
  niveaux.forEach((v, i) => {
    const haut = i ? niveaux[i - 1].min - 1 : max
    v.nom += ` (${v.min ? fourchette(v.min, haut) : fourchette(1, Math.min(2, haut))} liens)`
  })
  return niveaux
}

// Mélange de deux couleurs « #rrggbb » (f = 0 : la première, 1 : la seconde).
function melange(de, vers, f) {
  if (!/^#[0-9a-f]{6}$/i.test(vers)) return vers
  const canal = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map((i) => Math.round(canal(de, i) + (canal(vers, i) - canal(de, i)) * f).toString(16).padStart(2, '0')).join('')
}

// Le ciel derrière la constellation : des étoiles lointaines qui scintillent doucement et glissent un peu
// quand on déplace la vue (parallaxe). Sur une toile à part, pour ne pas redessiner tout le graphe.
function animerCiel(toile, graphe) {
  const etoiles = Array.from({ length: 240 }, () => ({
    x: Math.random(), y: Math.random(),
    r: 0.3 + Math.random() ** 3 * 1.2,
    phase: Math.random() * Math.PI * 2,
    vitesse: 0.3 + Math.random() * 1.1,
    profondeur: 0.015 + Math.random() * 0.05,
  }))
  const c = toile.getContext('2d')
  let derniere = 0
  const image = (instant) => {
    if (!toile.isConnected) return
    requestAnimationFrame(image)
    if (instant - derniere < 50) return // 20 images par seconde suffisent pour scintiller
    derniere = instant
    const ratio = window.devicePixelRatio || 1
    const { width: largeur, height: hauteur } = toile.getBoundingClientRect()
    if (toile.width !== Math.round(largeur * ratio) || toile.height !== Math.round(hauteur * ratio)) {
      toile.width = Math.round(largeur * ratio)
      toile.height = Math.round(hauteur * ratio)
    }
    c.setTransform(ratio, 0, 0, ratio, 0, 0)
    c.clearRect(0, 0, largeur, hauteur)
    const { x: vx, y: vy, k } = graphe.vue
    c.fillStyle = '#dce6ff'
    for (const e of etoiles) {
      const x = (((e.x * largeur - vx * k * e.profondeur) % largeur) + largeur) % largeur
      const y = (((e.y * hauteur - vy * k * e.profondeur) % hauteur) + hauteur) % hauteur
      c.globalAlpha = 0.15 + 0.6 * (0.5 + 0.5 * Math.sin((instant / 1000) * e.vitesse + e.phase)) * Math.min(1, e.r)
      c.beginPath()
      c.arc(x, y, e.r, 0, Math.PI * 2)
      c.fill()
    }
  }
  requestAnimationFrame(image)
}

function couleursDuTheme() {
  const css = getComputedStyle(document.documentElement)
  const v = (nom, defaut) => css.getPropertyValue(nom).trim() || defaut
  return {
    bulle: '#9aa4d6',
    decrite: v('--violet', '#2dd4bf'),
    accent: v('--accent', '#4ade80'),
    chemin: '#f59e0b',
    lien: v('--texte-3', '#6f8c79'),
    texte: v('--texte', '#e6f2ea'),
    texte2: v('--texte-2', '#a3c2ad'),
  }
}

// ---------------------------------------------------------------- cadre des raccourcis (repliable)

function cadreRaccourcis() {
  const RACCOURCIS = [
    ['Molette', 'zoomer, dézoomer'],
    ['Glisser le fond', 'se déplacer'],
    ['Glisser une bulle', 'la déplacer (figée si coché)'],
    ['Double-clic', 'libérer une bulle figée'],
    ['Clic', 'choisir une table (source)'],
    ['Ctrl + clic', 'chemin le plus court jusqu’à cette table'],
    ['Ctrl + Maj + clic', 'construire le chemin, table par table'],
    ['Clic sur un lien', 'le nommer, le décrire'],
  ]
  const cadre = h('div', { class: `cadre-raccourcis ${reglages.raccourcis ? '' : 'replie'}` })
  const dessiner = () => {
    cadre.classList.toggle('replie', !reglages.raccourcis)
    vider(cadre,
      h('button', { class: 'titre-raccourcis', title: reglages.raccourcis ? 'Replier' : 'Afficher les raccourcis', onclick: () => { reglages.raccourcis = !reglages.raccourcis; garderReglages(); dessiner() } },
        ic('aide', 13), 'Raccourcis', h('span', { class: 'discret' }, reglages.raccourcis ? ' ▾' : ' ▸')),
      reglages.raccourcis ? h('dl', {}, RACCOURCIS.map(([touche, effet]) => [h('dt', {}, touche), h('dd', {}, effet)])) : null)
  }
  dessiner()
  return cadre
}

// ---------------------------------------------------------------- réglages sous le graphe

function reglagesSchema(vue, caseEcartees) {
  const curseur = (cle, libelle, aide) => {
    const entree = h('input', { type: 'range', min: '0.2', max: '3', step: '0.1', value: String(reglages[cle]), title: aide })
    const valeur = h('span', { class: 'valeur-curseur' }, `×${Number(reglages[cle]).toFixed(1)}`)
    entree.addEventListener('input', () => {
      reglages[cle] = Number(entree.value)
      valeur.textContent = `×${reglages[cle].toFixed(1)}`
      garderReglages()
      vue.relancer(0.5)
    })
    return h('label', { class: 'curseur-schema', title: aide }, h('span', {}, libelle), entree, valeur)
  }
  const figer = h('input', { type: 'checkbox', checked: reglages.figer, onchange: () => { reglages.figer = figer.checked; garderReglages() } })
  return h('div', { class: 'reglages-schema' },
    curseur('attraction', 'Force des liens', 'Plus fort : les tables liées se rapprochent'),
    curseur('ecartement', 'Écartement', 'Plus fort : les bulles se repoussent davantage'),
    h('label', { class: 'case-schema', title: 'Une bulle déplacée reste où on la lâche (double-clic dessus pour la libérer)' }, figer, 'Figer en lâchant'),
    h('label', { class: 'case-schema', title: 'Écrire la clé de liaison le long de chaque ligne (zoomez si une ligne est trop courte)' },
      h('input', { type: 'checkbox', checked: reglages.cles, onchange: (e) => { reglages.cles = e.target.checked; garderReglages(); vue.dessiner() } }), 'Clés de liaison'),
    h('button', { class: 'petit discret', title: 'Toutes les bulles reprennent leur place dans la simulation', onclick: () => vue.libererTout() }, 'Tout libérer'),
    h('label', { class: 'case-schema' }, caseEcartees, 'Tables écartées'),
  )
}

// ---------------------------------------------------------------- panneau de droite

function aideSchema(graphe) {
  return [
    h('h2', { style: { marginBottom: '8px' } }, 'Mode d’emploi'),
    h('ul', { class: 'texte-2', style: { paddingLeft: '18px', fontSize: '14px', margin: 0 } },
      h('li', {}, 'Molette : zoomer. Glisser le fond : se déplacer. Glisser une bulle : la déplacer (elle reste là si « Figer en lâchant » est coché ; double-clic pour la libérer).'),
      h('li', {}, 'Curseurs sous le graphe : force des liens et écartement des bulles. « Clés de liaison » : la clé écrite le long de chaque ligne.'),
      h('li', {}, 'Clic sur une bulle : la décrire (c’est la source).'),
      h('li', {}, 'Ctrl + clic sur une autre bulle : chemin le plus court, avec les clés de jointure.'),
      h('li', {}, 'Ctrl + Maj + clic : construire le chemin soi-même, table par table.'),
      h('li', {}, 'Clic sur un lien : le nommer et le décrire.'),
    ),
    h('p', { class: 'discret', style: { fontSize: '13px', marginTop: '12px' } },
      'Taille et couleur d’une bulle : nombre de liens. ', graphe.niveaux.map((v, i) => [i ? ', ' : '', h('span', { style: { color: v.ecran, fontWeight: 600 } }, '● ', v.nom)]), '.'),
  ]
}

function enregistreur(entree, action) {
  entree.addEventListener('change', async () => {
    await action(entree.value.trim())
    entree.classList.add('enregistre')
    setTimeout(() => entree.classList.remove('enregistre'), 1200)
  })
  return entree
}

function panneauTable(n, vue) {
  const t = n.table
  const dico = (cle) => (valeur) => api('/api/dictionnaire', { methode: 'POST', corps: { table: t.nom, [cle]: valeur } }).then(() => {
    t[cle] = valeur
    vue.dessiner()
  })
  const coche = h('input', {
    type: 'checkbox',
    checked: !t.exclue,
    onchange: async () => {
      await api('/api/dictionnaire', { methode: 'POST', corps: { table: t.nom, exclue: !coche.checked } })
      t.exclue = !coche.checked
      notifier(coche.checked ? 'Table prise en compte par l’IA' : 'Table écartée de l’IA')
      vue.dessiner()
    },
  })
  return [
    h('div', { class: 'discret', style: { fontSize: '12px' } }, 'Source — Ctrl + clic sur une autre table pour le chemin'),
    h('h2', { class: 'mono', style: { margin: '4px 0 10px' } }, t.nom),
    h('label', { class: 'champ' }, h('span', {}, 'Nom clair'), enregistreur(h('input', { type: 'text', value: t.libelle || '', placeholder: 'ex. Rapport d’intervention' }), dico('libelle'))),
    h('label', { class: 'champ', style: { marginTop: '10px' } }, h('span', {}, 'Description (pour l’IA)'), enregistreur(h('textarea', { rows: 4 }, t.description || ''), dico('description'))),
    h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px' } }, coche, 'Prise en compte par l’IA'),
    h('p', { class: 'discret', style: { fontSize: '13px' } }, `${t.colonnes.length} colonnes, ${n.degre} table(s) liée(s) :`),
    h('div', { class: 'liste-voisins' }, [...n.voisins].sort((a, b) => a.table.nom.localeCompare(b.table.nom)).map((v) =>
      h('a', { href: '#', class: 'mono', title: v.table.libelle || '', onclick: (e) => { e.preventDefault(); vue.centrerSur(v, true) } }, v.table.nom))),
    h('div', { class: 'actions', style: { marginTop: '10px' } },
      h('button', { class: 'petit', onclick: () => extraireTables([t.nom]) }, ic('telecharger', 14), 'Télécharger la table'),
      h('a', { class: 'bouton petit discret', href: `#/base/${encodeURIComponent(t.nom)}` }, ic('table', 14), 'Colonnes')),
    ajoutLien(t),
  ]
}

function panneauChemin(chemin, vue, panneau) {
  if (chemin.manuel && !chemin.etapes.length) {
    return [h('h2', {}, 'Chemin construit'), h('p', { class: 'texte-2' }, `Départ : ${chemin.depart.table.nom}. Ctrl + Maj + clic sur la table suivante pour prolonger le chemin.`),
      h('div', { class: 'actions' }, h('button', { class: 'petit discret', onclick: () => { vue.effacerChemin(); vider(panneau, panneauTable(chemin.depart, vue)) } }, ic('x', 14), 'Effacer'))]
  }
  if (!chemin.etapes) {
    return [h('h2', {}, 'Chemin'), h('p', { class: 'texte-2' }, `Aucun lien connu ne relie ${chemin.depart.table.nom} à ${chemin.arrivee.table.nom}. Ajoutez le lien manquant depuis l’une des deux tables.`)]
  }
  const tables = [chemin.depart, ...chemin.etapes.map((e) => e.vers)]
  // Un chemin construit à la main peut repasser par une table (aller-retour) : elle n'est jointe
  // et téléchargée qu'une fois, sinon le SQL joindrait deux fois la même table sans alias.
  const vues = new Set([chemin.depart.table.nom])
  const utiles = chemin.etapes.filter((e) => !vues.has(e.vers.table.nom) && vues.add(e.vers.table.nom))
  const distinctes = [...vues]
  const jointures = utiles.map((e) => e.lien.jointures[0])
  const sql = `FROM ${chemin.depart.table.nom}\n${utiles.map((e) => {
    const j = e.lien.jointures[0]
    return `JOIN ${e.vers.table.nom} ON ${j.de}.${j.colonne} = ${j.vers}.${j.versColonne}`
  }).join('\n')}`
  const dejaVue = (n, i) => tables.findIndex((t) => t.table.nom === n.table.nom) < i
  return [
    h('h2', { style: { marginBottom: '4px' } }, chemin.manuel ? 'Chemin construit' : 'Chemin le plus court'),
    chemin.manuel ? h('p', { class: 'discret', style: { fontSize: '12px', margin: '0 0 4px' } }, 'Ctrl + Maj + clic sur une table pour prolonger.') : null,
    h('p', { class: 'discret', style: { fontSize: '13px', marginTop: 0 } }, `${jointures.length} jointure(s), ${distinctes.length} tables${distinctes.length < tables.length ? ` (${tables.length - distinctes.length} passage(s) en double, ignoré(s))` : ''}`),
    h('ol', { class: 'chemin-tables' }, tables.map((n, i) => h('li', { style: dejaVue(n, i) ? { opacity: 0.5 } : {} },
      h('span', { class: 'mono' }, n.table.nom),
      dejaVue(n, i) ? h('span', { class: 'discret' }, ' — déjà dans le chemin') : n.table.libelle ? h('span', { class: 'discret' }, ` — ${n.table.libelle}`) : null))),
    h('h3', { style: { margin: '12px 0 6px' } }, 'Clés'),
    h('ul', { class: 'chemin-cles' }, jointures.map((j) => h('li', {}, h('span', { class: 'mono' }, `${j.de}.${j.colonne} = ${j.vers}.${j.versColonne}`), j.libelle ? h('div', { class: 'discret', style: { fontSize: '12px' } }, j.libelle) : null))),
    h('pre', { class: 'code', 'data-langue': 'sql', style: { marginTop: '10px' } }, h('code', {}, sql)),
    h('div', { class: 'actions' },
      h('button', { class: 'petit', onclick: () => navigator.clipboard.writeText(sql).then(() => notifier('Jointures copiées')) }, ic('copier', 14), 'Copier'),
      h('button', { class: 'petit', title: 'Les données de toutes les tables du chemin', onclick: () => extraireTables(distinctes) }, ic('telecharger', 14), `Télécharger les ${distinctes.length} tables`),
      chemin.manuel ? h('button', { class: 'petit discret', title: 'Retirer la dernière table du chemin', onclick: () => vue.retirerDernier() }, ic('retour', 14), 'Retirer la dernière') : null,
      h('button', { class: 'petit discret', onclick: () => { vue.effacerChemin(); vider(panneau, panneauTable(chemin.depart, vue)) } }, ic('x', 14), 'Effacer'),
    ),
  ]
}

function panneauLien(l) {
  return [
    h('h2', { style: { marginBottom: '6px' } }, l.jointures.length > 1 ? 'Liens' : 'Lien'),
    l.jointures.map((j) => {
      const enregistrer = (cle) => (valeur) => api('/api/dictionnaire/lien', {
        methode: 'POST',
        corps: { deTable: j.de, deColonne: j.colonne, versTable: j.vers, libelle: cle === 'libelle' ? valeur : j.libelle, description: cle === 'description' ? valeur : j.description },
      }).then(() => { j[cle] = valeur })
      return h('div', { style: { marginBottom: '14px' } },
        h('p', { class: 'mono', style: { fontSize: '13px' } }, `${j.de}.${j.colonne}`, h('br'), `→ ${j.vers}.${j.versColonne}`),
        h('label', { class: 'champ' }, h('span', {}, 'Nom du lien'), enregistreur(h('input', { type: 'text', value: j.libelle, placeholder: 'ex. équipement de la demande' }), enregistrer('libelle'))),
        h('label', { class: 'champ', style: { marginTop: '8px' } }, h('span', {}, 'Description (pour l’IA)'), enregistreur(h('textarea', { rows: 3 }, j.description), enregistrer('description'))),
      )
    }),
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
          window.ktec.recharger()
        },
      }, ic('plus', 14), 'Ajouter'),
    ),
  )
}

// ---------------------------------------------------------------- PDF et impression

// La page A3 paysage (420 × 297, en millimètres), fond blanc, dessinée en SVG : tout le graphe avec le nom
// de chaque table, le chemin en surbrillance s'il y en a un, une légende. Sert au PDF et à l'impression.
function pageConstellation(graphe, vue, schema) {
  const noeuds = graphe.noeuds
  const xs = noeuds.map((n) => n.x)
  const ys = noeuds.map((n) => n.y)
  const marge = 50
  const minX = Math.min(...xs) - marge
  const minY = Math.min(...ys) - marge
  const largeur = Math.max(...xs) - minX + marge
  const hauteur = Math.max(...ys) - minY + marge
  // Taille du texte fixée sur la feuille : environ 4,5 mm pour un nom de table, quelle que soit l'étendue du graphe
  // (le graphe tient dans un cadre de 400 × 248 mm).
  const echelle = Math.min(400 / largeur, 248 / hauteur) // millimètres par unité du graphe
  const taille = 4.5 / echelle
  const rayon = (n) => Math.max(n.rayon, 2 / echelle) // une bulle fait au moins 4 mm
  const x = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

  const liensChemin = new Set(vue.chemin?.etapes?.map((e) => e.lien) || [])
  const surChemin = new Set(vue.chemin?.etapes?.flatMap((e) => [e.de, e.vers]) || [])
  const traits = graphe.liens.map((l) => `<line x1="${l.a.x}" y1="${l.a.y}" x2="${l.b.x}" y2="${l.b.y}" class="${liensChemin.has(l) ? 'chemin' : l.jointures.some((j) => j.libelle) ? 'nomme' : ''}"/>`).join('')
  // Clés de liaison le long des lignes, si elles sont affichées à l'écran.
  const cles = !reglages.cles ? '' : graphe.liens.map((l) => {
    let angle = (Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) * 180) / Math.PI
    if (angle > 90 || angle < -90) angle += 180
    const mx = (l.a.x + l.b.x) / 2
    const my = (l.a.y + l.b.y) / 2
    return `<text class="cle" x="${mx}" y="${my - taille * 0.25}" font-size="${taille * 0.6}" transform="rotate(${angle.toFixed(1)} ${mx} ${my})">${x(texteCle(l))}</text>`
  }).join('')
  const bulles = noeuds.map((n) => {
    const classe = surChemin.has(n) ? 'chemin' : n.table.exclue ? 'ecartee' : ''
    const grand = n.degre > 8 ? 1.25 : 1
    return `<g class="${classe}"><circle cx="${n.x}" cy="${n.y}" r="${rayon(n)}" fill="${n.niveau.papier}"/>`
      + `<text x="${n.x}" y="${n.y + rayon(n) + taille * 1.1}" font-size="${grand * taille}">${x(n.table.nom)}</text>`
      + (n.table.libelle && n.degre > 3 ? `<text class="libelle" x="${n.x}" y="${n.y + rayon(n) + taille * 2}" font-size="${taille * 0.7}">${x(n.table.libelle)}</text>` : '')
      + '</g>'
  }).join('')

  // Le chemin choisi : ses clés, en bas à droite du graphe, sur un fond blanc.
  let legendeChemin = ''
  if (vue.chemin?.etapes?.length) {
    const lignes = [`Chemin ${vue.chemin.depart.table.nom} → ${vue.chemin.arrivee.table.nom}`, ...new Set(vue.chemin.etapes.map((e) => {
      const j = e.lien.jointures[0]
      return `${j.de}.${j.colonne} = ${j.vers}.${j.versColonne}`
    }))]
    const haut = 270 - lignes.length * 4
    legendeChemin = `<rect x="300" y="${haut - 4}" width="110" height="${lignes.length * 4 + 3}" fill="#fff" fill-opacity="0.9"/>`
      + lignes.map((l, i) => `<text class="${i ? 'mono' : 'gras'}" x="408" y="${haut + i * 4}" text-anchor="end">${x(l)}</text>`).join('')
  }
  const base = etat.connexion?.base || schema.base
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
  const pastille = (cx, couleur, texte) => `<circle cx="${cx}" cy="282" r="1.6" fill="${couleur}"/><text x="${cx + 3}" y="283.2">${x(texte)}</text>`

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297">
<style>
  text { font-family: "Segoe UI", "Noto Sans", system-ui, sans-serif; fill: #1f2937; }
  .titre { font-size: 8px; font-weight: 600; fill: #1e3a8a; }
  .sous-titre { font-size: 3.5px; fill: #6b7280; }
  .pied text { font-size: 3.2px; fill: #374151; }
  .pied text.mono { font-family: ui-monospace, "DejaVu Sans Mono", monospace; font-size: 3px; }
  .pied text.gras { font-weight: 600; }
  .graphe line { stroke: #b4b9d6; stroke-width: ${taille * 0.15}; }
  .graphe line.nomme { stroke: #0d9488; }
  .graphe line.chemin { stroke: #f59e0b; stroke-width: ${taille * 0.45}; }
  .graphe g.ecartee circle { fill: #e5e7eb; }
  .graphe g.chemin circle { fill: #f59e0b !important; stroke: #92400e; stroke-width: ${taille * 0.15}; }
  .graphe text { text-anchor: middle; fill: #111827; font-weight: 600; paint-order: stroke; stroke: #fff; stroke-width: ${taille * 0.25}; stroke-linejoin: round; }
  .graphe text.libelle { fill: #4b5563; font-style: italic; font-weight: 400; }
  .graphe text.cle { fill: #4b5563; font-weight: 400; font-family: ui-monospace, "DejaVu Sans Mono", monospace; }
</style>
<rect width="420" height="297" fill="#fff"/>
<text class="titre" x="10" y="19">Constellation des tables</text>
<text class="sous-titre" x="410" y="19" text-anchor="end">Base « ${x(base)} » — ${noeuds.length} tables, ${graphe.liens.length} liens — ${date} — BiRTEC</text>
<line x1="10" y1="23" x2="410" y2="23" stroke="#1e3a8a" stroke-width="0.6"/>
<svg class="graphe" x="10" y="26" width="400" height="248" viewBox="${minX} ${minY} ${largeur} ${hauteur}" preserveAspectRatio="xMidYMid meet">${traits}${cles}${bulles}</svg>
<g class="pied">
  ${legendeChemin}
  <line x1="10" y1="277" x2="410" y2="277" stroke="#e5e7eb" stroke-width="0.3"/>
  <text x="10" y="283.2">Nombre de liens :</text>
  ${graphe.niveaux.map((v, i) => pastille(40 + i * 50, v.papier, v.nom)).join('')}
  ${pastille(244, '#e5e7eb', 'écartée de l’IA')}
  ${pastille(280, '#f59e0b', 'chemin choisi')}
  <text x="318" y="283.2">Trait vert : lien nommé.</text>
</g>
</svg>`
  return { svg, base }
}

// Télécharge la constellation en fichier PDF (A3 paysage). Le SVG est dessiné sur une toile en haute
// définition, puis glissé tel quel (JPEG) dans un PDF d'une page.
async function telechargerPdf(graphe, vue, schema) {
  const { svg, base } = pageConstellation(graphe, vue, schema)
  const image = new Image()
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await image.decode()
  const largeur = 4200 // environ 250 points par pouce sur une feuille A3
  const hauteur = Math.round((largeur * 297) / 420)
  const toile = document.createElement('canvas')
  toile.width = largeur
  toile.height = hauteur
  const c = toile.getContext('2d')
  c.fillStyle = '#fff'
  c.fillRect(0, 0, largeur, hauteur)
  c.drawImage(image, 0, 0, largeur, hauteur)
  const jpeg = new Uint8Array(await (await new Promise((ok) => toile.toBlob(ok, 'image/jpeg', 0.92))).arrayBuffer())
  const lien = h('a', { href: URL.createObjectURL(pdfDepuisJpeg(jpeg, largeur, hauteur)), download: `constellation-${String(base || 'base').replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.pdf` })
  document.body.append(lien)
  lien.click()
  lien.remove()
  setTimeout(() => URL.revokeObjectURL(lien.href), 10_000)
  notifier('Constellation enregistrée en PDF (dossier des téléchargements)')
}

// La même page, ouverte pour l'imprimante.
function imprimer(graphe, vue, schema) {
  const { svg, base } = pageConstellation(graphe, vue, schema)
  const page = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Constellation des tables — ${base}</title>
<style>@page { size: A3 landscape; margin: 0; } html, body { margin: 0; } svg { display: block; width: 420mm; height: 297mm; }</style>
</head><body>${svg}<script>window.onload = () => setTimeout(() => window.print(), 300)</script></body></html>`
  const fenetre = window.open('', '_blank')
  if (!fenetre) return notifier('Le navigateur a bloqué la fenêtre d’impression : autorisez les fenêtres de BiRTEC.', 'erreur')
  fenetre.document.write(page)
  fenetre.document.close()
}
