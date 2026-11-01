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
//   menu des motifs : ranger autrement (anneaux, hiérarchie, galaxies…), pour voir seulement : la disposition
//   enregistrée n'est jamais touchée ; « Ma disposition » ramène chaque bulle à sa place
//   étincelle : rejouer l'allumage des étoiles (il se joue aussi à chaque ouverture de l'écran)
// La disposition (positions, bulles figées) est gardée dans le fichier .ktec.
//
// Tout ce qui est saisi est gardé dans le fichier .ktec (dictionnaire) et sert à l'IA.

import { h, vider, ic, notifier, fenetre, nombreFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat, modeAdmin } from '/socle/etat.js'
import { extraireTables } from '../base/vue.js'
import { pdfDepuisJpeg } from '/socle/pdf.js'
import { MOTIFS, disposer } from '../../interface/motifs.js'
import { menuDeroulant } from '../../interface/menu-deroulant.js'
import { TYPES, typeParId, devinerTypes, coutLien } from '../../interface/types.js'

let voirEcartees = false
// Positions des bulles { x, y, fige } : chargées du .ktec, gardées d'une visite à l'autre.
const positions = new Map()
let dispositionChargee = false
const DUREE_ALLUMAGE = 3.4 // secondes
// Les images du motif « Concombre masqué » (chargées au premier usage).
const IMAGE_CONCOMBRE = new URL('../../interface/concombre-masque.webp', import.meta.url).href
const PETIT_CONCOMBRE = new URL('../../interface/concombre-petit.webp', import.meta.url).href
let imageConcombre = null

// Réglages de la simulation (gardés sur ce poste).
const reglages = { attraction: 1, ecartement: 1, figer: true, cles: false, raccourcis: true, sansLiaisons: false }
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
    // L'arrivée complète à la première visite de la session ; ensuite, en raccourci.
    let premiereVisite = true
    try {
      premiereVisite = !sessionStorage.getItem('birtec-constellation-vue')
      sessionStorage.setItem('birtec-constellation-vue', '1')
    } catch {}
    const panneau = h('div', { class: 'carte panneau-schema' })
    const toile = h('canvas', { class: 'toile-schema' })
    const ciel = h('canvas', { class: 'ciel-schema' })
    const pluie = h('div', { class: 'pluie-constellation', 'aria-hidden': 'true' })
    const vue = new VueGraphe(toile, graphe, {
      surSelection: (n) => vider(panneau, panneauTable(n, vue)),
      surChemin: (chemin) => {
        vider(panneau, panneauChemin(chemin, vue, panneau))
        bandeau?.majCompteur()
      },
      surLien: (l) => vider(panneau, panneauLien(l)),
      surMotif: () => { dessinerMotif(); faireTomber(pluie, vue.pluie) },
    })

    // Le menu des motifs.
    const zoneMotif = h('div', { class: 'zone-motif' })
    function dessinerMotif() {
      vider(zoneMotif,
        // Un motif caché n'apparaît dans le menu que pendant qu'il est affiché.
        menuDeroulant({ choix: MOTIFS.filter((m) => !m.cache || m.id === vue.motif).map((m) => ({ valeur: m.id, libelle: m.nom })), valeur: vue.motif || 'libre', surChoix: (id) => vue.appliquerMotif(id) }))
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

    // LA PHRASE, au-dessus de la constellation.
    let bandeau = null
    bandeau = bandeauPhrase(vue)
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
      bandeau.element,
      h('div', { class: 'schema-grille' },
        // Le halo : la nébuleuse, très floutée, déborde autour de l'encart et se perd dans la page.
        h('div', { class: 'halo-ciel', 'aria-hidden': 'true' }),
        h('div', { class: 'carte carte-ciel', style: { padding: '0', overflow: 'hidden', position: 'relative' } },
          // La nébuleuse nette, cadrée comme le halo, qui s'efface vers les bords.
          h('div', { class: 'ciel-net', 'aria-hidden': 'true' }),
          ciel,
          // L'arrivée : le fond (nébuleuse et étoiles) apparaît en fondu, pendant que la vue dézoome.
          h('div', { class: `voile-arrivee${premiereVisite ? '' : ' rapide'}`, 'aria-hidden': 'true' }),
          pluie,
          toile,
          cadreRaccourcis(),
          reglagesSchema(vue, caseEcartees),
        ),
        panneau,
      ),
    )
    vue.demarrer({ rapide: !premiereVisite })
    // Rouvert depuis une vignette (Rapports, Indicateurs GMAO) : le chemin s'allume une fois l'arrivée jouée.
    const rouvert = sessionStorage.getItem('birtec-rouvrir')
    if (rouvert) {
      sessionStorage.removeItem('birtec-rouvrir')
      setTimeout(() => { try { bandeau.restaurer(JSON.parse(rouvert)) } catch {} }, premiereVisite ? 1500 : 500)
    }
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
  // Le type de chaque table (deviné, ou corrigé par l'administrateur) donne sa couleur ; la taille suit ses liens.
  const choisis = Object.fromEntries(schema.tables.filter((t) => t.typeChoisi).map((t) => [t.nom.toLowerCase(), t.typeChoisi]))
  const { types, composees } = devinerTypes(schema.tables, choisis)
  for (const n of noeuds) {
    n.rayon = 4 + Math.sqrt(n.degre) * 2.6
    n.type = typeParId(types.get(n.table.nom.toLowerCase()))
  }
  return { noeuds, liens, parNom, composees }
}

// La clé de liaison d'un lien : « ID_DI », ou « ID_PERE = ID_ARTICLE » quand les deux colonnes diffèrent.
// Plusieurs colonnes entre les deux mêmes tables : séparées par « · ».
function entonnoir(c, x, y, couleur) {
  c.save()
  c.globalAlpha = 1
  c.fillStyle = couleur
  c.beginPath()
  c.moveTo(x - 5, y - 4)
  c.lineTo(x + 5, y - 4)
  c.lineTo(x + 1.2, y + 1)
  c.lineTo(x + 1.2, y + 5)
  c.lineTo(x - 1.2, y + 4)
  c.lineTo(x - 1.2, y + 1)
  c.closePath()
  c.fill()
  c.restore()
}

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

// Chemin le plus court : un lien nommé dans le dictionnaire, une table de liaison qui réunit justement ses deux
// voisines (« artmac » entre « article » et « machine »), ou une table « fille » coûtent moins (mêmes règles que les chemins donnés
// à l'IA, interface/types.js). bannis : des tables à éviter (pour proposer un autre chemin).
function cheminLePlusCourt(graphe, depart, arrivee, bannis = new Set()) {
  const cout = (lien) => coutLien(lien.a.table.nom.toLowerCase(), lien.b.table.nom.toLowerCase(), { nomme: lien.jointures.some((j) => j.libelle), composees: graphe.composees })
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
      if (faits.has(vers) || bannis.has(vers)) continue
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
  return { depart, arrivee, etapes, cout: meilleurs.get(arrivee).cout }
}

