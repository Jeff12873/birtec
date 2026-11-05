// LA PHRASE : le bandeau au-dessus de la constellation. L'utilisateur construit lui-même, par des choix
// cliquables, ce qu'il veut consulter : la table, puis des conditions (« qui ont », « qui contiennent »…) liées
// par ET / OU et groupées entre parenthèses, puis l'ordre. Pas d'IA : les listes viennent de la structure et de
// la base.
//
// Le SQL (comptage, aperçu, requête enregistrée) est construit ici, à partir d'une description (tables, clés,
// conditions, tri) vérifiée sur la structure : aucun SQL ne vient du navigateur.

import { ErreurHttp } from 'ktec/http.js'
import { executerRequete, etatConnexion } from 'ktec/mysql.js'
import { enregistrerRequete, lireInfo, ecrireInfo, enregistrerIndicateur } from 'ktec/ktec.js'
import { reglagesPoste } from 'ktec/installation.js'
import { obtenirSchema } from '../base/schema.js'
import { genererRapport } from '../rapports/serveur.js'
import { reglagesIndicateurs, tester } from '../indicateurs/serveur.js'
import { trouverFenetre, formaterNom } from '../indicateurs/indicateur.js'
import { lireRptdesign, phraseDuRapport } from './import.js'
import { lireModele, enregistrerModele, reconnaitreModele, lireArbre, lireParcs, sousLesNoeuds, cheminDe } from './modele.js'

const VALEURS_MAX = 30

