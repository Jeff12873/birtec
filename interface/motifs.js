// Les motifs de la constellation : des façons de ranger les bulles, calculées à partir des tables et de leurs
// liens. Un motif ne fait que proposer des positions, pour voir : la disposition de l'utilisateur (gardée dans
// le .ktec) n'est jamais touchée.
//   disposer(id, graphe, { source }) → { positions: Map(noeud → { x, y }), etiquettes: [{ x, y, texte }],
//                                        trace: [{ x, y }] (un dessin en filigrane), liensDiscrets,
//                                        image: { x, y, largeur, hauteur } (l'image du motif, en fond), pluie,
//                                        animer: (secondes) → Map(noeud → { x, y }) pour un motif dynamique }
// Les motifs sont rangés par catégorie dans le menu : utiles, fantaisies, dynamiques (qui bougent sans cesse).

const ECART = 46 // distance visée entre deux bulles voisines

export const CATEGORIES = { utiles: 'Utiles', fantaisies: 'Fantaisies', dynamiques: 'Dynamiques' }
export const MOTIFS = [
  { id: 'libre', nom: 'Ma disposition' }, // seule en tête du menu, hors catégorie
  { id: 'types', nom: 'Par types (axe des principales)', categorie: 'utiles' },
  { id: 'galaxie', nom: 'Galaxie (tout, pour l’impression)', categorie: 'utiles' },
  { id: 'autour', nom: 'Autour de la table choisie', categorie: 'utiles' },
  { id: 'arbre', nom: 'Arbre depuis la table choisie', categorie: 'utiles' },
  { id: 'hierarchie', nom: 'Hiérarchie (mères en haut)', categorie: 'utiles' },
  { id: 'anneaux', nom: 'Anneaux par importance', categorie: 'utiles' },
  { id: 'galaxies', nom: 'Amas (groupes liés)', categorie: 'utiles' },
  { id: 'familles', nom: 'Familles de noms', categorie: 'utiles' },
  { id: 'alphabet', nom: 'Grille alphabétique', categorie: 'utiles' },
  { id: 'cercle', nom: 'Cercle', categorie: 'fantaisies' },
  { id: 'spirale', nom: 'Spirale', categorie: 'fantaisies' },
  { id: 'etoile', nom: 'Étoile', categorie: 'fantaisies' },
  { id: 'coeur', nom: 'Cœur', categorie: 'fantaisies' },
  { id: 'fleur', nom: 'Fleur', categorie: 'fantaisies' },
  { id: 'vague', nom: 'Vague', categorie: 'fantaisies' },
  { id: 'concombre', nom: 'Concombre masqué', categorie: 'fantaisies', cache: true }, // à découvrir : l'étoile verte du ciel
  { id: 'galaxie_tournante', nom: 'Galaxie tournante', categorie: 'dynamiques' },
  { id: 'orbites', nom: 'Orbites par type', categorie: 'dynamiques' },
  { id: 'pulsation', nom: 'Pulsation', categorie: 'dynamiques' },
  { id: 'flottement', nom: 'Flottement', categorie: 'dynamiques' },
]

const tri = (a, b) => b.degre - a.degre || a.table.nom.localeCompare(b.table.nom)

export function disposer(id, graphe, options = {}) {
  const positions = new Map()
  const etiquettes = []
  const noeuds = [...graphe.noeuds]
  if (!noeuds.length) return { positions, etiquettes }
  const faire = { types, galaxie: plan, anneaux, autour, arbre, hierarchie, galaxies, familles, alphabet, cercle, spirale, etoile, coeur, fleur, vague, concombre, galaxie_tournante: galaxieTournante, orbites, pulsation, flottement }[id]
  const extra = faire?.(noeuds, graphe, positions, etiquettes, options) || {}
  return { positions, etiquettes, ...extra }
}

// ---------------------------------------------------------------- par types (géométrique)

