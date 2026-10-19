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
//                   'periode' (valeurs[0] : mois_en_cours, mois_precedent, annee_en_cours, 12_mois, 30_jours, demandee,
//                   ou glissante « mois:4 », « jours:15 », « semaines:2 », « ans:2 »)
//   etat: 'sans_corbeille' | 'courantes' | 'toutes',      (si le sujet a une colonne ACTIF)
//   tri: { champ, sens: 'asc'|'desc' },
//   totaux: true,
// }
// Filtre « compare » : valeurs = [opérateur (<, <=, >, >=, =, <>), id de l'autre champ] — ex. stock réel < stock mini.
// Filtre « demande » (texte) : la valeur est choisie au lancement du rapport, dans la liste des valeurs de la base
// (paramètre facultatif : vide = toutes).
// calculees: [{ libelle, a: idChamp, op: '-'|'+'|'*'|'/'|'pct'|'jours'|'heures', b: idChamp | null, valeur: nombre }]
//   (liste détaillée : colonnes calculées, ex. durée = fin − début, taux = réalisé / prévu en %)
//
// options.sansRegroupement : une synthèse sans « regrouper par » donne une seule ligne (chiffre clé).
//
// options.aliasSujet : alias de la table du sujet (par défaut t0). Pour un indicateur ITM, c'est le nom de la
// table lui-même, car les variables de la GMAO ({{ARBO_FILTRE_…}}) s'écrivent avec ce nom.

const FORMAT_PAR_NATURE = { nombre: 'decimal', date: 'date', date8: 'date', texte: 'texte' }

