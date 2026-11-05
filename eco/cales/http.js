// « ktec/http.js » dans BiRTEC éco+ : seulement l'erreur avec son statut.
export class ErreurHttp extends Error {
  constructor(statut, message) {
    super(message)
    this.statut = statut
  }
}
export function envoyerOctets() {
  throw new ErreurHttp(501, 'Indisponible dans BiRTEC éco+.')
}
