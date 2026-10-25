// Les motifs de la constellation : des façons de ranger les bulles, calculées à partir des tables et de leurs
// liens. Un motif ne fait que proposer des positions : la disposition de l'utilisateur (gardée dans le .ktec)
// n'est pas touchée tant qu'il ne choisit pas « Garder cette disposition ».
//   disposer(id, graphe, { source }) → { positions: Map(noeud → { x, y }), etiquettes: [{ x, y, texte }],
//                                        trace: [{ x, y }] (un dessin en filigrane), liensDiscrets,
//                                        image: { x, y, largeur, hauteur } (l'image du motif, en fond), pluie }

const ECART = 46 // distance visée entre deux bulles voisines

export const MOTIFS = [
  { id: 'libre', nom: 'Ma disposition' },
  { id: 'anneaux', nom: 'Anneaux par importance' },
  { id: 'autour', nom: 'Autour de la table choisie' },
  { id: 'hierarchie', nom: 'Hiérarchie (mères en haut)' },
  { id: 'galaxies', nom: 'Galaxies (groupes liés)' },
  { id: 'familles', nom: 'Familles de noms' },
  { id: 'cercle', nom: 'Cercle' },
  { id: 'spirale', nom: 'Spirale' },
  { id: 'concombre', nom: 'Concombre masqué', cache: true }, // à découvrir : l'étoile verte du ciel
]

const tri = (a, b) => b.degre - a.degre || a.table.nom.localeCompare(b.table.nom)

export function disposer(id, graphe, options = {}) {
  const positions = new Map()
  const etiquettes = []
  const noeuds = [...graphe.noeuds]
  if (!noeuds.length) return { positions, etiquettes }
  const faire = { anneaux, autour, hierarchie, galaxies, familles, cercle, spirale, concombre }[id]
  const extra = faire?.(noeuds, graphe, positions, etiquettes, options) || {}
  return { positions, etiquettes, ...extra }
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

// ---- Anneaux : carrefours au centre, puis chaque niveau de couleur sur un anneau plus large.
function anneaux(noeuds, graphe, positions, etiquettes) {
  let r = 0
  graphe.niveaux.forEach((niveau, i) => {
    const liste = noeuds.filter((n) => n.niveau === niveau).sort(tri)
    if (!liste.length) return
    if (i === 0 && liste.length === 1) return positions.set(liste[0], { x: 0, y: 0 })
    // Départ décalé d'un demi-pas : le haut de l'anneau reste libre pour son nom.
    r = surCercle(liste, positions, r + ECART * 1.7, 0, 0, -Math.PI / 2 + Math.PI / liste.length)
    etiquettes.push({ x: 0, y: -r - 16, texte: niveau.nom })
  })
}

// ---- Autour d'une table : elle au centre, ses voisines sur un 1er anneau, les voisines des voisines ensuite.
function autour(noeuds, graphe, positions, etiquettes, { source }) {
  const centre = source || [...noeuds].sort(tri)[0]
  const distance = new Map([[centre, 0]])
  const file = [centre]
  while (file.length) {
    const n = file.shift()
    for (const v of n.voisins) if (!distance.has(v)) { distance.set(v, distance.get(n) + 1); file.push(v) }
  }
  positions.set(centre, { x: 0, y: 0 })
  etiquettes.push({ x: 0, y: -ECART * 0.9, texte: centre.table.nom })
  const angleDe = (n) => { const p = positions.get(n); return Math.atan2(p.y, p.x) }
  let r = 0
  const max = Math.max(0, ...distance.values())
  for (let d = 1; d <= max + 1; d++) {
    const liste = d <= max ? noeuds.filter((n) => distance.get(n) === d) : noeuds.filter((n) => !distance.has(n))
    if (!liste.length) continue
    // Chaque table se place du côté de celles qui l'ont amenée (moins de liens croisés).
    const cle = (n) => {
      const avant = [...n.voisins].filter((v) => positions.has(v) && distance.get(v) === d - 1)
      return avant.length ? Math.atan2(avant.reduce((s, v) => s + Math.sin(angleDe(v)), 0), avant.reduce((s, v) => s + Math.cos(angleDe(v)), 0)) : 9
    }
    const cles = new Map(liste.map((n) => [n, cle(n)]))
    liste.sort((a, b) => cles.get(a) - cles.get(b) || tri(a, b))
    r = surCercle(liste, positions, r + ECART * 2, 0, 0, d === 1 ? -Math.PI / 2 : cles.get(liste[0]) === 9 ? 0 : cles.get(liste[0]))
    if (d > max) etiquettes.push({ x: 0, y: -r - 16, texte: 'sans lien avec ' + centre.table.nom })
  }
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
