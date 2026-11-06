// « Charger un .rptdesign » : d'un rapport BIRT, retrouver la phrase de la constellation.
//   - un rapport fait par LA PHRASE porte sa phrase dans un commentaire (birtec-phrase) : reprise telle quelle ;
//   - sinon, la requête du premier jeu de données est lue : tables (FROM, JOIN) → chemin, conditions simples du
//     WHERE → conditions de la phrase, ORDER BY → tri, colonnes du SELECT → colonnes montrées. Ce qui ne se traduit
//     pas (paramètre « ? », OU, sous-requête, calcul…) est rendu à part, pour que l'utilisateur le refasse.
//   - une requête « enveloppe » (SELECT X.*, … FROM ( SELECT … ) X LEFT JOIN ( … ) TOT ON …) : la requête du dedans
//     est lue, et ce qui est ajouté autour (totaux, colonnes de tri) est listé.

import { formatDate } from './serveur.js'

const tableDe = (schema, nom) => schema.tables.find((t) => t.nom.toLowerCase() === String(nom || '').toLowerCase())
const colonneDe = (table, nom) => table?.colonnes.find((c) => c.nom.toLowerCase() === String(nom || '').toLowerCase())

const entites = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&')

// { phrase } (embarquée) ou { requetes: [sql…] } : les requêtes des jeux de données, dans l'ordre du fichier.
export function lireRptdesign(xml) {
  const embarquee = xml.match(/<!--\s*birtec-phrase:([A-Za-z0-9+/=]+)\s*-->/)
  if (embarquee) {
    try {
      return { phrase: JSON.parse(Buffer.from(embarquee[1], 'base64').toString('utf8')) }
    } catch {}
  }
  const requetes = []
  for (const m of xml.matchAll(/<(xml-property|property) name="queryText">([\s\S]*?)<\/\1>/g)) {
    const brut = m[2].trim()
    const sql = brut.startsWith('<![CDATA[') ? brut.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>') : entites(brut)
    if (sql.trim()) requetes.push(sql.trim())
  }
  return { requetes }
}

// ---------------------------------------------------------------- découpage du SQL

const sansCommentaires = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')

// Découpe au niveau 0 (hors parenthèses et apostrophes) selon une expression des séparateurs.
function decouper(texte, separateur) {
  const morceaux = []
  let profondeur = 0
  let chaine = false
  let debut = 0
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]
    if (c === "'") { chaine = !chaine; continue }
    if (chaine) continue
    if (c === '(') profondeur++
    else if (c === ')') profondeur--
    else if (profondeur === 0) {
      const m = texte.slice(i).match(separateur)
      if (m && m.index === 0 && (i === 0 || /[\s,)]/.test(texte[i - 1]) || separateur.source.startsWith(','))) {
        morceaux.push(texte.slice(debut, i))
        i += m[0].length - 1
        debut = i + 1
      }
    }
  }
  morceaux.push(texte.slice(debut))
  return morceaux.map((x) => x.trim()).filter(Boolean)
}

// Les clauses de premier niveau : SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT.
function clauses(sql) {
  const mots = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT']
  const morceaux = {}
  let profondeur = 0
  let chaine = false
  let courant = null
  let debut = 0
  for (let i = 0; i <= sql.length; i++) {
    const c = sql[i]
    if (c === "'") { chaine = !chaine; continue }
    if (chaine) continue
    if (c === '(') profondeur++
    else if (c === ')') profondeur--
    if (profondeur !== 0 && i < sql.length) continue
    const mot = i < sql.length && (i === 0 || /\s/.test(sql[i - 1])) ? mots.find((m) => new RegExp(`^${m.replace(' ', '\\s+')}\\b`, 'i').test(sql.slice(i))) : null
    if (mot || i === sql.length) {
      if (courant) morceaux[courant] = sql.slice(debut, i).trim()
      if (mot) {
        courant = mot
        debut = i + sql.slice(i).match(new RegExp(`^${mot.replace(' ', '\\s+')}`, 'i'))[0].length
      }
    }
  }
  return morceaux
}