export function routes(r) {
  // Les valeurs proposées pour une colonne (les plus fréquentes, avec leur désignation si elle existe).
  // Les jointures « à type » (voir conditionDeType), pour que le SQL calculé dans la page les porte aussi.
  r.get('/api/phrase/associations', async () => {
    if (etatConnexion().ouverte) await preparerAssociations(await obtenirSchema())
    const m = lireModele()
    const v = m?.ficheTechnique?.valeurs
    return {
      associations: [...(associations || new Map())].map(([cle, a]) => ({ cle, colType: a.colType, valeurs: a.valeurs })),
      fiche: v?.idObjet && v?.typeObjet ? { idObjet: v.idObjet, typeObjet: v.typeObjet } : null,
      types: Object.fromEntries(Object.entries(m?.objets || {}).map(([code, o]) => [o.table.toLowerCase(), code])),
    }
  })

  // Le fichier de schéma pour BiRTEC éco+ (la page HTML seule) : la structure de la base, les réglages de LA PHRASE,
  // les jointures « à type », et l'adresse de la base pour les rapports (jamais de mot de passe, jamais de données).
  r.get('/api/phrase/eco-schema', async () => {
    const schema = await obtenirSchema()
    if (etatConnexion().ouverte) await preparerAssociations(schema)
    const { mysql = {} } = reglagesPoste()
    const infos = {}
    for (const cle of ['colonnes_phrase', 'passages_phrase', 'familles_phrase', 'birtec.modele_donnees', 'types_tables', 'charte', 'disposition_schema']) {
      const v = lireInfo(cle)
      if (v !== null && v !== undefined) infos[cle] = v
    }
    return {
      format: 'birtec-eco-schema',
      version: 1,
      le: new Date().toISOString(),
      base: mysql.base || schema.base || '',
      schema: { base: schema.base, tables: schema.tables },
      infos,
      associations: associationsConnues(),
      connexion: mysql.serveur ? { url: `jdbc:mysql://${mysql.serveur}:${mysql.port || 3306}/${mysql.base}`, utilisateur: mysql.utilisateur || '' } : null,
    }
  })

  r.get('/api/phrase/valeurs', async (ctx) => {
    if (!etatConnexion().ouverte) return []
    const schema = await obtenirSchema()
    const table = tableDe(schema, ctx.query.table)
    const colonne = colonneDe(table, ctx.query.colonne)
    if (!table || !colonne) throw new ErreurHttp(400, 'Colonne inconnue.')
    const affichage = colonneLisible(table, colonne)
    return valeursDe(table, colonne, affichage, affichage ? null : libelleParLien(schema, table, colonne))
  })

  // { table, colonne, spec } : les valeurs d'une condition imbriquée, seulement celles des lignes qui respectent
  // les conditions qui l'englobent (spec : le chemin et ces conditions parentes, sans la condition elle-même).
  r.post('/api/phrase/valeurs', async (ctx) => {
    if (!etatConnexion().ouverte) return []
    const { table: nomTable, colonne: nomColonne, spec } = await ctx.json()
    const schema = await obtenirSchema()
    const table = tableDe(schema, nomTable)
    const colonne = colonneDe(table, nomColonne)
    if (!table || !colonne) throw new ErreurHttp(400, 'Colonne inconnue.')
    const affichage = colonneLisible(table, colonne)
    const { from, where } = await morceauxSql({ ...spec, tri: [] }, schema)
    const col = `${table.nom}.${colonne.nom}`
    return valeursDe(table, colonne, affichage, affichage ? null : libelleParLien(schema, table, colonne), ` AND ${col} IN (SELECT ${col} ${from}${where})`)
  })

  // Quelques valeurs d'exemple de chaque colonne d'une table (les plus récentes lignes), pour la bulle des champs.
  r.get('/api/phrase/exemples', async (ctx) => {
    if (!etatConnexion().ouverte) return {}
    const table = tableDe(await obtenirSchema(), ctx.query.table)
    if (!table) throw new ErreurHttp(400, 'Table inconnue.')
    const cle = table.colonnes.find((c) => c.cle)
    const r200 = await executerRequete(`SELECT * FROM ${table.nom}${cle ? ` ORDER BY ${cle.nom} DESC` : ''}`, 200)
    const exemples = {}
    r200.colonnes.forEach((c, i) => {
      const vus = new Set()
      for (const l of r200.lignes) {
        const v = l[i] === null || l[i] === undefined ? '' : String(l[i]).trim()
        if (v && !vus.has(v)) vus.add(v)
        if (vus.size >= 3) break
      }
      exemples[c.nom] = [...vus].map((v) => (v.length > 60 ? `${v.slice(0, 57)}…` : v))
    })
    return exemples
  })

  // Les colonnes proposées dans LA PHRASE, table par table (choisies par l'administrateur ; absent : toutes).
  r.get('/api/phrase/colonnes', () => lireInfo('colonnes_phrase') || {})
  r.post('/api/phrase/colonnes', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const { table, colonnes } = await ctx.json()
    const t = tableDe(await obtenirSchema(), table)
    if (!t) throw new ErreurHttp(400, 'Table inconnue.')
    const toutes = { ...(lireInfo('colonnes_phrase') || {}) }
    if (Array.isArray(colonnes)) toutes[t.nom] = colonnes.map((c) => colonneDe(t, c)?.nom).filter(Boolean)
    else delete toutes[t.nom]
    ecrireInfo('colonnes_phrase', toutes)
    return toutes
  })

  // Les points de passage fixés entre deux tables : { 'a|b': [tables du milieu] } (l'administrateur les fixe).
  r.get('/api/phrase/passages', () => lireInfo('passages_phrase') || {})
  r.post('/api/phrase/passages', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const { de, vers, par } = await ctx.json()
    const schema = await obtenirSchema()
    const a = tableDe(schema, de)
    const b = tableDe(schema, vers)
    if (!a || !b) throw new ErreurHttp(400, 'Table inconnue.')
    const tous = { ...(lireInfo('passages_phrase') || {}) }
    delete tous[`${b.nom}|${a.nom}`]
    if (Array.isArray(par)) tous[`${a.nom}|${b.nom}`] = par.map((t) => tableDe(schema, t)?.nom).filter(Boolean)
    else delete tous[`${a.nom}|${b.nom}`]
    ecrireInfo('passages_phrase', tous)
    return tous
  })

  // Les familles de tables proposées dans « dans quelle table ? » (choisies par l'administrateur ; absent : le choix
  // par défaut de l'interface).
  r.get('/api/phrase/familles', () => lireInfo('familles_phrase') || null)
  r.post('/api/phrase/familles', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const { familles } = await ctx.json()
    const connues = ['directes', 'principale', 'secondaire', 'intermediaire', 'referentiel', 'technique']
    const propres = Array.isArray(familles) ? connues.filter((f) => familles.includes(f)) : null
    ecrireInfo('familles_phrase', propres)
    return propres
  })

  // Les choix guidés possibles pour une table de départ : parcs d'AITEC, table des machines, type de fiche technique.
  r.get('/api/phrase/guides', async (ctx) => {
    const m = lireModele()
    const parcs = lireParcs()
    const type = typeDeTable(m, ctx.query.depart)
    return {
      parcs: m?.machine && parcs.length ? parcs.map((x) => ({ valeur: x.id, libelle: x.nom })) : [],
      machines: m?.machine ? { table: m.machine.table } : null,
      fiche: m?.ficheTechnique && type ? { type, table: m.objets[type].table } : null,
    }
  })

  // ---- les choix guidés (parc, machine, fiche technique), d'après le modèle de données du site

  // Les machines d'un parc (et de tout ce qui est dessous), les plus proches de q en tête.
  r.get('/api/phrase/machines', async (ctx) => {
    const arbre = await lireArbre()
    if (!arbre) throw new ErreurHttp(409, 'Arborescence illisible : il faut la connexion et la requête d’arborescence (réglée dans PDRTEC).')
    const parc = lireParcs().find((x) => x.id === String(ctx.query.parc || ''))
    const noeuds = parc ? sousLesNoeuds(arbre, parc.racines) : [...arbre.noeuds.values()]
    return machinesProches(arbre, noeuds, String(ctx.query.q || ''), 400)
  })

  // Les modèles de fiche technique utilisés pour un type d'objet, leurs champs, et les valeurs d'un champ.
  r.get('/api/phrase/fiche/modeles', async (ctx) => listeFiche('modeles', ctx.query))
  r.get('/api/phrase/fiche/champs', async (ctx) => listeFiche('champs', ctx.query))
  r.get('/api/phrase/fiche/valeurs', async (ctx) => listeFiche('valeurs', ctx.query))

  // ---- le modèle de données (administrateur)
  r.get('/api/modele', (ctx) => {
    ctx.exigerModeAdmin?.()
    return { modele: lireModele() }
  })
  r.post('/api/modele/reconnaitre', async (ctx) => {
    ctx.exigerModeAdmin?.()
    return { modele: await reconnaitreModele(await obtenirSchema()) }
  })
  r.post('/api/modele', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const { modele } = await ctx.json()
    verifierModele(modele, await obtenirSchema())
    enregistrerModele(modele)
    return { modele: lireModele() }
  })

  // { depart, jointures, conditions, tri, groupe?, apercu? } → { nombre, groupes?, apercu: { colonnes, lignes }, sql? }
  // Avec un regroupement, le nombre est celui des lignes de la table de départ, « groupes » celui des groupes.
  r.post('/api/phrase/compter', async (ctx) => {
    const spec = await ctx.json()
    if (!etatConnexion().ouverte) throw new ErreurHttp(409, 'Connexion à la GMAO indisponible.')
    const schema = await obtenirSchema()
    const q = await requeteDeLaPhrase(spec, schema)
    // Les jointures multiplient les lignes (une RI et ses trois machines) : on compte les lignes distinctes de la
    // table de départ, par sa clé.
    const compte = await executerRequete(`SELECT COUNT(${q.cle ? `DISTINCT ${q.depart.nom}.${q.cle.nom}` : '*'}) AS n ${q.from}${q.where}`, 1)
    const reponse = { nombre: Number(compte.lignes[0]?.[0] ?? 0) }
    if (q.groupe) reponse.groupes = Number((await executerRequete(`SELECT COUNT(*) AS n FROM (${q.sql}) AS groupes_phrase`, 1)).lignes[0]?.[0] ?? 0)
    if (spec.apercu) {
      const r5 = await executerRequete(q.sql, q.groupe ? 12 : 5)
      reponse.apercu = { colonnes: q.colonnes, lignes: r5.lignes.map((l) => l.slice(0, q.colonnes.length)), groupe: q.groupe }
    }
    if (ctx.modeAdmin) reponse.sql = q.sql
    return reponse
  })

  // Un fichier .rptdesign (octets) → la phrase à reprendre : celle qu'il porte (rapport fait par LA PHRASE), sinon
  // celle tirée de sa première requête, avec ce qui n'a pas pu être traduit. Lecture seule : ouvert à tous.
  r.post('/api/phrase/rptdesign', async (ctx) => {
    const lu = lireRptdesign((await ctx.octets()).toString('utf8'))
    if (lu.phrase) return { phrase: lu.phrase, embarquee: true }
    if (!lu.requetes.length) throw new ErreurHttp(400, 'Ce fichier ne contient aucune requête SQL (jeu de données).')
    try {
      return phraseDuRapport(lu.requetes, await obtenirSchema())
    } catch (erreur) {
      throw new ErreurHttp(400, erreur.message)
    }
  })

  // { titre, spec, constellation, nom? } : un rapport BIRT fait directement de la phrase (un tableau : ses colonnes,
  // ou ses groupes et leurs calculs). nom : celui d'un rapport rouvert, refait sous le même nom (administrateur).
  r.post('/api/phrase/rapport', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const { titre = '', spec, constellation = null, nom = null } = await ctx.json()
    if (!String(titre).trim()) throw new ErreurHttp(400, 'Donnez un titre au rapport.')
    const q = await requeteDeLaPhrase(spec, await obtenirSchema())
    const description = {
      titre: String(titre).trim(),
      sousTitre: String(constellation?.phrase || '').slice(0, 300),
      orientation: q.colonnes.length > 6 ? 'paysage' : 'portrait',
      // « constructeur » garde la phrase pour la rouvrir (et dit que le SQL vient de BiRTEC, pas de l'IA).
      constructeur: { constellation, source: 'phrase' },
      blocs: [{ type: 'tableau', titre: '', requete: q.sql, liaisons: [], colonnes: q.colonnes.map((c) => ({ champ: c.alias, libelle: c.libelle, ...(c.format ? { format: c.format } : {}) })) }],
    }
    return genererRapport(description, nom || undefined)
  })

  // { nom, spec, constellation, id?, arborescence?, enregistrer? } : un indicateur GMAO fait de la phrase : le nombre
  // de lignes de la table consultée (requête indicateur) et leur liste (requête liste), au format de la GMAO.
  // Le regroupement éventuel n'y sert pas. enregistrer : sinon seulement essayé.
  r.post('/api/phrase/indicateur', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const { nom = '', spec, constellation = null, id = null, arborescence = true, enregistrer = false } = await ctx.json()
    const schema = await obtenirSchema()
    const { from, where } = await morceauxSql({ ...spec, tri: [] }, schema)
    const t = tableDe(schema, spec.depart)
    const reglages = await reglagesIndicateurs()
    const fenetre = trouverFenetre(reglages, t.nom)
    if (!fenetre) throw new ErreurHttp(400, `« ${t.libelle || t.nom} » ne peut pas être compté par un indicateur : la table doit avoir un identifiant, un code, une désignation et un état (ACTIF).`)
    const conditions = where.replace(/^\nWHERE /, '')
    const filtres = [arborescence && fenetre.variableArbo ? fenetre.variableArbo : null, conditions.trim() || null].filter(Boolean)
    const ou = filtres.length ? `\nWHERE ${filtres.join('\n  AND ')}` : ''
    const nomFinal = formaterNom(nom || t.libelle || t.nom)
    const colonnes = [`${t.nom}.${fenetre.id} AS ID`, `${t.nom}.${fenetre.code} AS CODE`, `${t.nom}.${fenetre.desi} AS DESI1`, `${t.nom}.${fenetre.actif} AS ACTIF`]
    const requeteIndicateur = `-- ${nomFinal}\nSELECT COUNT(DISTINCT ${t.nom}.${fenetre.id}) AS VAL\n${from}${ou}`
    const requeteListe = `-- ${nomFinal}\nSELECT DISTINCT\n  ${colonnes.join(',\n  ')}\n${from}${ou}\nORDER BY CODE`
    const essai = etatConnexion().ouverte ? await tester(requeteIndicateur, requeteListe) : { erreurs: [], avertissements: ['Connexion à la GMAO indisponible : requêtes non essayées.'] }
    let cree = null
    if (enregistrer && !essai.erreurs.length) {
      cree = enregistrerIndicateur({ id: id || undefined, nom: nomFinal, fenetre: fenetre.libelle, demande: constellation?.phrase || 'Créé depuis LA PHRASE', definition: { constellation, arborescence, source: 'phrase' }, requeteIndicateur, requeteListe, source: 'phrase' })
    }
    return { id: cree, nom: nomFinal, fenetre: fenetre.libelle, variableArbo: fenetre.variableArbo || null, requeteIndicateur, requeteListe, ...essai }
  })

  // { titre, spec } : la requête de la phrase, rangée dans les requêtes du site (administrateur).
  r.post('/api/phrase/enregistrer', async (ctx) => {
    ctx.exigerModeAdmin?.()
    const { titre = '', description = '', spec } = await ctx.json()
    if (!String(titre).trim()) throw new ErreurHttp(400, 'Donnez un nom à la requête.')
    const { sql } = await requeteDeLaPhrase(spec, await obtenirSchema())
    enregistrerRequete({ titre: titre.trim(), sql, description, source: `constellation:${titre.trim().toLowerCase()}` })
    return { sql }
  })
}

