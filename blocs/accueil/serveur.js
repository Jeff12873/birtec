// Page d'accueil : les indicateurs et les raccourcis de rapports choisis, dans l'ordre voulu
// (gardés dans le fichier .ktec, réglage « accueil »).

import fs from 'node:fs'
import path from 'node:path'
import { dossierTravail } from 'ktec/installation.js'
import { lireInfo, ecrireInfo, listerIndicateurs } from 'ktec/ktec.js'

export function routes(r) {
  r.get('/api/accueil', () => {
    const choix = lireInfo('accueil', { indicateurs: [], rapports: [] })
    const indicateurs = listerIndicateurs().map((i) => ({ id: i.id, nom: i.nom, fenetre: i.fenetre }))
    const dossier = path.join(dossierTravail(), 'rapports')
    const rapports = fs.readdirSync(dossier).filter((f) => f.endsWith('.rptdesign')).map((f) => {
      const xml = fs.readFileSync(path.join(dossier, f), 'utf8')
      return { nom: f.replace(/\.rptdesign$/, ''), titre: xml.match(/<text-property name="title">([^<]*)</)?.[1] || f }
    })
    return {
      indicateurs: choix.indicateurs.map((id) => indicateurs.find((i) => i.id === id)).filter(Boolean),
      rapports: choix.rapports.map((nom) => rapports.find((x) => x.nom === nom)).filter(Boolean),
      tousIndicateurs: indicateurs,
      tousRapports: rapports,
    }
  })

  // POST /api/accueil { indicateurs: [id…], rapports: [nom…] } : choix et ordre.
  r.post('/api/accueil', async (ctx) => {
    const { indicateurs = [], rapports = [] } = await ctx.json()
    ecrireInfo('accueil', { indicateurs: indicateurs.map(Number), rapports: rapports.map(String) })
  })
}
