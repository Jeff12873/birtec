// « ktec/ktec.js » dans BiRTEC éco+ : les réglages viennent du fichier de schéma glissé sur la page.
import { ErreurHttp } from './http.js'
import { lireInfo, ecrireInfo } from './magasin.js'

export { lireInfo, ecrireInfo }
export function enregistrerRequete() {
  throw new ErreurHttp(409, 'Dans BiRTEC éco+, rien n’est rangé dans le fichier de connaissances : copiez le SQL.')
}
export function enregistrerIndicateur() {
  throw new ErreurHttp(409, 'Les indicateurs GMAO se créent dans K.NOVA (ils sont essayés sur la base).')
}
export function ktec() {
  throw new ErreurHttp(409, 'Indisponible dans BiRTEC éco+ (arborescence et parcs : dans K.NOVA).')
}
export const lireTexteProtege = (t) => t
