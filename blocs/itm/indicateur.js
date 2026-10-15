// Assemblage d'un indicateur de la GMAO : une « requête indicateur » (une seule valeur, AS VAL) et sa
// « requête liste » (les fiches comptées, colonnes ID, CODE, DESI1, ACTIF, et DATE_INDICATEUR en option).
//
// Les deux requêtes sont construites à partir d'UNE définition (mêmes jointures, mêmes conditions) :
// elles ne peuvent donc pas diverger, et le chiffre affiché correspond toujours à la liste ouverte.
//
// Définition (écrite par l'IA ou à la main) :
// {
//   "nom": "[Maintenance] - FI à exécuter",                     (format « [catégorie] - nom court »)
//   "table": "fi",                                               (table principale : celle de la fenêtre à ouvrir)
//   "jointures": "LEFT JOIN di ON di.ID_DI = fi.ID_DI …",        (facultatif)
//   "conditions": "fi.ID_AVANC = 8 OR fi.ID_AVANC IS NULL",      (facultatif)
//   "arborescence": true,          (ajoute la variable de filtre d'arborescence de la fenêtre, si elle existe)
//   "dateIndicateur": "fi.DATE_LIMITE",                          (facultatif)
//   "tri": "DATE_INDICATEUR DESC",                               (facultatif : ID, CODE, DESI1 ou DATE_INDICATEUR)
//   "explication": "…"
// }
//
// Les fenêtres sont déduites de la structure : toute table qui a ID_<TABLE>, <TABLE>, DESI1 et ACTIF peut
// être comptée par un indicateur (c'est la forme des fiches de la GMAO). Les variables propres à la GMAO,
// et d'éventuelles fenêtres décrites à la main, sont dans le fichier .birtec (réglage « itm »).

export const REGLAGES_VIDES = { fenetres: [], variables: [] }

const MOTS_INTERDITS = /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|CALL|HANDLER|LOAD|INTO\s+OUTFILE)\b/i

// La fenêtre désignée par son libellé ou par sa table.
export function trouverFenetre(reglages, cle) {
  const c = String(cle || '').toLowerCase()
  return reglages.fenetres.find((f) => f.libelle.toLowerCase() === c) || reglages.fenetres.find((f) => f.table.toLowerCase() === c) || null
}

// Les tables qui ont la forme d'une fiche (ID_X, X, DESI1, ACTIF), avec le nom clair du dictionnaire.
export function deduireFenetres(tables) {
  return tables
    .filter((t) => !t.exclue)
    .map((t) => {
      const noms = new Map(t.colonnes.map((c) => [c.nom.toUpperCase(), c.nom]))
      const T = t.nom.toUpperCase()
      if (!noms.has(`ID_${T}`) || !noms.has(T) || !noms.has('DESI1') || !noms.has('ACTIF')) return null
      return { libelle: t.libelle || t.nom, table: t.nom, id: noms.get(`ID_${T}`), code: noms.get(T), desi: noms.get('DESI1'), actif: noms.get('ACTIF'), deduite: true }
    })
    .filter(Boolean)
}

// Nom au format de la GMAO : « [catégorie] - nom court ».
export function formaterNom(nom) {
  const texte = String(nom || '').trim().replace(/\s+/g, ' ')
  const m = texte.match(/^\[\s*([^\]]+?)\s*\]\s*-?\s*(.+)$/)
  return m ? `[${m[1]}] - ${m[2]}` : `[Divers] - ${texte}`
}

// Remet d'aplomb les écarts habituels de l'IA, sans changer le sens de l'indicateur :
// variable d'arborescence écrite dans les conditions, tri sur une colonne au lieu de son alias.
export function normaliser(d, reglages) {
  if (!d || typeof d !== 'object') return d
  const n = { ...d }
  const f = trouverFenetre(reglages, n.table || n.fenetre)
  if (f) {
    n.table = f.table
    n.fenetre = f.libelle
  }
  if (n.nom) n.nom = formaterNom(n.nom)
  if (f?.variableArbo && String(n.conditions || '').includes(f.variableArbo)) {
    n.conditions = String(n.conditions).replace(f.variableArbo, '').replace(/^\s*AND\s+/i, '').trim()
    n.arborescence = true
  }
  if (n.dateIndicateur === 'null' || n.dateIndicateur === '') n.dateIndicateur = null
  if (n.tri) {
    const [colonne, sens = ''] = String(n.tri).trim().split(/\s+(?=ASC$|DESC$)/i)
    const alias = { [String(n.dateIndicateur || '').toLowerCase()]: 'DATE_INDICATEUR' }
    if (f) Object.assign(alias, { [`${f.table}.${f.id}`.toLowerCase()]: 'ID', [`${f.table}.${f.code}`.toLowerCase()]: 'CODE', [`${f.table}.${f.desi || 'DESI1'}`.toLowerCase()]: 'DESI1' })
    const trouve = alias[colonne.toLowerCase()] || (/^(ID|CODE|DESI1|DATE_INDICATEUR)$/i.test(colonne) ? colonne.toUpperCase() : null)
    n.tri = trouve ? `${trouve}${sens ? ` ${sens.toUpperCase()}` : ''}` : null
  }
  return n
}

