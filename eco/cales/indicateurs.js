// « blocs/indicateurs/serveur.js » dans BiRTEC éco+ : les indicateurs GMAO sont essayés sur la base, donc dans K.NOVA.
import { ErreurHttp } from './http.js'
import { REGLAGES_VIDES } from '../../blocs/indicateurs/indicateur.js'

export async function reglagesIndicateurs() {
  return REGLAGES_VIDES
}
export async function tester() {
  throw new ErreurHttp(409, 'Les indicateurs GMAO se créent dans K.NOVA : ils sont essayés sur la base.')
}