const ouvrant = (t) => {
  // « (a AND b) » entièrement entre parenthèses → « a AND b ».
  t = t.trim()
  while (t.startsWith('(') && t.endsWith(')')) {
    let p = 0
    let ferme = -1
    for (let i = 0; i < t.length; i++) { if (t[i] === '(') p++; else if (t[i] === ')') { p--; if (p === 0) { ferme = i; break } } }
    if (ferme !== t.length - 1) break
    t = t.slice(1, -1).trim()
  }
  return t
}

// Le FROM en morceaux : la première table (ou liste « a, b »), puis chaque jointure { cible, on }, découpés hors
// parenthèses (une sous-requête garde ses propres JOIN).
const JOINTURE = /(?:(?:LEFT|RIGHT|INNER|CROSS|FULL)\s+)?(?:OUTER\s+)?JOIN\b/i
function morceauxFrom(from) {
  const [premier, ...jointures] = decouper(from, JOINTURE)
  return { premier, jointures: jointures.map((j) => { const [cible, ...on] = decouper(j, /ON\b/i); return { cible, on: on.join(' ON ') } }) }
}

// « ( SELECT … ) alias » → { sql, alias }, sinon null.
function sousRequete(texte) {
  const t = texte.trim()
  if (!t.startsWith('(')) return null
  let p = 0
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '(') p++
    else if (t[i] === ')' && --p === 0) {
      const sql = t.slice(1, i).trim()
      const alias = t.slice(i + 1).trim().match(/^(?:AS\s+)?`?(\w+)`?$/i)?.[1] || ''
      return /^SELECT\b/i.test(sql) ? { sql, alias } : null
    }
  }
  return null
}

const abreger = (t, n = 140) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

// Ce que fait une sous-requête, en une ligne : ses tables, son regroupement, son filtre.
// principale : la requête lue (une sous-requête qui la reprend telle quelle est dite comme telle).
const normaliser = (sql) => sansCommentaires(sql).replace(/\s+/g, ' ').trim().toLowerCase()
function resumeSousRequete(sql, principale = '') {
  const c = clauses(sql)
  const from = morceauxFrom(c.FROM || '')
  const dedans = sousRequete(from.premier)
  const tables = dedans
    ? [principale && normaliser(dedans.sql) === normaliser(principale) ? 'la requête principale, reprise telle quelle' : 'une autre sous-requête']
    : [from.premier, ...from.jointures.map((j) => j.cible)].map((t) => (sousRequete(t) ? 'sous-requête' : t.split(/\s+/)[0]))
  return [
    tables.length ? `sur ${[...new Set(tables)].join(', ')}` : '',
    c['GROUP BY'] ? `par ${c['GROUP BY']}` : '',
    /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(c.SELECT || '') ? `calcule ${abreger(decouper(c.SELECT, /,/).filter((x) => /\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(x)).join(', '), 80)}` : '',
    c.WHERE ? `où ${abreger(c.WHERE, 90)}` : '',
  ].filter(Boolean).join(' ; ')
}

// Une colonne du SELECT qui n'est pas une simple colonne : « CASE … END AS X » → { nom: 'X', expression }.
function colonneCalculee(morceau) {
  const m = morceau.match(/^([\s\S]+?)\s+(?:AS\s+)?`?(\w+)`?$/i)
  return m && !/^\w+(\.\w+)?$/.test(m[1].trim()) ? { nom: m[2], expression: m[1].trim() } : { nom: '', expression: morceau }
}