// Erreurs de forme (avant tout essai sur la base).
export function verifierDefinition(d, reglages) {
  d = normaliser(d, reglages)
  const erreurs = []
  if (!d || typeof d !== 'object') return ['La définition de l’indicateur est vide.']
  if (!String(d.nom || '').trim()) erreurs.push('Il manque le nom de l’indicateur.')
  if (!trouverFenetre(reglages, d.table || d.fenetre)) erreurs.push(`Table principale inconnue ou qui n’a pas la forme d’une fiche (ID_X, X, DESI1, ACTIF) : « ${d.table || d.fenetre || '?'} ».`)
  for (const champ of ['jointures', 'conditions', 'dateIndicateur', 'tri']) {
    const texte = String(d[champ] || '')
    if (texte.includes(';')) erreurs.push(`« ${champ} » ne doit pas contenir de point-virgule.`)
    if (MOTS_INTERDITS.test(texte)) erreurs.push(`« ${champ} » contient une instruction d’écriture : interdit.`)
  }
  if (d.jointures && !/^\s*(LEFT|RIGHT|INNER|CROSS|STRAIGHT_JOIN|JOIN)\b/i.test(d.jointures)) erreurs.push('Les jointures doivent commencer par JOIN, LEFT JOIN ou INNER JOIN.')
  if (d.tri && !/^(ID|CODE|DESI1|DATE_INDICATEUR)(\s+(ASC|DESC))?$/i.test(d.tri.trim())) erreurs.push('Le tri doit porter sur ID, CODE, DESI1 ou DATE_INDICATEUR (suivi de ASC ou DESC).')
  if (d.tri && /DATE_INDICATEUR/i.test(d.tri) && !d.dateIndicateur) erreurs.push('Tri sur DATE_INDICATEUR sans dateIndicateur.')
  return erreurs
}

// Les deux requêtes, prêtes à coller dans la GMAO.
export function assembler(d, reglages) {
  d = normaliser(d, reglages)
  const f = trouverFenetre(reglages, d.table)
  // La table principale est écrite comme l'IA (ou la personne) l'a écrite ailleurs : FI ou fi.
  const t = `${d.jointures || ''} ${d.conditions || ''} ${d.dateIndicateur || ''}`.match(new RegExp(`\\b(${f.table})\\.`, 'i'))?.[1] || f.table
  const actif = f.actif || 'ACTIF'
  const conditions = String(d.conditions || '').trim().split('\n').map((l) => l.trim()).filter(Boolean).join('\n        ')
  const avertissements = []

  const filtres = []
  if (d.arborescence !== false && f.variableArbo) filtres.push(f.variableArbo)
  if (conditions) filtres.push(`(${conditions})`)
  // Sans filtre sur ACTIF, la corbeille (et les archives) seraient comptées.
  if (!new RegExp(`\\b${t}\\.${actif}\\b`, 'i').test(conditions)) {
    filtres.push(`${t}.${actif} = 1`)
    avertissements.push(`Filtre ${t}.${actif} = 1 ajouté (fiches courantes seulement).`)
  }

  const de = [`FROM ${t}`, ...String(d.jointures || '').trim().split('\n').map((l) => l.trim()).filter(Boolean).map((l) => `    ${l}`)].join('\n')
  const ou = filtres.length ? `\nWHERE\n    ${filtres.join('\n    AND ')}` : ''
  const commentaire = `-- ${String(d.nom).replace(/\n/g, ' ')}${d.explication ? `\n-- ${String(d.explication).replace(/\n/g, '\n-- ')}` : ''}`

  const requeteIndicateur = `${commentaire}\nSELECT COUNT(DISTINCT ${t}.${f.id}) AS VAL\n${de}${ou}`

  const colonnes = [`${t}.${f.id} AS ID`, `${t}.${f.code} AS CODE`, `${t}.${f.desi || 'DESI1'} AS DESI1`, `${t}.${actif} AS ACTIF`]
  if (d.dateIndicateur) colonnes.push(`${d.dateIndicateur.trim()} AS DATE_INDICATEUR`)
  const tri = (d.tri || (d.dateIndicateur ? 'DATE_INDICATEUR DESC' : 'CODE')).trim()
  const requeteListe = `${commentaire}\nSELECT DISTINCT\n    ${colonnes.join(',\n    ')}\n${de}${ou}\nORDER BY ${tri}`

  return { requeteIndicateur, requeteListe, avertissements }
}

// Remplace les variables de la GMAO par leurs valeurs d'essai, pour tester les requêtes sur MySQL.
// Dans une valeur d'essai : {debutMois} → AAAAMM01, {aujourdhui} → AAAAMMJJ, {debutAnnee} → AAAA0101.
export function remplacerVariables(sql, reglages, date = new Date()) {
  const aaaa = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const jj = String(date.getDate()).padStart(2, '0')
  const jetons = { '{debutMois}': `${aaaa}${mm}01`, '{aujourdhui}': `${aaaa}${mm}${jj}`, '{debutAnnee}': `${aaaa}0101` }
  let resultat = sql
  for (const v of reglages.variables) {
    let essai = String(v.essai ?? '1=1')
    for (const [jeton, valeur] of Object.entries(jetons)) essai = essai.replaceAll(jeton, valeur)
    // Variable écrite entre apostrophes ('{{X}}') : la valeur d'essai ne doit pas en ajouter d'autres.
    resultat = resultat.replaceAll(`'${v.nom}'`, `'${essai.replace(/^'(.*)'$/, '$1')}'`).replaceAll(v.nom, essai)
  }
  const restantes = [...new Set(resultat.match(/\{\{[A-Z0-9_]+\}\}/g) || [])]
  return { sql: resultat, restantes }
}
