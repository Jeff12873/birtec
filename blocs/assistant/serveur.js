// L'assistant : le point d'entrée unique pour les requêtes SQL, les rapports BIRT et les indicateurs ITM,
// à partir de la vraie structure de la base MySQL et des connaissances du site (fichier .ktec).
//
// À chaque question : on choisit les tables utiles (blocs/base/schema.js), on les décrit à l'IA avec
// les règles ci-dessous et la démarche voulue par l'utilisateur (« consignes », modifiables, gardées
// dans le .ktec), et la réponse est envoyée au navigateur au fur et à mesure.
// Avant de laisser la réponse, BiRTEC contrôle chaque requête (tables et colonnes existantes) ; en cas
// d'erreur, il fait réécrire la réponse par l'IA (2 fois au plus).

import { ouvrirFlux, ErreurHttp } from 'ktec/http.js'
import { discuter, iaInstallee } from 'ktec/ia.js'
import { obtenirSchema, tablesUtiles, decrireTables, connaissancesUtiles, tablesDesRequetes, tablesDesConventions, cheminsDeJointure } from '../base/schema.js'
import { verifierSQL, requetesDeLaReponse } from '../base/verification.js'
import { listerNotes, listerRequetes, listerIndicateurs, lireInfo, ecrireInfo } from 'ktec/ktec.js'
import { reglagesITM, reglesIndicateur } from '../itm/serveur.js'
import { verifierDefinition, assembler } from '../itm/indicateur.js'
import { THEMES } from '../rapports/generateur.js'

const CORRECTIONS_MAX = 2

// La démarche par défaut (modifiable dans l'assistant, bouton « Consignes »).
export const CONSIGNES_PAR_DEFAUT = `Réponds directement à la question, sans questionnaire préalable : les rapports et indicateurs courants se font dans le formulaire « Nouveau rapport ».
Pose une question seulement si la demande est vraiment impossible à comprendre, et une seule.
Pour une requête : donne-la, puis explique-la en deux ou trois phrases (tables utilisées, filtres).
Pour expliquer une table ou un lien : sois concret, avec les colonnes utiles et un exemple de jointure.`

const REGLES = `Tu es BiRTEC, un assistant expert en SQL MySQL, en rapports Eclipse BIRT 4.x et en indicateurs de maintenance. On te pose des questions libres : expliquer la base, écrire une requête inhabituelle (calcul, comparaison, sous-requête), comprendre une requête existante.

Règles :
- Réponds en français, clairement, sans formule de politesse.
- N'utilise que les tables et colonnes de la STRUCTURE fournie, avec le sens donné par leurs noms clairs (« … »). Ne devine jamais le sens d'une abréviation : si une information manque, dis-le et demande.
- Pour toute requête, écris du SQL MySQL dans un bloc \`\`\`sql … \`\`\`, une seule requête par bloc, sans point-virgule final.
- Uniquement des requêtes de lecture (SELECT, WITH) : n'écris jamais INSERT, UPDATE, DELETE, CREATE, DROP.
- Donne des alias de colonnes lisibles en français (AS nb_ot, AS heures_totales…).
- Pour une période relative (« mois en cours »…), calcule les dates dans la requête (CURDATE(), DATE_FORMAT, INTERVAL) au lieu d'écrire des dates fixes.
- Respecte les CONVENTIONS DU SITE et inspire-toi des REQUÊTES DÉJÀ ÉCRITES SUR CE SITE.
- Seulement quand tu poses une question : tu peux terminer par une ligne qui commence par « CHOIX : » suivie des réponses possibles séparées par « | » (ex. « CHOIX : Rapport BIRT | Indicateur ITM »). N'écris jamais de réponses vides ou génériques.
- Seulement quand tu proposes des compléments : une ligne qui commence par « OPTIONS : » suivie des compléments concrets séparés par « | » (ex. « OPTIONS : Ajouter le temps d'arrêt | Grouper par ETH »).
- Quand la demande commence par « combien », la requête renvoie un nombre (COUNT).
- Utilise les CHEMINS DE JOINTURE fournis et les indications du dictionnaire (« ATTENTION », « → ») plutôt que d'inventer tes propres jointures.

RAPPORT BIRT — quand la demande est claire, termine par sa description dans un bloc \`\`\`rapport … \`\`\` contenant ce JSON (BiRTEC fabrique le .rptdesign) :
{"titre": "…", "sousTitre": "…", "orientation": "portrait|paysage", "requete": "SELECT …",
 "parametres": [{"nom": "debut", "libelle": "Du", "type": "texte|entier|decimal|date|dateheure", "defaut": "…"}],
 "liaisons": ["debut", "fin"],
 "colonnes": [{"champ": "alias_exact_de_la_requete", "libelle": "Titre de colonne", "format": "texte|entier|decimal|pourcentage|date|dateheure", "total": "somme|moyenne|nombre|min|max"}],
 "groupes": [{"champ": "alias_de_regroupement", "libelle": "…", "sousTotaux": true}],
 "description": "texte expliquant le rapport, ou vide", "positionDescription": "entete|pied", "logo": true, "theme": "{themes}"}
« liaisons » donne, dans l'ordre, le paramètre de chaque « ? » de la requête. « total », « groupes », « description » sont facultatifs. Trie la requête par les champs de groupe.

INDICATEUR ITM — quand la demande est claire, termine par sa définition dans un bloc \`\`\`indicateur … \`\`\` (BiRTEC en tire la requête indicateur et la requête liste) :
{indicateur}

Aujourd'hui, nous sommes le {date}.`

