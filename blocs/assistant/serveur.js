// L'assistant : aide à écrire les requêtes SQL et à concevoir les rapports BIRT, à partir de la vraie
// structure de la base MySQL.
//
// À chaque question : on choisit les tables utiles (blocs/base/schema.js), on les décrit à l'IA avec
// les consignes ci-dessous, et la réponse est envoyée au navigateur au fur et à mesure.
// Les consignes (CONSIGNES) sont l'endroit où ajuster le comportement de l'IA.

import { ouvrirFlux } from '../../serveur/socle/http.js'
import { discuter, iaInstallee } from '../../serveur/socle/ia.js'
import { obtenirSchema, tablesUtiles, decrireTables, connaissancesUtiles, tablesDesRequetes, tablesDesConventions } from '../base/schema.js'
import { listerNotes, listerRequetes } from '../../serveur/socle/birtec.js'

const CONSIGNES = `Tu es BiRTEC, un assistant expert en rapports Eclipse BIRT 4.x et en SQL MySQL, pour la personne qui conçoit les rapports de la GMAO.

Règles :
- Réponds en français, clairement, sans formule de politesse.
- Pour toute requête, écris du SQL MySQL dans un bloc \`\`\`sql … \`\`\`, une seule requête par bloc, terminée sans point-virgule.
- N'utilise que les tables et colonnes de la STRUCTURE fournie. Si une information manque (table ou colonne inconnue), dis-le et demande au lieu d'inventer.
- Uniquement des requêtes de lecture (SELECT, WITH). La base est en lecture seule : n'écris jamais INSERT, UPDATE, DELETE, CREATE, DROP.
- Donne des alias de colonnes lisibles en français (AS nb_ot, AS heures_totales…) : ils deviendront les colonnes du rapport.
- Pour les paramètres d'un rapport BIRT, écris « ? » dans la requête et précise à quoi il correspond (BIRT les remplace par les paramètres du rapport).
- Pour une période relative (« mois en cours », « année dernière »), calcule les dates dans la requête (CURDATE(), DATE_FORMAT, INTERVAL) au lieu d'écrire des dates fixes : le rapport doit rester juste le mois suivant.
- Respecte les CONVENTIONS DU SITE quand elles sont fournies (format des dates, statuts, filtres habituels…) et inspire-toi des REQUÊTES DÉJÀ ÉCRITES SUR CE SITE.
- Pour un rapport BIRT, une fois la demande claire, termine par sa description dans un bloc \`\`\`rapport … \`\`\` contenant ce JSON (BiRTEC en fabriquera le .rptdesign) :
  {"titre": "…", "sousTitre": "…", "orientation": "portrait" ou "paysage", "requete": "SELECT …",
   "parametres": [{"nom": "debut", "libelle": "Du", "type": "texte|entier|decimal|date|dateheure", "defaut": "…"}],
   "liaisons": ["debut", "fin"],
   "colonnes": [{"champ": "alias_exact_de_la_requete", "libelle": "Titre de colonne", "format": "texte|entier|decimal|pourcentage|date|dateheure", "total": "somme|moyenne|nombre|min|max"}],
   "groupes": [{"champ": "alias_de_regroupement", "libelle": "…", "sousTotaux": true}]}
  « liaisons » donne, dans l'ordre, le paramètre de chaque « ? » de la requête. « total » et « groupes » sont facultatifs. Trie la requête par les champs de groupe.
- Si la demande est ambiguë (quelle période ? quel regroupement ?), pose 1 à 3 questions courtes avant d'écrire la requête.
- Aujourd'hui, nous sommes le {date}.`

export function routes(r) {
  // POST /api/assistant { question, historique: [{ role, contenu }] }
  // Réponse en flux : « tables » (tables données à l'IA), puis des « texte », puis « fin » (ou « erreur »).
  r.post('/api/assistant', async (ctx) => {
    const { question, historique = [] } = await ctx.json()
    const flux = ouvrirFlux(ctx.res)
    const arret = new AbortController()
    ctx.res.on('close', () => arret.abort())

    try {
      if (!iaInstallee()) {
        flux.envoyer('texte', "L'IA n'est pas installée sur ce poste : lancez la préparation (voir l'aide).")
        return flux.envoyer('fin', {})
      }

      // La structure de la base (lue sur MySQL, ou celle du fichier .birtec si la connexion est fermée),
      // et les connaissances du site : conventions, notes et requêtes déjà écrites.
      let structure = 'STRUCTURE : inconnue (connexion MySQL fermée et fichier .birtec vide). Réponds de façon générale et signale que la connexion permettrait une réponse précise.'
      const schema = await obtenirSchema()
      const precedentes = historique.filter((m) => m.role === 'agent').slice(-2).map((m) => m.contenu).join(' ')
      const recherche = `${question} ${precedentes}`
      const connaissances = { notes: listerNotes(), requetes: listerRequetes() }
      // Les tables des requêtes du site proches de la question sont données d'office à l'IA.
      // Idem pour les tables citées par les conventions du site sur le sujet de la question.
      const imposees = [...new Set([...tablesDesConventions(connaissances.notes, question, schema), ...tablesDesRequetes(connaissancesUtiles(recherche, [], connaissances).exemples)])]
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
      }
      const site = connaissancesUtiles(recherche, tables, connaissances)
      flux.envoyer('tables', { tables: tables.map((t) => t.nom), notes: site.notes, requetes: site.requetes, direct: schema.direct })
      if (site.texte) structure = `${site.texte}\n\n${structure}`

      const consignes = CONSIGNES.replace('{date}', new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }))
      const precedents = historique.slice(-8).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.contenu).slice(0, 4000) }))
      await discuter(
        [{ role: 'system', content: consignes }, ...precedents, { role: 'user', content: `${structure}\n\nDEMANDE : ${question}` }],
        { surMorceau: (morceau) => flux.envoyer('texte', morceau), signal: arret.signal, temperature: 0.2, maxMots: 2500 },
      )
      flux.envoyer('fin', {})
    } catch (erreur) {
      if (!arret.signal.aborted) flux.envoyer('erreur', { message: erreur.message })
    } finally {
      flux.fermer()
    }
  })
}
