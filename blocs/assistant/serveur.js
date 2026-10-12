// L'assistant : aide à écrire les requêtes SQL et à concevoir les rapports BIRT, à partir de la vraie
// structure de la base MySQL.
//
// À chaque question : on choisit les tables utiles (blocs/base/schema.js), on les décrit à l'IA avec
// les consignes ci-dessous, et la réponse est envoyée au navigateur au fur et à mesure.
// Les consignes (CONSIGNES) sont l'endroit où ajuster le comportement de l'IA.

import { ouvrirFlux } from '../../serveur/socle/http.js'
import { discuter, iaInstallee } from '../../serveur/socle/ia.js'
import { etatConnexion } from '../../serveur/socle/mysql.js'
import { obtenirSchema, tablesUtiles, decrireTables } from '../base/schema.js'

const CONSIGNES = `Tu es BiRTEC, un assistant expert en rapports Eclipse BIRT 4.x et en SQL MySQL, pour la personne qui conçoit les rapports de la GMAO.

Règles :
- Réponds en français, clairement, sans formule de politesse.
- Pour toute requête, écris du SQL MySQL dans un bloc \`\`\`sql … \`\`\`, une seule requête par bloc, terminée sans point-virgule.
- N'utilise que les tables et colonnes de la STRUCTURE fournie. Si une information manque (table ou colonne inconnue), dis-le et demande au lieu d'inventer.
- Uniquement des requêtes de lecture (SELECT, WITH). La base est en lecture seule : n'écris jamais INSERT, UPDATE, DELETE, CREATE, DROP.
- Donne des alias de colonnes lisibles en français (AS nb_ot, AS heures_totales…) : ils deviendront les colonnes du rapport.
- Pour les paramètres d'un rapport BIRT, écris « ? » dans la requête et précise à quoi il correspond (BIRT les remplace par les paramètres du rapport).
- Pour une période relative (« mois en cours », « année dernière »), calcule les dates dans la requête (CURDATE(), DATE_FORMAT, INTERVAL) au lieu d'écrire des dates fixes : le rapport doit rester juste le mois suivant.
- Pour un rapport, décris sa structure : titre, requête, colonnes et formats, groupes, totaux, tri, paramètres.
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

      // La structure de la base, si la connexion est ouverte.
      let structure = 'STRUCTURE : connexion MySQL fermée, structure de la base inconnue. Réponds de façon générale et signale que la connexion permettrait une réponse précise.'
      if (etatConnexion().ouverte) {
        const schema = await obtenirSchema()
        const precedentes = historique.filter((m) => m.role === 'agent').slice(-2).map((m) => m.contenu).join(' ')
        const tables = tablesUtiles(schema, `${question} ${precedentes}`)
        flux.envoyer('tables', tables.map((t) => t.nom))
        structure = `STRUCTURE DE LA BASE « ${schema.base} » (${tables.length} tables utiles sur ${schema.tables.length}) :\n${decrireTables(tables)}`
      }

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
