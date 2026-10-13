// Configuration : connexion MySQL (sans le mot de passe), ouverture de la session, dossier de travail,
// état général. (Les fichiers BIRT et les connaissances du site sont dans le bloc « connaissances ».)

import fs from 'node:fs'
import { ErreurHttp } from '../../serveur/socle/http.js'
import { cheminBirtec } from '../../serveur/socle/birtec.js'
import { etatIA, arreterIA } from '../../serveur/socle/ia.js'
import { version, reglagesPoste, modifierReglagesPoste, dossierTravail, journal } from '../../serveur/socle/installation.js'
import { etatConnexion, ouvrirSession, fermerSession, javaInstalle } from '../../serveur/socle/mysql.js'

export function routes(r) {
  // Interrogé régulièrement par l'interface.
  r.get('/api/etat', () => ({
    version: version(),
    ia: etatIA(),
    java: javaInstalle(),
    connexion: etatConnexion(),
    dossierTravail: dossierTravail(),
    fichierBirtec: cheminBirtec(),
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

  // ---- dossier de travail

  r.post('/api/configuration/dossier', async (ctx) => {
    const { dossier } = await ctx.json()
    if (dossier && !fs.existsSync(dossier)) throw new ErreurHttp(404, `Dossier introuvable : ${dossier}`)
    modifierReglagesPoste({ dossierTravail: dossier || '' })
    return { dossier: dossierTravail() }
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