// Un plan lisible, construit sur les types de tables (interface/types.js) :
//   - au centre, l'AXE des tables principales, de haut en bas, voisines rapprochées ; elles alternent un peu à
//     gauche et à droite, pour qu'un lien entre deux principales éloignées ne passe jamais sur une autre ;
//   - à gauche, les tables INTERMÉDIAIRES, à mi-hauteur entre les deux principales qu'elles relient (leurs deux
//     liens partent en biais, jamais à l'horizontale) ;
//   - à droite, les SECONDAIRES de chaque principale, en quinconce au-dessus et au-dessous d'elle ;
//   - tout à gauche, les RÉFÉRENTIELS, à la hauteur moyenne des tables qui s'en servent ;
//   - en bas à droite, les tables TECHNIQUES et celles qui ne tiennent à rien, en grille.
// Chaque colonne est ensuite desserrée pour que deux bulles ne se touchent pas.
function types(noeuds, graphe, positions, etiquettes) {
  const PAS = 150 // entre deux principales
  const DECALAGE = 46 // l'alternance de l'axe
  const COLONNES = { referentiel: -620, intermediaire: -240, axe: 0, secondaire: 240, technique: 620 }
  const de = (id) => noeuds.filter((n) => (n.type?.id || 'secondaire') === id)

  // L'axe : on enchaîne les principales en partant de la plus reliée, en prenant à chaque fois la voisine la
  // plus liée à celles déjà placées (les voisines restent proches sur l'axe).
  const restantes = new Set(de('principale').sort(tri))
  const axe = []
  while (restantes.size) {
    const proche = (n) => axe.filter((m) => liees(n, m)).length + (axe.length && liees(n, axe.at(-1)) ? 2 : 0)
    const suivante = [...restantes].sort((a, b) => proche(b) - proche(a) || tri(a, b))[0]
    axe.push(suivante)
    restantes.delete(suivante)
  }
  axe.forEach((n, i) => positions.set(n, { x: (i % 2 ? 1 : -1) * DECALAGE, y: i * PAS }))
  const yAxe = new Map(axe.map((n, i) => [n, i * PAS]))
  const principalesDe = (n) => [...n.voisins].filter((v) => yAxe.has(v)).sort((a, b) => yAxe.get(a) - yAxe.get(b))

  // Intermédiaires : entre leurs principales ; sinon près de leur voisine placée.
  const voulus = { intermediaire: [], secondaire: [], referentiel: [], technique: [] }
  for (const n of de('intermediaire')) {
    const p = principalesDe(n)
    voulus.intermediaire.push({ n, y: p.length ? (yAxe.get(p[0]) + yAxe.get(p.at(-1))) / 2 + (p.length === 1 ? PAS / 3 : 0) : null })
  }
  // Secondaires : en quinconce autour de leur principale (au-dessus, au-dessous, de plus en plus loin).
  const parPrincipale = new Map()
  for (const n of de('secondaire')) {
    const p = principalesDe(n)[0] || [...n.voisins].map((v) => principalesDe(v)[0]).find(Boolean)
    if (!p) { voulus.secondaire.push({ n, y: null }); continue }
    const rang = parPrincipale.get(p) || 0
    parPrincipale.set(p, rang + 1)
    const sens = rang % 2 ? 1 : -1
    voulus.secondaire.push({ n, y: yAxe.get(p) + sens * (48 + Math.floor(rang / 2) * 40) })
  }
  // Référentiels : à la hauteur moyenne des tables qui s'en servent (déjà placées ou à placer).
  for (const n of de('referentiel')) {
    const ys = [...n.voisins].map((v) => yAxe.get(v) ?? principalesDe(v).map((p) => yAxe.get(p))[0]).filter((y) => y !== undefined)
    voulus.referentiel.push({ n, y: ys.length ? ys.reduce((s, y) => s + y, 0) / ys.length : null })
  }
  for (const n of de('technique')) voulus.technique.push({ n, y: null })

  // Chaque colonne : triée par hauteur voulue, puis desserrée (écart mini) ; les sans-attache vont au bout, et
  // une colonne trop chargée déborde sur une deuxième rangée, décalée d'une demi-case (toujours en biais).
  const bas = Math.max(PAS, (axe.length - 1) * PAS)
  for (const [type, liste] of Object.entries(voulus)) {
    if (!liste.length) continue
    const x0 = COLONNES[type]
    const sens = x0 < 0 ? -1 : 1
    if (type === 'technique') {
      // En grille, sous le reste, à droite.
      liste.sort((a, b) => tri(a.n, b.n)).forEach(({ n }, i) => positions.set(n, { x: x0 + (i % 4) * 90 * sens, y: bas + 160 + Math.floor(i / 4) * 70 + (i % 2) * 22 }))
      continue
    }
    const attaches = liste.filter((v) => v.y !== null).sort((a, b) => a.y - b.y)
    const libres = liste.filter((v) => v.y === null)
    let dernier = -Infinity
    const ecart = ECART * 1.3
    const sous = type === 'intermediaire' ? 3 : 2 // sous-colonnes en alternance : les bulles serrées ne s'alignent pas
    attaches.forEach((v, i) => {
      const y = Math.max(v.y, dernier + ecart / sous)
      dernier = y
      positions.set(v.n, { x: x0 + (i % sous) * 95 * sens, y })
    })
    libres.forEach((v, i) => positions.set(v.n, { x: x0 + (i % sous) * 95 * sens, y: Math.max(dernier, bas) + 80 + i * (ecart / sous) }))
  }

  const haut = -110
  etiquettes.push(
    { x: COLONNES.referentiel + 55 * -1, y: haut, texte: 'Référentiels' },
    { x: COLONNES.intermediaire - 55, y: haut, texte: 'Intermédiaires' },
    { x: 0, y: haut, texte: 'Principales' },
    { x: COLONNES.secondaire + 55, y: haut, texte: 'Secondaires' },
    { x: COLONNES.technique + 135, y: bas + 110, texte: 'Techniques' },
  )
  return {}
}

const liees = (a, b) => a.voisins.has(b)

// ---------------------------------------------------------------- galaxie : tout, pour l'impression

// La taille d'une case de la galaxie : un nom de table (et sa description en dessous) y tient sans toucher ses
// voisines. L'impression écrit les noms à cette échelle (voir pageConstellation).
export const CASE_GALAXIE = { largeur: 190, hauteur: 62 }

