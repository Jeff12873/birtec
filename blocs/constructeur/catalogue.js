// Catalogue du constructeur de rapports : les sujets possibles (tables « fiches ») et, pour un sujet, tous
// les champs qu'on peut afficher ou filtrer, avec les jointures pour les atteindre.
//
// Les champs viennent de la table du sujet et des tables qu'on atteint en suivant les liens :
//   - vers une table « parente » (une colonne ID_X du sujet → table X) : sans risque, une ligne reste une ligne ;
//   - vers une table « fille » (une table qui pointe vers le sujet, ex. ses équipements) : une seule fois,
//     et les lignes se multiplient (une ligne par élément de la table fille) — c'est signalé.
// Les noms affichés sont ceux du dictionnaire (fichier .ktec) : noms clairs des tables, colonnes et liens.

const PROFONDEUR = 3
const TECHNIQUES = /^(ID_USER|ID_SOCIETE|DATE_EXPORT|EXPORT|NUM_EXPORT|DATE_IMPORT|IMPORT|NUM_IMPORT|DATE_INACTIF|IDENTNAVIRE|DATE_MOD|HEURE_CRE)$/i

// Les tables qui ont la forme d'une fiche (ID_X, X, DESI1) : ce sont les sujets possibles d'un rapport.
export function sujets(schema) {
  return schema.tables
    .filter((t) => !t.exclue)
    .filter((t) => {
      const noms = new Set(t.colonnes.map((c) => c.nom.toUpperCase()))
      const T = t.nom.toUpperCase()
      return noms.has(`ID_${T}`) && (noms.has(T) || noms.has('DESI1'))
    })
    .map((t) => ({ table: t.nom, libelle: t.libelle || t.nom, description: t.description || '', decrite: Boolean(t.libelle), liens: t.liens.length }))
    .sort((a, b) => b.decrite - a.decrite || a.libelle.localeCompare(b.libelle, 'fr'))
}

// Nature d'une colonne : nombre, date (vraie date), date8 (texte AAAAMMJJ, courant dans les GMAO), texte.
export function nature(colonne) {
  const type = String(colonne.type || '').toLowerCase()
  const taille = Number(colonne.taille || type.match(/\((\d+)\)/)?.[1] || 0)
  if (/^(date|datetime|timestamp)/.test(type)) return 'date'
  if (/char/.test(type) && taille === 8 && /^DATE/i.test(colonne.nom)) return 'date8'
  if (/int|decimal|double|float|numeric|real/.test(type) && !/^ID_/i.test(colonne.nom)) return 'nombre'
  return 'texte'
}

