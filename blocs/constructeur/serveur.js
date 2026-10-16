// Constructeur de rapports : la façon simple de créer un rapport, par formulaire.
// On choisit un sujet, des colonnes, des filtres, une présentation ; BiRTEC écrit lui-même le SQL
// (jointures prises dans le dictionnaire et les liens) et montre l'aperçu à chaque changement.
// L'IA ne sert qu'à pré-remplir le formulaire à partir d'une phrase.

import { ErreurHttp } from '../../serveur/socle/http.js'
import { discuter, iaInstallee } from '../../serveur/socle/ia.js'
import { executerRequete, etatConnexion } from '../../serveur/socle/mysql.js'
import { obtenirSchema } from '../base/schema.js'
import { sujets, champsDuSujet } from './catalogue.js'
import { construire } from './requete.js'
import { genererRapport, sqlAvecValeurs, extraireJson } from '../rapports/serveur.js'
import { reglagesITM, tester } from '../itm/serveur.js'
import { trouverFenetre, formaterNom } from '../itm/indicateur.js'
import { enregistrerIndicateur } from '../../serveur/socle/birtec.js'

// Le champ du catalogue qui correspond le mieux à quelques mots (« ligne », « temps d'arrêt »…).
// Un mot qui désigne une table liée (« ligne », « type de maintenance ») donne son code ou sa désignation.
function trouverChamp(cat, texte, filtre = () => true) {
  const mots = normaliser(texte).split(/[^a-z0-9]+/).filter((m) => m.length > 2)
  if (!mots.length) return null
  let meilleur = null
  for (const c of cat.champs.filter(filtre)) {
    const libelle = normaliser(c.libelle)
    const groupe = normaliser(c.groupe.split(' › ').at(-1))
    let score = 0
    for (const m of mots) {
      if (libelle.includes(m)) score += 3
      else if (groupe.includes(m)) score += 2
    }
    if (!score) continue
    // Pour une table désignée par son nom, sa désignation (ou son code) plutôt qu'une autre colonne.
    if (/^(designation|code)/.test(libelle) && mots.some((m) => groupe.includes(m))) score += 1.5
    score -= c.niveau * 0.4 + (c.multiplie ? 0.3 : 0)
    if (!meilleur || score > meilleur.score) meilleur = { id: c.id, score }
  }
  return meilleur?.id || null
}

function sujetParLesMots(liste, phrase) {
  // Seulement le début de la phrase, avant « par », « avec »… : c'est là qu'on nomme ce qu'on liste.
  const debut = normaliser(phrase).split(/\b(par|avec|sur|pour|dont|qui|sous|selon|en|du|des \d)\b/)[0]
  const mots = debut.split(/[^a-z0-9]+/).map((m) => m.replace(/(s|x)$/, '')).filter((m) => m.length > 2)
  let meilleur = null
  for (const s of liste.filter((x) => x.decrite)) {
    const siens = normaliser(s.libelle).split(/[^a-z0-9]+/).map((m) => m.replace(/(s|x)$/, '')).filter((m) => m.length > 2)
    let score = 0
    mots.forEach((m, i) => { if (siens.includes(m)) score += 1 + 1 / (1 + i) + (siens[0] === m ? 1 : 0) })
    if (score && (!meilleur || score > meilleur.score)) meilleur = { table: s.table, score }
  }
  return meilleur?.table || null
}