// Toutes les tables (écartées et liaisons comprises : vue.js les montre pendant ce motif), en un plan à lire sur
// papier. Chaque table a SA case dans un quadrillage : deux noms ne peuvent pas se chevaucher.
//   - les tables PRINCIPALES d'abord, en grille, les plus reliées côte à côte ;
//   - puis chaque table prend la case libre la plus proche de ce qu'elle relie : une liaison entre deux
//     principales au milieu d'elles, une table d'une seule principale autour d'elle ;
//   - les tables qui ne tiennent à rien : en rangées sous le plan.
// L'ensemble est tassé pour remplir une feuille A3 paysage.
function plan(noeuds, graphe, positions, etiquettes) {
  const { largeur: CL, hauteur: CH } = CASE_GALAXIE
  const type = (n) => n.type?.id || 'secondaire'
  const principales = noeuds.filter((n) => type(n) === 'principale').sort(tri)
  if (!principales.length) return types(noeuds, graphe, positions, etiquettes)
  const estPrincipale = new Set(principales)
  const principalesDe = (n) => {
    const directes = [...n.voisins].filter((v) => estPrincipale.has(v))
    return directes.length ? directes : [...new Set([...n.voisins].flatMap((v) => [...v.voisins].filter((w) => estPrincipale.has(w) && w !== n)))]
  }

  // Le poids entre deux principales : lien direct, ou par une table de liaison.
  const poids = new Map()
  const cleDe = (a, b) => [a.table.nom, b.table.nom].sort().join('|')
  const ajouterPoids = (a, b, p) => { if (a !== b) poids.set(cleDe(a, b), (poids.get(cleDe(a, b)) || 0) + p) }
  for (const l of graphe.liens) if (estPrincipale.has(l.a) && estPrincipale.has(l.b)) ajouterPoids(l.a, l.b, 2)
  const reliees = noeuds.filter((n) => !estPrincipale.has(n) && n.voisins.size)
  for (const n of reliees) {
    const p = principalesDe(n)
    for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) ajouterPoids(p[i], p[j], 1)
  }
  const lien = (a, b) => poids.get(cleDe(a, b)) || 0

  // 1. Le quadrillage entier est taillé pour la feuille A3 paysage (400 × 248 mm utiles), rempli aux trois cinquièmes
  //    environ ; les tables sans lien en occupent les dernières lignes. Les principales sont réparties dessus en
  //    blocs à peu près carrés, puis échangées entre elles tant que leurs liens raccourcissent.
  const isoleesNb = noeuds.filter((n) => !n.voisins.size && !estPrincipale.has(n)).length
  const total = noeuds.length / 0.6
  const C = Math.max(6, Math.round(Math.sqrt(total * (400 / 248) * (CH / CL))))
  const R = Math.max(4, Math.ceil(total / C))
  const lignesIsolees = Math.ceil(isoleesNb / C)
  const RP = Math.max(3, R - lignesIsolees - (lignesIsolees ? 1 : 0))
  const colonnes = Math.max(1, Math.min(principales.length, Math.round(Math.sqrt(principales.length * (C * CL) / (RP * CH)))))
  const lignes = Math.ceil(principales.length / colonnes)
  const PAS_X = C / colonnes
  const PAS_Y = RP / lignes
  const cases = []
  for (let i = 0; i < colonnes * lignes; i++) cases.push({ c: Math.floor((i % colonnes) * PAS_X + PAS_X / 2), l: Math.floor(Math.floor(i / colonnes) * PAS_Y + PAS_Y / 2) })
  const dist = (a, b) => Math.hypot((a.c - b.c) * CL, (a.l - b.l) * CH)
  const milieu = { c: ((colonnes - 1) * PAS_X) / 2, l: ((lignes - 1) * PAS_Y) / 2 }
  const libres = [...cases].sort((a, b) => dist(a, milieu) - dist(b, milieu))
  const place = new Map()
  const reste = new Set(principales)
  while (reste.size) {
    const n = [...reste].sort((a, b) => [...place.keys()].reduce((s, m) => s + lien(b, m) - lien(a, m), 0) || tri(a, b))[0]
    const cout = (c) => [...place].reduce((s, [m, pm]) => s + lien(n, m) * dist(c, pm), 0)
    const c = place.size ? [...libres].sort((a, b) => cout(a) - cout(b))[0] : libres[0]
    place.set(n, c)
    libres.splice(libres.indexOf(c), 1)
    reste.delete(n)
  }
  const longueur = () => [...poids].reduce((s, [cle, p]) => {
    const [a, b] = cle.split('|').map((nom) => principales.find((n) => n.table.nom === nom))
    return s + p * dist(place.get(a), place.get(b))
  }, 0)
  let meilleure = longueur()
  for (let tour = 0, mieux = true; mieux && tour < 20; tour++) {
    mieux = false
    for (const a of principales) {
      for (const c of [...principales.filter((b) => b !== a).map((b) => place.get(b)), ...libres]) {
        const b = principales.find((x) => place.get(x) === c)
        const ca = place.get(a)
        place.set(a, c)
        if (b) place.set(b, ca)
        const l = longueur()
        if (l < meilleure - 1e-6) {
          meilleure = l
          mieux = true
          if (!b) libres.splice(libres.indexOf(c), 1, ca)
        } else {
          place.set(a, ca)
          if (b) place.set(b, c)
        }
      }
    }
  }

  // 2. Les cases fines : chaque table prend la case libre la plus proche de la place voulue.
  const prises = new Set()
  const occuper = (n, c, l) => { prises.add(`${c},${l}`); positions.set(n, { x: c * CL, y: l * CH }) }
  const poser = (n, cible) => {
    for (let r = 0; r < 400; r++) {
      // Les cases à distance r (en anneau), les plus proches d'abord.
      const anneau = []
      for (let dc = -r; dc <= r; dc++) for (let dl = -r; dl <= r; dl++) if (Math.max(Math.abs(dc), Math.abs(dl)) === r) anneau.push({ c: Math.round(cible.c) + dc, l: Math.round(cible.l) + dl })
      anneau.sort((a, b) => dist(a, cible) - dist(b, cible))
      const libre = anneau.find((x) => !prises.has(`${x.c},${x.l}`))
      if (libre) return occuper(n, libre.c, libre.l)
    }
  }
  for (const n of principales) occuper(n, place.get(n).c, place.get(n).l)
  const ou = (n) => {
    const p = principalesDe(n).map((x) => place.get(x))
    return { c: p.reduce((s, q) => s + q.c, 0) / p.length, l: p.reduce((s, q) => s + q.l, 0) / p.length + (p.length === 1 ? 0.5 : 0) }
  }
  // Les liaisons entre principales d'abord (elles tiennent au milieu), puis les tables d'une seule principale,
  // les plus reliées en premier (au plus près), puis celles reliées seulement à d'autres non principales.
  const avecPrincipales = reliees.filter((n) => principalesDe(n).length).sort((a, b) => principalesDe(b).length - principalesDe(a).length || tri(a, b))
  for (const n of avecPrincipales) poser(n, ou(n))
  const sansPrincipale = reliees.filter((n) => !principalesDe(n).length).sort(tri)
  for (let tour = 0; tour < 3; tour++) {
    for (const n of sansPrincipale) {
      if (positions.has(n)) continue
      const placees = [...n.voisins].map((v) => positions.get(v)).filter(Boolean)
      if (placees.length || tour === 2) poser(n, placees.length ? { c: placees.reduce((s, q) => s + q.x / CL, 0) / placees.length, l: placees.reduce((s, q) => s + q.y / CH, 0) / placees.length } : milieu)
    }
  }

  // 3. Les tables isolées : en rangées sous le plan, aussi large que lui.
  const isolees = noeuds.filter((n) => !positions.has(n)).sort((a, b) => a.table.nom.localeCompare(b.table.nom))
  if (isolees.length) {
    const cs = [...prises].map((k) => Number(k.split(',')[0]))
    const ls = [...prises].map((k) => Number(k.split(',')[1]))
    const gauche = Math.min(0, ...cs)
    const parLigne = Math.max(C, Math.max(...cs) - gauche + 1)
    const bas = Math.max(...ls) + 2
    isolees.forEach((n, i) => occuper(n, gauche + (i % parLigne), bas + Math.floor(i / parLigne)))
    etiquettes.push({ x: gauche * CL + 40, y: (bas - 0.9) * CH, texte: 'Tables sans lien' })
  }
  return { galaxie: true }
}

// Des bulles réparties sur un cercle ; le rayon grandit s'il n'y a pas la place. Renvoie le rayon pris.
function surCercle(liste, positions, rayon, cx = 0, cy = 0, depart = -Math.PI / 2) {
  const r = Math.max(rayon, (liste.length * ECART) / (2 * Math.PI))
  liste.forEach((n, i) => {
    const angle = depart + (2 * Math.PI * i) / liste.length
    positions.set(n, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) })
  })
  return r
}

// Un amas en tournesol : la plus reliée au centre, les autres en spirale autour. Renvoie son rayon.
function enTournesol(liste, positions, cx, cy) {
  liste.sort(tri).forEach((n, k) => {
    const r = ECART * 0.62 * Math.sqrt(k)
    positions.set(n, { x: cx + r * Math.cos(k * 2.39996), y: cy + r * Math.sin(k * 2.39996) })
  })
  return ECART * 0.62 * Math.sqrt(Math.max(1, liste.length - 1)) + ECART * 0.6
}

