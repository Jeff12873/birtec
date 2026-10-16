// Construction de la requête et de la description du rapport à partir des choix du formulaire.
// C'est BiRTEC qui écrit le SQL (pas l'IA) : les jointures viennent des chemins du catalogue.
//
// État du formulaire :
// {
//   sujet: 'ri',
//   mode: 'liste' | 'synthese',
//   champs: [idChamp…],                                  (liste : colonnes affichées)
//   regroupements: [{ champ, par: 'valeur'|'jour'|'mois'|'annee' }],   (liste : groupes ; synthèse : « par »)
//   mesures: [{ fonction: 'nombre'|'somme'|'moyenne'|'min'|'max', champ }],   (synthèse)
//   filtres: [{ champ, operateur, valeurs: [] }],
//      operateurs : 'egal' (une des valeurs), 'contient', 'commence', 'vide', 'non_vide', '>=', '<=', 'entre',
//                   'periode' (valeurs[0] : mois_en_cours, mois_precedent, annee_en_cours, 12_mois, 30_jours, demandee)
//   etat: 'sans_corbeille' | 'courantes' | 'toutes',      (si le sujet a une colonne ACTIF)
//   tri: { champ, sens: 'asc'|'desc' },
//   totaux: true,
// }
// Filtre « compare » : valeurs = [opérateur (<, <=, >, >=, =, <>), id de l'autre champ] — ex. stock réel < stock mini.
//
// options.aliasSujet : alias de la table du sujet (par défaut t0). Pour un indicateur ITM, c'est le nom de la
// table lui-même, car les variables de la GMAO ({{ARBO_FILTRE_…}}) s'écrivent avec ce nom.

const FORMAT_PAR_NATURE = { nombre: 'decimal', date: 'date', date8: 'date', texte: 'texte' }

