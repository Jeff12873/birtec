// Configuration : connexion MySQL (sans le mot de passe), ouverture de la session, dossier de travail,
// fichiers de configuration BIRT (bibliothèques, modèles, ressources), état général.

import fs from 'node:fs'
import path from 'node:path'
import { ErreurHttp } from '../../serveur/socle/http.js'
import { etatIA, arreterIA } from '../../serveur/socle/ia.js'
import { version, reglagesPoste, modifierReglagesPoste, dossierTravail, journal } from '../../serveur/socle/installation.js'
import { etatConnexion, ouvrirSession, fermerSession, javaInstalle } from '../../serveur/socle/mysql.js'

// Les fichiers BIRT acceptés, et le dossier où ils sont rangés dans le dossier de travail.
export const FICHIERS_BIRT = {
  modeles: { libelle: 'Rapports modèles', extensions: ['.rptdesign', '.rpttemplate'] },
  ressources: { libelle: 'Bibliothèques et ressources', extensions: ['.rptlibrary', '.properties', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.xml', '.dat'] },
}

export function routes(r) {
  // Interrogé régulièrement par l'interface.
  r.get('/api/etat', () => ({
    version: version(),
    ia: etatIA(),
    java: javaInstalle(),
    connexion: etatConnexion(),
    dossierTravail: dossierTravail(),
    poste: reglagesPoste(),
  }))

  // ---- connexion MySQL

  r.post('/api/configuration/mysql', async (ctx) => {
    const { serveur, port, base, utilisateur } = await ctx.json()
    if (!serveur?.trim() || !base?.trim() || !utilisateur?.trim()) throw new ErreurHttp(400, 'Serveur, base et utilisateur sont obligatoires.')
    modifierReglagesPoste({ mysql: { serveur: serveur.trim(), port: Number(port) || 3306, base: base.trim(), utilisateur: utilisateur.trim() } })
    fermerSession() // nouvelle connexion : le mot de passe sera redemandé
  })

  r.post('/api/session', async (ctx) => {
    const { motDePasse } = await ctx.json()
    if (!motDePasse) throw new ErreurHttp(400, 'Saisissez le mot de passe MySQL.')
    return ouvrirSession(motDePasse)
  })

  r.delete('/api/session', () => {
    fermerSession()
  })

  // ---- dossier de travail et fichiers BIRT

  r.post('/api/configuration/dossier', async (ctx) => {
    const { dossier } = await ctx.json()
    if (dossier && !fs.existsSync(dossier)) throw new ErreurHttp(404, `Dossier introuvable : ${dossier}`)
    modifierReglagesPoste({ dossierTravail: dossier || '' })
    return { dossier: dossierTravail() }
  })

  r.get('/api/fichiers-birt', () => {
    const racine = dossierTravail()
    return Object.fromEntries(
      Object.entries(FICHIERS_BIRT).map(([dossier, infos]) => [
        dossier,
        {
          ...infos,
          fichiers: fs
            .readdirSync(path.join(racine, dossier), { withFileTypes: true })
            .filter((e) => e.isFile())
            .map((e) => {
              const chemin = path.join(racine, dossier, e.name)
              return { nom: e.name, taille: fs.statSync(chemin).size, modifie: fs.statSync(chemin).mtime.toISOString() }
            })
            .sort((a, b) => a.nom.localeCompare(b.nom, 'fr')),
        },
      ]),
    )
  })

  // Dépôt d'un fichier BIRT : le corps est le fichier, son nom dans l'en-tête X-Nom.
  r.post('/api/fichiers-birt/:dossier', async (ctx) => {
    const infos = FICHIERS_BIRT[ctx.params.dossier]
    if (!infos) throw new ErreurHttp(404, 'Dossier inconnu')
    const nom = path.basename(decodeURIComponent(ctx.req.headers['x-nom'] || ''))
    if (!infos.extensions.includes(path.extname(nom).toLowerCase())) {
      throw new ErreurHttp(400, `Type de fichier non accepté ici. Acceptés : ${infos.extensions.join(', ')}`)
    }
    fs.writeFileSync(path.join(dossierTravail(), ctx.params.dossier, nom), await ctx.octets())
    journal(`Fichier BIRT ajouté : ${ctx.params.dossier}/${nom}`)
  })

  r.delete('/api/fichiers-birt/:dossier/:nom', (ctx) => {
    if (!FICHIERS_BIRT[ctx.params.dossier]) throw new ErreurHttp(404, 'Dossier inconnu')
    fs.rmSync(path.join(dossierTravail(), ctx.params.dossier, path.basename(ctx.params.nom)), { force: true })
  })

  // ---- réglages du poste

  r.post('/api/poste', async (ctx) => {
    const { arretIAMinutes } = await ctx.json()
    return modifierReglagesPoste({ arretIAMinutes: Math.max(1, Math.min(480, Number(arretIAMinutes) || 20)) })
  })

  r.post('/api/quitter', () => {
    journal('Arrêt demandé depuis l’interface')
    setTimeout(() => {
      arreterIA()
      process.exit(0)
    }, 300)
  })
}