// Tous les champs atteignables depuis la table du sujet.
export function champsDuSujet(schema, sujet) {
  const parNom = new Map(schema.tables.filter((t) => !t.exclue || t.nom === sujet).map((t) => [t.nom.toLowerCase(), t]))
  const depart = parNom.get(String(sujet).toLowerCase())
  if (!depart) return { sujet: null, champs: [] }

  // Tables filles : celles qui ont un lien vers le sujet.
  const filles = [...parNom.values()].flatMap((t) => t.liens.filter((l) => l.versTable.toLowerCase() === depart.nom.toLowerCase() && t !== depart).map((l) => ({ table: t, lien: l })))

  // Parcours par coût croissant : chaque « chemin » est une suite de jointures depuis le sujet. Un lien
  // nommé dans le dictionnaire coûte moins, une table fille un peu plus. Pour chaque table atteinte par une
  // colonne donnée (ex. un équipement et sa ligne de production, atteints par deux colonnes différentes), seul le meilleur chemin est gardé.
  const coutLien = (l, versFille) => (l.libelle ? 0.6 : 1) + (versFille ? 0.4 : 0)
  const chemins = []
  const aTraiter = [{ cle: '', table: depart, etapes: [], noms: [], multiplie: false, cout: 0 }]
  const pris = new Set()
  while (aTraiter.length && chemins.length < 250) {
    aTraiter.sort((x, y) => x.cout - y.cout)
    const c = aTraiter.shift()
    const derniere = c.etapes.at(-1)
    const marque = derniere ? `${c.table.nom}|${derniere.colonne}`.toLowerCase() : ''
    // Les liens directs du sujet sont tous gardés (deux personnes différentes, par exemple).
    if (derniere && c.etapes.length > 1 && pris.has(marque)) continue
    pris.add(marque)
    chemins.push(c)
    if (c.etapes.length >= PROFONDEUR) continue
    const traversees = new Set([depart.nom.toLowerCase(), ...c.etapes.map((e) => e.table.toLowerCase())])
    // Vers les tables parentes.
    for (const l of c.table.liens) {
      const cible = parNom.get(l.versTable.toLowerCase())
      if (!cible || traversees.has(cible.nom.toLowerCase())) continue
      // Au-delà du premier niveau, seulement les tables décrites dans le dictionnaire (sinon : trop de bruit).
      if (c.etapes.length >= 1 && !cible.libelle && !l.libelle) continue
      // Nom du lien : celui du dictionnaire, sinon celui de la colonne (« Responsable »), sinon la table visée.
      const colonneLien = c.table.colonnes.find((x) => x.nom === l.colonne)
      aTraiter.push({
        cle: `${c.cle}>${l.colonne}:${cible.nom}`,
        table: cible,
        etapes: [...c.etapes, { table: cible.nom, de: c.cle, colonne: l.colonne, versColonne: l.versColonne, sens: 'parent' }],
        noms: [...c.noms, l.libelle || colonneLien?.libelle || cible.libelle || cible.nom],
        multiplie: c.multiplie,
        cout: c.cout + coutLien(l, false),
      })
    }
    // Vers les tables filles : seulement depuis le sujet, et seulement celles qui sont décrites.
    if (c.etapes.length === 0) {
      // Une table fille déjà jointe comme parente (ex. la demande d'origine) n'est pas proposée deux fois.
      const parentes = new Set(depart.liens.map((l) => l.versTable.toLowerCase()))
      for (const { table, lien } of filles.filter((f) => (f.table.libelle || f.lien.libelle) && !parentes.has(f.table.nom.toLowerCase()))) {
        aTraiter.push({
          cle: `<${lien.colonne}:${table.nom}`,
          table,
          etapes: [{ table: table.nom, de: '', colonne: lien.colonne, versColonne: lien.versColonne, sens: 'fille' }],
          noms: [lien.libelle || table.libelle || table.nom],
          multiplie: true,
          cout: coutLien(lien, true),
        })
      }
    }
  }

  const champs = []
  for (const c of chemins) {
    const t = c.table
    const T = t.nom.toUpperCase()
    const groupe = c.etapes.length ? c.noms.join(' › ') : t.libelle || t.nom
    // Une colonne de lien (ex. ID_TYPE_MAINT) n'est pas proposée : la table visée offre ses champs lisibles.
    const deLien = new Set(t.liens.map((l) => l.colonne.toUpperCase()))
    for (const col of t.colonnes) {
      if (TECHNIQUES.test(col.nom)) continue
      const N = col.nom.toUpperCase()
      if (deLien.has(N) && N !== `ID_${T}`) continue
      // Sujet : toutes ses colonnes utiles. Tables jointes : colonnes décrites, code, désignation, dates.
      const utile = !c.etapes.length
        ? !/^ID_/.test(N) || N === `ID_${T}`
        : Boolean(col.libelle) || N === T || N === 'DESI1'
      if (!utile) continue
      champs.push({
        id: `${c.cle}.${col.nom}`,
        chemin: c.cle,
        table: t.nom,
        colonne: col.nom,
        libelle: col.libelle || libelleParDefaut(col.nom, t),
        groupe,
        nature: nature(col),
        decrit: Boolean(col.libelle),
        niveau: c.etapes.length,
        multiplie: c.multiplie,
      })
    }
  }
  // Le sujet d'abord, puis les tables du premier niveau (décrites d'abord), puis le reste.
  champs.sort((a, b) => a.niveau - b.niveau || (a.niveau ? b.decrit - a.decrit : 0))
  return { sujet: { table: depart.nom, libelle: depart.libelle || depart.nom }, champs, chemins: Object.fromEntries(chemins.map((c) => [c.cle, c.etapes])) }
}

function libelleParDefaut(colonne, table) {
  const N = colonne.toUpperCase()
  if (N === table.nom.toUpperCase()) return 'Code'
  if (N === 'DESI1') return 'Désignation'
  if (N === 'DESI2') return 'Désignation 2'
  if (N === `ID_${table.nom.toUpperCase()}`) return 'Identifiant'
  if (N === 'ACTIF') return 'État (actif)'
  if (N === 'DATE_CRE') return 'Date de création'
  return colonne
}