// Range des amas (du plus gros au plus petit) sans qu'ils se chevauchent, en partant du centre.
function rangerAmas(amas, positions, etiquettes, titre) {
  const places = []
  for (const groupe of amas.sort((a, b) => b.length - a.length)) {
    const r = ECART * 0.62 * Math.sqrt(Math.max(1, groupe.length - 1)) + ECART * 0.9
    let centre = null
    for (let d = 0; !centre; d += 25) {
      const essais = Math.max(1, Math.round(d / 18))
      for (let i = 0; i < essais && !centre; i++) {
        const angle = (2 * Math.PI * i) / essais + d * 0.01
        const c = { x: d * Math.cos(angle), y: d * Math.sin(angle) * 0.75 }
        if (places.every((p) => Math.hypot(p.x - c.x, p.y - c.y) > p.r + r + 30)) centre = c
      }
    }
    places.push({ ...centre, r })
    enTournesol(groupe, positions, centre.x, centre.y)
    const texte = titre(groupe)
    if (texte) etiquettes.push({ x: centre.x, y: centre.y - r - 8, texte })
  }
}

// ---- Anneaux par importance : les tables les plus reliées au centre, puis un anneau par tranche du nombre de liens.
const TRANCHES = [[8, 'Carrefours (8 liens et plus)'], [4, 'Très reliées (4 à 7)'], [2, 'Reliées (2 ou 3)'], [1, 'Un seul lien'], [0, 'Sans lien']]
function anneaux(noeuds, graphe, positions, etiquettes) {
  let r = 0
  let min = Infinity
  TRANCHES.forEach(([seuil, nom]) => {
    const liste = noeuds.filter((n) => n.degre >= seuil && n.degre < min).sort(tri)
    min = seuil
    if (!liste.length) return
    if (!r && liste.length === 1) return positions.set(liste[0], { x: 0, y: 0 }), (r = ECART * 0.5)
    // Départ décalé d'un demi-pas : le haut de l'anneau reste libre pour son nom.
    r = surCercle(liste, positions, r + ECART * 1.9, 0, 0, -Math.PI / 2 + Math.PI / liste.length)
    etiquettes.push({ x: 0, y: -r - 16, texte: nom })
  })
}

// ---- Autour de la table choisie : elle au centre, puis un cercle par type de table, du plus proche du métier au
// plus technique (principales, intermédiaires, secondaires, référentiels, techniques). Sur chaque cercle, une
// table se range du côté des tables déjà placées qu'elle relie (moins de liens croisés) ; les tables sans aucun
// chemin jusqu'au centre ferment leur cercle.
const ORDRE_CERCLES = [['principale', 'Principales'], ['intermediaire', 'Intermédiaires'], ['secondaire', 'Secondaires'], ['referentiel', 'Référentiels'], ['technique', 'Techniques']]
function autour(noeuds, graphe, positions, etiquettes, { source }) {
  const centre = source || [...noeuds].sort(tri)[0]
  positions.set(centre, { x: 0, y: 0 })
  etiquettes.push({ x: 0, y: -ECART * 0.9, texte: centre.table.nom })
  const angleDe = (n) => { const p = positions.get(n); return Math.atan2(p.y, p.x) }
  const moyenne = (angles) => Math.atan2(angles.reduce((s, a) => s + Math.sin(a), 0), angles.reduce((s, a) => s + Math.cos(a), 0))
  let r = 0
  let premierCercle = true
  for (const [type, titre] of ORDRE_CERCLES) {
    const liste = noeuds.filter((n) => n !== centre && (n.type?.id || 'secondaire') === type)
    if (!liste.length) continue
    // Assez de tour pour que les noms ne se touchent pas (près de deux écarts par table).
    r = Math.max(r + ECART * 2.2, (liste.length * ECART * 1.8) / (2 * Math.PI))
    if (premierCercle) ordonnerPremierCercle(liste, noeuds, r, positions)
    else {
      // L'angle voulu : au milieu des tables déjà placées qu'elle relie (sinon de celles que relient ses voisines).
      const voulus = new Map(liste.map((n) => {
        let placees = [...n.voisins].filter((v) => positions.has(v) && v !== centre)
        if (!placees.length) placees = [...n.voisins].flatMap((v) => [...v.voisins]).filter((w) => positions.has(w) && w !== centre && w !== n)
        return [n, placees.length ? moyenne(placees.map(angleDe)) : null]
      }))
      placerAuxAngles(liste, voulus, r, positions)
    }
    premierCercle = false
    etiquettes.push({ x: 0, y: -r - 18, texte: `${titre} (${liste.length})` })
  }
}

// Le premier cercle (rien n'est encore placé autour) : régulier, dans l'ordre qui rapproche les tables liées
// (directement, ou par une table qui les relie toutes les deux) ; amélioré par échanges tant que ça raccourcit.
function ordonnerPremierCercle(liste, noeuds, r, positions) {
  const dans = new Set(liste)
  const poids = (a, b) => (a.voisins.has(b) ? 3 : 0) + noeuds.filter((x) => !dans.has(x) && x.voisins.has(a) && x.voisins.has(b)).length
  const P = liste.map((a) => liste.map((b) => (a === b ? 0 : poids(a, b))))
  const n = liste.length
  const ecart = (i, j) => { const d = Math.abs(i - j) % n; return Math.min(d, n - d) }
  const ordre = liste.map((_, i) => i)
  const cout = () => { let c = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) c += P[ordre[i]][ordre[j]] * ecart(i, j); return c }
  let meilleur = cout()
  for (let tour = 0, mieux = true; mieux && tour < 50; tour++) {
    mieux = false
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      ;[ordre[i], ordre[j]] = [ordre[j], ordre[i]]
      const c = cout()
      if (c < meilleur) { meilleur = c; mieux = true } else [ordre[i], ordre[j]] = [ordre[j], ordre[i]]
    }
  }
  ordre.forEach((k, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
    positions.set(liste[k], { x: r * Math.cos(angle), y: r * Math.sin(angle) })
  })
}

