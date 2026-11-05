// « ktec/mysql.js » dans BiRTEC éco+ : pas de base de données, la page ne travaille que sur des fichiers.
import { ErreurHttp } from './http.js'

const SANS_BASE = 'BiRTEC éco+ n’a pas accès à la base : copiez le SQL et lancez-le dans votre outil, ou glissez un export Excel dans « Aperçu ».'
export const etatConnexion = () => ({ ouverte: false, configuree: false })
export async function executerRequete() {
  throw new ErreurHttp(409, SANS_BASE)
}
export async function lireSchema() {
  throw new ErreurHttp(409, SANS_BASE)
}