export function construire(etat, catalogue, { aliasSujet = 't0', sansRegroupement = false } = {}) {
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

  // Valeur utilisée dans un calcul : une date AAAAMMJJ devient une vraie date.
  const valeurCalcul = (id) => affichage(id)
  // Nom de paramètre BIRT tiré du nom du champ (« Ligne » → p_ligne).
  const nomParametre = (libelle) => `p_${String(libelle).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'valeur'}`

  // --- filtres
  const conditions = []
  const parametres = []
  const liaisons = []
  const colSujet = catalogue.champs.find((c) => c.chemin === '' && c.colonne.toUpperCase() === 'ACTIF')
  if (colSujet && etat.etat !== 'toutes') conditions.push(etat.etat === 'courantes' ? `${aliasSujet}.${colSujet.colonne} = 1` : `${aliasSujet}.${colSujet.colonne} <> 0`)

  // Une condition (une ligne de filtre) → son SQL, ou null si elle est incomplète. Les paramètres qu'elle crée
  // sont notés dans l'ordre où leurs « ? » apparaîtront dans la requête.
  const conditionDe = (f) => {
    const c = champs.get(f.champ)
    if (!c) return null
    const e = expression(f.champ)
    const v = (f.valeurs || []).filter((x) => x !== '' && x !== null && x !== undefined)
    const litteral = (x) => (c.nature === 'nombre' && !isNaN(Number(x)) ? String(Number(x)) : `'${String(x).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`)
    switch (f.operateur) {
      case 'egal':
        if (v.length) return (v.length === 1 ? `${e} = ${litteral(v[0])}` : `${e} IN (${v.map(litteral).join(', ')})`)
        break
      case 'different':
        if (v.length) return `(${e} IS NULL OR ${e} NOT IN (${v.map(litteral).join(', ')}))`
        break
      case 'contient':
        if (v.length) return `${e} LIKE ${litteral(`%${v[0]}%`)}`
        break
      case 'commence':
        if (v.length) return `${e} LIKE ${litteral(`${v[0]}%`)}`
        break
      case 'compare': {
        // Comparaison avec une autre colonne (ex. stock réel < stock minimum, date de fin > date limite).
        const op = ['<', '<=', '>', '>=', '=', '<>'].includes(f.valeurs?.[0]) ? f.valeurs[0] : '<'
        if (f.valeurs?.[1] && champs.has(f.valeurs[1])) return `${e} ${op} ${expression(f.valeurs[1])}`
        break
      }
      case 'vide':
        return `(${e} IS NULL OR ${e} = '')`
        break
      case 'non_vide':
        return `(${e} IS NOT NULL AND ${e} <> '')`
        break
      case '>=':
      case '<=':
        if (v.length) return `${e} ${f.operateur} ${litteral(dateSaisie(v[0], c))}`
        break
      case 'entre':
        if (v.length === 2) return `${e} BETWEEN ${litteral(dateSaisie(v[0], c))} AND ${litteral(dateSaisie(v[1], c))}`
        break
      case 'demande': {
        // Valeur choisie au lancement, dans la liste des valeurs existantes ; vide = toutes.
        // « Désignation » d'une table liée : c'est la table qui parle (« Type de maintenance »).
        const groupe = c.groupe.split(' › ').at(-1)
        const libelle = c.niveau && /^(d[ée]signation|code)/i.test(c.libelle) ? groupe.charAt(0).toUpperCase() + groupe.slice(1) : c.niveau ? `${c.libelle} (${groupe})` : c.libelle
        const nom = nomParametre(libelle)
        if (!parametres.some((p) => p.nom === nom)) {
          const liste = construire({ sujet, mode: 'liste', champs: [f.champ], filtres: [], etat: 'toutes' }, catalogue)
          const colonne = liste.colonnes[0]?.champ
          parametres.push({
            nom, libelle, type: 'texte', defaut: '', optionnel: true,
            liste: { requete: `SELECT DISTINCT ${colonne} AS valeur FROM (${liste.sql}) AS l WHERE ${colonne} IS NOT NULL AND ${colonne} <> '' ORDER BY 1` },
          })
        }
        liaisons.push(nom, nom)
        return `(? = '' OR ${e} = ?)`
        break
      }
      case 'periode': {
        const periode = v[0] || 'mois_en_cours'
        if (periode === 'demandee') {
          // Période choisie au lancement du rapport : deux paramètres BIRT de type date (un calendrier pour choisir).
          // Une date rangée en AAAAMMJJ est comparée à la date choisie mise au même format.
          const debut = { nom: 'debut', libelle: 'Du', type: 'date', defaut: premierDuMois(true) }
          const fin = { nom: 'fin', libelle: 'Au', type: 'date', defaut: aujourdhui(true) }
          if (!parametres.some((p) => p.nom === 'debut')) parametres.push(debut, fin)
          const marque = c.nature === 'date' ? '?' : "DATE_FORMAT(?, '%Y%m%d')"
          liaisons.push('debut', 'fin')
          return `${e} >= ${marque} AND ${e} <= ${marque}`
        } else {
          return conditionPeriode(e, periode, c.nature)
        }
        break
      }
    }
    return null
  }

  // Conditions liées par ET / OU, et groupes entre parenthèses (en cascade) :
  // filtres = [{ champ, operateur, valeurs, lien }, { groupe: [ … ], lien }], lien = 'et' | 'ou' avec l'élément précédent.
  // Comme à la lecture, ET passe avant OU : « A et B ou C » = (A et B) ou C ; un groupe change cet ordre.
  const combiner = (liste) => {
    const morceaux = []
    for (const f of liste || []) {
      const sql = Array.isArray(f.groupe) ? combiner(f.groupe) : conditionDe(f)
      if (sql) morceaux.push(`${morceaux.length ? (f.lien === 'ou' ? ' OR ' : ' AND ') : ''}(${sql})`)
    }
    return morceaux.length ? morceaux.join('') : null
  }
  const filtres = combiner(etat.filtres)
  if (filtres) conditions.push((etat.filtres || []).some((f) => f.lien === 'ou' || Array.isArray(f.groupe)) ? `(${filtres})` : filtres)

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
    if (!dimensions.length && !sansRegroupement) erreurs.push('Synthèse : choisissez au moins un « regrouper par ».')
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
    // Colonnes calculées : une opération entre deux champs (ou un champ et un nombre).
    for (const k of etat.calculees || []) {
      const a = champs.get(k.a)
      const b = k.b ? champs.get(k.b) : null
      if (!a || (k.b && !b)) continue
      const ea = valeurCalcul(k.a)
      const eb = b ? valeurCalcul(k.b) : String(Number(k.valeur) || 0)
      const sql = {
        '-': `(${ea} - ${eb})`,
        '+': `(${ea} + ${eb})`,
        '*': `(${ea} * ${eb})`,
        '/': `ROUND(${ea} / NULLIF(${eb}, 0), 2)`,
        pct: `ROUND(100 * ${ea} / NULLIF(${eb}, 0), 1)`,
        jours: `DATEDIFF(${ea}, ${eb})`,
        heures: `ROUND(TIMESTAMPDIFF(MINUTE, ${eb}, ${ea}) / 60, 2)`,
      }[k.op]
      if (!sql) continue
      const libelle = k.libelle || `${a.libelle} ${k.op} ${b ? b.libelle : k.valeur}`
      const nom = aliasDe(libelle)
      select.push(`${sql} AS ${nom}`)
      colonnesRapport.push({ champ: nom, libelle, format: k.op === 'jours' ? 'entier' : 'decimal', total: etat.totaux !== false && !['pct', '/'].includes(k.op) ? 'somme' : undefined })
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
  // date(expression SQL d'une date, format aaaa-mm-jj) → la même date au format de la colonne.
  const date = (expression) => (nature === 'date' ? expression : `DATE_FORMAT(${expression}, '%Y%m%d')`)
  // Premier jour du mois ou de l'année, écrit directement au format de la colonne.
  const debutMois = (decalage = '') => (nature === 'date' ? `DATE_FORMAT(CURDATE()${decalage}, '%Y-%m-01')` : `DATE_FORMAT(CURDATE()${decalage}, '%Y%m01')`)
  const debutAnnee = nature === 'date' ? "DATE_FORMAT(CURDATE(), '%Y-01-01')" : "DATE_FORMAT(CURDATE(), '%Y0101')"
  const aujourdhui = date('CURDATE()')
  // Période glissante : « mois:4 » = les 4 derniers mois, jusqu'à aujourd'hui (de même jours, semaines, ans).
  const glissante = /^(jours|semaines|mois|ans):(\d+)$/.exec(periode)
  if (glissante) {
    const unite = { jours: 'DAY', semaines: 'WEEK', mois: 'MONTH', ans: 'YEAR' }[glissante[1]]
    return `${e} >= ${date(`CURDATE() - INTERVAL ${Number(glissante[2])} ${unite}`)} AND ${e} <= ${aujourdhui}`
  }
  switch (periode) {
    case 'mois_precedent':
      return `${e} >= ${debutMois(' - INTERVAL 1 MONTH')} AND ${e} < ${debutMois()}`
    case 'annee_en_cours':
      return `${e} >= ${debutAnnee} AND ${e} <= ${aujourdhui}`
    case '12_mois':
      return `${e} >= ${date('CURDATE() - INTERVAL 12 MONTH')} AND ${e} <= ${aujourdhui}`
    case '30_jours':
      return `${e} >= ${date('CURDATE() - INTERVAL 30 DAY')} AND ${e} <= ${aujourdhui}`
    case 'depassee': // date passée (ex. date limite dépassée = en retard)
      return `${e} IS NOT NULL ${nature === 'date' ? '' : `AND ${e} <> '' `}AND ${e} < ${aujourdhui}`
    case 'a_venir':
      return `${e} >= ${aujourdhui}`
    default: // mois en cours
      return `${e} >= ${debutMois()} AND ${e} <= ${aujourdhui}`
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