// Chaque table à son angle voulu sur le cercle, puis écartées juste assez pour ne pas se toucher ; celles sans
// angle voulu vont dans les plus grands vides.
function placerAuxAngles(liste, voulus, r, positions) {
  const TOUR = 2 * Math.PI
  const ecartMini = Math.min(TOUR / liste.length, (ECART * 1.6) / r)
  const norme = (a) => ((a % TOUR) + TOUR) % TOUR
  const places = liste.filter((n) => voulus.get(n) !== null).map((n) => ({ n, a: norme(voulus.get(n)) }))
  for (let tour = 0; tour < 300; tour++) {
    places.sort((x, y) => x.a - y.a)
    let bouge = false
    for (let i = 0; i < places.length && places.length > 1; i++) {
      const p = places[i]
      const q = places[(i + 1) % places.length]
      const ecart = norme(q.a - p.a) || (i === places.length - 1 ? TOUR : 0)
      if (ecart >= ecartMini - 1e-9) continue
      const pousse = (ecartMini - ecart) / 2 + 1e-4
      p.a = norme(p.a - pousse)
      q.a = norme(q.a + pousse)
      bouge = true
    }
    if (!bouge) break
  }
  // Les tables sans angle : une à une dans le plus grand vide.
  for (const n of liste.filter((x) => voulus.get(x) === null).sort(tri)) {
    places.sort((x, y) => x.a - y.a)
    if (!places.length) { places.push({ n, a: norme(-Math.PI / 2) }); continue }
    let meilleur = 0
    let taille = -1
    places.forEach((p, i) => {
      const q = places[(i + 1) % places.length]
      const t = places.length === 1 ? TOUR : norme(q.a - p.a)
      if (t > taille) { taille = t; meilleur = i }
    })
    places.push({ n, a: norme(places[meilleur].a + taille / 2) })
  }
  for (const { n, a } of places) positions.set(n, { x: r * Math.cos(a), y: r * Math.sin(a) })
}

// ---- Hiérarchie : une table qui en désigne une autre par sa clé (ID_X → X) est sa fille et se range dessous.
function hierarchie(noeuds, graphe, positions) {
  const meres = new Map(noeuds.map((n) => [n, new Set()]))
  for (const l of graphe.liens) {
    for (const j of l.jointures) {
      const fille = j.de === l.a.table.nom ? l.a : l.b
      const mere = fille === l.a ? l.b : l.a
      meres.get(fille).add(mere)
    }
  }
  // Rang : 0 pour les tables qui ne désignent personne, sinon un de plus que la mère la plus basse.
  // Une boucle (A → B → A) est coupée là où il reste le moins de mères à placer.
  const rang = new Map()
  const reste = new Set(noeuds)
  while (reste.size) {
    let pret = [...reste].filter((n) => [...meres.get(n)].every((m) => rang.has(m) || m === n))
    if (!pret.length) pret = [[...reste].sort((a, b) => [...meres.get(a)].filter((m) => !rang.has(m)).length - [...meres.get(b)].filter((m) => !rang.has(m)).length || tri(a, b))[0]]
    for (const n of pret) {
      rang.set(n, Math.max(-1, ...[...meres.get(n)].filter((m) => rang.has(m)).map((m) => rang.get(m))) + 1)
      reste.delete(n)
    }
  }
  const etages = []
  for (const n of noeuds) (etages[rang.get(n)] ||= []).push(n)
  let y = 0
  for (const etage of etages.filter(Boolean)) {
    // Sous ses mères, autant que possible.
    const x = (n) => { const m = [...meres.get(n)].filter((v) => positions.has(v)); return m.length ? m.reduce((s, v) => s + positions.get(v).x, 0) / m.length : 0 }
    const cles = new Map(etage.map((n) => [n, x(n)]))
    etage.sort((a, b) => cles.get(a) - cles.get(b) || tri(a, b))
    const parRangee = 28
    for (let debut = 0; debut < etage.length; debut += parRangee) {
      const rangee = etage.slice(debut, debut + parRangee)
      rangee.forEach((n, i) => positions.set(n, { x: (i - (rangee.length - 1) / 2) * ECART * 1.35, y }))
      y += ECART * 1.1
    }
    y += ECART * 1.4
  }
}