// ---------------------------------------------------------------- la requête de la phrase

// Les colonnes montrées (aperçu, rapport), table par table. La table de départ : sa clé (sauf si elle est retirée :
// apercu.sansCle), puis les colonnes cochées, sinon les premières colonnes proposées. Les autres tables : la colonne
// de chaque condition (verrouillée : elle montre la jointure ou le filtre), puis les colonnes cochées.
function colonnesMontrees(spec, schema, depart) {
  const jointes = new Set([depart.nom, ...(spec.jointures || []).map((j) => tableDe(schema, j.table)?.nom)])
  const choisies = spec.apercu?.affichees && typeof spec.apercu.affichees === 'object' ? spec.apercu.affichees : {}
  const cochees = (t) => (Array.isArray(choisies[t.nom]) ? t.colonnes.filter((c) => choisies[t.nom].includes(c.nom)) : null)
  const sources = []
  const ajouter = (c) => { if (!sources.some((x) => x.table === c.table && x.colonne === c.colonne)) sources.push(c) }
  const cleDepart = depart.colonnes.find((c) => c.cle)
  if (cleDepart && !spec.apercu?.sansCle) ajouter({ table: depart.nom, colonne: cleDepart.nom, cle: true })
  const proposees = (lireInfo('colonnes_phrase') || {})[depart.nom]
  const premieres = (proposees?.length ? depart.colonnes.filter((c) => proposees.includes(c.nom)) : depart.colonnes).filter((c) => c !== cleDepart)
  for (const c of cochees(depart) || premieres.slice(0, 8)) if (c !== cleDepart) ajouter({ table: depart.nom, colonne: c.nom })
  const conditions = colonnesDesConditions(spec.conditions, schema)
  for (const c of conditions) ajouter({ ...c, condition: true, verrouillee: true })
  for (const nom of [...new Set([...conditions.map((c) => c.table), ...Object.keys(choisies)])]) {
    const t = tableDe(schema, nom)
    if (!t || t.nom === depart.nom || !jointes.has(t.nom)) continue
    for (const c of cochees(t) || []) ajouter({ table: t.nom, colonne: c.nom })
  }
  // Regroupées par table, dans l'ordre d'arrivée des tables.
  const ordre = [...new Set(sources.map((c) => c.table))]
  return sources.sort((a, b) => ordre.indexOf(a.table) - ordre.indexOf(b.table))
}

const libelleDe = (schema, table, colonne) => colonneDe(tableDe(schema, table), colonne)?.libelle || colonne
const FONCTIONS = { nombre: 'Nombre', somme: 'Somme', moyenne: 'Moyenne', min: 'Minimum', max: 'Maximum' }
const PERIODES_GROUPE = { jour: '%Y-%m-%d', semaine: '%x-S%v', mois: '%Y-%m', annee: '%Y' }