// Un autre chemin presque aussi court, qui évite une des tables du milieu (deux tables de liaison possibles entre les mêmes tables) :
// proposé dans le panneau, en un clic.
function autreChemin(graphe, chemin) {
  if (!chemin?.etapes?.length) return null
  for (const e of chemin.etapes.slice(0, -1)) {
    const autre = cheminLePlusCourt(graphe, chemin.depart, chemin.arrivee, new Set([e.vers]))
    if (autre && autre.cout <= chemin.cout * 1.3 + 0.01) return { ...autre, evite: e.vers }
  }
  return null
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
    this.allumage = { debut: 0 } // l'allumage des étoiles, à chaque ouverture de l'écran
    this.motif = null // motif affiché (null : la disposition de l'utilisateur)
    this.utilisateur = null // positions de l'utilisateur, gardées pendant qu'un motif est affiché
    this.transition = null
    this.etiquettes = []
    this.trace = null // dessin en filigrane d'un motif (silhouette)
    this.liensDiscrets = false
    this.image = null // image du motif, en fond, légèrement transparente
    this.fondu = null // instant où l'image a commencé d'apparaître
    this.pluie = false
    this.ecouter()
  }

  demarrer({ rapide = false } = {}) {
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
    // L'arrivée : la vue part de tout près et dézoome jusqu'à tout montrer, pendant que les étoiles s'allument
    // et que les chemins se tracent. En raccourci aux visites suivantes (l'allumage est déjà bien avancé).
    if (this.allumage) {
      if (rapide) this.allumage.debut -= 2000
      this.arrivee = { debut: performance.now(), duree: rapide ? 900 : 3000, k: this.vue.k }
      this.vue = { ...this.vue, k: this.vue.k * (rapide ? 1.6 : 4.5) }
    }
    const boucle = () => {
      if (!this.toile.isConnected) return // écran quitté
      if (this.arrivee) {
        const p = Math.min(1, (performance.now() - this.arrivee.debut) / this.arrivee.duree)
        const e = 1 - Math.pow(1 - p, 3)
        const depart = this.arrivee.depart ??= this.vue.k
        this.vue = { ...this.vue, k: depart + (this.arrivee.k - depart) * e }
        if (p >= 1) this.arrivee = null
        if (!(this.chaleur > 0.004 && !this.motif)) this.dessiner()
      }
      if (this.transition) {
        this.avancerTransition()
        this.dessiner()
      } else if (this.chaleur > 0.004 && !this.motif) {
        this.simuler()
        this.dessiner()
      } else if (this.allumage || this.fondu) {
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
      this.image = null
      this.pluie = false
    } else {
      if (!this.utilisateur) this.utilisateur = new Map(this.graphe.noeuds.map((n) => [n, { x: n.x, y: n.y, fige: n.fige }]))
      const r = disposer(id, this.graphe, { source: this.source })
      cibles = r.positions
      this.etiquettes = r.etiquettes
      this.trace = r.trace || null
      this.liensDiscrets = Boolean(r.liensDiscrets)
      this.image = r.image || null
      this.pluie = Boolean(r.pluie)
      if (this.image && !imageConcombre) {
        imageConcombre = new Image()
        imageConcombre.onload = () => { if (this.image && !this.transition) this.fondu = performance.now() }
        imageConcombre.onerror = () => { this.image = null; this.fondu = null }
        imageConcombre.src = IMAGE_CONCOMBRE
      }
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
    if (this.image) this.fondu = performance.now()
    if (this.transition.retour) {
      for (const [n, p] of this.utilisateur) n.fige = p.fige
      this.utilisateur = null
    }
    this.transition = null
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
      if (this.cachee(l.a) || this.cachee(l.b)) continue
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

  // « Masquer les liaisons » : une table de liaison est cachée, sauf si elle est sur le chemin en cours.
  cachee(n) {
    return reglages.sansLiaisons && n.type?.id === 'intermediaire' && !this.surCheminVu?.has(n)
  }

  noeudSous(ex, ey) {
    const p = this.versMonde(ex, ey)
    let meilleur = null
    let distance = Infinity
    for (const n of this.graphe.noeuds) {
      if (this.cachee(n)) continue
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
          if (this.chemin) this.chemin.autre = autreChemin(this.graphe, this.chemin)
          this.rappels.surChemin(this.chemin || { depart: this.source, arrivee: g.noeud, etapes: null })
        } else {
          this.source = g.noeud
          this.chemin = null
          this.lienChoisi = null
          this.rappels.surSelection(g.noeud)
        }
      } else if (this.etoileVerte && Math.hypot(p.x - this.etoileVerte.x, p.y - this.etoileVerte.y) < 9) {
        this.appliquerMotif(this.motif === 'concombre' ? 'libre' : 'concombre')
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

  // Le chemin de LA PHRASE : la première table, puis chaque autre table rattachée par le plus court passage depuis
  // une table déjà prise. Il reste un chemin « construit » : on peut le prolonger ou le raccourcir à la main.
  cheminPour(noms) {
    const noeuds = noms.map((n) => this.graphe.parNom.get(n.toLowerCase())).filter(Boolean)
    if (!noeuds.length) return null
    const prises = [noeuds[0]]
    const etapes = []
    for (const n of noeuds.slice(1)) {
      if (prises.includes(n)) continue
      let morceau = null
      for (const depart of prises) {
        const essai = cheminLePlusCourt(this.graphe, depart, n)
        if (essai && (!morceau || essai.cout < morceau.cout)) morceau = essai
      }
      if (!morceau) continue
      for (const e of morceau.etapes) if (!prises.includes(e.vers)) { etapes.push(e); prises.push(e.vers) }
    }
    this.source = noeuds[0]
    this.chemin = { depart: noeuds[0], arrivee: etapes.at(-1)?.vers || noeuds[0], etapes, manuel: true }
    this.rappels.surChemin(this.chemin)
    this.toutVoirChemin()
    this.dessiner()
    return this.chemin
  }

  // Cadre la vue sur les tables du chemin.
  toutVoirChemin() {
    if (!this.chemin) return
    const points = [this.chemin.depart, ...this.chemin.etapes.map((e) => e.vers)]
    if (points.length > 1) this.vue = this.cadrage(points)
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
        // pour ne pas repasser par des tables déjà prises (aller-retour a → b → a…).
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
    this.surCheminVu = surChemin
    const focus = this.survol
    // Les voisines du chemin : les tables qu'on peut lui ajouter, gardées nettes et nommées.
    const voisinesChemin = new Set()
    for (const n of surChemin) for (const v of n.voisins) if (!surChemin.has(v)) voisinesChemin.add(v)
    const attenue = (n) => (focus ? n !== focus && !focus.voisins.has(n) : surChemin.size > 0 && !surChemin.has(n) && !voisinesChemin.has(n))

    // Image du motif, légèrement transparente, qui apparaît en fondu une fois les bulles en place.
    if (this.image && !this.transition && imageConcombre?.complete) {
      const fondu = this.fondu ? Math.min(1, (performance.now() - this.fondu) / 700) : 1
      if (fondu >= 1) this.fondu = null
      const a = this.versEcran(this.image.x, this.image.y)
      c.globalAlpha = 0.3 * fondu
      c.drawImage(imageConcombre, a.x, a.y, this.image.largeur * k, this.image.hauteur * k)
      c.globalAlpha = 1
    }

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

    // Liaisons masquées : leurs tables reliées entre elles par un trait pointillé, à la place.
    if (reglages.sansLiaisons && !this.allumage) {
      c.setLineDash([4, 5])
      c.strokeStyle = couleurs.lien
      c.lineWidth = 0.8
      c.globalAlpha = focus || surChemin.size ? 0.15 : 0.45
      for (const n of this.graphe.noeuds) {
        if (!this.cachee(n)) continue
        const bouts = [...n.voisins].filter((v) => !this.cachee(v))
        for (let i = 0; i < bouts.length; i++) for (let j = i + 1; j < bouts.length; j++) {
          const a = this.versEcran(bouts[i].x, bouts[i].y)
          const b = this.versEcran(bouts[j].x, bouts[j].y)
          c.beginPath()
          c.moveTo(a.x, a.y)
          c.lineTo(b.x, b.y)
          c.stroke()
        }
      }
      c.setLineDash([])
      c.globalAlpha = 1
    }

    // Liens
    for (const l of this.graphe.liens) {
      if (this.cachee(l.a) || this.cachee(l.b)) continue
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
      const versVoisine = surChemin.size && ((surChemin.has(l.a) && voisinesChemin.has(l.b)) || (surChemin.has(l.b) && voisinesChemin.has(l.a)))
      c.globalAlpha = (actif ? 1 : versVoisine ? 0.45 : focus || surChemin.size ? 0.18 : l.jointures.some((j) => j.libelle) ? 0.7 : 0.4) * (this.liensDiscrets && !actif ? 0.3 : 1)
      c.lineWidth = surLeChemin ? 3 : actif ? 1.6 : 0.8
      c.beginPath()
      c.moveTo(a.x, a.y)
      c.lineTo(b.x, b.y)
      c.stroke()
    }
    c.globalAlpha = 1

    // Clés de liaison, écrites le long de chaque ligne (dans son axe, jamais à l'envers).
    if (reglages.cles && modeAdmin() && !this.allumage) {
      c.font = `${Math.round(10 + Math.min(3, k))}px ui-monospace, monospace`
      c.textAlign = 'center'
      c.textBaseline = 'bottom'
      for (const l of this.graphe.liens) {
        const pale = focus ? !(l.a === focus || l.b === focus) : surChemin.size > 0 && !liensChemin.has(l)
        if (pale || this.cachee(l.a) || this.cachee(l.b)) continue
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
      if (this.cachee(n)) continue
      const p = this.versEcran(n.x, n.y)
      const rayon = Math.max(2.5, n.rayon * Math.sqrt(k))
      if (p.x < -rayon - 80 || p.y < -rayon - 40 || p.x > r.width + rayon + 80 || p.y > r.height + rayon + 40) continue
      const pale = attenue(n)
      let couleur = n === this.source ? couleurs.accent : surChemin.has(n) ? couleurs.chemin : n.type.ecran
      let eclat = 1
      let rayonVu = rayon
      if (this.allumage) {
        // Un point blanc qui s'allume, puis prend sa couleur.
        eclat = borne((t - n.allumage) / 0.35)
        if (!eclat) continue
        couleur = melange('#ffffff', couleur, borne((t - n.allumage - 0.35) / 0.7))
        rayonVu = rayon * (0.4 + 0.6 * eclat)
      }
      const opacite = (pale ? (surChemin.size && !focus ? 0.5 : 0.3) : n.table.exclue ? 0.4 : 1) * eclat
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
      // Table filtrée par LA PHRASE : un petit entonnoir à côté de la bulle.
      if (this.filtres?.has(n.table.nom) && !pale) entonnoir(c, p.x + rayonVu + 4, p.y - rayonVu - 4, couleurs.chemin)
      // Bulle figée : un petit point sombre au centre (comme une punaise).
      if (n.fige && !pale) {
        c.fillStyle = '#0b1210'
        c.beginPath()
        c.arc(p.x, p.y, Math.max(1.5, rayon * 0.32), 0, Math.PI * 2)
        c.fill()
      }
      // Noms : en zoomant, ou pour les tables importantes, survolées, choisies, sur le chemin.
      const visible = k > 1.1 || n === focus || n === this.source || surChemin.has(n) || voisinesChemin.has(n) || (focus && focus.voisins.has(n)) || (k > 0.45 && grands.has(n))
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

// La pluie de concombres derrière les bulles, tant que le motif « Concombre masqué » est affiché.
function faireTomber(zone, actif) {
  clearInterval(zone.minuterie)
  if (!actif) {
    zone.replaceChildren()
    return
  }
  zone.minuterie = setInterval(() => {
    if (!zone.isConnected) return clearInterval(zone.minuterie)
    if (document.hidden || zone.childElementCount > 40) return
    const c = h('img', { src: PETIT_CONCOMBRE, alt: '' })
    c.style.left = `${Math.random() * 100}%`
    c.style.animationDuration = `${4 + Math.random() * 4}s`
    c.style.setProperty('--chute', `${zone.clientHeight + 120}px`)
    c.style.setProperty('--tour', `${Math.round(Math.random() * 720 - 360)}deg`)
    c.style.setProperty('--taille', `${0.6 + Math.random() * 0.8}`)
    c.addEventListener('animationend', () => c.remove())
    zone.append(c)
  }, 280)
}

// Mélange de deux couleurs « #rrggbb » (f = 0 : la première, 1 : la seconde).
function melange(de, vers, f) {
  if (!/^#[0-9a-f]{6}$/i.test(vers)) return vers
  const canal = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return '#' + [0, 1, 2].map((i) => Math.round(canal(de, i) + (canal(vers, i) - canal(de, i)) * f).toString(16).padStart(2, '0')).join('')
}

// Le ciel derrière la constellation : des étoiles lointaines qui scintillent doucement et glissent un peu
// quand on déplace la vue (parallaxe). Sur une toile à part, pour ne pas redessiner tout le graphe.
// Parmi elles, une seule étoile verte, qui clignote autrement : un clic dessus fait venir le concombre masqué.
function animerCiel(toile, graphe) {
  const etoiles = Array.from({ length: 240 }, () => ({
    x: Math.random(), y: Math.random(),
    r: 0.3 + Math.random() ** 3 * 1.2,
    phase: Math.random() * Math.PI * 2,
    vitesse: 0.3 + Math.random() * 1.1,
    profondeur: 0.015 + Math.random() * 0.05,
  }))
  const verte = { x: 0.2 + Math.random() * 0.6, y: 0.15 + Math.random() * 0.5, profondeur: 0.04 }
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
    // L'étoile verte : deux battements rapprochés, puis une pause.
    const x = (((verte.x * largeur - vx * k * verte.profondeur) % largeur) + largeur) % largeur
    const y = (((verte.y * hauteur - vy * k * verte.profondeur) % hauteur) + hauteur) % hauteur
    const phase = (instant / 1000) % 3.2
    c.globalAlpha = 0.35 + 0.65 * Math.max(Math.exp(-(((phase - 0.3) / 0.12) ** 2)), Math.exp(-(((phase - 0.75) / 0.12) ** 2)))
    c.fillStyle = '#6ee7a8'
    c.beginPath()
    c.arc(x, y, 1.6, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#dce6ff'
    c.globalAlpha = 1
    graphe.etoileVerte = { x, y }
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

// ---------------------------------------------------------------- LA PHRASE (bandeau du haut)

// LA PHRASE en cours : le panneau « Et maintenant ? » s'en sert (texte, conditions, tri).
let phraseCourante = null

// L'utilisateur construit lui-même ce qu'il veut consulter, par des choix cliquables (pas d'IA) : la table, puis
// des conditions (« qui ont », « qui contiennent »…) liées par ET / OU et groupées entre parenthèses, puis l'ordre.
// Le chemin s'allume dans la constellation avec les tables utilisées ; le compteur et l'aperçu suivent chaque
// changement. Le SQL est écrit par le serveur (blocs/phrase/serveur.js).

const OPERATEURS = {
  egal: 'ont', different: 'n’ont pas', contient: 'contiennent', ne_contient: 'ne contiennent pas',
  commence: 'commencent par', finit: 'finissent par', sup: 'ont plus que', inf: 'ont moins que', entre: 'ont entre',
  vide: 'ont vide', non_vide: 'ont rempli',
}
const OPERATEURS_PAR_NATURE = {
  // « ont » sans valeur = le champ est rempli ; « n'ont pas » sans valeur = il est vide.
  texte: ['egal', 'different', 'contient', 'ne_contient', 'commence', 'finit'],
  nombre: ['egal', 'different', 'sup', 'inf', 'entre'],
  date: ['egal', 'different', 'sup', 'inf', 'entre'],
  guide: ['egal', 'different'],
}
const libelleOperateur = (op, nature) => (nature === 'date' && op === 'sup' ? 'ont après' : nature === 'date' && op === 'inf' ? 'ont avant' : OPERATEURS[op])
const SANS_VALEUR = new Set(['vide', 'non_vide'])

// La nature d'une colonne, d'après son type : les dates rangées en AAAAMMJJ (texte de 8) comptent pour des dates.
function natureColonne(c) {
  const type = String(c?.type || '')
  if (/^(int|bigint|smallint|tinyint|mediumint|decimal|numeric|float|double)/i.test(type)) return 'nombre'
  if (/^(date|datetime|timestamp)/i.test(type)) return 'date'
  if (/^(var)?char\(8\)/i.test(type) && /^date|_date|^dt_/i.test(c.nom)) return 'date8'
  return 'texte'
}
const famille = (nature) => (nature === 'date8' ? 'date' : nature)
// Saisie d'une date (AAAA-MM-JJ) → valeur de la base, et inversement.
const versBase = (v, nature) => (nature === 'date8' ? String(v).replace(/-/g, '') : v)
const versSaisie = (v, nature) => (nature === 'date8' && /^\d{8}$/.test(String(v)) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v)
const dateFr = (v) => (/^\d{4}-?\d{2}-?\d{2}$/.test(String(v)) ? String(v).replace(/-/g, '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$3/$2/$1') : v)

let numeroCondition = 0
const nouvelleCondition = (lien = 'et') => ({ id: ++numeroCondition, lien, source: '', op: 'egal', valeurs: [] })

function bandeauPhrase(vue) {
  const zoneDepart = h('div', { class: 'ligne-depart-phrase' })
  const zoneConditions = h('div', { class: 'conditions-phrase' })
  const zoneResultat = h('div', { class: 'resultat-phrase' })
  // { depart, conditions: [condition | { id, lien, groupe: [condition…] }], tri: [{ table, colonne, sens }] }
  let etatPhrase = { depart: null, conditions: [], tri: [] }
  let guidesDispo = { parcs: [], machines: null, fiche: null }
  let origine = null
  let minuterie = null
  let demande = 0
  let tablesDuChemin = ''
  const listesValeurs = new Map()
  let colonnesProposees = {}
  api('/api/phrase/colonnes').then((x) => { colonnesProposees = x || {} }).catch(() => {})

  const noeud = (nom) => vue.graphe.parNom.get(String(nom || '').toLowerCase())
  const libelleTable = (nom) => noeud(nom)?.table.libelle || nom
  const colonneDe = (table, nom) => noeud(table)?.table.colonnes.find((c) => c.nom === nom)
  const libelleColonne = (c) => (c ? (c.libelle ? c.libelle : c.nom) : '')

  // Les tables proposées pour une condition : les voisines de la table, puis les voisines de celles-ci. Les tables
  // de liaison (type intermédiaire) ne sont jamais proposées : on les traverse sans compter de pas, si bien que la
  // machine d'un rapport (rapport → liaison → machine) est une voisine directe.
  const deLiaison = (n) => n.type?.id === 'intermediaire'
  function tablesLiees() {
    const depart = noeud(etatPhrase.depart)
    if (!depart) return []
    const distances = new Map([[depart, 0]])
    const file = [depart]
    while (file.length) {
      const n = file.shift()
      for (const v of n.voisins) {
        const d = distances.get(n) + (deLiaison(v) ? 0 : 1)
        if (d > 2 || (distances.has(v) && distances.get(v) <= d)) continue
        distances.set(v, d)
        if (deLiaison(v)) file.unshift(v)
        else file.push(v)
      }
    }
    return [...distances].filter(([n, d]) => d > 0 && !deLiaison(n)).sort((a, b) => a[1] - b[1] || (a[0].table.libelle || a[0].table.nom).localeCompare(b[0].table.libelle || b[0].table.nom, 'fr')).map(([n, d]) => ({ n, d }))
  }

  // Toutes les conditions, groupes compris (pour le chemin, les étiquettes, le texte).
  const aplatir = (liste) => liste.flatMap((c) => (c.groupe ? aplatir(c.groupe) : [c]))
  const tableDeCondition = (c) => (c.source === 'parc' || c.source === 'machine' ? guidesDispo.machines?.table : c.source === 'fiche' ? guidesDispo.fiche?.table : c.table)
  const complete = (c) => {
    if (!c.source) return false
    if (c.source === 'parc' || c.source === 'machine') return Boolean(c.valeur)
    if (c.source === 'fiche') return Boolean(c.modele)
    // Une table liée seule, sans champ : « ont » = une ligne existe dans cette table, « n'ont pas » = aucune.
    if (!c.colonne) return Boolean(c.table) && c.table !== etatPhrase.depart && ['egal', 'different'].includes(c.op)
    // « ont » / « n'ont pas » sans valeur : le champ est rempli (ou non), par exemple une table liée qui existe.
    return Boolean(c.colonne) && (SANS_VALEUR.has(c.op) || ['egal', 'different'].includes(c.op) || (c.op === 'entre' ? c.valeurs.length === 2 && c.valeurs.every(Boolean) : Boolean(c.valeurs[0])))
  }

  // ---- une couleur par table ajoutée (dans les conditions et dans l'aperçu), dans l'ordre d'arrivée
  const COULEURS_TABLES = ['#3d9bff', '#e879f9', '#2dd4bf', '#f87171', '#a3e635', '#fbbf24', '#818cf8', '#fb923c']
  const couleurTable = (table) => {
    if (!table || table === etatPhrase.depart) return null
    const tables = [...new Set([...aplatir(etatPhrase.conditions).map(tableDeCondition), ...Object.keys(etatPhrase.colonnes || {})].filter((t) => t && t !== etatPhrase.depart))]
    const i = tables.indexOf(table)
    return i < 0 ? null : COULEURS_TABLES[i % COULEURS_TABLES.length]
  }

  // ---- le texte de la phrase (gardé avec le rapport, affiché dans les vignettes)
  function texteCondition(c) {
    const op = OPERATEURS[c.op] || 'ont'
    if (c.source === 'parc') return `qui ${c.op === 'different' ? 'ne sont pas' : 'sont'} dans le parc ${c.valeurTexte || c.valeur}`
    if (c.source === 'machine') return `qui ${c.op === 'different' ? 'ne concernent pas' : 'concernent'} la machine ${c.valeurTexte || c.valeur} (et dessous)`
    if (c.source === 'fiche') return `qui ${op} la fiche technique ${c.modeleTexte}${c.champ ? ` › ${c.champTexte}` : ''}${c.valeurs[0] ? ` = ${c.valeurs[0]}` : ''}`
    if (!c.colonne) return `qui ${c.op === 'different' ? 'n’ont pas de' : 'ont des'} ${libelleTable(c.table)}`
    const col = colonneDe(c.table, c.colonne)
    const nature = natureColonne(col)
    const champ = `${libelleColonne(col)}${c.table !== etatPhrase.depart ? ` (${libelleTable(c.table)})` : ''}`
    const v = (x) => `« ${famille(nature) === 'date' ? dateFr(x) : c.valeurTexte || x} »`
    if (SANS_VALEUR.has(c.op)) return `qui ${op.replace(/^ont /, `ont ${champ} `)}`
    if (['egal', 'different'].includes(c.op) && !c.valeurs[0]) return `qui ${op} ${champ}`
    if (c.op === 'entre') return `qui ont ${champ} entre ${v(c.valeurs[0])} et ${v(c.valeurs[1])}`
    if (['contient', 'ne_contient', 'commence', 'finit'].includes(c.op)) return `qui ${op} ${v(c.valeurs[0])} dans ${champ}`
    return `qui ${libelleOperateur(c.op, famille(nature))} ${champ} ${v(c.valeurs[0])}`
  }
  function texteListe(liste) {
    const morceaux = []
    for (const c of liste) {
      const t = c.groupe ? (() => { const x = texteListe(c.groupe); return x ? `(${x})` : '' })() : complete(c) ? texteCondition(c) : ''
      if (t) morceaux.push(`${morceaux.length ? (c.lien === 'ou' ? ' ou ' : ' et ') : ''}${t}`)
    }
    return morceaux.join('')
  }
  const texte = () => {
    if (!etatPhrase.depart) return ''
    const conditions = texteListe(etatPhrase.conditions)
    const tri = etatPhrase.tri.filter((t) => t.colonne).map((t) => `${libelleColonne(colonneDe(t.table, t.colonne))}${t.sens === 'desc' ? ' (décroissant)' : ''}`)
    return `Les ${libelleTable(etatPhrase.depart)}${conditions ? ` ${conditions}` : ''}${tri.length ? `, triés par ${tri.join(', ')}` : ''}.`
  }

  // ---- ce qui part au serveur : les conditions complètes, dans leurs groupes
  const versSpec = (liste) => liste.map((c) => {
    if (c.groupe) return { lien: c.lien, groupe: versSpec(c.groupe) }
    if (!complete(c)) return null
    if (c.source === 'parc' || c.source === 'machine') return { lien: c.lien, guide: c.source, op: c.op, valeur: c.valeur }
    if (c.source === 'fiche') return { lien: c.lien, guide: 'fiche', op: c.op, type: guidesDispo.fiche?.type, modele: c.modele, champ: c.champ || null, valeurs: c.valeurs.filter(Boolean) }
    return { lien: c.lien, table: c.table, colonne: c.colonne, op: c.op, valeurs: c.valeurs.filter(Boolean) }
  }).filter((c) => c && (!c.groupe || c.groupe.length))
  const conditionsSpec = () => versSpec(etatPhrase.conditions)
  const triSpec = () => etatPhrase.tri.filter((t) => t.colonne).map(({ table, colonne, sens }) => ({ table, colonne, sens }))

  // ---- après chaque changement : le chemin (si les tables ont changé), les étiquettes, le compteur
  function changement() {
    if (!etatPhrase.depart) return
    const tables = [etatPhrase.depart, ...aplatir(etatPhrase.conditions).filter(complete).map(tableDeCondition), ...etatPhrase.tri.filter((t) => t.colonne).map((t) => t.table)].filter(Boolean)
    const cle = [...new Set(tables)].join('|')
    if (cle !== tablesDuChemin) {
      tablesDuChemin = cle
      vue.cheminPour([...new Set(tables)]) // rappelle majCompteur
    } else majCompteur()
    vue.filtres = new Map()
    for (const c of aplatir(etatPhrase.conditions).filter(complete)) {
      const t = tableDeCondition(c)
      vue.filtres.set(t, [...(vue.filtres.get(t) || []), texteCondition(c)])
    }
    vue.dessiner()
  }

  // ---- le dessin
  const choixListe = (options, valeur, surChoix, { vide = null, classe = '' } = {}) => {
    const s = h('select', { class: `pastille-choix ${classe}${valeur ? ' choisie' : ''}` },
      vide !== null ? h('option', { value: '' }, vide) : null,
      options.map((o) => (o.groupe
        ? h('optgroup', { label: o.groupe }, o.options.map((x) => h('option', { value: x.valeur, selected: String(valeur ?? '') === String(x.valeur), title: x.titre || '' }, x.libelle)))
        : h('option', { value: o.valeur, selected: String(valeur ?? '') === String(o.valeur), title: o.titre || '' }, o.libelle))))
    s.addEventListener('change', () => surChoix(s.value, s.selectedOptions[0]?.textContent || ''))
    return s
  }

  function dessinerDepart() {
    const tables = vue.graphe.noeuds.filter((n) => !deLiaison(n)).map((n) => n.table).sort((a, b) => (a.libelle || a.nom).localeCompare(b.libelle || b.nom, 'fr'))
    const principales = vue.graphe.noeuds.filter((n) => n.type?.id === 'principale').map((n) => n.table.nom)
    const option = (t) => ({ valeur: t.nom, libelle: t.libelle ? `${t.libelle} (${t.nom})` : t.nom })
    const options = principales.length
      ? [{ groupe: 'Principales', options: tables.filter((t) => principales.includes(t.nom)).map(option) }, { groupe: 'Toutes les tables', options: tables.filter((t) => !principales.includes(t.nom)).map(option) }]
      : tables.map(option)
    vider(zoneDepart, ic('etincelle', 18), h('span', {}, 'Je souhaite consulter les'),
      choixListe(options, etatPhrase.depart, (v) => choisirDepart(v), { vide: '— choisir —', classe: 'depart' }))
  }

  async function choisirDepart(nom, garder = null) {
    etatPhrase = garder || { depart: nom || null, conditions: [], tri: [], colonnes: {} }
    etatPhrase.colonnes ||= {}
    tablesDuChemin = ''
    guidesDispo = { parcs: [], machines: null, fiche: null }
    if (etatPhrase.depart) guidesDispo = await api(`/api/phrase/guides?depart=${encodeURIComponent(etatPhrase.depart)}`).catch(() => guidesDispo)
    phraseCourante = { texte, conditions: conditionsSpec, tri: triSpec, sauvegarde: () => JSON.parse(JSON.stringify({ conditions: etatPhrase.conditions, tri: triSpec(), colonnes: etatPhrase.colonnes })), origine }
    dessinerDepart()
    dessiner()
    if (etatPhrase.depart) changement()
    else vider(zoneResultat)
  }

  function dessiner() {
    if (!etatPhrase.depart) return vider(zoneConditions)
    vider(zoneConditions, listeConditions(etatPhrase.conditions, true))
  }

  // Une liste de conditions (la phrase entière, ou l'intérieur d'un groupe), avec ses boutons d'ajout.
  function listeConditions(liste, racine) {
    const lignes = liste.map((c, i) => {
      const lien = i === 0 ? null : h('button', { class: `pastille-lien ${c.lien}`, title: 'Changer ET / OU', onclick: () => { c.lien = c.lien === 'ou' ? 'et' : 'ou'; dessiner(); changement() } }, c.lien === 'ou' ? 'OU' : 'ET')
      const retirer = h('button', { class: 'discret icone-seule petit', title: c.groupe ? 'Retirer le groupe' : 'Retirer la condition', onclick: () => { liste.splice(liste.indexOf(c), 1); dessiner(); changement() } }, ic('x', 13))
      if (c.groupe) return h('div', { class: 'ligne-condition' }, lien, h('div', { class: 'groupe-condition' }, h('span', { class: 'parenthese' }, '('), listeConditions(c.groupe, false), h('span', { class: 'parenthese' }, ')')), retirer)
      return h('div', { class: 'ligne-condition' }, lien, editeurCondition(c), retirer)
    })
    // Une nouvelle condition cherche d'abord dans la table consultée.
    const neuve = () => ({ ...nouvelleCondition(), source: `table:${etatPhrase.depart}`, table: etatPhrase.depart })
    const ajouter = (quoi) => { liste.push(quoi === 'groupe' ? { id: ++numeroCondition, lien: 'et', groupe: [neuve()] } : neuve()); dessiner() }
    return h('div', { class: `liste-conditions${racine ? '' : ' interieur'}` }, lignes,
      h('div', { class: 'ajouts-condition' },
        h('button', { class: 'pastille-ajout', onclick: () => ajouter('condition') }, ic('plus', 13), liste.length ? 'et qui…' : 'qui…'),
        racine ? h('button', { class: 'pastille-ajout', title: 'Un groupe entre parenthèses : ses conditions sont lues ensemble', onclick: () => ajouter('groupe') }, ic('plus', 13), '( groupe )') : null))
  }

  // Les tables où chercher : celle qu'on consulte, les choix guidés, puis les tables liées (et un peu plus loin).
  function sourcesCondition() {
    const liees = tablesLiees()
    const option = (n) => ({ valeur: n.table.nom, libelle: n.table.libelle ? `${n.table.libelle} (${n.table.nom})` : n.table.nom })
    const guides = [
      guidesDispo.parcs.length ? { valeur: 'parc', libelle: 'le parc (AITEC)' } : null,
      guidesDispo.machines ? { valeur: 'machine', libelle: 'la machine (et dessous)' } : null,
      guidesDispo.fiche ? { valeur: 'fiche', libelle: 'la fiche technique' } : null,
    ].filter(Boolean)
    return [
      { groupe: 'La table consultée', options: [option(noeud(etatPhrase.depart))] },
      guides.length ? { groupe: 'Choix guidés', options: guides } : null,
      { groupe: 'Tables liées', options: liees.filter(({ d }) => d === 1).map(({ n }) => option(n)) },
      { groupe: 'Un peu plus loin', options: liees.filter(({ d }) => d === 2).map(({ n }) => option(n)) },
    ].filter((g) => g && g.options.length)
  }
  // Les colonnes proposées d'une table (le choix de l'administrateur, sinon toutes) ; garder : celle déjà choisie.
  const colonnesDe = (table, garder = null) => {
    const liste = colonnesProposees[noeud(table)?.table.nom]
    return (noeud(table)?.table.colonnes || []).filter((x) => !liste?.length || liste.includes(x.nom) || x.nom === garder).map((x) => ({ valeur: x.nom, libelle: libelleColonne(x), titre: x.nom }))
  }

  // Administrateur : cocher les colonnes de la table que LA PHRASE propose (les autres sont cachées aux utilisateurs).
  async function choisirColonnes(table) {
    const t = noeud(table).table
    const liste = colonnesProposees[t.nom]
    const cases = t.colonnes.map((x) => ({ x, c: h('input', { type: 'checkbox', checked: !liste?.length || liste.includes(x.nom) }) }))
    const technique = (x) => /^id_|_id$/i.test(x.nom) || /^(date_(cre|mod|export|import|inactif)|num_(export|import)|export|import|id_user)$/i.test(x.nom)
    const cocher = (f) => cases.forEach(({ x, c }) => { c.checked = f(x) })
    const contenu = h('div', { class: 'choix-colonnes' },
      h('p', { class: 'texte-2', style: { marginTop: 0 } }, `Les colonnes de ${t.libelle || t.nom} proposées dans LA PHRASE. Les autres restent utilisables par le SQL, mais ne sont plus proposées.`),
      h('div', { class: 'actions' },
        h('button', { class: 'petit discret', onclick: () => cocher(() => true) }, 'Toutes'),
        h('button', { class: 'petit discret', onclick: () => cocher(() => false) }, 'Aucune'),
        h('button', { class: 'petit discret', title: 'Décoche les identifiants (ID_…) et les colonnes techniques (dates de création, exports…)', onclick: () => cocher((x) => !technique(x)) }, 'Sans les techniques')),
      h('div', { class: 'liste-colonnes' }, cases.map(({ x, c }) => h('label', { class: 'case-colonne' }, c, h('span', {}, libelleColonne(x)), x.libelle ? h('span', { class: 'discret' }, x.nom) : null))))
    const choix = await fenetre({ titre: 'Colonnes proposées', contenu, boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: () => {
        const cochees = cases.filter(({ c }) => c.checked).map(({ x }) => x.nom)
        return cochees.length === t.colonnes.length ? [] : cochees
      } },
    ] })
    if (!choix) return
    colonnesProposees = await api('/api/phrase/colonnes', { methode: 'POST', corps: { table: t.nom, colonnes: choix.length ? choix : null } })
    notifier(choix.length ? `${choix.length} colonne(s) proposée(s) pour ${t.libelle || t.nom}` : `Toutes les colonnes de ${t.libelle || t.nom} sont proposées`)
    dessiner()
    majCompteur()
  }

  // La bulle d'un champ : son nom dans la base et trois valeurs d'exemple (lues une fois par table).
  const exemplesParTable = new Map()
  async function bulleExemple(table, colonne) {
    if (!exemplesParTable.has(table)) exemplesParTable.set(table, api(`/api/phrase/exemples?table=${encodeURIComponent(table)}`).catch(() => ({})))
    const exemples = (await exemplesParTable.get(table))[colonne] || []
    const col = colonneDe(table, colonne)
    return h('div', {}, h('b', {}, `${libelleColonne(col)}${col?.libelle ? ` · ${colonne}` : ''}`),
      exemples.length ? exemples.map((v) => h('code', {}, v)) : h('span', { class: 'discret' }, 'Toujours vide dans les dernières lignes'))
  }

  // Une condition : « qui » [opérateur] [table] [champ] [valeur].
  function editeurCondition(c) {
    const col = c.table ? colonneDe(c.table, c.colonne) : null
    const nature = c.source && !c.source.startsWith('table:') ? 'guide' : famille(natureColonne(col))
    const ops = OPERATEURS_PAR_NATURE[nature] || OPERATEURS_PAR_NATURE.texte
    if (c.op === 'vide' || c.op === 'non_vide') Object.assign(c, { op: c.op === 'vide' ? 'different' : 'egal', valeurs: [] })
    if (!ops.includes(c.op)) c.op = 'egal'
    const op = choixListe(ops.map((o) => ({ valeur: o, libelle: c.source === 'parc' ? (o === 'egal' ? 'sont dans' : 'ne sont pas dans') : c.source === 'machine' ? (o === 'egal' ? 'concernent' : 'ne concernent pas') : libelleOperateur(o, nature) })), c.op,
      (v) => { c.op = v; if (SANS_VALEUR.has(v)) c.valeurs = []; dessiner(); changement() }, { classe: 'operateur' })

    // D'abord où chercher (la table, une table liée, ou un choix guidé), puis la colonne de cette table.
    const table = choixListe(sourcesCondition(), c.source && !c.source.startsWith('table:') ? c.source : c.table || '', (v) => {
      Object.assign(c, { valeurs: [], valeur: null, valeurTexte: null, modele: null, champ: null, colonne: null })
      if (['parc', 'machine', 'fiche'].includes(v)) Object.assign(c, { source: v, table: null })
      else Object.assign(c, { source: v ? `table:${v}` : '', table: v || null })
      dessiner()
      changement()
    }, { vide: '— dans quelle table ? —', classe: 'champ' })
    const teinte = couleurTable(c.table)
    if (teinte) { table.style.setProperty('--teinte', teinte); table.classList.add('teintee') }
    // Le champ : un menu à bulle, qui montre quelques valeurs d'exemple de la colonne survolée.
    const champ = c.table ? menuDeroulant({
      choix: [{ valeur: '', libelle: c.table === etatPhrase.depart ? '— quel champ ? —' : '— la table seule —' }, ...colonnesDe(c.table, c.colonne).map((x) => ({ valeur: x.valeur, libelle: x.libelle }))],
      valeur: c.colonne || '',
      classe: `champ-phrase${c.colonne ? ' choisi' : ''}`,
      bulle: (v) => bulleExemple(c.table, v),
      surChoix: (v) => {
        Object.assign(c, { colonne: v || null, valeurs: [], valeurTexte: null })
        dessiner()
        changement()
      },
    }) : null
    const reglerColonnes = c.table && modeAdmin() ? h('button', { class: 'discret icone-seule petit', title: 'Choisir les colonnes proposées pour cette table (administrateur)', onclick: () => choisirColonnes(c.table) }, ic('reglages', 14)) : null
    return h('div', { class: 'condition' }, h('span', { class: 'mot-phrase' }, 'qui'), op, table, champ, reglerColonnes, editeurValeur(c, col))
  }

  function editeurValeur(c, col) {
    if (c.source === 'parc') return choixListe(guidesDispo.parcs, c.valeur, (v, t) => { c.valeur = v || null; c.valeurTexte = t; dessiner(); changement() }, { vide: '— quel parc ? —' })
    if (c.source === 'machine') return editeurMachine(c)
    if (c.source === 'fiche') return editeurFiche(c)
    if (!c.colonne || SANS_VALEUR.has(c.op)) return null
    const nature = natureColonne(col)
    const saisie = (i) => {
      const date = famille(nature) === 'date'
      const champ = h('input', { type: date ? 'date' : nature === 'nombre' ? 'number' : 'text', class: 'pastille-choix libre', value: date ? versSaisie(c.valeurs[i] || '', nature) : c.valeurs[i] || '', placeholder: ['egal', 'different'].includes(c.op) ? 'valeur (vide : toutes)…' : 'valeur…' })
      if (!date && ['egal', 'different'].includes(c.op)) {
        // Les valeurs de la base, proposées en tapant (avec leur désignation quand la colonne est un code).
        const id = `valeurs-${c.id}`
        champ.setAttribute('list', id)
        const liste = h('datalist', { id })
        const cle = `${c.table}.${c.colonne}`
        const remplir = (vals) => vider(liste, vals.map((x) => h('option', { value: x.valeur }, x.libelle !== x.valeur ? x.libelle : '')))
        if (listesValeurs.has(cle)) remplir(listesValeurs.get(cle))
        else champ.addEventListener('focus', async () => {
          const vals = await api(`/api/phrase/valeurs?table=${encodeURIComponent(c.table)}&colonne=${encodeURIComponent(c.colonne)}`).catch(() => [])
          listesValeurs.set(cle, vals)
          remplir(vals)
        }, { once: true })
        champ.addEventListener('input', () => {
          const trouve = (listesValeurs.get(cle) || []).find((x) => x.valeur === champ.value)
          c.valeurTexte = trouve && trouve.libelle !== trouve.valeur ? trouve.libelle : null
        })
        champ._liste = liste
      }
      champ.addEventListener('input', () => {
        c.valeurs[i] = champ.value ? (date ? versBase(champ.value, nature) : champ.value) : ''
        champ.classList.toggle('choisie', Boolean(champ.value))
        clearTimeout(champ._minuterie)
        champ._minuterie = setTimeout(changement, 400)
      })
      if (champ.value) champ.classList.add('choisie')
      return [champ, champ._liste || null]
    }
    if (c.op === 'entre') return h('span', { class: 'valeurs-entre' }, saisie(0), h('span', { class: 'mot-phrase' }, 'et'), saisie(1))
    return h('span', {}, saisie(0))
  }

  function editeurMachine(c) {
    const recherche = h('input', { type: 'search', class: 'pastille-choix libre', placeholder: 'repère, nom…', value: c.recherche || '' })
    const liste = h('select', { class: `pastille-choix${c.valeur ? ' choisie' : ''}` }, h('option', { value: '' }, '— quelle machine ? —'))
    const chemin = h('div', { class: 'chemin-machine discret' }, c.chemin || '')
    const parc = aplatir(etatPhrase.conditions).find((x) => x.source === 'parc' && x.op === 'egal' && x.valeur)?.valeur || ''
    const charger = async () => {
      const machines = await api(`/api/phrase/machines?parc=${encodeURIComponent(parc)}&q=${encodeURIComponent(recherche.value)}`).catch(() => [])
      vider(liste, h('option', { value: '' }, '— quelle machine ? —'), machines.slice(0, 200).map((m) => h('option', { value: m.code, selected: c.valeur === m.code, title: m.chemin }, m.libelle)))
    }
    let minuterieRecherche = null
    recherche.addEventListener('input', () => { c.recherche = recherche.value; clearTimeout(minuterieRecherche); minuterieRecherche = setTimeout(charger, 300) })
    liste.addEventListener('change', () => {
      const o = liste.selectedOptions[0]
      Object.assign(c, { valeur: liste.value || null, valeurTexte: liste.value ? o.textContent : null, chemin: liste.value ? o.title : '' })
      liste.classList.toggle('choisie', Boolean(liste.value))
      chemin.textContent = c.chemin
      changement()
    })
    charger()
    return h('div', { class: 'choix-machine' }, recherche, liste, chemin)
  }

  function editeurFiche(c) {
    const f = guidesDispo.fiche
    const zone = h('span', { class: 'choix-fiche' })
    const remplir = async () => {
      const modeles = await api(`/api/phrase/fiche/modeles?type=${encodeURIComponent(f.type)}`).catch(() => [])
      const morceaux = [choixListe(modeles, c.modele, (v, t) => { Object.assign(c, { modele: v || null, modeleTexte: t.split(' — ')[0], champ: null, valeurs: [] }); dessiner(); changement() }, { vide: modeles.length ? '— quelle fiche ? —' : '— aucune fiche remplie —' })]
      if (c.modele) {
        const champs = await api(`/api/phrase/fiche/champs?type=${encodeURIComponent(f.type)}&modele=${encodeURIComponent(c.modele)}`).catch(() => [])
        morceaux.push(choixListe(champs, c.champ, (v, t) => { Object.assign(c, { champ: v || null, champTexte: t, valeurs: [] }); dessiner(); changement() }, { vide: '— tout champ —' }))
        if (c.champ) {
          const vals = await api(`/api/phrase/fiche/valeurs?type=${encodeURIComponent(f.type)}&modele=${encodeURIComponent(c.modele)}&champ=${encodeURIComponent(c.champ)}`).catch(() => [])
          morceaux.push(choixListe(vals.map((x) => ({ ...x, libelle: `${x.libelle} (${nombreFr(x.nombre)})` })), c.valeurs[0], (v) => { c.valeurs = v ? [v] : []; dessiner(); changement() }, { vide: '— toute valeur —' }))
        }
      }
      vider(zone, morceaux)
    }
    remplir()
    return zone
  }

  // Le tri se fait dans l'aperçu : un clic sur une colonne trie (croissant, puis décroissant, puis plus de tri) ;
  // Maj + clic ajoute un tri secondaire. C'est ce tri qui fait l'ORDER BY de la requête.
  function trierPar(table, colonne, ajouter) {
    const existant = etatPhrase.tri.find((t) => t.table === table && t.colonne === colonne)
    if (!ajouter) etatPhrase.tri = existant ? [existant] : []
    if (!existant) etatPhrase.tri.push({ table, colonne, sens: 'asc' })
    else if (existant.sens === 'asc') existant.sens = 'desc'
    else etatPhrase.tri = etatPhrase.tri.filter((t) => t !== existant)
    changement()
  }
  // Une colonne de l'aperçu. Celles des autres tables portent la couleur de leur table ; celles des conditions de
  // la table consultée sont teintées en orange. La première colonne de chaque table porte la pastille « + » qui
  // ajoute une colonne de cette table ; une colonne ajoutée se retire par sa croix.
  const styleColonne = (c) => {
    const teinte = couleurTable(c.table)
    return teinte ? { '--teinte': teinte } : {}
  }
  const classeColonne = (c) => (couleurTable(c.table) ? ' colonne-table' : c.condition ? ' colonne-condition' : '')
  const celluleApercu = (c, v) => h('td', { class: classeColonne(c).trim(), style: styleColonne(c), title: v === null ? '' : String(v) }, v === null ? '' : String(v))
  const enteteTri = (c, i, toutes) => {
    const { table, colonne, ajoutee } = c
    const k = etatPhrase.tri.findIndex((t) => t.table === table && t.colonne === colonne)
    const t = etatPhrase.tri[k]
    const premiere = toutes.findIndex((x) => x.table === table) === i
    const plus = premiere ? ajoutColonne(table, toutes) : null
    const retirer = ajoutee ? h('button', { class: 'retirer-colonne', title: 'Retirer cette colonne de l’aperçu', onclick: (e) => {
      e.stopPropagation()
      etatPhrase.colonnes[table] = (etatPhrase.colonnes[table] || []).filter((x) => x !== colonne)
      if (!etatPhrase.colonnes[table].length) delete etatPhrase.colonnes[table]
      majCompteur()
    } }, '×') : null
    return h('th', { class: `triable${t ? ' trie' : ''}${classeColonne(c)}`, style: styleColonne(c), title: 'Cliquer pour trier (Maj + clic : tri secondaire)', onclick: (e) => { if (!e.target.closest('.menu-theme, .retirer-colonne')) trierPar(table, colonne, e.shiftKey) } },
      h('span', { class: 'entete-apercu' }, colonne, table !== etatPhrase.depart ? h('span', { class: 'table-colonne' }, ` (${table})`) : null,
        t ? h('span', { class: 'sens-tri' }, `${t.sens === 'desc' ? '↓' : '↑'}${etatPhrase.tri.length > 1 ? k + 1 : ''}`) : null, retirer, plus))
  }
  // La pastille « + » : les colonnes (proposées) de la table pas encore affichées, avec leur bulle d'exemples.
  function ajoutColonne(table, toutes) {
    const deja = new Set(toutes.filter((x) => x.table === table).map((x) => x.colonne))
    const choix = colonnesDe(table).filter((x) => !deja.has(x.valeur))
    if (!choix.length) return null
    return menuDeroulant({
      choix: [{ valeur: '', libelle: `Ajouter une colonne de ${libelleTable(table)}` }, ...choix.map((x) => ({ valeur: x.valeur, libelle: x.libelle }))],
      valeur: '',
      classe: 'ajout-colonne',
      flottant: true,
      bulle: (v) => bulleExemple(table, v),
      surChoix: (v) => {
        if (!v) return
        etatPhrase.colonnes[table] = [...(etatPhrase.colonnes[table] || []), v]
        majCompteur()
      },
    })
  }

  // Le compteur et l'aperçu : relus un instant après le dernier changement (choix ou chemin).
  function majCompteur() {
    clearTimeout(minuterie)
    if (!etatPhrase.depart || !vue.chemin?.etapes) return
    minuterie = setTimeout(async () => {
      const numero = ++demande
      vider(zoneResultat, h('span', { class: 'discret curseur' }, 'Comptage dans la base'))
      try {
        const ajoutees = Object.entries(etatPhrase.colonnes).flatMap(([table, cols]) => cols.map((colonne) => ({ table, colonne })))
        const r = await api('/api/phrase/compter', { methode: 'POST', corps: { ...specDuChemin(vue.chemin, conditionsSpec(), triSpec()), apercu: { colonnes: ajoutees } } })
        if (numero !== demande) return
        vider(zoneResultat,
          h('div', { class: 'compteur-phrase' }, h('b', {}, nombreFr(r.nombre)), ` ${libelleTable(vue.chemin.depart.table.nom)} correspondent`),
          r.apercu?.lignes.length ? h('div', { class: 'tableau-conteneur apercu-phrase' }, h('table', { class: 'tableau compact' },
            h('thead', {}, h('tr', {}, r.apercu.colonnes.map((c, i) => enteteTri(c, i, r.apercu.colonnes)))),
            h('tbody', {}, r.apercu.lignes.map((l) => h('tr', {}, l.map((v, i) => celluleApercu(r.apercu.colonnes[i], v))))))) : null,
          r.sql ? h('details', { class: 'sql-phrase' }, h('summary', {}, 'Voir le SQL pour BIRT'), h('pre', { class: 'code' }, h('code', {}, r.sql))) : null)
      } catch (e) {
        if (numero === demande) vider(zoneResultat, h('span', { class: 'rouge' }, e.message))
      }
    }, 350)
  }

  // Un rapport ou un indicateur rouvert depuis sa vignette : sa table, ses conditions et son tri reviennent. Les
  // anciennes constellations (filtres : une valeur par colonne) deviennent des conditions « ont ».
  function restaurer(c) {
    origine = c.origine || null
    const depart = c.depart || c.tables?.[0]
    const conditions = Array.isArray(c.conditions) ? reprendre(c.conditions) : (c.filtres || []).map((f) => (f.guide
      ? { ...nouvelleCondition(), source: f.guide, valeur: f.valeur, valeurTexte: String(f.texte || '').split(' : ').slice(1).join(' : ') || f.valeur, modele: f.modele, modeleTexte: f.modele, champ: f.champ, champTexte: f.champ, valeurs: f.valeurs || [] }
      : { ...nouvelleCondition(), source: `table:${f.table}`, table: f.table, colonne: f.colonne, valeurs: [String(f.valeurs?.[0] ?? '')] }))
    choisirDepart(depart, { depart, conditions, tri: (c.tri || []).map((t) => ({ ...t })), colonnes: { ...(c.colonnes || {}) } }).then(() => {
      // Les tables du chemin d'origine (y compris celles sans condition) sont rallumées.
      if (c.tables?.length) { tablesDuChemin = ''; vue.cheminPour(c.tables) }
    })
  }
  // Les conditions enregistrées → l'état de l'éditeur (identifiants neufs).
  const reprendre = (liste) => liste.map((x) => (x.groupe ? { ...x, id: ++numeroCondition, groupe: reprendre(x.groupe) } : { ...nouvelleCondition(x.lien), ...x, id: ++numeroCondition, valeurs: x.valeurs || [] }))

  dessinerDepart()
  const element = h('div', { class: 'carte bandeau-phrase' }, zoneDepart, zoneConditions, zoneResultat)
  return { element, majCompteur, restaurer }
}

// La description d'un chemin (et de ses conditions, de son tri) envoyée au serveur, qui en construit lui-même le SQL.
function specDuChemin(chemin, conditions = [], tri = []) {
  const { ordre } = sqlDuChemin(chemin)
  return {
    depart: chemin.depart.table.nom,
    jointures: ordre.map(({ table, j }) => ({ table, de: j.de, colonne: j.colonne, vers: j.vers, versColonne: j.versColonne })),
    conditions,
    tri,
  }
}

// « Et maintenant ? » : une fois le chemin (et la phrase) validés, passer au rapport, au SQL ou à l'indicateur.
// Réservé à l'administrateur : créer demande d'écrire du SQL.
function etMaintenant(chemin, distinctes) {
  if (!modeAdmin()) return null
  // Lu au moment du clic : les conditions ont pu changer depuis que ce panneau a été dessiné.
  const actuel = () => {
    const phrase = phraseCourante?.texte() || ''
    const constellation = { phrase, depart: chemin.depart.table.nom, tables: distinctes, ...(phraseCourante?.sauvegarde() || {}) }
    return { phrase, constellation, conditions: phraseCourante?.conditions() || [], tri: phraseCourante?.tri() || [] }
  }
  const libelle = chemin.depart.table.libelle || chemin.depart.table.nom
  const origine = phraseCourante?.origine || null
  return h('div', { class: 'et-maintenant' },
    h('h3', {}, ic('etincelle', 15), 'Et maintenant ?'),
    h('div', { class: 'actions' },
      h('button', { class: 'petit principal', title: 'Le formulaire du rapport, déjà rempli d’après la phrase et le chemin', onclick: () => {
        const { phrase, constellation } = actuel()
        sessionStorage.setItem('birtec-constellation', JSON.stringify(constellation))
        sessionStorage.setItem('birtec-phrase', phrase || `Liste des ${libelle}`)
        location.hash = '#/constructeur/rapport'
      } }, ic('document', 14), 'Créer un rapport'),
      h('button', { class: 'petit', title: 'Ranger cette requête dans les requêtes du site (fichier .ktec)', onclick: () => { const { phrase, conditions, tri } = actuel(); enregistrerSql(chemin, conditions, tri, phrase || libelle) } }, ic('base', 14), 'Enregistrer le SQL'),
      origine ? h('button', { class: 'petit principal', title: 'Rouvrir le formulaire de ce qui a été rouvert, avec le chemin et les conditions d’aujourd’hui', onclick: () => mettreAJour(origine, actuel().constellation) }, ic('crayon', 14), `Mettre à jour « ${String(origine.titre || '').slice(0, 40)} »`) : null,
      h('button', { class: 'petit', title: 'Un indicateur de la GMAO sur cette table', onclick: () => {
        const { phrase, constellation } = actuel()
        sessionStorage.setItem('birtec-indicateur', JSON.stringify({ etat: { sujet: chemin.depart.table.nom }, nom: phrase ? phrase.slice(0, 80) : '', constellation }))
        location.hash = '#/indicateur'
      } }, ic('graphique', 14), 'Indicateur GMAO')))
}

// « Mettre à jour » un rapport ou un indicateur rouvert : son formulaire, avec le chemin et les filtres actuels.
async function mettreAJour(origine, constellation) {
  const nouvelle = { ...constellation, phrase: constellation.phrase || origine.titre || '' }
  if (origine.type === 'rapport') {
    const r = await api(`/api/rapports/${encodeURIComponent(origine.nom)}`)
    if (!r.description?.constructeur) return notifier('Ce rapport n’a pas été fait avec le formulaire : créez-en un nouveau (« Créer un rapport »).', 'erreur')
    sessionStorage.setItem('birtec-rapport', JSON.stringify({ rapport: { ...r.description.constructeur, constellation: nouvelle }, nom: origine.nom }))
    location.hash = '#/constructeur/rapport'
  } else {
    const i = (await api('/api/indicateurs/indicateurs')).find((x) => String(x.id) === String(origine.id))
    if (!i) return notifier('Indicateur introuvable.', 'erreur')
    sessionStorage.setItem('birtec-indicateur', JSON.stringify({ etat: i.definition?.constructeur || { sujet: constellation.depart }, nom: i.nom, dateIndicateur: i.definition?.dateIndicateur, arborescence: i.definition?.arborescence, id: i.id, constellation: nouvelle }))
    location.hash = '#/indicateur'
  }
}

async function enregistrerSql(chemin, conditions, tri, titre) {
  const champ = h('input', { type: 'text', value: titre.slice(0, 80) })
  const fait = await fenetre({
    titre: 'Enregistrer le SQL',
    contenu: h('div', {}, h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'La requête (jointures dans l’ordre et filtres choisis) est rangée dans les requêtes du site, réutilisables dans BIRT.'), h('label', { class: 'champ' }, h('span', {}, 'Nom'), champ)),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: () => api('/api/phrase/enregistrer', { methode: 'POST', corps: { titre: champ.value, description: phraseCourante?.texte() || '', spec: specDuChemin(chemin, conditions, tri) } }) },
    ],
  })
  if (fait) notifier('Requête enregistrée dans les requêtes du site')
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
    ['Clic sur un lien', modeAdmin() ? 'le nommer, le décrire' : 'voir ce qu’il relie'],
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
    !modeAdmin() ? null : h('label', { class: 'case-schema', title: 'Écrire la clé de liaison le long de chaque ligne (zoomez si une ligne est trop courte)' },
      h('input', { type: 'checkbox', checked: reglages.cles, onchange: (e) => { reglages.cles = e.target.checked; garderReglages(); vue.dessiner() } }), 'Clés de liaison'),
    h('label', { class: 'case-schema', title: 'Cache les tables de liaison (type intermédiaire) : les tables qu’elles relient sont jointes par un pointillé. Une liaison sur le chemin reste visible.' },
      h('input', { type: 'checkbox', checked: reglages.sansLiaisons, onchange: (e) => { reglages.sansLiaisons = e.target.checked; garderReglages(); vue.dessiner() } }), 'Masquer les liaisons'),
    h('button', { class: 'petit discret', title: 'Toutes les bulles reprennent leur place dans la simulation', onclick: () => vue.libererTout() }, 'Tout libérer'),
    modeAdmin() ? h('label', { class: 'case-schema', title: 'Montrer aussi, en grisé, les tables écartées de l’IA' }, caseEcartees, 'Tables écartées') : null,
  )
}

// ---------------------------------------------------------------- panneau de droite

function aideSchema(graphe) {
  // Les gestes sont dans le cadre « Raccourcis », sur le ciel : ici, seulement la légende.
  const compte = (id) => graphe.noeuds.filter((n) => n.type.id === id).length
  return [
    h('h2', { style: { marginBottom: '6px' } }, 'Constellation'),
    h('p', { class: 'texte-2', style: { marginTop: 0, fontSize: '14px' } }, 'Cliquez une table pour la décrire, puis Ctrl + clic sur une autre pour le chemin qui les relie, avec ses jointures dans l’ordre.'),
    h('h3', { style: { margin: '14px 0 6px', fontSize: '14px' } }, 'Couleur : le type de la table'),
    h('ul', { class: 'legende-types' }, TYPES.map((v) => h('li', {}, h('span', { class: 'point-type', style: { background: v.ecran } }), h('b', {}, v.nom), h('span', { class: 'discret' }, ` · ${compte(v.id)} — ${v.aide}`)))),
    h('p', { class: 'discret', style: { fontSize: '13px', marginTop: '10px' } }, 'Taille : le nombre de liens. Le type est deviné par BiRTEC ; l’administrateur le corrige dans le panneau d’une table.'),
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
  const voisins = [
    h('p', { class: 'discret', style: { fontSize: '13px' } }, `${t.colonnes.length} colonnes, ${n.degre} table(s) liée(s) :`),
    h('div', { class: 'liste-voisins' }, [...n.voisins].sort((a, b) => a.table.nom.localeCompare(b.table.nom)).map((v) =>
      h('a', { href: '#', class: 'mono', title: v.table.libelle || '', onclick: (e) => { e.preventDefault(); vue.centrerSur(v, true) } }, v.table.nom))),
  ]
  // L'utilisateur : la table, son nom clair et son type, en lecture ; rien à régler (la description est pour l'IA).
  if (!modeAdmin()) {
    return [
      h('div', { class: 'discret', style: { fontSize: '12px' } }, 'Source — Ctrl + clic sur une autre table pour le chemin'),
      h('h2', { style: { margin: '4px 0 2px' } }, t.libelle || t.nom),
      t.libelle ? h('div', { class: 'mono discret', style: { fontSize: '12px' } }, t.nom) : null,
      h('p', { style: { fontSize: '13px', margin: '10px 0 0' } }, h('span', { class: 'point-type', style: { background: n.type.ecran } }), ` ${n.type.nom} — `, h('span', { class: 'discret' }, n.type.aide)),
      voisins,
      h('div', { class: 'actions', style: { marginTop: '10px' } }, h('button', { class: 'petit', onclick: () => extraireTables([t.nom]) }, ic('telecharger', 14), 'Télécharger la table')),
    ]
  }
  return [
    h('div', { class: 'discret', style: { fontSize: '12px' } }, 'Source — Ctrl + clic sur une autre table pour le chemin'),
    h('h2', { class: 'mono', style: { margin: '4px 0 10px' } }, t.nom),
    h('label', { class: 'champ' }, h('span', {}, 'Nom clair'), enregistreur(h('input', { type: 'text', value: t.libelle || '', placeholder: 'ex. Rapport d’intervention' }), dico('libelle'))),
    h('label', { class: 'champ', style: { marginTop: '10px' } }, h('span', {}, 'Description (pour l’IA)'), enregistreur(h('textarea', { rows: 4 }, t.description || ''), dico('description'))),
    h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px' } }, coche, 'Prise en compte par l’IA'),
    choixType(n, vue),
    voisins,
    h('div', { class: 'actions', style: { marginTop: '10px' } },
      h('button', { class: 'petit', onclick: () => extraireTables([t.nom]) }, ic('telecharger', 14), 'Télécharger la table'),
      h('a', { class: 'bouton petit discret', href: `#/base/${encodeURIComponent(t.nom)}` }, ic('table', 14), 'Colonnes')),
    ajoutLien(t),
  ]
}

// Le type de la table (sa couleur) : deviné par BiRTEC, corrigé ici par l'administrateur.
function choixType(n, vue) {
  const choisi = n.table.typeChoisi || ''
  const liste = h('select', {},
    h('option', { value: '', selected: !choisi }, `Deviné : ${n.type.nom}`),
    TYPES.map((v) => h('option', { value: v.id, selected: choisi === v.id }, v.nom)))
  liste.addEventListener('change', async () => {
    await api('/api/schema/type', { methode: 'POST', corps: { table: n.table.nom, type: liste.value } })
    notifier('Type enregistré : la constellation se recharge')
    window.ktec.recharger()
  })
  return h('label', { class: 'champ', style: { marginTop: '10px' } }, h('span', {}, h('span', { class: 'point-type', style: { background: n.type.ecran } }), ' Type de table'), liste)
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
  const { sql, jointures, distinctes, erreur } = sqlDuChemin(chemin)
  const dejaVue = (n, i) => tables.findIndex((t) => t.table.nom === n.table.nom) < i
  return [
    h('h2', { style: { marginBottom: '4px' } }, chemin.manuel ? 'Chemin construit' : 'Chemin le plus court'),
    chemin.manuel ? h('p', { class: 'discret', style: { fontSize: '12px', margin: '0 0 4px' } }, 'Ctrl + Maj + clic sur une table pour prolonger.') : null,
    h('p', { class: 'discret', style: { fontSize: '13px', marginTop: 0 } }, `${jointures.length} jointure(s), ${distinctes.length} tables${distinctes.length < tables.length ? ` (${tables.length - distinctes.length} passage(s) en double, ignoré(s))` : ''}`),
    h('ol', { class: 'chemin-tables' }, tables.map((n, i) => h('li', { style: dejaVue(n, i) ? { opacity: 0.5 } : {} },
      h('span', { class: 'mono' }, n.table.nom),
      dejaVue(n, i) ? h('span', { class: 'discret' }, ' — déjà dans le chemin') : n.table.libelle ? h('span', { class: 'discret' }, ` — ${n.table.libelle}`) : null))),
    // Les clés et le SQL : pour l'administrateur.
    modeAdmin() ? h('h3', { style: { margin: '12px 0 6px' } }, 'Clés') : null,
    !modeAdmin() ? null : h('ul', { class: 'chemin-cles' }, jointures.map((j) => h('li', {}, h('span', { class: 'mono' }, `${j.de}.${j.colonne} = ${j.vers}.${j.versColonne}`), j.libelle ? h('div', { class: 'discret', style: { fontSize: '12px' } }, j.libelle) : null))),
    erreur ? h('div', { class: 'bandeau', style: { marginTop: '8px' } }, ic('alerte'), erreur) : null,
    modeAdmin() ? h('pre', { class: 'code', 'data-langue': 'sql', style: { marginTop: '10px' } }, h('code', {}, sql)) : null,
    chemin.autre ? h('button', { class: 'petit discret', title: 'Un chemin presque aussi court, par d’autres tables', onclick: () => {
      const autre = { ...chemin.autre, autre: { ...chemin, autre: null } }
      vue.chemin = autre
      vue.rappels.surChemin(autre)
      vue.dessiner()
    } }, ic('reseau', 14), `Autre chemin : par ${chemin.autre.etapes.slice(0, -1).map((e) => e.vers.table.nom).join(', ') || 'un lien direct'}`) : null,
    h('div', { class: 'actions' },
      h('button', { class: 'petit', onclick: () => navigator.clipboard.writeText(sql).then(() => notifier('Jointures copiées')) }, ic('copier', 14), 'Copier'),
      h('button', { class: 'petit', title: 'Un zip pour Excel : les tables du chemin en CSV (dossier sources), un classeur avec une requête Power Query par table, l’image du chemin et ses jointures', onclick: () => extraireTables(distinctes, modeAdmin() ? { image: imageDuChemin(vue, chemin, sql), sql } : { image: imageDuChemin(vue, chemin, '') }) }, ic('telecharger', 14), `Extraire pour Excel (${distinctes.length} tables)`),
      chemin.manuel ? h('button', { class: 'petit discret', title: 'Retirer la dernière table du chemin', onclick: () => vue.retirerDernier() }, ic('retour', 14), 'Retirer la dernière') : null,
      h('button', { class: 'petit discret', onclick: () => { vue.effacerChemin(); vider(panneau, panneauTable(chemin.depart, vue)) } }, ic('x', 14), 'Effacer'),
    ),
    etMaintenant(chemin, distinctes),
  ]
}

// L'image jointe à l'extraction : la constellation telle qu'elle est à l'écran (le chemin allumé), et à droite
// les tables du chemin et son SQL.
function imageDuChemin(vue, chemin, sql) {
  const source = vue.toile
  const ratio = vue.ratio || 1
  const largeurTexte = 520 * ratio
  const lignes = [`Chemin : ${[chemin.depart, ...chemin.etapes.map((e) => e.vers)].map((n) => n.table.nom).filter((n, i, l) => l.indexOf(n) === i).join(' → ')}`, '', ...sql.split('\n')]
  const toile = document.createElement('canvas')
  toile.width = source.width + largeurTexte
  toile.height = Math.max(source.height, (lignes.length * 18 + 60) * ratio)
  const c = toile.getContext('2d')
  c.fillStyle = '#04070f'
  c.fillRect(0, 0, toile.width, toile.height)
  c.drawImage(source, 0, 0)
  c.fillStyle = '#0b1210'
  c.fillRect(source.width, 0, largeurTexte, toile.height)
  c.scale(ratio, ratio)
  c.fillStyle = '#e6f2ea'
  c.font = '600 15px system-ui, sans-serif'
  c.fillText('Jointures', source.width / ratio + 20, 32)
  c.font = '12px ui-monospace, Consolas, monospace'
  lignes.forEach((ligne, i) => {
    c.fillStyle = i === 0 ? '#f59e0b' : '#c7d2cc'
    c.fillText(ligne.length > 70 ? ligne.slice(0, 69) + '…' : ligne, source.width / ratio + 20, 60 + i * 18)
  })
  return toile.toDataURL('image/png')
}

// Le SQL d'un chemin, dans un ordre que BIRT accepte : on part de la première table, et une jointure n'ajoute sa
// table que quand l'autre table de son lien est déjà jointe (sinon elle attend son tour). Une table déjà jointe
// n'est pas jointe une deuxième fois (aller-retour d'un chemin construit à la main).
export function sqlDuChemin(chemin) {
  const depart = chemin.depart.table.nom
  const jointes = new Set([depart])
  const restants = [...new Set(chemin.etapes.map((e) => e.lien))]
  const ordre = []
  while (restants.length) {
    const i = restants.findIndex((l) => jointes.has(l.a.table.nom) !== jointes.has(l.b.table.nom))
    if (i < 0) break
    const [lien] = restants.splice(i, 1)
    const table = jointes.has(lien.a.table.nom) ? lien.b.table.nom : lien.a.table.nom
    jointes.add(table)
    ordre.push({ table, j: lien.jointures[0] })
    // Les liens dont les deux tables sont déjà jointes ne servent plus.
    for (let k = restants.length - 1; k >= 0; k--) if (jointes.has(restants[k].a.table.nom) && jointes.has(restants[k].b.table.nom)) restants.splice(k, 1)
  }
  const sql = `SELECT *\nFROM ${depart}\n${ordre.map(({ table, j }) => `LEFT JOIN ${table} ON ${j.de}.${j.colonne} = ${j.vers}.${j.versColonne}`).join('\n')}`
  return {
    sql,
    ordre,
    jointures: ordre.map((o) => o.j),
    distinctes: [...jointes],
    erreur: restants.length ? `${restants.length} lien(s) sans table déjà jointe : le chemin n’est pas d’un seul tenant.` : null,
  }
}

function panneauLien(l) {
  // L'utilisateur : ce que relie le lien, et son nom s'il en a un.
  if (!modeAdmin()) {
    return [
      h('h2', { style: { marginBottom: '6px' } }, l.jointures.length > 1 ? 'Liens' : 'Lien'),
      l.jointures.map((j) => h('div', { style: { marginBottom: '12px' } },
        h('p', { style: { margin: 0 } }, h('b', {}, l.a.table.libelle || l.a.table.nom), ' ↔ ', h('b', {}, l.b.table.libelle || l.b.table.nom)),
        j.libelle ? h('p', { class: 'texte-2', style: { margin: '4px 0 0' } }, j.libelle) : null,
        j.description ? h('p', { class: 'discret', style: { fontSize: '13px', margin: '4px 0 0' } }, j.description) : null)),
    ]
  }
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
  const cles = !reglages.cles || !modeAdmin() ? '' : graphe.liens.map((l) => {
    let angle = (Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x) * 180) / Math.PI
    if (angle > 90 || angle < -90) angle += 180
    const mx = (l.a.x + l.b.x) / 2
    const my = (l.a.y + l.b.y) / 2
    return `<text class="cle" x="${mx}" y="${my - taille * 0.25}" font-size="${taille * 0.6}" transform="rotate(${angle.toFixed(1)} ${mx} ${my})">${x(texteCle(l))}</text>`
  }).join('')
  const bulles = noeuds.map((n) => {
    const classe = surChemin.has(n) ? 'chemin' : n.table.exclue ? 'ecartee' : ''
    const grand = n.degre > 8 ? 1.25 : 1
    return `<g class="${classe}"><circle cx="${n.x}" cy="${n.y}" r="${rayon(n)}" fill="${n.type.papier}"/>`
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
  <text x="10" y="283.2">Type de table :</text>
  ${TYPES.map((v, i) => pastille(36 + i * 34, v.papier, v.nom)).join('')}
  ${pastille(212, '#e5e7eb', 'écartée de l’IA')}
  ${pastille(250, '#f59e0b', 'chemin choisi')}
  <text x="290" y="283.2">Taille : nombre de liens. Trait vert : lien nommé.</text>
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