function normaliser(texte) {
  return String(texte || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Les valeurs existantes d'un champ, les plus fréquentes d'abord.
async function valeursDe(cat, champ) {
  const { description: d, erreurs } = description({ sujet: cat.sujet.table, mode: 'synthese', regroupements: [{ champ }], mesures: [{ fonction: 'nombre' }], etat: 'sans_corbeille' }, cat)
  if (erreurs.length) throw new ErreurHttp(400, erreurs.join(' ; '))
  const r = await executerRequete(`SELECT * FROM (${d.requete.replace(/\nORDER BY[\s\S]*$/, '')}) AS v ORDER BY 2 DESC`, 300)
  return r.lignes.filter((l) => l[0] !== null && l[0] !== '').map((l) => ({ valeur: l[0], nombre: Number(l[1]) }))
}

async function catalogue(table) {
  const c = champsDuSujet(await obtenirSchema(), table)
  if (!c.sujet) throw new ErreurHttp(404, `Sujet inconnu : ${table}`)
  return c
}

// La description de rapport (format du générateur) tirée de l'état du formulaire.
function description(etat, cat, aspect = {}) {
  const r = construire(etat, cat)
  const d = {
    titre: aspect.titre || `${cat.sujet.libelle}`,
    sousTitre: aspect.sousTitre || '',
    orientation: aspect.orientation || (r.colonnes.length > 6 ? 'paysage' : 'portrait'),
    requete: r.sql,
    parametres: r.parametres,
    liaisons: r.liaisons,
    colonnes: r.colonnes,
    groupes: r.groupes,
    theme: aspect.theme || 'charte',
    logo: aspect.logo !== false,
    image: aspect.image || null,
    description: aspect.description || '',
    positionDescription: aspect.positionDescription || 'entete',
    constructeur: etat, // pour rouvrir le formulaire plus tard
  }
  return { description: d, erreurs: r.erreurs, avertissements: r.avertissements }
}

export function routes(r) {
  r.get('/api/constructeur/sujets', async () => sujets(await obtenirSchema()))

  r.get('/api/constructeur/champs/:table', async (ctx) => {
    const c = await catalogue(ctx.params.table)
    return { sujet: c.sujet, champs: c.champs }
  })

  // Aperçu : la requête construite, ses 50 premières lignes et le nombre total de lignes.
  r.post('/api/constructeur/apercu', async (ctx) => {
    const { etat, aspect } = await ctx.json()
    const cat = await catalogue(etat.sujet)
    const { description: d, erreurs, avertissements } = description(etat, cat, aspect)
    if (erreurs.length) return { erreurs, avertissements, sql: d.requete }
    if (!etatConnexion().ouverte) return { erreurs: [], avertissements: [...avertissements, 'Connexion MySQL fermée : pas d’aperçu.'], sql: d.requete }
    const sql = sqlAvecValeurs(d)
    try {
      const [lignes, compte] = await Promise.all([
        executerRequete(sql, 50),
        executerRequete(`SELECT COUNT(*) FROM (${sql}) AS birtec_compte`, 1),
      ])
      return { erreurs: [], avertissements, sql: d.requete, colonnes: d.colonnes, resultat: lignes, total: Number(compte.lignes[0][0]) }
    } catch (erreur) {
      return { erreurs: [erreur.message], avertissements, sql: d.requete }
    }
  })

  // Les valeurs existantes d'un champ (pour choisir un filtre dans une liste).
  r.post('/api/constructeur/valeurs', async (ctx) => {
    const { sujet, champ } = await ctx.json()
    return valeursDe(await catalogue(sujet), champ)
  })

  // POST /api/constructeur/creer { etat, aspect } : fabrique le rapport (sans passer par l'IA).
  r.post('/api/constructeur/creer', async (ctx) => {
    const { etat, aspect, nom } = await ctx.json()
    const cat = await catalogue(etat.sujet)
    const { description: d, erreurs } = description(etat, cat, aspect)
    if (erreurs.length) throw new ErreurHttp(400, erreurs.join(' ; '))
    return genererRapport(d, nom)
  })

  // POST /api/constructeur/indicateur { etat, nom, dateIndicateur?, arborescence?, enregistrer? }
  // Le même formulaire donne un indicateur ITM : le sujet est la table comptée, les filtres font le WHERE.
  // BiRTEC écrit la requête indicateur et la requête liste, les essaie, et les range dans le .birtec.
  r.post('/api/constructeur/indicateur', async (ctx) => {
    const { etat, nom, dateIndicateur = null, arborescence = true, enregistrer = false } = await ctx.json()
    const cat = await catalogue(etat.sujet)
    const reglages = await reglagesITM()
    const fenetre = trouverFenetre(reglages, cat.sujet.table)
    if (!fenetre) throw new ErreurHttp(400, `« ${cat.sujet.libelle} » ne peut pas être compté par un indicateur : la table doit avoir un identifiant, un code, une désignation et un état (ACTIF).`)
    if ((etat.filtres || []).some((f) => f.operateur === 'periode' && f.valeurs?.[0] === 'demandee')) {
      throw new ErreurHttp(400, 'Un indicateur n’a pas de paramètre : remplacez la période « choisie au lancement » par une période fixe (mois en cours, 12 derniers mois…).')
    }
    // Le sujet garde son nom de table : les variables de la GMAO ({{ARBO_FILTRE_…}}) s'écrivent avec lui.
    const t = cat.sujet.table
    const r = construire({ ...etat, mode: 'synthese', regroupements: [], mesures: [{ fonction: 'nombre' }], tri: null }, cat, { aliasSujet: t })
    const de = r.sql.slice(r.sql.indexOf('\nFROM ') + 1).replace(/\nGROUP BY[\s\S]*$/, '').replace(/\nORDER BY[\s\S]*$/, '')
    const [jointures, conditions = ''] = de.split('\nWHERE ')
    const filtres = [arborescence && fenetre.variableArbo ? fenetre.variableArbo : null, conditions.trim() || null].filter(Boolean)
    const ou = filtres.length ? `\nWHERE ${filtres.join('\n  AND ')}` : ''
    const nomFinal = formaterNom(nom || cat.sujet.libelle)
    const date = dateIndicateur && cat.champs.find((c) => c.id === dateIndicateur)
    const colonnes = [`${t}.${fenetre.id} AS ID`, `${t}.${fenetre.code} AS CODE`, `${t}.${fenetre.desi} AS DESI1`, `${t}.${fenetre.actif} AS ACTIF`]
    if (date && date.niveau === 0) colonnes.push(`${t}.${date.colonne} AS DATE_INDICATEUR`)
    const requeteIndicateur = `-- ${nomFinal}\nSELECT COUNT(DISTINCT ${t}.${fenetre.id}) AS VAL\n${jointures}${ou}`
    const requeteListe = `-- ${nomFinal}\nSELECT DISTINCT\n  ${colonnes.join(',\n  ')}\n${jointures}${ou}\nORDER BY ${date && date.niveau === 0 ? 'DATE_INDICATEUR' : 'CODE'}`
    const essai = etatConnexion().ouverte ? await tester(requeteIndicateur, requeteListe) : { erreurs: [], avertissements: ['Connexion MySQL fermée : requêtes non essayées.'] }
    let id = null
    if (enregistrer && !essai.erreurs.length) {
      id = enregistrerIndicateur({ nom: nomFinal, fenetre: fenetre.libelle, demande: `Créé avec le formulaire « Nouveau rapport »`, definition: { constructeur: etat, dateIndicateur, arborescence }, requeteIndicateur, requeteListe, source: 'formulaire' })
    }
    return { id, nom: nomFinal, fenetre: fenetre.libelle, variableArbo: fenetre.variableArbo || null, requeteIndicateur, requeteListe, ...essai }
  })

  // POST /api/constructeur/proposer { phrase, sujet? } : l'IA remplit le formulaire d'après une phrase.
  r.post('/api/constructeur/proposer', async (ctx) => {
    const { phrase, sujet } = await ctx.json()
    if (!phrase?.trim()) throw new ErreurHttp(400, 'Décrivez le rapport en une phrase.')
    if (!iaInstallee()) throw new ErreurHttp(409, 'L’IA n’est pas installée sur ce poste.')
    const schema = await obtenirSchema()

    // 1. Le sujet (si l'utilisateur ne l'a pas choisi).
    // Le sujet : d'abord par les mots de la phrase (le premier nom cité l'emporte : « pièces … avec le magasin »).
    let table = sujet || sujetParLesMots(sujets(schema), phrase)
    if (!table) {
      const liste = sujets(schema).filter((s) => s.decrite).map((s) => `${s.table} : ${s.libelle}${s.description ? ` — ${s.description.slice(0, 120)}` : ''}`).join('\n')
      const reponse = await discuter([
        { role: 'system', content: 'Tu choisis la table principale d’un rapport de maintenance. Réponds uniquement par le nom de la table (première colonne de la liste), rien d’autre.' },
        { role: 'user', content: `TABLES :\n${liste}\n\nRAPPORT DEMANDÉ : ${phrase}` },
      ], { temperature: 0, maxMots: 20 })
      table = reponse.trim().split(/[\s:]/)[0].replace(/[`'"]/g, '')
    }
    const cat = await catalogue(table)

    // 2. L'IA ne fait que comprendre la phrase (des mots simples) ; BiRTEC associe ces mots aux champs du
    //    catalogue et cherche dans la base la valeur exacte des filtres. Rapide, et rien n'est inventé.
    const reponse = await discuter([
      {
        role: 'system',
        content: `Tu analyses la demande d'un rapport de maintenance et tu en extrais les éléments, en mots simples (tels que l'utilisateur les dit). Réponds uniquement par ce JSON :
{"titre": "titre court du rapport", "mode": "liste" ou "synthese",
 "colonnes": ["ce qu'il faut afficher, un mot ou deux par colonne"],
 "regrouper_par": [{"quoi": "…", "par": "valeur|mois|annee"}],
 "mesures": [{"fonction": "nombre|somme|moyenne|max|min", "de": "… (vide pour un nombre)"}],
 "filtres": [{"sur": "…", "valeur": "…"}],
 "comparaisons": [{"colonne": "…", "operateur": "<|<=|>|>=|=|<>", "autre": "…"}],
 "periode": {"sur": "… (date concernée, vide si non précisé)", "valeur": "mois_en_cours|mois_precedent|30_jours|annee_en_cours|12_mois|depassee|a_venir|demandee"} ou null}
« synthese » dès qu'il est question de nombre, de total, de « par » quelque chose ; sinon « liste ».
Un type ou une catégorie cité (dépannage, préventif, entretien…) est un filtre : {"sur": "type de maintenance", "valeur": "dépannage"}.
Une période choisie au lancement du rapport : "demandee".
« En retard » : {"sur": "date limite", "valeur": "depassee"}. « À venir », « à faire bientôt » : "a_venir".
Une comparaison entre deux valeurs de la même fiche est une « comparaison » : « sous le stock minimum » = {"colonne": "stock réel", "operateur": "<", "autre": "stock minimum"}.`,
      },
      { role: 'user', content: `SUJET : ${cat.sujet.libelle}\nDEMANDE : ${phrase}` },
    ], { temperature: 0, maxMots: 500 })
    const p = extraireJson(reponse)
    if (!p) throw new ErreurHttp(502, 'L’IA n’a pas rendu de proposition lisible : remplissez le formulaire, ou reformulez.')

    const nombres = (c) => c.nature === 'nombre'
    const dates = (c) => c.nature === 'date' || c.nature === 'date8'
    // La date « métier » du sujet : décrite, et pas une date de saisie ou de modification.
    const metier = (c) => c.niveau === 0 && dates(c) && !/saisie|modif/.test(normaliser(c.libelle))
    const dateMetier = cat.champs.find((c) => metier(c) && c.decrit)?.id || cat.champs.find(metier)?.id || cat.champs.find((c) => c.niveau === 0 && dates(c))?.id
    const etat = {
      sujet: cat.sujet.table,
      mode: p.mode === 'synthese' ? 'synthese' : 'liste',
      champs: (p.colonnes || []).map((t) => trouverChamp(cat, t)).filter(Boolean),
      regroupements: (p.regrouper_par || []).map((g) => {
        const parDate = g.par === 'mois' || g.par === 'annee' || /\b(mois|annee|semaine|jour)\b/.test(normaliser(g.quoi))
        const par = g.par && g.par !== 'valeur' ? g.par : /annee/.test(normaliser(g.quoi)) ? 'annee' : parDate ? 'mois' : 'valeur'
        return { champ: parDate ? trouverChamp(cat, g.quoi, (c) => dates(c) && c.niveau === 0) || dateMetier : trouverChamp(cat, g.quoi), par }
      }).filter((g) => g.champ),
      mesures: (p.mesures || []).map((m) => (m.fonction && m.fonction !== 'nombre' && m.de ? { fonction: m.fonction, champ: trouverChamp(cat, m.de, nombres) } : { fonction: 'nombre', champ: null })).filter((m) => m.fonction === 'nombre' || m.champ),
      filtres: [],
      etat: 'sans_corbeille',
      totaux: true,
    }
    if (!etat.mesures.length) etat.mesures = [{ fonction: 'nombre', champ: null }]
    const nonTrouves = []
    // Une comparaison répétée par l'IA comme filtre (« stock réel : stock minimum ») n'est pas un filtre de plus.
    const compares = (p.comparaisons || []).flatMap((c) => [c.colonne, c.autre]).map(normaliser).filter(Boolean)
    for (const f of p.filtres || []) {
      if (compares.some((x) => normaliser(`${f.sur} ${f.valeur}`).includes(x))) continue
      const champ = trouverChamp(cat, f.sur, (c) => c.nature === 'texte')
      if (!champ || !f.valeur) continue
      // La valeur exacte telle qu'elle est dans la base (« dépannage » → « Intervention de dépannage »).
      const valeurs = await valeursDe(cat, champ).catch(() => [])
      const cherche = normaliser(f.valeur)
      const trouvees = valeurs.filter((v) => normaliser(v.valeur).includes(cherche)).map((v) => String(v.valeur))
      if (trouvees.length) etat.filtres.push({ champ, operateur: 'egal', valeurs: trouvees.slice(0, 10) })
      else nonTrouves.push(`${f.sur} : ${f.valeur}`)
    }
    for (const c of p.comparaisons || []) {
      const comparables = (x) => x.nature !== 'texte'
      const gauche = trouverChamp(cat, c.colonne, comparables)
      const droite = trouverChamp(cat, c.autre, comparables)
      if (gauche && droite && gauche !== droite) etat.filtres.push({ champ: gauche, operateur: 'compare', valeurs: [c.operateur || '<', droite] })
      else nonTrouves.push(`${c.colonne} ${c.operateur} ${c.autre}`)
    }
    // « En retard » : date limite dépassée, sur les fiches courantes (même si l'IA ne l'a pas relevé).
    const phraseN = normaliser(phrase)
    if (/en retard|depasse/.test(phraseN) && p.periode?.valeur !== 'depassee') {
      const limite = cat.champs.find((c) => c.niveau === 0 && dates(c) && /limite|echeance/.test(normaliser(c.libelle)))
      if (limite) p.periode = { sur: limite.libelle, valeur: 'depassee' }
    }
    if (/en retard|a faire|en cours|ouvert/.test(phraseN)) etat.etat = 'courantes'
    if (p.periode?.valeur) {
      // Sans précision : la date du regroupement par mois s'il y en a un, sinon la date « métier » du sujet.
      const champ = (p.periode.sur && trouverChamp(cat, p.periode.sur, dates)) || etat.regroupements.find((g) => g.par !== 'valeur')?.champ || dateMetier
      if (champ) etat.filtres.push({ champ, operateur: 'periode', valeurs: [p.periode.valeur] })
    }
    // Une synthèse sans « regrouper par » n'a pas de sens : liste détaillée.
    if (etat.mode === 'synthese' && !etat.regroupements.length) etat.mode = 'liste'
    if (etat.mode === 'liste' && !etat.champs.length) etat.champs = cat.champs.filter((c) => c.niveau === 0 && c.decrit).slice(0, 4).map((c) => c.id)
    const avertissements = nonTrouves.length ? [`Filtre(s) non trouvé(s) dans la base, à ajouter à la main : ${nonTrouves.join(' ; ')}`] : []
    return { etat, titre: p.titre || '', avertissements }
  })
}