// La requête complète de la phrase → { sql, colonnes: [{ alias, table?, colonne?, libelle, ... }], groupe, depart, cle,
// from, where }. Sans regroupement : les colonnes montrées (SELECT DISTINCT), triées comme dans l'aperçu.
// Avec spec.groupe = { par: [{ table, colonne, periode? }], mesures: [{ fonction, table?, colonne? }] } : une ligne
// par groupe, avec ses calculs (nombre de lignes de la table consultée, somme, moyenne, min, max d'une colonne).
async function requeteDeLaPhrase(spec, schema) {
  const { from, where, tri, jointes } = await morceauxSql(spec, schema)
  const depart = tableDe(schema, spec.depart)
  const cle = depart.colonnes.find((c) => c.cle)
  const groupe = spec.groupe && Array.isArray(spec.groupe.par) && spec.groupe.par.length ? spec.groupe : null
  if (!groupe) {
    const sources = colonnesMontrees(spec, schema, depart)
    const colonnes = sources.map((c, i) => ({ ...c, alias: `c_${i}`, libelle: libelleDe(schema, c.table, c.colonne) }))
    const select = [...colonnes.map((c) => `${c.table}.${c.colonne} AS ${c.alias}`), ...tri.map((t, i) => `${t.expression} AS tri_${i}`)]
    const sql = `SELECT DISTINCT\n  ${select.join(',\n  ')}\n${from}${where}${tri.length ? `\nORDER BY ${tri.map((t, i) => `tri_${i} ${t.sens}`).join(', ')}` : ''}`
    return { sql, colonnes, groupe: false, depart, cle, from, where }
  }
  // Une colonne du regroupement ou d'un calcul : elle doit exister et sa table être dans le chemin.
  const cible = (x) => {
    const t = tableDe(schema, x.table || spec.depart)
    const c = colonneDe(t, x.colonne)
    if (!t || !c) throw new ErreurHttp(400, 'Colonne inconnue dans le regroupement.')
    if (!jointes.has(t.nom)) throw new ErreurHttp(400, `La table ${t.nom} n’est pas dans le chemin.`)
    return { t, c, e: `${t.nom}.${c.nom}` }
  }
  const colonnes = []
  const par = groupe.par.slice(0, 4).map((x, i) => {
    const { t, c, e } = cible(x)
    const format = formatDate(c)
    let expression = e
    if (format && PERIODES_GROUPE[x.periode]) {
      const jour = format === 'date8' ? `STR_TO_DATE(NULLIF(${e}, ''), '%Y%m%d')` : format === 'unix' ? `FROM_UNIXTIME(NULLIF(${e}, 0))` : e
      expression = `DATE_FORMAT(${jour}, '${PERIODES_GROUPE[x.periode]}')`
    }
    colonnes.push({ alias: `g_${i}`, table: t.nom, colonne: c.nom, libelle: `${c.libelle || c.nom}${x.periode && format ? ` (${{ jour: 'jour', semaine: 'semaine', mois: 'mois', annee: 'année' }[x.periode]})` : ''}`, groupe: true })
    return `${expression} AS g_${i}`
  })
  const mesures = (Array.isArray(groupe.mesures) && groupe.mesures.length ? groupe.mesures : [{ fonction: 'nombre' }]).slice(0, 6).map((m, i) => {
    if (!FONCTIONS[m.fonction]) throw new ErreurHttp(400, `Calcul inconnu : ${m.fonction}`)
    if (m.fonction === 'nombre') {
      colonnes.push({ alias: `m_${i}`, libelle: `Nombre de ${depart.libelle || depart.nom}`, mesure: true, format: 'entier' })
      return `COUNT(${cle ? `DISTINCT ${depart.nom}.${cle.nom}` : '*'}) AS m_${i}`
    }
    const { t, c, e } = cible(m)
    const sql = { somme: 'SUM', moyenne: 'AVG', min: 'MIN', max: 'MAX' }[m.fonction]
    // Une date en AAAAMMJJ : vide n'est pas un minimum.
    const valeur = formatDate(c) === 'date8' ? `NULLIF(${e}, '')` : e
    colonnes.push({ alias: `m_${i}`, table: t.nom, colonne: c.nom, libelle: `${FONCTIONS[m.fonction]} de ${c.libelle || c.nom}`, mesure: true, ...(m.fonction === 'moyenne' ? { format: 'decimal' } : {}) })
    return `${sql}(${valeur}) AS m_${i}`
  })
  // Regroupé par période (mois, année…) : dans l'ordre du calendrier ; sinon les plus gros groupes d'abord.
  const parPeriode = groupe.par[0] && PERIODES_GROUPE[groupe.par[0].periode] && formatDate(cible(groupe.par[0]).c)
  const sql = `SELECT\n  ${[...par, ...mesures].join(',\n  ')}\n${from}${where}\nGROUP BY ${par.map((_, i) => `g_${i}`).join(', ')}\nORDER BY ${parPeriode ? 'g_0 DESC' : 'm_0 DESC'}`
  return { sql, colonnes, groupe: true, depart, cle, from, where }
}

// ---------------------------------------------------------------- structure

const tableDe = (schema, nom) => schema.tables.find((t) => t.nom.toLowerCase() === String(nom || '').toLowerCase())
const colonneDe = (table, nom) => table?.colonnes.find((c) => c.nom.toLowerCase() === String(nom || '').toLowerCase())

function colonneLisible(table, colonne) {
  if (!colonne.cle && !/^id_|_id$/i.test(colonne.nom)) return null
  const texte = (c) => !c.cle && !/^id_|_id$/i.test(c.nom) && !/^(int|bigint|smallint|tinyint|decimal|float|double|date|datetime|time)/i.test(c.type || '')
  return table.colonnes.find((c) => texte(c) && /desi|libel|intitul|nom\b|^nom/i.test(c.nom))
    || table.colonnes.find((c) => texte(c) && c.nom.toLowerCase() === table.nom.toLowerCase())
    || table.colonnes.find((c) => texte(c) && /code|ref/i.test(c.nom))
    || null
}

// Pas de colonne lisible dans la table (une arborescence, une table de liaison) : la désignation d'une table
// liée, par la première clé étrangère qui mène à une table qui en a une. → { table, colonne, versColonne, libelle }
function libelleParLien(schema, table, colonne) {
  if (!colonne.cle && !/^id_|_id$/i.test(colonne.nom)) return null
  for (const l of table.liens) {
    const cible = tableDe(schema, l.versTable)
    const lisible = cible && colonneLisible(cible, { cle: true, nom: 'ID' })
    if (lisible) return { table: cible.nom, colonne: l.colonne, versColonne: l.versColonne, libelle: lisible.nom }
  }
  return null
}

// Les valeurs les plus fréquentes d'une colonne (avec sa désignation si l'IA l'a donnée) : les pastilles.
// dans : une restriction de plus (« AND … IN (sous-requête) »), pour une condition imbriquée.
async function valeursDe(table, colonne, affichage, parLien = null, dans = '') {
  const lib = parLien ? `${parLien.table}.${parLien.libelle}` : `${table.nom}.${affichage && affichage.nom !== colonne.nom ? affichage.nom : colonne.nom}`
  const jointure = parLien ? ` LEFT JOIN ${parLien.table} ON ${table.nom}.${parLien.colonne} = ${parLien.table}.${parLien.versColonne}` : ''
  const col = `${table.nom}.${colonne.nom}`
  try {
    const r = await executerRequete(
      `SELECT ${col} AS valeur, ${lib} AS libelle, COUNT(*) AS n FROM ${table.nom}${jointure} WHERE ${col} IS NOT NULL AND ${col} <> ''${dans} GROUP BY ${col}, ${lib} ORDER BY n DESC LIMIT ${VALEURS_MAX}`,
      VALEURS_MAX,
    )
    return r.lignes.map((l) => ({ valeur: String(l[0]), libelle: String(l[1] ?? l[0]), nombre: Number(l[2]) }))
  } catch {
    return []
  }
}

// ---------------------------------------------------------------- SQL construit ici

// Les colonnes que touchent les conditions (groupes compris) ; parc et machine : le repère de la table des machines.
function colonnesDesConditions(liste, schema) {
  const m = lireModele()
  return (Array.isArray(liste) ? liste : []).flatMap((c) => {
    if (Array.isArray(c.groupe)) return colonnesDesConditions(c.groupe, schema)
    if (Array.isArray(c.sous) && c.sous.length) return [...colonnesDesConditions([{ ...c, sous: null }], schema), ...colonnesDesConditions(c.sous, schema)]
    if (c.guide === 'parc' || c.guide === 'machine') return m?.machine ? [{ table: tableDe(schema, m.machine.table)?.nom, colonne: m.machine.code }] : []
    if (c.guide) return []
    const t = tableDe(schema, c.table)
    const col = c.colonne ? colonneDe(t, c.colonne) : t && cleDe(t)
    return t && col ? [{ table: t.nom, colonne: col.nom }] : []
  }).filter((c) => c.table)
}