export function consignesActuelles() {
  return lireInfo('consignes', null) ?? CONSIGNES_PAR_DEFAUT
}

export function routes(r) {
  r.get('/api/assistant/consignes', () => ({ consignes: consignesActuelles(), parDefaut: CONSIGNES_PAR_DEFAUT }))

  r.post('/api/assistant/consignes', async (ctx) => {
    const { consignes } = await ctx.json()
    if (typeof consignes !== 'string') throw new ErreurHttp(400, 'Consignes attendues.')
    ecrireInfo('consignes', consignes.trim() || CONSIGNES_PAR_DEFAUT)
  })

  // POST /api/assistant { question, historique: [{ role, contenu }] }
  // Réponse en flux : « tables » (ce qui est donné à l'IA), des « texte », éventuellement « correction »
  // (la réponse va être réécrite), « avertissement », puis « fin » (ou « erreur »).
  r.post('/api/assistant', async (ctx) => {
    const { question, historique = [] } = await ctx.json()
    const flux = ouvrirFlux(ctx.res)
    const arret = new AbortController()
    ctx.res.on('close', () => arret.abort())

    try {
      if (!iaInstallee()) {
        flux.envoyer('texte', "L'IA n'est pas installée sur ce poste : lancez l'installation de KTEC (voir l'aide).")
        return flux.envoyer('fin', {})
      }

      // La structure de la base (lue sur MySQL, ou celle du fichier .ktec si la connexion est fermée),
      // et les connaissances du site : conventions, notes et requêtes déjà écrites.
      let structure = 'STRUCTURE : inconnue (connexion MySQL fermée et fichier .ktec vide). Réponds de façon générale et signale que la connexion permettrait une réponse précise.'
      const schema = await obtenirSchema()
      const precedentes = historique.filter((m) => m.role === 'agent').slice(-3).map((m) => m.contenu).join(' ')
      const recherche = `${question} ${precedentes}`
      const connaissances = { notes: listerNotes(), requetes: listerRequetes() }
      // Les tables des requêtes du site proches de la question, et celles que citent les conventions
      // sur le sujet de la question, sont données d'office à l'IA.
      const imposees = [...new Set([...tablesDesConventions(connaissances.notes, recherche, schema), ...tablesDesRequetes(connaissancesUtiles(recherche, [], connaissances).exemples)])]
      let tables = []
      if (schema.tables.length) {
        // Les tables des GMAO ont souvent beaucoup de colonnes : on réduit leur nombre si le texte devient trop long pour l'IA.
        let description = ''
        for (let nombre = 12; nombre >= 4; nombre -= 2) {
          tables = tablesUtiles(schema, recherche, nombre, imposees)
          description = decrireTables(tables)
          if (description.length < 22_000) break
        }
        structure = `STRUCTURE DE LA BASE « ${schema.base} » (${tables.length} tables utiles sur ${schema.tables.length}) :\n${description.slice(0, 26_000)}`
        // Les jointures entre les tables principales, toutes calculées : l'IA n'a plus à les deviner.
        const chemins = cheminsDeJointure(tables.slice(0, 6).map((t) => t.nom), schema).slice(0, 12)
        if (chemins.length) structure += `\n\nCHEMINS DE JOINTURE ENTRE CES TABLES (vérifiés, à utiliser tels quels) :\n${chemins.join('\n')}`
      }
      const site = connaissancesUtiles(recherche, tables, connaissances)
      const indicateurs = indicateursProches(recherche)
      flux.envoyer('tables', { tables: tables.map((t) => t.nom), notes: site.notes, requetes: site.requetes, direct: schema.direct })
      if (indicateurs) structure = `${indicateurs}\n\n${structure}`
      if (site.texte) structure = `${site.texte}\n\n${structure}`

      const reglages = await reglagesITM()
      const systeme = REGLES
        .replace('{date}', new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))
        .replace('{themes}', Object.keys(THEMES).join('|'))
        .replace('{indicateur}', reglesIndicateur(reglages, tables.map((t) => t.nom)))
        + `\n\nDÉMARCHE À SUIVRE (consignes de l'utilisateur) :\n${consignesActuelles()}`
      const precedents = historique.slice(-8).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.contenu).slice(0, 4000) }))
      let messages = [{ role: 'system', content: systeme }, ...precedents, { role: 'user', content: `${structure}\n\nDEMANDE : ${question}` }]

      // La réponse, contrôlée puis réécrite si une requête cite une table ou une colonne inexistante.
      for (let tour = 0; ; tour++) {
        let reponse = ''
        let reflexion = 0
        let envoye = 0
        await discuter(messages, {
          surMorceau: (morceau) => {
            reponse += morceau
            flux.envoyer('texte', morceau)
          },
          // Le raisonnement n'est pas montré : seulement sa progression (« L'IA réfléchit… »).
          reflechir: true,
          surReflexion: (morceau) => {
            reflexion += morceau.length
            if (reflexion - envoye >= 400) {
              flux.envoyer('reflexion', reflexion - envoye)
              envoye = reflexion
            }
          },
          signal: arret.signal,
          temperature: 0.1,
          maxMots: 2500,
        })
        const erreurs = controlerReponse(reponse, schema, reglages)
        if (!erreurs.length) break
        if (tour >= CORRECTIONS_MAX) {
          flux.envoyer('avertissement', { erreurs })
          break
        }
        flux.envoyer('correction', { erreurs })
        messages = [
          ...messages,
          { role: 'assistant', content: reponse },
          { role: 'user', content: `BiRTEC a contrôlé ta réponse sur la structure réelle de la base et y a trouvé ces erreurs :\n- ${erreurs.join('\n- ')}\n\nRéécris ta réponse complète, corrigée, sans parler de ce contrôle.` },
        ]
      }
      flux.envoyer('fin', {})
    } catch (erreur) {
      if (!arret.signal.aborted) flux.envoyer('erreur', { message: erreur.message })
    } finally {
      flux.fermer()
    }
  })
}

