// Le type d'une table, qui donne sa couleur dans la constellation et guide les chemins de jointure.
// Partagé par le serveur (chemins donnés à l'IA) et par la constellation (navigateur) : pas d'import Node ici.
//
//   principale    : un objet métier, ce qu'on veut voir (beaucoup de tables pointent vers elle, beaucoup de colonnes)
//   secondaire    : le détail rattaché à une principale
//   intermediaire : une table de liaison entre deux tables (son nom les réunit souvent : ART + MAC → articles d'une machine)
//   referentiel   : une liste de codes (types, familles…), surtout référencée
//   technique     : journaux, exports, paramètres
//
// BiRTEC devine le type ; l'administrateur peut le corriger dans le panneau de la table (gardé dans le .ktec).

// Aucune couleur proche de celles de la sélection (orange : le chemin, vert : la table choisie).
export const TYPES = [
  { id: 'principale', nom: 'Principale', ecran: '#ff5c7a', papier: '#e11d48', aide: 'Un objet métier, ce qu’on veut voir' },
  { id: 'secondaire', nom: 'Secondaire', ecran: '#3d9bff', papier: '#0066ff', aide: 'Le détail rattaché à une principale' },
  { id: 'intermediaire', nom: 'Intermédiaire', ecran: '#c45bff', papier: '#9000d8', aide: 'Une table de liaison entre deux tables' },
  { id: 'referentiel', nom: 'Référentiel', ecran: '#ece8e1', papier: '#57534e', aide: 'Une liste de codes (types, familles…)' },
  { id: 'technique', nom: 'Technique', ecran: '#8b95a7', papier: '#a3a9b4', aide: 'Journaux, exports, paramètres' },
]
export const typeParId = (id) => TYPES.find((t) => t.id === id) || TYPES[1]

// Colonnes de suivi présentes partout : elles ne disent rien de la table.
const SUIVI = /^(id_user|date_(cre|mod|export|import|inactif)|num_(export|import)|export|import|actif|ordre|position)$/i
const TECHNIQUE = /(^|_)(log|logs|histo|trace|journal|export|import|param|parametres?|config|tmp|temp|sys|old|sauv)(_|$)/i

// { types: Map(nom en minuscules → id), composees: Map(nom → Set des tables que la table de liaison réunit) }
// choisis : { nom en minuscules: id } corrigés par l'administrateur.
export function devinerTypes(tables, choisis = {}) {
  const parNom = new Map(tables.map((t) => [t.nom.toLowerCase(), t]))
  const entrants = new Map(tables.map((t) => [t.nom.toLowerCase(), new Set()]))
  for (const t of tables) {
    for (const l of t.liens) {
      const vers = l.versTable.toLowerCase()
      if (vers !== t.nom.toLowerCase() && entrants.has(vers)) entrants.get(vers).add(t.nom.toLowerCase())
    }
  }
  const types = new Map()
  const composees = new Map()
  for (const t of tables) {
    const nom = t.nom.toLowerCase()
    const cibles = [...new Set(t.liens.map((l) => l.versTable.toLowerCase()))].filter((c) => c !== nom && parNom.has(c))
    const cles = new Set(t.liens.map((l) => l.colonne.toLowerCase()))
    const propres = t.colonnes.filter((c) => !c.cle && !cles.has(c.nom.toLowerCase()) && !SUIVI.test(c.nom))
    const reunies = tablesReunies(nom, cibles)
    const nEntrants = entrants.get(nom).size
    // Une date « métier » (date de la RI, de mise en service…) : un objet qu'on suit dans le temps, pas une liste de codes.
    const dateMetier = propres.some((c) => /date|^dt_|_dt$/i.test(c.nom) || /^(date|datetime|timestamp)/i.test(c.type || ''))
    let type
    if (TECHNIQUE.test(nom) || (t.exclue && !nEntrants && !cibles.length)) type = 'technique'
    else if (reunies.size >= 2 || (cibles.length >= 2 && propres.length <= 4)) type = 'intermediaire'
    else if (nEntrants >= 3 && dateMetier && t.colonnes.length >= 10) type = 'principale'
    else if (nEntrants >= 2 && !dateMetier && cibles.length <= 3) type = 'referentiel'
    else if (cibles.length) type = 'secondaire'
    else type = nEntrants ? 'referentiel' : 'technique'
    types.set(nom, TYPES.some((x) => x.id === choisis[nom]) ? choisis[nom] : type)
    if (reunies.size >= 2) composees.set(nom, reunies)
    else if (type === 'intermediaire') composees.set(nom, new Set(cibles))
  }
  return { types, composees }
}

// Les tables qu'un nom de table de liaison réunit : « artmac » = ART(icle) + MAC(hine), « cdeart » = CDE + ART(icle).
function tablesReunies(nom, cibles) {
  const reunies = new Set()
  for (let i = 2; i <= nom.length - 2; i++) {
    const debut = nom.slice(0, i)
    const fin = nom.slice(i)
    const a = cibles.find((c) => c.startsWith(debut))
    const b = cibles.find((c) => c !== a && c.startsWith(fin))
    if (a && b) {
      reunies.add(a)
      reunies.add(b)
    }
  }
  return reunies
}

// Le coût d'un lien entre deux tables pour le plus court chemin : un lien nommé dans le dictionnaire est le chemin
// habituel du site ; une table de liaison qui réunit justement la table voisine passe avant une autre ; une table
// « fille » (ot_equipement pour ot) aussi.
export function coutLien(a, b, { nomme = false, composees = new Map() } = {}) {
  if (nomme) return 0.6
  const relie = (x, y) => composees.get(x)?.has(y)
  if (relie(a, b) || relie(b, a)) return 0.7
  if (a.startsWith(b) || b.startsWith(a)) return 0.8
  return 1
}