// Une jointure sur un identifiant d'objet « à type » (comme celui des fiches techniques : l'identifiant ne dit
// rien sans le type d'objet à côté) : le type de l'autre table est ajouté à la jointure (sinon elle prendrait
// les objets d'un autre type au même numéro).
function conditionDeType(de, colDe, vers, colVers) {
  const m = lireModele()
  const v = m?.ficheTechnique?.valeurs
  for (const [cote, col, autre] of [[de, colDe, vers], [vers, colVers, de]]) {
    // La colonne du type : celle des fiches techniques (modèle de données), ou celle reconnue sur les données.
    const a = associations?.get(`${cote.nom}.${col.nom}`.toLowerCase())
    const colFiche = v?.idObjet && v?.typeObjet && col.nom.toLowerCase() === v.idObjet.toLowerCase() ? colonneDe(cote, v.typeObjet) : null
    const colType = colFiche?.nom || a?.colType
    if (!colType) continue
    // Le type de l'autre table : celui du modèle, sinon la valeur des données qui porte son nom, sinon son nom
    // en majuscules : une table sans ligne de ce type ne ramène simplement rien.
    const code = typeDeTable(m, autre.nom)
    const type = code || a?.valeurs.find((x) => x.toLowerCase() === autre.nom.toLowerCase()) || autre.nom.toUpperCase()
    return ` AND ${cote.nom}.${colType} = ${litteral(type)}`
  }
  return ''
}

// Les tables d'association « à type » : un identifiant ID_X et, à côté, une colonne texte X qui dit de quelle
// table vient l'identifiant (le nom de cette table, en majuscules). Le même numéro désigne sinon des objets différents selon la
// table : la jointure doit donc aussi porter sur X. Elles sont reconnues sur les données (toutes les valeurs de X
// sont des noms de tables, ou des types d'objets du modèle), une fois par lancement de K.NOVA.
let associations = null
// Pour le fichier de schéma de BiRTEC éco+, et dans la page éco+ (qui n'a pas de base pour les reconnaître).
export const associationsConnues = () => [...(associations || new Map())].map(([cle, a]) => ({ cle, colType: a.colType, valeurs: a.valeurs }))
export function definirAssociations(liste) {
  associations = new Map((liste || []).map((a) => [a.cle, { colType: a.colType, valeurs: a.valeurs }]))
}
async function preparerAssociations(schema) {
  if (associations || !etatConnexion().ouverte) return
  const m = lireModele()
  const connus = new Set([...schema.tables.map((t) => t.nom.toLowerCase()), ...Object.keys(m?.objets || {}).map((x) => x.toLowerCase())])
  const candidates = []
  for (const t of schema.tables) {
    for (const c of t.colonnes) {
      const nom = c.nom.match(/^id_(.+)$/i)?.[1]
      const colType = nom && t.colonnes.find((x) => x.nom.toLowerCase() === nom.toLowerCase() && !NUMERIQUE.test(x.type || ''))
      if (colType) candidates.push({ table: t.nom, id: c.nom, colType: colType.nom })
    }
  }
  // Les valeurs de chaque colonne de type, sur un échantillon (les 5 000 premières lignes), en une seule requête :
  // une requête par table coûterait des dizaines de secondes.
  const echantillon = (x, i) => `(SELECT ${i} AS k, v FROM (SELECT DISTINCT v FROM (SELECT ${x.colType} AS v FROM ${x.table} LIMIT 5000) e WHERE v IS NOT NULL AND v <> '') d LIMIT 40)`
  // (Enveloppée dans un SELECT : la requête doit commencer par SELECT pour être acceptée en lecture.)
  const lire = async (liste, decalage = 0) => (await executerRequete(`SELECT k, v FROM (\n${liste.map((x, i) => echantillon(x, i + decalage)).join('\nUNION ALL\n')}\n) u`, 40 * liste.length)).lignes
  let lignes = []
  try {
    if (candidates.length) lignes = await lire(candidates)
  } catch {
    // Une table illisible fait échouer l'ensemble : une par une, en ignorant celles qui échouent.
    for (let i = 0; i < candidates.length; i++) lignes.push(...(await lire([candidates[i]], i).catch(() => [])))
  }
  const valeursDe = new Map()
  for (const [k, v] of lignes) valeursDe.set(Number(k), [...(valeursDe.get(Number(k)) || []), String(v)])
  const trouvees = new Map()
  candidates.forEach((x, i) => {
    const valeurs = valeursDe.get(i) || []
    if (valeurs.length && valeurs.every((v) => connus.has(v.toLowerCase()))) trouvees.set(`${x.table}.${x.id}`.toLowerCase(), { colType: x.colType, valeurs })
  })
  associations = trouvees
}