// Une borne de date écrite en SQL → ce qu'elle veut dire, ou null :
//   CURDATE() [- INTERVAL n U]                         → { glissant: [n, unité] } (n = 0 : aujourd'hui)
//   LAST_DAY(CURDATE() - INTERVAL n MONTH) + INTERVAL 1 DAY → { mois: n } : le 1er du mois, n - 1 mois avant celui-ci
//   DATE_FORMAT(CURDATE(), '%Y-%m-01') [- INTERVAL n MONTH] → { mois: n + 1 }
//   LAST_DAY(CURDATE() [- INTERVAL 0 MONTH])           → { finDuMois: true }
// Un DATE_FORMAT(…, '%Y%m%d') autour (date AAAAMMJJ) est ôté.
const UNITE_SQL = { DAY: 'jours', WEEK: 'semaines', MONTH: 'mois', YEAR: 'annees' }
function borneDate(texte) {
  let t = texte.replace(/\s+/g, ' ').trim()
  const format = t.match(/^DATE_FORMAT\((.+),\s*'%Y%m%d'\s*\)$/i)
  if (format) t = format[1].trim()
  const intervalle = '(?:\\s*-\\s*INTERVAL\\s+(\\d+)\\s+(DAY|WEEK|MONTH|YEAR))?'
  let m
  if ((m = t.match(new RegExp(`^CURDATE\\(\\)${intervalle}$`, 'i')))) return { glissant: [Number(m[1] || 0), UNITE_SQL[(m[2] || 'DAY').toUpperCase()]] }
  if ((m = t.match(/^LAST_DAY\(\s*CURDATE\(\)\s*-\s*INTERVAL\s+(\d+)\s+MONTH\s*\)\s*\+\s*INTERVAL\s+1\s+DAY$/i)) && Number(m[1]) > 0) return { mois: Number(m[1]) }
  if ((m = t.match(/^DATE_FORMAT\(\s*CURDATE\(\)\s*,\s*'%Y-%m-01'\s*\)(?:\s*-\s*INTERVAL\s+(\d+)\s+MONTH)?$/i))) return { mois: Number(m[1] || 0) + 1 }
  if (/^LAST_DAY\(\s*CURDATE\(\)(?:\s*-\s*INTERVAL\s+0\s+MONTH)?\s*\)$/i.test(t)) return { finDuMois: true }
  return null
}

// ---------------------------------------------------------------- traduction

// Un rapport de la GMAO a souvent plusieurs jeux de données (version, en-tête du client…) : on garde la requête
// principale, celle qui touche le plus de tables connues de la base (puis qui montre le plus de colonnes).
export function phraseDuRapport(requetes, schema) {
  let meilleure = null
  requetes.forEach((sql, i) => {
    try {
      const p = phraseDepuisSql(sql, schema)
      const score = p.tables.length * 100 + Object.values(p.affichees).flat().length * 2 + p.conditions.length
      if (!meilleure || score > meilleure.score) meilleure = { p, sql, i, score }
    } catch {}
  })
  if (!meilleure) throw new Error('Aucune requête de ce rapport ne porte sur des tables connues de la base.')
  return { phrase: meilleure.p, requete: meilleure.sql, autresRequetes: requetes.length - 1 }
}