// ---- Galaxies : les groupes de tables très liées entre elles (propagation d'étiquettes), chacun en amas.
export function groupesLies(noeuds) {
  const groupe = new Map(noeuds.map((n) => [n, n.table.nom]))
  const ordre = [...noeuds].sort((a, b) => a.table.nom.localeCompare(b.table.nom))
  for (let tour = 0; tour < 12; tour++) {
    let change = false
    for (const n of ordre) {
      if (!n.voisins.size) continue
      const comptes = new Map()
      for (const v of n.voisins) comptes.set(groupe.get(v), (comptes.get(groupe.get(v)) || 0) + 1 + v.degre * 0.01)
      const meilleur = [...comptes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
      if (meilleur !== groupe.get(n)) { groupe.set(n, meilleur); change = true }
    }
    if (!change) break
  }
  const parGroupe = new Map()
  for (const n of noeuds) {
    const cle = n.voisins.size ? groupe.get(n) : '\u0000isolées'
    parGroupe.set(cle, [...(parGroupe.get(cle) || []), n])
  }
  return [...parGroupe.values()]
}
function galaxies(noeuds, graphe, positions, etiquettes) {
  rangerAmas(groupesLies(noeuds), positions, etiquettes, (g) => (g.length > 2 ? g.sort(tri)[0].table.nom : ''))
}

// ---- Familles de noms : les tables qui commencent pareil (avant le premier « _ », sinon 3 lettres).
function familles(noeuds, graphe, positions, etiquettes) {
  const famille = (n) => { const nom = n.table.nom.toLowerCase(); return nom.includes('_') && nom.indexOf('_') > 0 ? nom.slice(0, nom.indexOf('_')) : nom.slice(0, 3) }
  const parFamille = new Map()
  for (const n of noeuds) parFamille.set(famille(n), [...(parFamille.get(famille(n)) || []), n])
  const seules = [...parFamille].filter(([, g]) => g.length === 1).flatMap(([, g]) => g)
  const amas = [...parFamille].filter(([, g]) => g.length > 1).map(([nom, g]) => Object.assign(g, { nom: nom + '…' }))
  if (seules.length) amas.push(Object.assign(seules, { nom: 'autres' }))
  rangerAmas(amas, positions, etiquettes, (g) => g.nom)
}

// ---- Cercle : toutes sur un cercle, groupe par groupe (moins de liens qui traversent).
function cercle(noeuds, graphe, positions) {
  surCercle(groupesLies(noeuds).sort((a, b) => b.length - a.length).flatMap((g) => g.sort(tri)), positions, 200)
}

// ---- Spirale : deux bras, la plus reliée au centre.
function spirale(noeuds, graphe, positions) {
  const liste = [...noeuds].sort(tri)
  const longueur = Math.sqrt(liste.length) * ECART * 2.2
  liste.forEach((n, i) => {
    const t = Math.floor(i / 2) / Math.max(1, Math.ceil(liste.length / 2))
    const angle = (i % 2) * Math.PI + t * 2.8 * Math.PI
    const r = ECART * 0.8 + t * longueur
    positions.set(n, { x: r * Math.cos(angle), y: r * Math.sin(angle) })
  })
}

// ---- Concombre masqué : les tables suivent la silhouette du héros de PDRTec. Les plus reliées prennent les
// yeux du masque, l'emblème et la boucle de ceinture ; s'il en reste, elles remplissent l'intérieur.
// Silhouette : 200 points (x, y), hauteur 2, centrée.
const SILHOUETTE = [0.304,-0.988,0.335,-0.973,0.363,-0.953,0.383,-0.925,0.396,-0.894,0.406,-0.861,0.414,-0.828,0.421,-0.794,0.433,-0.763,0.438,-0.728,0.433,-0.693,0.438,-0.658,0.429,-0.625,0.425,-0.59,0.429,-0.555,0.429,-0.518,0.433,-0.483,0.438,-0.448,0.46,-0.425,0.486,-0.405,0.495,-0.376,0.521,-0.35,0.541,-0.321,0.552,-0.289,0.558,-0.255,0.575,-0.226,0.592,-0.196,0.608,-0.166,0.626,-0.137,0.64,-0.106,0.65,-0.074,0.642,-0.04,0.625,-0.011,0.604,0.017,0.584,0.046,0.564,0.074,0.54,0.1,0.515,0.121,0.51,0.147,0.521,0.179,0.529,0.212,0.533,0.247,0.538,0.282,0.538,0.319,0.537,0.355,0.531,0.389,0.535,0.423,0.542,0.457,0.546,0.488,0.558,0.519,0.566,0.553,0.567,0.589,0.562,0.624,0.555,0.658,0.55,0.692,0.546,0.727,0.546,0.764,0.558,0.795,0.575,0.825,0.598,0.852,0.627,0.871,0.652,0.893,0.662,0.925,0.629,0.934,0.594,0.938,0.557,0.938,0.522,0.933,0.493,0.917,0.459,0.917,0.43,0.905,0.433,0.871,0.439,0.836,0.45,0.804,0.453,0.77,0.448,0.735,0.438,0.703,0.425,0.671,0.405,0.643,0.392,0.612,0.388,0.577,0.383,0.542,0.396,0.511,0.404,0.478,0.398,0.444,0.384,0.413,0.372,0.381,0.361,0.349,0.35,0.317,0.342,0.284,0.321,0.292,0.301,0.32,0.281,0.348,0.258,0.376,0.235,0.403,0.212,0.43,0.195,0.459,0.175,0.488,0.152,0.515,0.138,0.546,0.135,0.578,0.121,0.609,0.104,0.638,0.084,0.666,0.058,0.69,0.038,0.718,0.021,0.748,0.011,0.78,0.005,0.814,0.008,0.846,0.005,0.88,0.008,0.915,0.012,0.95,-0.003,0.979,-0.038,0.983,-0.074,0.983,-0.111,0.983,-0.147,0.983,-0.167,0.961,-0.154,0.93,-0.134,0.901,-0.121,0.87,-0.117,0.835,-0.101,0.805,-0.092,0.772,-0.087,0.737,-0.079,0.704,-0.079,0.668,-0.075,0.633,-0.078,0.598,-0.071,0.565,-0.071,0.538,-0.108,0.538,-0.142,0.533,-0.174,0.521,-0.192,0.492,-0.205,0.461,-0.233,0.438,-0.267,0.433,-0.301,0.439,-0.333,0.45,-0.368,0.446,-0.399,0.431,-0.419,0.402,-0.429,0.37,-0.438,0.337,-0.442,0.302,-0.438,0.267,-0.444,0.239,-0.475,0.225,-0.503,0.205,-0.525,0.177,-0.541,0.147,-0.55,0.114,-0.558,0.081,-0.577,0.052,-0.604,0.029,-0.632,0.009,-0.654,-0.018,-0.627,-0.032,-0.594,-0.042,-0.563,-0.054,-0.533,-0.071,-0.504,-0.088,-0.475,-0.108,-0.447,-0.129,-0.419,-0.15,-0.39,-0.168,-0.361,-0.185,-0.331,-0.202,-0.302,-0.219,-0.272,-0.236,-0.243,-0.254,-0.214,-0.273,-0.185,-0.292,-0.156,-0.31,-0.128,-0.33,-0.1,-0.35,-0.072,-0.373,-0.048,-0.398,-0.025,-0.425,0.002,-0.448,0.03,-0.468,0.06,-0.483,0.092,-0.496,0.108,-0.521,0.108,-0.554,0.112,-0.585,0.112,-0.622,0.112,-0.655,0.112,-0.688,0.118,-0.723,0.129,-0.755,0.138,-0.788,0.149,-0.82,0.16,-0.852,0.175,-0.882,0.192,-0.912,0.214,-0.939,0.241,-0.962,0.271,-0.979]
const REPERES = [[0.242, -0.717], [0.379, -0.708], [0.383, -0.308], [0.412, 0.037]]

function concombre(noeuds, graphe, positions) {
  const points = []
  for (let i = 0; i < SILHOUETTE.length; i += 2) points.push([SILHOUETTE[i], SILHOUETTE[i + 1]])
  const perimetre = points.reduce((s, p, i) => s + Math.hypot(p[0] - points[(i + 1) % points.length][0], p[1] - points[(i + 1) % points.length][1]), 0)
  // Ordre de parcours : de proche en proche depuis la plus reliée, pour que les tables liées restent voisines.
  const liste = [...noeuds].sort(tri)
  const reperes = liste.length >= 8 ? liste.slice(0, REPERES.length) : []
  const ordre = []
  const vus = new Set(reperes)
  for (const racine of liste) {
    if (vus.has(racine)) continue
    const file = [racine]
    vus.add(racine)
    while (file.length) {
      const n = file.shift()
      ordre.push(n)
      for (const v of [...n.voisins].sort(tri)) if (!vus.has(v)) { vus.add(v); file.push(v) }
    }
  }
  // Assez grand pour que les bulles du bord se touchent presque : la silhouette se lit même avec peu de tables.
  const echelle = Math.max(170, (Math.min(ordre.length, 260) * ECART * 0.8) / perimetre)
  const surLeBord = ordre.slice(0, Math.max(1, Math.floor((echelle * perimetre) / (ECART * 0.8))))
  // L'image (320 × 480) tient exactement dans la silhouette : hauteur 2, largeur 4/3, centrée.
  const extra = {
    trace: points.map(([x, y]) => ({ x: x * echelle, y: y * echelle })),
    liensDiscrets: true,
    image: { x: (-2 / 3) * echelle, y: -echelle, largeur: (4 / 3) * echelle, hauteur: 2 * echelle },
    pluie: true,
  }
  const dedans = ordre.slice(surLeBord.length)
  reperes.forEach((n, i) => positions.set(n, { x: REPERES[i][0] * echelle, y: REPERES[i][1] * echelle }))
  // Le bord : des points également espacés le long de la silhouette.
  const cumul = [0]
  for (let i = 1; i <= points.length; i++) cumul.push(cumul[i - 1] + Math.hypot(points[i % points.length][0] - points[i - 1][0], points[i % points.length][1] - points[i - 1][1]))
  surLeBord.forEach((n, k) => {
    const d = (k / surLeBord.length) * perimetre
    let i = cumul.findIndex((c) => c > d) - 1
    if (i < 0) i = points.length - 1
    const t = (d - cumul[i]) / (cumul[i + 1] - cumul[i] || 1)
    const a = points[i]
    const b = points[(i + 1) % points.length]
    positions.set(n, { x: (a[0] + (b[0] - a[0]) * t) * echelle, y: (a[1] + (b[1] - a[1]) * t) * echelle })
  })
  if (!dedans.length) return extra
  // L'intérieur : une grille resserrée jusqu'à ce que tout le monde tienne.
  const interieur = (x, y) => {
    let dans = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i]
      const [xj, yj] = points[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dans = !dans
    }
    return dans
  }
  const occupes = [...positions.values()]
  for (let pas = ECART; pas > 8; pas *= 0.85) {
    const places = []
    for (let y = -echelle; y <= echelle; y += pas) {
      for (let x = -echelle; x <= echelle; x += pas * 0.866) {
        const px = x + ((Math.round(y / pas) % 2) * pas) / 2
        if (interieur(px / echelle, y / echelle) && occupes.every((p) => Math.hypot(p.x - px, p.y - y) > pas * 0.8)) places.push({ x: px, y })
      }
    }
    if (places.length >= dedans.length) {
      dedans.forEach((n, i) => positions.set(n, places[Math.floor((i * places.length) / dedans.length)]))
      return extra
    }
  }
  dedans.forEach((n) => positions.set(n, { x: 0, y: 0 }))
  return extra
}