// La description du chemin, des conditions et du tri, vérifiée sur la structure : chaque table et chaque colonne
// doit exister et être dans le chemin ; les valeurs sont écrites entre apostrophes (doublées).
// conditions : [{ table, colonne, op, valeurs, lien } | { guide, op, … , lien } | { groupe: [ … ], lien }],
// lien = 'et' | 'ou' avec l'élément précédent. Comme à la lecture, ET passe avant OU ; un groupe change cet ordre.
// Les anciennes constellations (filtres : une valeur par colonne, tous en ET) restent comprises.
// → { from, where, tri: [{ expression, sens }] }
export async function morceauxSql(spec, schema) {
  await preparerAssociations(schema)
  const depart = tableDe(schema, spec?.depart)
  if (!depart) throw new ErreurHttp(400, 'Table de départ inconnue.')
  const jointes = new Set([depart.nom])
  const lignes = [`FROM ${depart.nom}`]
  for (const j of Array.isArray(spec.jointures) ? spec.jointures : []) {
    const table = tableDe(schema, j.table)
    const de = tableDe(schema, j.de)
    const vers = tableDe(schema, j.vers)
    if (!table || !de || !vers || !colonneDe(de, j.colonne) || !colonneDe(vers, j.versColonne)) throw new ErreurHttp(400, 'Jointure inconnue dans la structure.')
    if (![de.nom, vers.nom].includes(table.nom) || !jointes.has(de.nom === table.nom ? vers.nom : de.nom)) throw new ErreurHttp(400, 'Jointures dans le désordre.')
    if (jointes.has(table.nom)) continue
    jointes.add(table.nom)
    const autre = de.nom === table.nom ? vers : de
    lignes.push(`LEFT JOIN ${table.nom} ON ${de.nom}.${colonneDe(de, j.colonne).nom} = ${vers.nom}.${colonneDe(vers, j.versColonne).nom}${conditionDeType(de, colonneDe(de, j.colonne), vers, colonneDe(vers, j.versColonne))}${memeObjet(schema, table, autre, jointes, depart, colonneDe(table, de.nom === table.nom ? j.colonne : j.versColonne))}`)
  }
  const ciblee = (f) => {
    const table = tableDe(schema, f.table)
    const colonne = colonneDe(table, f.colonne)
    if (!table || !colonne) throw new ErreurHttp(400, 'Colonne inconnue dans la structure.')
    if (!jointes.has(table.nom)) throw new ErreurHttp(400, `La table ${table.nom} n’est pas dans le chemin.`)
    return { e: `${table.nom}.${colonne.nom}`, colonne }
  }
  const conditionDe = async (f) => {
    if (f.guide) {
      const c = await conditionGuidee(f, jointes, depart, schema)
      return c && f.op === 'different' ? `NOT COALESCE((${c}), FALSE)` : c
    }
    // Une table seule, sans champ : « ont » = une ligne liée existe dans cette table, « n'ont pas » = aucune.
    if (f.table && !f.colonne) {
      const t = tableDe(schema, f.table)
      if (!t || !jointes.has(t.nom)) throw new ErreurHttp(400, `La table ${f.table} n’est pas dans le chemin.`)
      const e = `${t.nom}.${cleDe(t).nom}`
      return f.op === 'different' ? `${e} IS NULL` : `${e} IS NOT NULL`
    }
    const { e, colonne } = ciblee(f)
    const v = (Array.isArray(f.valeurs) ? f.valeurs : [f.valeurs]).filter((x) => x !== undefined && x !== null && x !== '')
    // Une date (AAAAMMJJ en texte, DATE/DATETIME, ou horodatage Unix) : comparée comme une date, jamais comme un texte.
    const format = formatDate(colonne)
    if (format) {
      const quand = f.quand ?? { egal: v.length ? 'le' : '', different: v.length ? 'le' : '', sup: 'apres', inf: 'avant', entre: 'entre' }[f.op || 'egal']
      if (quand === undefined) throw new ErreurHttp(400, `Opérateur inconnu pour une date : ${f.op}`)
      const c = conditionDate(e, format, quand, v)
      return f.op === 'different' ? `NOT COALESCE((${c}), FALSE)` : c
    }
    const lit = (x) => litteralPour(colonne, x)
    const motif = (x) => `'${echapper(String(x).replace(/[%_]/g, (m) => `\\${m}`))}'`
    switch (f.op || 'egal') {
      // Sans valeur : « ont » = le champ est rempli, « n'ont pas » = il est vide.
      case 'egal': return v.length ? `${e} IN (${v.map(lit).join(', ')})` : rempli(e, colonne)
      case 'different': return v.length ? `(${e} IS NULL OR ${e} NOT IN (${v.map(lit).join(', ')}))` : `NOT (${rempli(e, colonne)})`
      case 'contient': return v.length ? `${e} LIKE CONCAT('%', ${motif(v[0])}, '%')` : null
      case 'ne_contient': return v.length ? `(${e} IS NULL OR ${e} NOT LIKE CONCAT('%', ${motif(v[0])}, '%'))` : null
      case 'commence': return v.length ? `${e} LIKE CONCAT(${motif(v[0])}, '%')` : null
      case 'finit': return v.length ? `${e} LIKE CONCAT('%', ${motif(v[0])})` : null
      case 'sup': return v.length ? `${e} > ${lit(v[0])}` : null
      case 'inf': return v.length ? `${e} < ${lit(v[0])}` : null
      case 'entre': return v.length === 2 ? `${e} BETWEEN ${lit(v[0])} AND ${lit(v[1])}` : null
      case 'vide': return `(${e} IS NULL OR ${e} = '')`
      case 'non_vide': return `(${e} IS NOT NULL AND ${e} <> '')`
      default: throw new ErreurHttp(400, `Opérateur inconnu : ${f.op}`)
    }
  }
  // « et tout ce qui est dessous » : une condition sur la table des machines garde les machines qu'elle trouve et
  // toute leur descendance dans l'arborescence (celle réglée dans PDRTEC). La liste est figée à la fabrication.
  const enCascade = async (f, propre) => {
    const m = lireModele()
    const t = tableDe(schema, f.table)
    if (!propre || !m?.machine || !t || t.nom !== tableDe(schema, m.machine.table)?.nom) return propre
    const arbre = await lireArbre()
    if (!arbre) throw new ErreurHttp(409, 'Arborescence illisible (requête réglée dans PDRTEC) : « et tout ce qui est dessous » est impossible.')
    const code = `${t.nom}.${colonneDe(t, m.machine.code).nom}`
    const r = await executerRequete(`SELECT DISTINCT ${code} FROM ${t.nom} WHERE ${propre}`, 100_000)
    const trouvees = new Set(r.lignes.map((l) => String(l[0] ?? '').trim()).filter(Boolean))
    const racines = [...arbre.noeuds.values()].filter((n) => trouvees.has(n.code)).map((n) => n.id)
    const codes = [...new Set(sousLesNoeuds(arbre, racines).map((n) => n.code).filter(Boolean))]
    return codes.length ? `${code} IN (${codes.map(litteral).join(', ')})` : '1 = 0'
  }
  const combiner = async (liste) => {
    const morceaux = []
    for (const f of Array.isArray(liste) ? liste : []) {
      // Une condition peut porter ses propres conditions (« des pièces qui ont telle famille ») : elles s'y ajoutent.
      const propre = Array.isArray(f.groupe) ? await combiner(f.groupe) : f.cascade ? await enCascade(f, await conditionDe(f)) : await conditionDe(f)
      const sous = !Array.isArray(f.groupe) && Array.isArray(f.sous) && f.sous.length ? await combiner(f.sous) : null
      const sql = propre && sous ? `${propre} AND (${sous})` : propre || sous
      if (sql) morceaux.push(`${morceaux.length ? (f.lien === 'ou' ? '\n  OR ' : '\n  AND ') : ''}(${sql})`)
    }
    return morceaux.length ? morceaux.join('') : null
  }
  const anciens = (Array.isArray(spec.filtres) ? spec.filtres : []).map((f) => ({ ...f, op: f.op || 'egal', lien: 'et' }))
  const where = await combiner([...anciens, ...(Array.isArray(spec.conditions) ? spec.conditions : [])])
  const tri = (Array.isArray(spec.tri) ? spec.tri : []).map((t) => ({ expression: ciblee(t).e, sens: t.sens === 'desc' ? 'DESC' : 'ASC' }))
  return { from: lignes.join('\n'), where: where ? `\nWHERE ${where}` : '', tri, jointes }
}

// Deux tables qui portent chacune un objet « à type » (identifiant + type de l’objet : celles des fiches techniques)
// parlent du même objet quand le chemin les relie : RI → modèles associés → modèle → réponses. Sans cela, les réponses
// du modèle seraient celles de tous les objets qui l'utilisent, pas celles de cette RI. Sans autre table « à type »
// dans le chemin, les réponses sont celles de la table consultée (quand son type d'objet est connu).
// colJointure : la colonne de la table qui sert à la jointure (si c'est l'identifiant d'objet, la jointure dit déjà
// de quel objet il s'agit).
function pairesObjet(t) {
  const v = lireModele()?.ficheTechnique?.valeurs
  const paires = []
  const ajouter = (id, type) => {
    const a = colonneDe(t, id)
    const b = colonneDe(t, type)
    if (a && b && !paires.some((p) => p.id === a.nom)) paires.push({ id: a.nom, type: b.nom })
  }
  if (v?.idObjet && v?.typeObjet) ajouter(v.idObjet, v.typeObjet)
  // Les mêmes colonnes reconnues sur les données, si le modèle de données ne les décrit pas.
  for (const [cle, a] of associations || []) if (cle.startsWith(`${t.nom.toLowerCase()}.`)) ajouter(cle.split('.')[1], a.colType)
  return paires
}
function memeObjet(schema, table, autre, jointes, depart, colJointure) {
  const p = pairesObjet(table)[0]
  if (!p || colJointure?.nom.toLowerCase() === p.id.toLowerCase()) return ''
  const memes = (t) => pairesObjet(t).find((x) => x.id.toLowerCase() === p.id.toLowerCase() && x.type.toLowerCase() === p.type.toLowerCase())
  const deja = [...jointes].map((n) => tableDe(schema, n)).find((t) => t && t.nom !== table.nom && t.nom !== autre.nom && memes(t))
  if (deja) {
    const q = memes(deja)
    return ` AND ${table.nom}.${p.id} = ${deja.nom}.${q.id} AND ${table.nom}.${p.type} = ${deja.nom}.${q.type}`
  }
  const a = associations?.get(`${table.nom}.${p.id}`.toLowerCase())
  const code = typeDeTable(lireModele(), depart.nom) || a?.valeurs.find((x) => x.toLowerCase() === depart.nom.toLowerCase())
  const cle = depart.colonnes.find((c) => c.cle)
  if (!code || !cle || autre.nom === depart.nom) return ''
  return ` AND ${table.nom}.${p.id} = ${depart.nom}.${cle.nom} AND ${table.nom}.${p.type} = ${litteral(code)}`
}