export function construire(etat, catalogue, { aliasSujet = 't0' } = {}) {
  const champs = new Map(catalogue.champs.map((c) => [c.id, c]))
  const erreurs = []
  const sujet = catalogue.sujet.table

  // Alias de table : t0 (ou le nom de la table) pour le sujet, puis un alias par chemin utilisé.
  const alias = new Map([['', aliasSujet]])
  const jointures = []
  const joindre = (cle) => {
    if (alias.has(cle)) return alias.get(cle)
    const etapes = catalogue.chemins[cle]
    let precedent = ''
    for (let i = 0; i < etapes.length; i++) {
      const e = etapes[i]
      const cleEtape = cleJusqua(cle, i)
      if (!alias.has(cleEtape)) {
        const a = `t${alias.size}`  // t1, t2… (le sujet occupe la première place)
        const aPrec = alias.get(precedent)
        const sur = e.sens === 'parent' ? `${a}.${e.versColonne} = ${aPrec}.${e.colonne}` : `${a}.${e.colonne} = ${aPrec}.${e.versColonne}`
        jointures.push(`LEFT JOIN ${e.table} ${a} ON ${sur}`)
        alias.set(cleEtape, a)
      }
      precedent = cleEtape
    }
    return alias.get(cle)
  }
  const expression = (id) => {
    const c = champs.get(id)
    if (!c) {
      erreurs.push(`Champ inconnu : ${id}`)
      return 'NULL'
    }
    return `${joindre(c.chemin)}.${c.colonne}`
  }
  // Valeur affichée : une date AAAAMMJJ devient une vraie date (format jj/mm/aaaa dans le rapport).
  const affichage = (id) => {
    const c = champs.get(id)
    const e = expression(id)
    return c?.nature === 'date8' ? `STR_TO_DATE(NULLIF(${e}, ''), '%Y%m%d')` : e
  }

  // --- filtres
  const conditions = []
  const parametres = []
  const liaisons = []
  const colSujet = catalogue.champs.find((c) => c.chemin === '' && c.colonne.toUpperCase() === 'ACTIF')
  if (colSujet && etat.etat !== 'toutes') conditions.push(etat.etat === 'courantes' ? `${aliasSujet}.${colSujet.colonne} = 1` : `${aliasSujet}.${colSujet.colonne} <> 0`)

  for (const f of etat.filtres || []) {
    const c = champs.get(f.champ)
    if (!c) continue
    const e = expression(f.champ)
    const v = (f.valeurs || []).filter((x) => x !== '' && x !== null && x !== undefined)
    const litteral = (x) => (c.nature === 'nombre' && !isNaN(Number(x)) ? String(Number(x)) : `'${String(x).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`)
    switch (f.operateur) {
      case 'egal':
        if (v.length) conditions.push(v.length === 1 ? `${e} = ${litteral(v[0])}` : `${e} IN (${v.map(litteral).join(', ')})`)
        break
      case 'different':
        if (v.length) conditions.push(`(${e} IS NULL OR ${e} NOT IN (${v.map(litteral).join(', ')}))`)
        break
      case 'contient':
        if (v.length) conditions.push(`${e} LIKE ${litteral(`%${v[0]}%`)}`)
        break
      case 'commence':
        if (v.length) conditions.push(`${e} LIKE ${litteral(`${v[0]}%`)}`)
        break
      case 'compare': {
        // Comparaison avec une autre colonne (ex. stock réel < stock minimum, date de fin > date limite).
        const op = ['<', '<=', '>', '>=', '=', '<>'].includes(f.valeurs?.[0]) ? f.valeurs[0] : '<'
        if (f.valeurs?.[1] && champs.has(f.valeurs[1])) conditions.push(`${e} ${op} ${expression(f.valeurs[1])}`)
        break
      }
      case 'vide':
        conditions.push(`(${e} IS NULL OR ${e} = '')`)
        break
      case 'non_vide':
        conditions.push(`(${e} IS NOT NULL AND ${e} <> '')`)
        break
      case '>=':
      case '<=':
        if (v.length) conditions.push(`${e} ${f.operateur} ${litteral(dateSaisie(v[0], c))}`)
        break
      case 'entre':
        if (v.length === 2) conditions.push(`${e} BETWEEN ${litteral(dateSaisie(v[0], c))} AND ${litteral(dateSaisie(v[1], c))}`)
        break
      case 'periode': {
        const periode = v[0] || 'mois_en_cours'
        if (periode === 'demandee') {
          // Période choisie au lancement du rapport : deux paramètres BIRT.
          const type = c.nature === 'date' ? 'date' : 'texte'
          const debut = { nom: 'debut', libelle: 'Du', type, defaut: type === 'date' ? premierDuMois(true) : premierDuMois(false) }
          const fin = { nom: 'fin', libelle: 'Au', type, defaut: type === 'date' ? aujourdhui(true) : aujourdhui(false) }
          if (!parametres.some((p) => p.nom === 'debut')) parametres.push(debut, fin)
          conditions.push(`${e} >= ? AND ${e} <= ?`)
          liaisons.push('debut', 'fin')
        } else {
          conditions.push(conditionPeriode(e, periode, c.nature))
        }
        break
      }
    }
  }

  // --- colonnes
  const colonnesRapport = []
  const select = []
  const groupesRapport = []
  const nomsPris = new Set()
  const aliasDe = (texte) => {
    let base = String(texte).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'colonne'
    if (/^\d/.test(base)) base = `c_${base}`
    let nom = base
    for (let i = 2; nomsPris.has(nom); i++) nom = `${base}_${i}`
    nomsPris.add(nom)
    return nom
  }
  const libelleDe = (c) => (c.niveau ? `${c.libelle} (${c.groupe.split(' › ').at(-1)})` : c.libelle)
  const valeurGroupe = (g) => {
    const c = champs.get(g.champ)
    const e = affichage(g.champ)
    if (c && (c.nature === 'date' || c.nature === 'date8')) {
      if (g.par === 'mois') return { sql: `DATE_FORMAT(${e}, '%Y-%m')`, libelle: `${c.libelle} (mois)`, format: 'texte' }
      if (g.par === 'annee') return { sql: `YEAR(${e})`, libelle: `${c.libelle} (année)`, format: 'texte' }
    }
    return { sql: e, libelle: c ? libelleDe(c) : g.champ, format: c ? FORMAT_PAR_NATURE[c.nature] : 'texte' }
  }

  let groupBy = ''
  let orderBy = []
  if (etat.mode === 'synthese') {
    const dimensions = (etat.regroupements || []).filter((g) => champs.has(g.champ))
    if (!dimensions.length) erreurs.push('Synthèse : choisissez au moins un « regrouper par ».')
    const sqlDimensions = []
    for (const g of dimensions) {
      const v = valeurGroupe(g)
      const nom = aliasDe(v.libelle)
      select.push(`${v.sql} AS ${nom}`)
      sqlDimensions.push(v.sql)
      colonnesRapport.push({ champ: nom, libelle: v.libelle, format: v.format === 'decimal' ? 'decimal' : v.format })
    }
    const mesures = (etat.mesures || []).length ? etat.mesures : [{ fonction: 'nombre' }]
    for (const m of mesures) {
      const c = champs.get(m.champ)
      let sql
      let libelle
      if (m.fonction === 'nombre' || !c) {
        sql = `COUNT(DISTINCT ${aliasSujet}.${catalogue.champs.find((x) => x.chemin === '' && x.colonne.toUpperCase() === `ID_${sujet.toUpperCase()}`)?.colonne || 'ID'})`
        // « Rapport d’intervention (intervention réalisée) » → « Nombre de rapports d’intervention »
        const court = catalogue.sujet.libelle.replace(/\s*\(.*\)\s*$/, '').toLowerCase()
        libelle = `Nombre de ${court.replace(/^(\S+?)(?<![sx])(\s|$)/, '$1s$2')}`.slice(0, 60)
      } else {
        const fn = { somme: 'SUM', moyenne: 'AVG', min: 'MIN', max: 'MAX' }[m.fonction] || 'SUM'
        sql = `ROUND(${fn}(${expression(m.champ)}), 2)`
        libelle = `${{ somme: 'Total', moyenne: 'Moyenne', min: 'Minimum', max: 'Maximum' }[m.fonction] || 'Total'} ${c.libelle.toLowerCase()}`
      }
      const nom = aliasDe(libelle)
      select.push(`${sql} AS ${nom}`)
      colonnesRapport.push({ champ: nom, libelle, format: m.fonction === 'nombre' || !c ? 'entier' : 'decimal', total: etat.totaux === false ? undefined : m.fonction === 'moyenne' ? 'moyenne' : m.fonction === 'min' ? 'min' : m.fonction === 'max' ? 'max' : 'somme' })
    }
    if (sqlDimensions.length) groupBy = `GROUP BY ${sqlDimensions.join(', ')}`
    orderBy = etat.tri?.champ === '__mesure' ? [`${colonnesRapport.at(-1).champ} ${etat.tri.sens === 'asc' ? 'ASC' : 'DESC'}`] : sqlDimensions.map((d) => d)
  } else {
    const groupes = (etat.regroupements || []).filter((g) => champs.has(g.champ))
    for (const g of groupes) {
      const v = valeurGroupe(g)
      const nom = aliasDe(v.libelle)
      select.push(`${v.sql} AS ${nom}`)
      groupesRapport.push({ champ: nom, libelle: v.libelle, sousTotaux: true })
      orderBy.push(v.sql)
    }
    const affiches = (etat.champs || []).filter((id) => champs.has(id))
    if (!affiches.length) erreurs.push('Choisissez au moins une colonne à afficher.')
    for (const id of affiches) {
      const c = champs.get(id)
      const nom = aliasDe(libelleDe(c))
      select.push(`${affichage(id)} AS ${nom}`)
      colonnesRapport.push({ champ: nom, libelle: libelleDe(c), format: FORMAT_PAR_NATURE[c.nature], total: etat.totaux !== false && c.nature === 'nombre' ? 'somme' : undefined })
    }
    if (etat.tri?.champ && champs.has(etat.tri.champ)) orderBy.push(`${affichage(etat.tri.champ)} ${etat.tri.sens === 'desc' ? 'DESC' : 'ASC'}`)
  }

  const de = `FROM ${sujet}${aliasSujet === sujet ? '' : ` ${aliasSujet}`}${jointures.length ? `\n${jointures.join('\n')}` : ''}`
  const ou = conditions.length ? `\nWHERE ${conditions.join('\n  AND ')}` : ''
  const sql = `SELECT\n  ${select.join(',\n  ')}\n${de}${ou}${groupBy ? `\n${groupBy}` : ''}${orderBy.length ? `\nORDER BY ${orderBy.join(', ')}` : ''}`
  const multiplie = [...alias.keys()].some((cle) => catalogue.chemins[cle]?.some((e) => e.sens === 'fille'))

  return {
    erreurs,
    sql,
    parametres,
    liaisons,
    colonnes: colonnesRapport,
    groupes: groupesRapport,
    avertissements: multiplie && etat.mode !== 'synthese' ? ['Une table « fille » est utilisée : un même élément peut apparaître sur plusieurs lignes (une par élément lié).'] : [],
  }
}

