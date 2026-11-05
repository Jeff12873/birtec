// « blocs/rapports/serveur.js » dans BiRTEC éco+ : le rapport est fabriqué dans la page et téléchargé (.rptdesign),
// sans vérification dans le moteur BIRT. La connexion (adresse et utilisateur, jamais de mot de passe) vient du
// fichier de schéma.
import { magasin, lireInfo } from './magasin.js'
import { verifierSQL } from '../../blocs/base/verification.js'
import { genererRptdesign, verifierDescription, normaliserDescription, BLOCS_DONNEES } from '../../blocs/rapports/generateur.js'

const nomDeFichier = (t) => String(t || 'rapport').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'rapport'

export async function genererRapport(description, nom) {
  nom = nomDeFichier(nom || description?.titre)
  const erreurs = verifierDescription(description)
  if (erreurs.length) return { nom, ok: false, erreurs, corrections: [] }
  const schema = magasin()?.schema
  const d = normaliserDescription(description)
  const inconnues = schema ? d.blocs.filter((b) => BLOCS_DONNEES.includes(b.type)).flatMap((b) => verifierSQL(b.requete, schema)) : []
  if (inconnues.length) return { nom, ok: false, erreurs: inconnues, corrections: [] }
  const c = magasin()?.connexion || {}
  const xml = genererRptdesign(description, { url: c.url || '', utilisateur: c.utilisateur || '', charte: lireInfo('charte'), image: null })
  const lien = document.createElement('a')
  lien.href = URL.createObjectURL(new Blob([xml], { type: 'application/xml' }))
  lien.download = `${nom}.rptdesign`
  document.body.append(lien)
  lien.click()
  lien.remove()
  setTimeout(() => URL.revokeObjectURL(lien.href), 10_000)
  return { nom, ok: true, erreurs: [], avertissements: [], corrections: [] }
}