// ---------------------------------------------------------------- utiles (suite)

// ---- Arbre depuis la table choisie : elle à gauche, puis une colonne par distance (1 lien, 2 liens…). Dans
// chaque colonne, une table se range à la hauteur moyenne de celles qui l'ont amenée (peu de liens croisés).
// Les tables sans chemin jusqu'à elle ferment la marche, à droite.
function arbre(noeuds, graphe, positions, etiquettes, { source }) {
  const racine = source || [...noeuds].sort(tri)[0]
  const distance = new Map([[racine, 0]])
  const file = [racine]
  while (file.length) {
    const n = file.shift()
    for (const v of [...n.voisins].sort(tri)) if (!distance.has(v)) { distance.set(v, distance.get(n) + 1); file.push(v) }
  }
  const max = Math.max(0, ...distance.values())
  const PAS_X = 230
  const PAS_Y = ECART * 1.25
  positions.set(racine, { x: 0, y: 0 })
  for (let d = 1; d <= max + 1; d++) {
    const liste = d <= max ? noeuds.filter((n) => distance.get(n) === d) : noeuds.filter((n) => !distance.has(n))
    if (!liste.length) continue
    const voulu = (n) => {
      const avant = [...n.voisins].filter((v) => positions.has(v) && distance.get(v) === d - 1).map((v) => positions.get(v).y)
      return avant.length ? avant.reduce((s, y) => s + y, 0) / avant.length : Infinity
    }
    const ys = new Map(liste.map((n) => [n, voulu(n)]))
    liste.sort((a, b) => ys.get(a) - ys.get(b) || tri(a, b))
    const haut = -((liste.length - 1) * PAS_Y) / 2
    liste.forEach((n, i) => positions.set(n, { x: d * PAS_X, y: haut + i * PAS_Y }))
    etiquettes.push({ x: d * PAS_X, y: haut - 40, texte: d <= max ? `${d} lien${d > 1 ? 's' : ''}` : 'sans chemin' })
  }
  etiquettes.push({ x: 0, y: -40, texte: racine.table.nom })
}

// ---- Grille alphabétique : pour retrouver une table d'un coup d'œil, de A à Z, en lignes.
function alphabet(noeuds, graphe, positions, etiquettes) {
  const liste = [...noeuds].sort((a, b) => a.table.nom.localeCompare(b.table.nom, 'fr'))
  const colonnes = Math.max(1, Math.round(Math.sqrt(liste.length * 2.2)))
  let lettre = ''
  liste.forEach((n, i) => {
    const p = { x: (i % colonnes) * 170, y: Math.floor(i / colonnes) * 70 }
    positions.set(n, p)
    const initiale = n.table.nom[0].toUpperCase()
    if (initiale !== lettre) { lettre = initiale; etiquettes.push({ x: p.x, y: p.y - 26, texte: lettre }) }
  })
}

// ---------------------------------------------------------------- fantaisies