// Clé du chemin jusqu'à l'étape i (les clés sont des suites « >col:table » ou « <col:table »).
function cleJusqua(cle, i) {
  const morceaux = cle.match(/[<>][^<>]+/g) || []
  return morceaux.slice(0, i + 1).join('')
}

function conditionPeriode(e, periode, nature) {
  // Dates AAAAMMJJ : comparaisons de textes ; vraies dates : comparaisons de dates.
  const f = nature === 'date' ? (x) => x : (x) => `DATE_FORMAT(${x}, '%Y%m%d')`
  const fin = f('CURDATE()')
  switch (periode) {
    case 'mois_precedent':
      return `${e} >= ${f("DATE_FORMAT(CURDATE() - INTERVAL 1 MONTH, '%Y-%m-01')")} AND ${e} < ${f("DATE_FORMAT(CURDATE(), '%Y-%m-01')")}`
    case 'annee_en_cours':
      return `${e} >= ${f("DATE_FORMAT(CURDATE(), '%Y-01-01')")} AND ${e} <= ${fin}`
    case '12_mois':
      return `${e} >= ${f('CURDATE() - INTERVAL 12 MONTH')} AND ${e} <= ${fin}`
    case '30_jours':
      return `${e} >= ${f('CURDATE() - INTERVAL 30 DAY')} AND ${e} <= ${fin}`
    case 'depassee': // date passée (ex. date limite dépassée = en retard)
      return `${e} IS NOT NULL ${nature === 'date' ? '' : `AND ${e} <> '' `}AND ${e} < ${fin}`
    case 'a_venir':
      return `${e} >= ${fin}`
    default: // mois en cours
      return `${e} >= ${f("DATE_FORMAT(CURDATE(), '%Y-%m-01')")} AND ${e} <= ${fin}`
  }
}

// Une date saisie (aaaa-mm-jj) mise au format de la colonne.
function dateSaisie(valeur, c) {
  if (c.nature === 'date8') return String(valeur).replace(/-/g, '')
  return valeur
}

function premierDuMois(iso) {
  const d = new Date()
  const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  return iso ? t : t.replace(/-/g, '')
}

function aujourdhui(iso) {
  const d = new Date()
  const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return iso ? t : t.replace(/-/g, '')
}