// ---------------------------------------------------------------- dates

// Le format d'une colonne de date, ou null : 'date8' (AAAAMMJJ dans un texte de 8, le cas de la GMAO), 'sql'
// (DATE, DATETIME, TIMESTAMP) ou 'unix' (secondes depuis 1970 dans un entier dont le nom parle de date).
export function formatDate(colonne) {
  const type = String(colonne?.type || '')
  if (/^(date|datetime|timestamp)\b/i.test(type)) return 'sql'
  // Le type arrive seul (« VARCHAR », taille à part) ou avec sa taille (« varchar(8) »).
  const huit = Number(colonne.taille) === 8 || /\(8\)/.test(type)
  if (/^(var)?char/i.test(type) && huit && /^date|_date|^dt_/i.test(colonne.nom)) return 'date8'
  if (/^(int|bigint)\b/i.test(type) && /^date|_date/i.test(colonne.nom)) return 'unix'
  return null
}

const UNITES_SQL = { jours: 'DAY', semaines: 'WEEK', mois: 'MONTH', annees: 'YEAR' }
// Les périodes du calendrier : [début, fin[ en expressions SQL, recalculées chaque jour (un rapport enregistré suit).
const LUNDI = 'CURDATE() - INTERVAL WEEKDAY(CURDATE()) DAY'
const PREMIER_DU_MOIS = "DATE_FORMAT(CURDATE(), '%Y-%m-01')"
const PREMIER_JANVIER = 'MAKEDATE(YEAR(CURDATE()), 1)'
const PERIODES_SQL = {
  aujourdhui: ['CURDATE()', 'CURDATE() + INTERVAL 1 DAY'],
  hier: ['CURDATE() - INTERVAL 1 DAY', 'CURDATE()'],
  cette_semaine: [LUNDI, `${LUNDI} + INTERVAL 7 DAY`],
  semaine_derniere: [`${LUNDI} - INTERVAL 7 DAY`, LUNDI],
  ce_mois: [PREMIER_DU_MOIS, `${PREMIER_DU_MOIS} + INTERVAL 1 MONTH`],
  mois_dernier: [`${PREMIER_DU_MOIS} - INTERVAL 1 MONTH`, PREMIER_DU_MOIS],
  cette_annee: [PREMIER_JANVIER, `${PREMIER_JANVIER} + INTERVAL 1 YEAR`],
  annee_derniere: [`${PREMIER_JANVIER} - INTERVAL 1 YEAR`, PREMIER_JANVIER],
}

// Une date saisie (AAAA-MM-JJ ou AAAAMMJJ) → DATE 'AAAA-MM-JJ'.
function jourSql(x) {
  const m = String(x).match(/^(\d{4})-?(\d{2})-?(\d{2})$/)
  if (!m) throw new ErreurHttp(400, `Date illisible : ${x}`)
  return `DATE '${m[1]}-${m[2]}-${m[3]}'`
}

// « qui ont <date> <quand> » : la date de la colonne tombe dans l'intervalle [début, fin[. Une borne est écrite dans
// le format de la colonne, pour comparer sans convertir chaque ligne. Une date vide ('', 00000000, 0) ne tombe
// jamais dans un intervalle : en AAAAMMJJ, '' passerait sinon pour « avant » n'importe quelle date.
function conditionDate(e, format, quand, v) {
  const borne = (d) => (format === 'date8' ? `DATE_FORMAT(${d}, '%Y%m%d')` : format === 'unix' ? `UNIX_TIMESTAMP(${d})` : d)
  const garde = format === 'date8' ? `${e} >= '19000101'` : format === 'unix' ? `${e} > 0` : `${e} >= DATE '1900-01-01'`
  const intervalle = (debut, fin) => [garde, debut && `${e} >= ${borne(debut)}`, fin && `${e} < ${borne(fin)}`].filter(Boolean).join(' AND ')
  const lendemain = (x) => `${jourSql(x)} + INTERVAL 1 DAY`
  const duree = () => {
    const n = Number(v[0])
    if (!Number.isInteger(n) || n < 1 || n > 9999 || !UNITES_SQL[v[1]]) throw new ErreurHttp(400, 'Durée illisible.')
    return `CURDATE() - INTERVAL ${n} ${UNITES_SQL[v[1]]}`
  }
  switch (quand) {
    case '': return garde // la date est remplie
    case 'le': return v.map((x) => `(${intervalle(jourSql(x), lendemain(x))})`).join(' OR ') || garde
    case 'avant': return intervalle(null, jourSql(v[0]))
    case 'apres': return intervalle(lendemain(v[0]), null)
    case 'depuis': return intervalle(jourSql(v[0]), null)
    case 'entre': {
      if (v.length !== 2) throw new ErreurHttp(400, 'Il faut deux dates.')
      const [a, b] = [...v].sort((x, y) => String(x).replace(/-/g, '').localeCompare(String(y).replace(/-/g, '')))
      return intervalle(jourSql(a), lendemain(b))
    }
    case 'derniers': return intervalle(duree(), 'CURDATE() + INTERVAL 1 DAY')
    case 'plus_de': return intervalle(null, duree())
    case 'periode': {
      const p = PERIODES_SQL[v[0]]
      if (!p) throw new ErreurHttp(400, `Période inconnue : ${v[0]}`)
      return intervalle(...p)
    }
    default: throw new ErreurHttp(400, `Choix de date inconnu : ${quand}`)
  }
}

// La clé d'une table (sinon sa première colonne) : sert à dire qu'une ligne liée existe.
const cleDe = (t) => t.colonnes.find((c) => c.cle) || t.colonnes[0]
// Un champ rempli : non nul (et, pour un texte, pas vide).
const rempli = (e, colonne) => (NUMERIQUE.test(colonne.type || '') ? `${e} IS NOT NULL` : `(${e} IS NOT NULL AND ${e} <> '')`)
const echapper = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")
const litteral = (v) => (/^-?\d+(\.\d+)?$/.test(String(v)) ? String(v) : `'${echapper(v)}'`)
// Une colonne texte garde ses zéros (« 0012 ») : la valeur reste entre apostrophes.
const NUMERIQUE = /^(int|bigint|smallint|tinyint|mediumint|decimal|numeric|float|double)/i
const litteralPour = (colonne, v) => (NUMERIQUE.test(colonne.type || '') && /^-?\d+(\.\d+)?$/.test(String(v)) ? String(v) : `'${echapper(v)}'`)

// ---------------------------------------------------------------- choix guidés

const sansAccents = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