// Des tables le long d'une courbe fermée (ou ouverte), espacées régulièrement, les plus reliées d'abord.
// courbe(t), t de 0 à 1 → { x, y } en unités quelconques : elle est mise à l'échelle pour que deux bulles
// voisines soient à un peu plus d'un écart l'une de l'autre.
function surCourbe(liste, positions, courbe, { fermee = true, espace = 1.3 } = {}) {
  const points = []
  for (let i = 0; i <= 1200; i++) points.push(courbe(i / 1200))
  const cumul = [0]
  for (let i = 1; i < points.length; i++) cumul.push(cumul[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  const total = cumul.at(-1) || 1
  const echelle = (liste.length * ECART * espace) / total
  const pas = total / (fermee ? liste.length : Math.max(1, liste.length - 1))
  let k = 0
  liste.forEach((n, i) => {
    const voulu = i * pas
    while (k < cumul.length - 2 && cumul[k + 1] < voulu) k++
    const f = (voulu - cumul[k]) / ((cumul[k + 1] - cumul[k]) || 1)
    positions.set(n, { x: (points[k].x + (points[k + 1].x - points[k].x) * f) * echelle, y: (points[k].y + (points[k + 1].y - points[k].y) * f) * echelle })
  })
}
const enOrdre = (noeuds) => groupesLies(noeuds).sort((a, b) => b.length - a.length).flatMap((g) => g.sort(tri))

// ---- Étoile à cinq branches.
function etoile(noeuds, graphe, positions) {
  surCourbe(enOrdre(noeuds), positions, (t) => {
    const branche = t * 10
    const i = Math.floor(branche) % 10
    const f = branche - Math.floor(branche)
    const sommet = (k) => { const a = -Math.PI / 2 + (k * Math.PI) / 5; const r = k % 2 ? 0.42 : 1; return { x: r * Math.cos(a), y: r * Math.sin(a) } }
    const a = sommet(i)
    const b = sommet(i + 1)
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
  })
}

// ---- Cœur.
function coeur(noeuds, graphe, positions) {
  surCourbe(enOrdre(noeuds), positions, (t) => {
    const a = t * 2 * Math.PI
    return { x: 16 * Math.sin(a) ** 3, y: -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) }
  })
}

// ---- Fleur : six pétales, et les plus reliées en cœur de fleur.
function fleur(noeuds, graphe, positions) {
  const liste = enOrdre(noeuds)
  const coeurFleur = [...noeuds].sort(tri).slice(0, Math.min(7, Math.ceil(noeuds.length / 8)))
  const petales = liste.filter((n) => !coeurFleur.includes(n))
  surCourbe(petales, positions, (t) => { const a = t * 2 * Math.PI; const r = 0.25 + Math.abs(Math.cos(3 * a)); return { x: r * Math.cos(a), y: r * Math.sin(a) } })
  surCercle(coeurFleur, positions, ECART * 1.1)
}

// ---- Vague : trois rangées ondulantes.
function vague(noeuds, graphe, positions) {
  const liste = enOrdre(noeuds)
  const rangees = 3
  const parRangee = Math.ceil(liste.length / rangees)
  for (let r = 0; r < rangees; r++) {
    surCourbe(liste.slice(r * parRangee, (r + 1) * parRangee), positions, (t) => ({ x: t * 12, y: Math.sin(t * 4 * Math.PI + r * 0.9) * 1.4 + r * 2.6 }), { fermee: false, espace: 1.6 })
  }
}

// ---------------------------------------------------------------- dynamiques (animées sans cesse)

// ---- Galaxie tournante : trois bras en spirale, les plus reliées au cœur ; tout tourne lentement, le cœur un
// peu plus vite, et chaque étoile ondule légèrement sur son bras.
function galaxieTournante(noeuds, graphe, positions) {
  const liste = [...noeuds].sort(tri)
  const bras = 3
  const base = liste.map((n, i) => {
    const rang = Math.floor(i / bras)
    const rayon = ECART * 0.9 + Math.sqrt(rang) * ECART * 1.5
    return { n, rayon, angle: (i % bras) * ((2 * Math.PI) / bras) + rayon * 0.011, phase: i * 1.7 }
  })
  const animer = (t) => new Map(base.map(({ n, rayon, angle, phase }) => {
    const a = angle + t * (0.06 + 0.12 * (ECART * 2) / (rayon + ECART * 2))
    const r = rayon * (1 + 0.025 * Math.sin(t * 1.3 + phase))
    return [n, { x: r * Math.cos(a), y: r * Math.sin(a) }]
  }))
  for (const [n, p] of animer(0)) positions.set(n, p)
  return { animer }
}

// ---- Orbites par type : un anneau par type autour de la table la plus reliée, chacun tourne à sa vitesse et
// un sur deux dans l'autre sens.
function orbites(noeuds, graphe, positions, etiquettes, { source }) {
  const centre = source || [...noeuds].sort(tri)[0]
  const anneaux = []
  let r = 0
  for (const [type] of ORDRE_CERCLES) {
    const liste = noeuds.filter((n) => n !== centre && (n.type?.id || 'secondaire') === type).sort(tri)
    if (!liste.length) continue
    r = Math.max(r + ECART * 2.2, (liste.length * ECART * 1.6) / (2 * Math.PI))
    anneaux.push({ liste, r, sens: anneaux.length % 2 ? -1 : 1, vitesse: 0.22 / (anneaux.length + 1) })
  }
  const animer = (t) => {
    const p = new Map([[centre, { x: 0, y: 0 }]])
    for (const { liste, r, sens, vitesse } of anneaux) {
      liste.forEach((n, i) => {
        const a = -Math.PI / 2 + (2 * Math.PI * i) / liste.length + sens * vitesse * t
        p.set(n, { x: r * Math.cos(a), y: r * Math.sin(a) })
      })
    }
    return p
  }
  for (const [n, q] of animer(0)) positions.set(n, q)
  return { animer }
}

// ---- Pulsation : les anneaux par importance respirent, l'un après l'autre, comme une onde.
function pulsation(noeuds, graphe, positions, etiquettes) {
  anneaux(noeuds, graphe, positions, etiquettes)
  etiquettes.length = 0
  const base = new Map(positions)
  const animer = (t) => new Map([...base].map(([n, q]) => {
    const r = Math.hypot(q.x, q.y)
    const f = 1 + 0.07 * Math.sin(t * 2 - r / 90)
    return [n, { x: q.x * f, y: q.y * f }]
  }))
  return { animer }
}

// ---- Flottement : chaque bulle dérive doucement autour de sa place de « Ma disposition ».
function flottement(noeuds, graphe, positions, etiquettes, { utilisateur }) {
  const base = noeuds.map((n, i) => ({ n, x: utilisateur?.get(n)?.x ?? n.x, y: utilisateur?.get(n)?.y ?? n.y, a: 0.4 + (i % 7) * 0.07, b: 0.3 + (i % 5) * 0.09, phase: i * 2.3 }))
  const animer = (t) => new Map(base.map(({ n, x, y, a, b, phase }) => [n, { x: x + 9 * Math.sin(t * a + phase), y: y + 9 * Math.cos(t * b + phase * 0.7) }]))
  for (const [n, q] of animer(0)) positions.set(n, q)
  return { animer }
}
