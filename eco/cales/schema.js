// « blocs/base/schema.js » dans BiRTEC éco+ : la structure de la base est celle du fichier de schéma (déjà avec les
// noms clairs du dictionnaire et les liens, telle que K.NOVA l'a exportée).
import { magasin, lireInfo } from './magasin.js'

export async function obtenirSchema() {
  const s = magasin()?.schema
  if (!s) return { base: '', tables: [], direct: false }
  return s
}
export const lireTypesChoisis = () => lireInfo('types_tables', {}) || {}