// Tables et colonnes de chaque requête de la réponse (blocs sql, rapport et indicateur).
function controlerReponse(texte, schema, reglages) {
  if (!schema.tables.length) return []
  const erreurs = []
  for (const sql of requetesDeLaReponse(texte)) erreurs.push(...verifierSQL(sql, schema))
  for (const m of String(texte).matchAll(/```indicateur\s*\n([\s\S]*?)```/g)) {
    let definition
    try {
      definition = JSON.parse(m[1])
    } catch {
      erreurs.push('Le bloc indicateur n’est pas un JSON valide.')
      continue
    }
    const forme = verifierDefinition(definition, reglages)
    if (forme.length) erreurs.push(...forme)
    else erreurs.push(...verifierSQL(assembler(definition, reglages).requeteListe, schema))
  }
  return [...new Set(erreurs)]
}

// Les indicateurs déjà écrits qui ressemblent à la demande : l'IA s'en inspire.
function indicateursProches(recherche) {
  const mots = new Set(recherche.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((m) => m.length > 3))
  const proches = listerIndicateurs()
    .map((i) => ({ i, score: `${i.nom} ${i.demande || ''}`.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter((m) => mots.has(m)).length }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
  if (!proches.length) return ''
  return `INDICATEURS DÉJÀ ÉCRITS SUR CE SITE (exemples) :\n${proches.map(({ i }) => `### ${i.nom}\n${i.definition ? JSON.stringify(i.definition) : i.requeteIndicateur}`).join('\n\n')}`
}