// La phrase tirée d'une requête : { depart, tables, conditions, tri, affichees, nonReconnu: [texte…] }.
export function phraseDepuisSql(sqlBrut, schema) {
  const nonReconnu = []
  const sql = sansCommentaires(sqlBrut).replace(/\s+/g, ' ').trim()
  const c = clauses(sql)
  if (!c.FROM) throw new Error('La requête du rapport n’a pas de FROM lisible.')
  const from = morceauxFrom(c.FROM)

  // Une requête enveloppe : on lit celle du dedans, et on liste ce que l'enveloppe ajoute.
  const dedans = sousRequete(from.premier)
  if (dedans) {
    const p = phraseDepuisSql(dedans.sql, schema)
    const autour = []
    for (const morceau of decouper((c.SELECT || '').replace(/^DISTINCT\s+/i, ''), /,/)) {
      if (/^(\w+\.)?\*$/.test(morceau)) continue
      const x = colonneCalculee(morceau)
      autour.push(`Colonne ajoutée autour de la requête${x.nom ? ` « ${x.nom} »` : ''} : ${abreger(x.expression)}`)
    }
    for (const j of from.jointures) {
      const sous = sousRequete(j.cible)
      autour.push(sous ? `Sous-requête jointe « ${sous.alias} » (${resumeSousRequete(sous.sql, dedans.sql)}), reliée par ${abreger(j.on, 80)}` : `Table jointe autour de la requête : ${abreger(j.cible)}`)
    }
    if (c.WHERE) autour.push(`Condition autour de la requête : ${abreger(c.WHERE)}`)
    if (c['GROUP BY']) autour.push(`Regroupement autour de la requête (GROUP BY ${c['GROUP BY']}) : à refaire avec « regrouper »`)
    p.nonReconnu.unshift(...autour)
    return p
  }
  // Les tables et leurs alias : FROM t [AS] a, puis chaque JOIN t [AS] a ON …
  const alias = new Map()
  const tables = []
  const sousRequetes = new Set()
  const noterTable = (texte, on = '') => {
    const sous = sousRequete(texte)
    if (sous) {
      if (sous.alias) sousRequetes.add(sous.alias.toLowerCase())
      nonReconnu.push(`Sous-requête jointe${sous.alias ? ` « ${sous.alias} »` : ''} (${resumeSousRequete(sous.sql)})${on ? `, reliée par ${abreger(on, 80)}` : ''}`)
      return
    }
    const m = texte.trim().match(/^`?(\w+)`?(?:\s+(?:AS\s+)?`?(\w+)`?)?$/i)
    const t = m && tableDe(schema, m[1])
    if (!t) { nonReconnu.push(`Table inconnue de la base : ${abreger(texte.trim(), 120)}`); return }
    alias.set((m[2] || m[1]).toLowerCase(), t.nom)
    alias.set(t.nom.toLowerCase(), t.nom)
    if (!tables.includes(t.nom)) tables.push(t.nom)
  }
  for (const morceau of decouper(from.premier, /,/)) noterTable(morceau)
  for (const j of from.jointures) noterTable(j.cible, j.on)
  const depart = tables[0]
  if (!depart) throw new Error('Aucune table de la requête n’est dans la structure de la base.')

  // Une colonne « a.col » ou « col » (de la table de départ) → { table, colonne } ou null.
  const colonne = (texte) => {
    const m = String(texte).trim().replace(/`/g, '').match(/^(?:(\w+)\.)?(\w+)$/)
    if (!m) return null
    const table = m[1] ? alias.get(m[1].toLowerCase()) : depart
    const col = table && colonneDe(tableDe(schema, table), m[2])
    return col ? { table, colonne: col.nom, col } : null
  }
  const valeur = (texte) => {
    const t = String(texte).trim()
    if (t === '?') return { parametre: true }
    if (/^'.*'$/s.test(t)) return { v: t.slice(1, -1).replace(/''/g, "'") }
    if (/^-?\d+(\.\d+)?$/.test(t)) return { v: t }
    return null
  }
  const enSaisie = (v) => (/^\d{8}$/.test(v) ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : v)

  // Le WHERE : des conditions reliées par ET (BETWEEN … AND … reste d'un tenant).
  const conditions = []
  const termes = []
  for (const t of decouper(c.WHERE || '', /AND\b/i)) {
    if (termes.length && /\bBETWEEN\s+\S+$/i.test(termes.at(-1))) termes[termes.length - 1] += ` AND ${t}`
    else termes.push(t)
  }
  for (const brut of termes) {
    const t = ouvrant(brut)
    if (decouper(t, /OR\b/i).length > 1) { nonReconnu.push(`Condition avec OU : ${t}`); continue }
    let m
    const ajouter = (cible, cond) => {
      if (!cible) return nonReconnu.push(`Condition : ${t}`)
      // Une table écartée de la constellation (réglage de l'administrateur) : LA PHRASE ne peut pas y passer.
      if (tableDe(schema, cible.table)?.exclue) return nonReconnu.push(`Condition sur la table ${cible.table}, écartée de la constellation par l’administrateur (rallumez-la pour la reprendre) : ${t}`)
      const date = Boolean(formatDate(cible.col))
      conditions.push({ lien: 'et', source: `table:${cible.table}`, table: cible.table, colonne: cible.colonne, op: 'egal', valeurs: [], ...cond(date) })
    }
    // Une jointure écrite dans le WHERE (a.x = b.y) : déjà prise par le chemin.
    if ((m = t.match(/^(\S+)\s*=\s*(\S+)$/)) && colonne(m[1]) && colonne(m[2])) continue
    if ((m = t.match(/^(\S+)\s+IS\s+(NOT\s+)?NULL$/i))) { ajouter(colonne(m[1]), () => ({ op: m[2] ? 'egal' : 'different' })); continue }
    if ((m = t.match(/^(\S+)\s+(NOT\s+)?IN\s*\((.*)\)$/i))) {
      const vals = decouper(m[3], /,/).map(valeur)
      if (vals.some((x) => !x || x.parametre)) { nonReconnu.push(`Condition (liste ou paramètre) : ${t}`); continue }
      ajouter(colonne(m[1]), () => ({ op: m[2] ? 'different' : 'egal', valeurs: vals.map((x) => x.v) }))
      continue
    }
    if ((m = t.match(/^(\S+)\s+(NOT\s+)?LIKE\s+'(.*)'$/i))) {
      const motif = m[3]
      const debutJoker = motif.startsWith('%')
      const finJoker = motif.endsWith('%')
      const texte = motif.replace(/^%|%$/g, '')
      const op = m[2] ? 'ne_contient' : debutJoker && finJoker ? 'contient' : finJoker ? 'commence' : debutJoker ? 'finit' : 'egal'
      if (m[2] && !(debutJoker && finJoker)) { nonReconnu.push(`Condition : ${t}`); continue }
      ajouter(colonne(m[1]), () => ({ op, valeurs: [texte] }))
      continue
    }
    if ((m = t.match(/^(\S+)\s+BETWEEN\s+(\S+)\s+AND\s+(\S+)$/i))) {
      const a = valeur(m[2])
      const b = valeur(m[3])
      if (!a?.v || !b?.v) { nonReconnu.push(`Condition (paramètre) : ${t}`); continue }
      ajouter(colonne(m[1]), (date) => (date ? { quand: 'entre', valeurs: [enSaisie(a.v), enSaisie(b.v)] } : { op: 'entre', valeurs: [a.v, b.v] }))
      continue
    }
    // Une période calculée depuis aujourd'hui : « >= CURDATE() - INTERVAL 12 MONTH » (aussi en AAAAMMJJ) devient
    // « dans les 12 derniers mois » ; « >= LAST_DAY(CURDATE() - INTERVAL 3 MONTH) + INTERVAL 1 DAY » (le 1er du mois,
    // deux mois avant celui-ci) « dans les 3 derniers mois du calendrier ». La borne haute « aujourd'hui » ou « fin de
    // ce mois » ne dit rien de plus.
    if ((m = t.match(/^(\S+)\s*(>=|>|<=|<)\s*(.+)$/)) && borneDate(m[3])) {
      const cible = colonne(m[1])
      const b = borneDate(m[3])
      if (cible && formatDate(cible.col)) {
        if (/^</.test(m[2]) && (b.finDuMois || (b.glissant && !b.glissant[0]))) continue
        if (/^>/.test(m[2]) && b.mois) { ajouter(cible, () => ({ quand: 'derniers', valeurs: [String(b.mois), 'mois_calendrier'] })); continue }
        if (/^>/.test(m[2]) && b.glissant?.[0]) { ajouter(cible, () => ({ quand: 'derniers', valeurs: [String(b.glissant[0]), b.glissant[1]] })); continue }
      }
    }
    if ((m = t.match(/^(\S+)\s*(=|<>|!=|>=|<=|>|<)\s*(.+)$/))) {
      const v = valeur(m[3])
      if (!v) { nonReconnu.push(`Condition (calcul) : ${t}`); continue }
      if (v.parametre) { nonReconnu.push(`Condition sur un paramètre du rapport : ${t}`); continue }
      const op = m[2]
      // « <> '' » : rempli ; « = '' » : vide.
      if (v.v === '' && (op === '<>' || op === '!=' || op === '=')) { ajouter(colonne(m[1]), () => ({ op: op === '=' ? 'different' : 'egal' })); continue }
      ajouter(colonne(m[1]), (date) => {
        if (date) {
          const quand = { '=': 'le', '>=': 'depuis', '>': 'depuis', '<': 'avant', '<=': 'avant' }[op]
          if (quand) return { quand, valeurs: [enSaisie(v.v)] }
        }
        return { '=': { op: 'egal', valeurs: [v.v] }, '<>': { op: 'different', valeurs: [v.v] }, '!=': { op: 'different', valeurs: [v.v] }, '>': { op: 'sup', valeurs: [v.v] }, '>=': { op: 'sup', valeurs: [v.v] }, '<': { op: 'inf', valeurs: [v.v] }, '<=': { op: 'inf', valeurs: [v.v] } }[op]
      })
      continue
    }
    nonReconnu.push(`Condition : ${t}`)
  }

  // Le tri, et les colonnes montrées (celles du SELECT, table par table).
  const tri = []
  for (const morceau of decouper(c['ORDER BY'] || '', /,/)) {
    const m = morceau.match(/^(.+?)(?:\s+(ASC|DESC))?$/i)
    const cible = m && colonne(m[1])
    if (cible) tri.push({ table: cible.table, colonne: cible.colonne, sens: /desc/i.test(m[2] || '') ? 'desc' : 'asc' })
    else if (morceau) nonReconnu.push(`Tri : ${morceau}`)
  }
  const affichees = {}
  for (const morceau of decouper((c.SELECT || '').replace(/^DISTINCT\s+/i, ''), /,/)) {
    // « a.col », « a.col AS x » ou « a.col x » : la colonne est le premier mot.
    const cible = colonne(morceau.split(/\s+/)[0])
    if (cible) {
      if (!(affichees[cible.table] ||= []).includes(cible.colonne)) affichees[cible.table].push(cible.colonne)
    } else if (!/^(\w+\.)?\*$/.test(morceau)) {
      const x = colonneCalculee(morceau)
      nonReconnu.push(`Colonne calculée${x.nom ? ` « ${x.nom} »` : ''} : ${abreger(x.expression)}`)
    }
  }
  if (c['GROUP BY']) nonReconnu.push(`Regroupement (GROUP BY ${c['GROUP BY']}) : à refaire avec « regrouper »`)
  // Les tables jointes qu'aucune condition ne touche : le chemin de la phrase ne les reprend pas.
  const touchees = new Set([depart, ...conditions.map((x) => x.table)])
  const seules = tables.filter((t) => !touchees.has(t))
  if (conditions.length && seules.length) {
    const colonnes = seules.flatMap((t) => (affichees[t] || []).map((x) => `${t}.${x}`))
    nonReconnu.push(`Tables jointes sans condition (${seules.join(', ')}) : le chemin ne passe par elles que si une condition les touche${colonnes.length ? ` ; sinon leurs colonnes ne sont pas montrées (${colonnes.join(', ')})` : ''}`)
  }
  return { depart, tables, conditions, tri, affichees, nonReconnu }
}
