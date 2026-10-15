// Connaissances : le contenu du fichier .birtec (notes, structure, requêtes, fichiers BIRT),
// son importation depuis un dossier et le choix du fichier.

import fs from 'node:fs'
import path from 'node:path'
import { ErreurHttp, envoyerOctets } from '../../serveur/socle/http.js'
import { dossierTravail, journal } from '../../serveur/socle/installation.js'
import {
  resumeBirtec, changerBirtec, cheminBirtec, listerNotes, enregistrerNote, supprimerNote, lireTables, lireLiens,
  listerRequetes, supprimerRequete, listerFichiers, lireFichier, enregistrerFichier, supprimerFichier, lireInfo, ecrireInfo,
} from '../../serveur/socle/birtec.js'
import { oublierSchema } from '../base/schema.js'
import { importerDossier } from './importation.js'
import { completerCharte } from '../rapports/generateur.js'

// Les fichiers BIRT acceptés dans chaque catégorie.
export const FICHIERS_BIRT = {
  modeles: { libelle: 'Rapports modèles', extensions: ['.rptdesign', '.rpttemplate'] },
  images: { libelle: 'Images pour le haut des rapports', extensions: ['.png', '.jpg', '.jpeg', '.gif', '.bmp'] },
  ressources: { libelle: 'Bibliothèques et ressources', extensions: ['.rptlibrary', '.properties', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.dat'] },
}

export function routes(r) {
  r.get('/api/connaissances', () => resumeBirtec())

  // Ouvrir un autre fichier .birtec, ou en créer un nouveau (vide).
  r.post('/api/connaissances/fichier', async (ctx) => {
    const { chemin } = await ctx.json()
    if (!chemin?.trim()) throw new ErreurHttp(400, 'Indiquez le chemin du fichier .birtec.')
    changerBirtec(chemin.trim())
    oublierSchema()
    return resumeBirtec()
  })

  r.get('/api/connaissances/telecharger', (ctx) => {
    envoyerOctets(ctx.res, fs.readFileSync(cheminBirtec()), { nom: path.basename(cheminBirtec()), telecharger: true })
  })

  r.post('/api/connaissances/importer', async (ctx) => {
    const { dossier } = await ctx.json()
    if (!dossier?.trim()) throw new ErreurHttp(400, 'Indiquez le dossier à importer.')
    const bilan = importerDossier(dossier.trim())
    oublierSchema()
    journal(`Importation de ${dossier} dans le .birtec : ${JSON.stringify({ ...bilan, ignores: bilan.ignores.length })}`)
    return bilan
  })

  // ---- charte des rapports (aspect et conventions de connexion de la GMAO)

  r.get('/api/connaissances/charte', () => completerCharte(lireInfo('charte')))

  r.post('/api/connaissances/charte', async (ctx) => {
    const charte = await ctx.json()
    if (typeof charte !== 'object' || Array.isArray(charte)) throw new ErreurHttp(400, 'La charte doit être un objet JSON.')
    ecrireInfo('charte', completerCharte(charte))
  })

  // ---- notes

  r.get('/api/connaissances/notes', () => listerNotes())

  r.post('/api/connaissances/notes', async (ctx) => {
    const note = await ctx.json()
    if (!note.titre?.trim()) throw new ErreurHttp(400, 'La note doit avoir un titre.')
    return { id: enregistrerNote({ ...note, titre: note.titre.trim() }) }
  })

  r.delete('/api/connaissances/notes/:id', (ctx) => supprimerNote(Number(ctx.params.id)))

  // ---- structure et requêtes

  r.get('/api/connaissances/tables', () => {
    const liens = lireLiens()
    return lireTables().map((t) => ({
      nom: t.nom,
      commentaire: t.commentaire,
      colonnes: t.colonnes.length,
      liens: liens.filter((l) => l.deTable === t.nom).length,
    }))
  })

  r.get('/api/connaissances/requetes', () => listerRequetes())

  r.delete('/api/connaissances/requetes/:id', (ctx) => supprimerRequete(Number(ctx.params.id)))

  // ---- fichiers BIRT

  r.get('/api/connaissances/fichiers', () =>
    Object.fromEntries(Object.entries(FICHIERS_BIRT).map(([categorie, infos]) => [categorie, { ...infos, fichiers: listerFichiers(categorie) }])),
  )

  // Dépôt d'un fichier : le corps est le fichier, son nom dans l'en-tête X-Nom.
  r.post('/api/connaissances/fichiers/:categorie', async (ctx) => {
    const infos = FICHIERS_BIRT[ctx.params.categorie]
    if (!infos) throw new ErreurHttp(404, 'Catégorie inconnue')
    const nom = path.basename(decodeURIComponent(ctx.req.headers['x-nom'] || ''))
    if (!infos.extensions.includes(path.extname(nom).toLowerCase())) {
      throw new ErreurHttp(400, `Type de fichier non accepté ici. Acceptés : ${infos.extensions.join(', ')}`)
    }
    enregistrerFichier(ctx.params.categorie, nom, await ctx.octets())
  })

  r.get('/api/connaissances/fichiers/:categorie/:nom', (ctx) => {
    const contenu = lireFichier(ctx.params.categorie, ctx.params.nom)
    if (!contenu) throw new ErreurHttp(404, 'Fichier introuvable')
    envoyerOctets(ctx.res, Buffer.from(contenu), { nom: ctx.params.nom, telecharger: true })
  })

  r.delete('/api/connaissances/fichiers/:categorie/:nom', (ctx) => supprimerFichier(ctx.params.categorie, ctx.params.nom))

  // Copie un rapport modèle dans les rapports, pour le voir en aperçu ou s'en servir de base.
  r.post('/api/connaissances/modeles/:nom/vers-rapports', (ctx) => {
    const contenu = lireFichier('modeles', ctx.params.nom)
    if (!contenu) throw new ErreurHttp(404, 'Modèle introuvable')
    const nom = path.basename(ctx.params.nom).replace(/\.(rptdesign|rpttemplate)$/i, '')
    fs.writeFileSync(path.join(dossierTravail(), 'rapports', `${nom}.rptdesign`), contenu)
    return { nom }
  })
}
