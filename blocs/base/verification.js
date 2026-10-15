// Vérification d'une requête SQL écrite par l'IA, AVANT de la montrer ou de l'exécuter :
// chaque table citée existe, et chaque colonne « alias.colonne » existe dans sa table.
// Quand une colonne est introuvable, on indique les tables qui l'ont : l'IA s'en sert pour se corriger
// (ex. « ot.ID_EQUIPEMENT n'existe pas ; ID_EQUIPEMENT existe dans ot_equipement, demande_equipement… »).
//
// Ce n'est pas un analyseur SQL complet : ce qu'il ne comprend pas (sous-requêtes nommées, tables
// dérivées, fonctions), il le laisse passer plutôt que de signaler une fausse erreur.

const MOTS_SQL = new Set(`on where left right inner outer cross join natural straight_join group order having limit union
  using set select from as and or not into values case when then else end is null like in between exists`.split(/\s+/))

export function verifierSQL(sql, schema) {
  const erreurs = []
  const texte = nettoyer(sql)
  const tables = new Map(schema.tables.map((t) => [t.nom.toLowerCase(), t]))

  // Noms à ne pas contrôler : sous-requêtes nommées (WITH x AS), tables dérivées (…) AS x, base.table.
  const ignores = new Set()
  for (const m of texte.matchAll(/\bWITH\s+(?:RECURSIVE\s+)?(\w+)\s+AS\s*\(|,\s*(\w+)\s+AS\s*\(/gi)) ignores.add((m[1] || m[2]).toLowerCase())
  for (const m of texte.matchAll(/\)\s*(?:AS\s+)?(\w+)/gi)) if (!MOTS_SQL.has(m[1].toLowerCase())) ignores.add(m[1].toLowerCase())

  // Tables citées et leurs alias.
  const alias = new Map() // alias → [noms de tables]
  // « FROM a x, b y » (jointure à l'ancienne, par virgules) et « JOIN c z ».
  const references = []
  for (const m of texte.matchAll(/\bFROM\s+([\s\S]*?)(?=\b(?:WHERE|GROUP|ORDER|HAVING|LIMIT|UNION|LEFT|RIGHT|INNER|CROSS|JOIN|STRAIGHT_JOIN|NATURAL)\b|[()]|$)/gi)) {
    for (const element of m[1].split(',')) {
      const r = element.trim().match(/^(?:(\w+)\.)?(\w+)(?:\s+(?:AS\s+)?(\w+))?$/i)
      if (r) references.push(r)
    }
  }
  for (const m of texte.matchAll(/\bJOIN\s+(?:(\w+)\.)?(\w+)(?!\s*\()(?:\s+(?:AS\s+)?(\w+))?/gi)) references.push(m)
  for (const m of references) {
    const nom = m[2].toLowerCase()
    if (m[1]) ignores.add(m[1].toLowerCase()) // préfixe de base : base.table
    if (ignores.has(nom)) {
      if (m[3]) ignores.add(m[3].toLowerCase()) // alias d'une sous-requête nommée
      continue
    }
    if (!tables.has(nom)) {
      erreurs.push(`La table ${m[2]} n’existe pas.${proches(nom, [...tables.keys()])}`)
      continue
    }
    const ajouter = (a) => alias.set(a, [...new Set([...(alias.get(a) || []), nom])])
    ajouter(nom)
    if (m[3] && !MOTS_SQL.has(m[3].toLowerCase())) ajouter(m[3].toLowerCase())
  }

  // Colonnes « alias.colonne ».
  const signalees = new Set()
  for (const m of texte.matchAll(/\b(\w+)\.(\w+)\b/g)) {
    const prefixe = m[1].toLowerCase()
    const colonne = m[2]
    if (ignores.has(prefixe) || /^\d+$/.test(prefixe)) continue
    const candidates = alias.get(prefixe)
    if (!candidates) {
      // Un préfixe ni table ni alias : alias oublié ou mal écrit (ex. « e.CODE » sans « equipement e »).
      if (alias.size && !signalees.has(prefixe)) {
        signalees.add(prefixe)
        erreurs.push(`L’alias ${m[1]} (dans ${m[1]}.${colonne}) n’est défini nulle part : tables et alias de la requête : ${[...alias.keys()].join(', ')}.`)
      }
      continue
    }
    const existe = candidates.some((t) => tables.get(t).colonnes.some((c) => c.nom.toLowerCase() === colonne.toLowerCase()))
    if (existe || signalees.has(`${prefixe}.${colonne}`.toLowerCase())) continue
    signalees.add(`${prefixe}.${colonne}`.toLowerCase())
    const table = candidates[0]
    // Les tables liées à celle de l'alias d'abord (ex. ot_equipement pour ot), puis celles du dictionnaire.
    const liees = new Set([...tables.get(table).liens.map((l) => l.versTable.toLowerCase()),
      ...schema.tables.filter((t) => t.liens.some((l) => l.versTable.toLowerCase() === table)).map((t) => t.nom.toLowerCase())])
    // Une table « fille » au nom proche (ot_equipement pour ot) passe en tête.
    const rang = (t) => (t.nom.toLowerCase().startsWith(table) && liees.has(t.nom.toLowerCase()) ? -1 : liees.has(t.nom.toLowerCase()) ? 0 : t.libelle ? 1 : 2)
    const ailleurs = schema.tables
      .filter((t) => !t.exclue && t.colonnes.some((c) => c.nom.toLowerCase() === colonne.toLowerCase()))
      .sort((a, b) => rang(a) - rang(b))
      .map((t) => t.nom)
    erreurs.push(
      `La colonne ${m[1]}.${colonne} n’existe pas (table ${table}${tables.get(table).libelle ? ` « ${tables.get(table).libelle} »` : ''}).` +
        (ailleurs.length ? ` ${colonne} existe dans : ${ailleurs.slice(0, 8).join(', ')}${ailleurs.length > 8 ? '…' : ''}.` : proches(colonne.toLowerCase(), tables.get(table).colonnes.map((c) => c.nom.toLowerCase()), 'Colonnes proches dans cette table')),
    )
  }
  return erreurs
}

// Les blocs ```sql d'une réponse de l'IA, et les requêtes de ses descriptions de rapport.
export function requetesDeLaReponse(texte) {
  const requetes = []
  for (const m of String(texte).matchAll(/```(\w*)\s*\n([\s\S]*?)```/g)) {
    const langue = m[1].toLowerCase()
    if (langue === 'sql') requetes.push(m[2])
    if (langue === 'rapport' || langue === 'json') {
      try {
        const description = JSON.parse(m[2])
        if (description.requete) requetes.push(description.requete)
      } catch {
        // pas du JSON : rien à vérifier
      }
    }
  }
  return requetes
}

// Sans commentaires ni chaînes : on ne doit pas prendre « 'fi.TEST' » pour une colonne.
function nettoyer(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, "''")
    .replace(/`/g, '')
    .replace(/\{\{\w+\}\}/g, '1=1')
}

// Quelques noms qui ressemblent (même début ou contenu commun).
function proches(nom, noms, libelle = 'Noms proches') {
  const racine = nom.replace(/^id_/, '').slice(0, 4)
  const trouves = noms.filter((n) => n !== nom && racine.length >= 2 && (n.includes(racine) || nom.includes(n.replace(/^id_/, '')))).slice(0, 6)
  return trouves.length ? ` ${libelle} : ${trouves.join(', ')}.` : ''
}
