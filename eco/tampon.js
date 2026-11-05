// Un petit « Buffer » pour le code de BiRTEC écrit pour Node (générateur de .rptdesign, lecture d'un .rptdesign) :
// seulement Buffer.from(texte | base64 | octets) et toString('utf8' | 'base64').
class Tampon {
  constructor(octets) { this.octets = octets }
  static from(valeur, codage = 'utf8') {
    if (typeof valeur === 'string') {
      if (codage === 'base64') return new Tampon(Uint8Array.from(atob(valeur), (c) => c.charCodeAt(0)))
      return new Tampon(new TextEncoder().encode(valeur))
    }
    return new Tampon(valeur instanceof Uint8Array ? valeur : new Uint8Array(valeur?.octets || valeur || []))
  }
  toString(codage = 'utf8') {
    if (codage === 'base64') {
      let binaire = ''
      for (let i = 0; i < this.octets.length; i += 0x8000) binaire += String.fromCharCode(...this.octets.subarray(i, i + 0x8000))
      return btoa(binaire)
    }
    return new TextDecoder().decode(this.octets)
  }
}
if (!globalThis.Buffer) globalThis.Buffer = Tampon