// Les machines (nœuds de l'arborescence) les plus proches des mots donnés : { code, libelle, chemin }.
function machinesProches(arbre, noeuds, q, max) {
  const mots = sansAccents(q).split(/[^a-z0-9]+/).filter(Boolean)
  // Un mot entier compte plus qu'un bout de mot (« chargement » n'est pas « déchargement »), un nombre plus encore.
  const score = (n) => {
    const texte = sansAccents(`${n.code} ${n.desi}`)
    const entiers = new Set(texte.split(/[^a-z0-9]+/))
    return mots.reduce((s, m) => s + (entiers.has(m) ? (/^\d+$/.test(m) ? 5 : 3) : texte.includes(m) ? 1 : 0), 0)
  }
  return noeuds
    .filter((n) => n.code)
    .map((n) => ({ n, s: score(n) }))
    .sort((a, b) => b.s - a.s || a.n.code.localeCompare(b.n.code, 'fr', { numeric: true }))
    .slice(0, max)
    .map(({ n, s }) => ({ code: n.code, libelle: n.desi && n.desi !== n.code ? `${n.code} — ${n.desi}` : n.code, chemin: cheminDe(arbre, n), score: s }))
}

// Le type d'objet d'une table pour les fiches techniques (la valeur de la colonne « type »), d'après le modèle.
const typeDeTable = (modele, table) => Object.entries(modele?.objets || {}).find(([, o]) => o.table.toLowerCase() === String(table).toLowerCase())?.[0] || null

async function listeFiche(quoi, q) {
  const m = lireModele()
  const ft = m?.ficheTechnique
  if (!ft) throw new ErreurHttp(409, 'Fiches techniques non décrites : Configuration › Modèle de données.')
  const type = q.type || typeDeTable(m, q.table)
  if (!type) return []
  const v = ft.valeurs
  const typeSql = litteral(type)
  if (quoi === 'modeles') {
    const r = await executerRequete(`SELECT ${ft.modeles.table}.${ft.modeles.cle}, ${ft.modeles.table}.${ft.modeles.code || ft.modeles.cle}, ${ft.modeles.table}.${ft.modeles.nom || ft.modeles.code}, COUNT(*) FROM ${v.table} JOIN ${ft.modeles.table} ON ${ft.modeles.table}.${ft.modeles.cle} = ${v.table}.${v.modele} WHERE ${v.table}.${v.typeObjet} = ${typeSql} GROUP BY 1, 2, 3 ORDER BY 2 LIMIT 300`, 300)
    return r.lignes.map((l) => ({ valeur: String(l[0]), libelle: l[2] && l[2] !== l[1] ? `${l[1]} — ${l[2]}` : String(l[1]), code: String(l[1]), type }))
  }
  if (quoi === 'champs') {
    const r = await executerRequete(`SELECT ${ft.champs.table}.${ft.champs.cle}, ${ft.champs.table}.${ft.champs.code || ft.champs.cle}, ${ft.champs.table}.${ft.champs.nom || ft.champs.code}, COUNT(*) FROM ${v.table} JOIN ${ft.champs.table} ON ${ft.champs.table}.${ft.champs.cle} = ${v.table}.${v.champ} WHERE ${v.table}.${v.typeObjet} = ${typeSql} AND ${v.table}.${v.modele} = ${litteral(q.modele)} GROUP BY 1, 2, 3 ORDER BY 3 LIMIT 300`, 300)
    return r.lignes.map((l) => ({ valeur: String(l[0]), libelle: String(l[2] || l[1]), code: String(l[1]) }))
  }
  const r = await executerRequete(`SELECT ${v.valeur}, COUNT(*) FROM ${v.table} WHERE ${v.typeObjet} = ${typeSql} AND ${v.modele} = ${litteral(q.modele)} AND ${v.champ} = ${litteral(q.champ)} AND ${v.valeur} IS NOT NULL AND ${v.valeur} <> '' GROUP BY 1 ORDER BY 2 DESC LIMIT 40`, 40)
  return r.lignes.map((l) => ({ valeur: String(l[0]), libelle: String(l[0]), nombre: Number(l[1]) }))
}

// La condition SQL d'un choix guidé. Parc ou machine : les machines de l'arborescence sous le parc ou la machine
// (elle comprise), par leur code ; fiche technique : la table qui la porte a une valeur pour ce modèle et ce champ.
async function conditionGuidee(f, jointes, depart, schema) {
  const m = lireModele()
  if (f.guide === 'parc' || f.guide === 'machine') {
    if (!m?.machine) throw new ErreurHttp(409, 'Machines non décrites : Configuration › Modèle de données.')
    if (!jointes.has(tableDe(schema, m.machine.table)?.nom)) throw new ErreurHttp(400, 'La table des machines n’est pas dans le chemin : ajoutez-la (Ctrl + Maj + clic).')
    const arbre = await lireArbre()
    if (!arbre) throw new ErreurHttp(409, 'Arborescence illisible (requête réglée dans PDRTEC).')
    let racines = []
    if (f.guide === 'parc') racines = lireParcs().find((x) => x.id === String(f.valeur))?.racines || []
    else racines = [...arbre.noeuds.values()].filter((n) => n.code === String(f.valeur)).map((n) => n.id)
    const codes = [...new Set(sousLesNoeuds(arbre, racines).map((n) => n.code).filter(Boolean))]
    if (!codes.length) return '1 = 0'
    return `${tableDe(schema, m.machine.table).nom}.${m.machine.code} IN (${codes.map(litteral).join(', ')})`
  }
  if (f.guide === 'fiche') {
    const ft = m?.ficheTechnique
    const objet = m?.objets?.[f.type]
    if (!ft || !objet) throw new ErreurHttp(409, 'Fiches techniques non décrites : Configuration › Modèle de données.')
    const table = tableDe(schema, objet.table)
    if (!table || !jointes.has(table.nom)) throw new ErreurHttp(400, `La table ${objet.table} n’est pas dans le chemin.`)
    const v = ft.valeurs
    const valeurs = (Array.isArray(f.valeurs) ? f.valeurs : [f.valeur]).filter((x) => x !== undefined && x !== null && x !== '')
    return `EXISTS (SELECT 1 FROM ${v.table} ft WHERE ft.${v.typeObjet} = ${litteral(f.type)} AND ft.${v.idObjet} = ${table.nom}.${objet.cle} AND ft.${v.modele} = ${litteral(f.modele)}${f.champ ? ` AND ft.${v.champ} = ${litteral(f.champ)}` : ''}${valeurs.length ? ` AND ft.${v.valeur} IN (${valeurs.map(litteral).join(', ')})` : ''})`
  }
  return null
}

// Le modèle de données enregistré : chaque table et chaque colonne doit exister (rien d'autre n'entre dans le SQL).
function verifierModele(modele, schema) {
  const verifier = (table, colonnes) => {
    const t = tableDe(schema, table)
    if (!t) throw new ErreurHttp(400, `Table inconnue : ${table}`)
    for (const c of colonnes.filter(Boolean)) if (!colonneDe(t, c)) throw new ErreurHttp(400, `Colonne inconnue : ${table}.${c}`)
  }
  const ft = modele?.ficheTechnique
  if (ft) {
    verifier(ft.valeurs.table, [ft.valeurs.modele, ft.valeurs.champ, ft.valeurs.valeur, ft.valeurs.typeObjet, ft.valeurs.idObjet])
    verifier(ft.modeles.table, [ft.modeles.cle, ft.modeles.code, ft.modeles.nom])
    verifier(ft.champs.table, [ft.champs.cle, ft.champs.code, ft.champs.nom])
  }
  for (const o of Object.values(modele?.objets || {})) verifier(o.table, [o.cle, o.nom])
  if (modele?.machine) verifier(modele.machine.table, [modele.machine.cle, modele.machine.code, modele.machine.nom])
}
