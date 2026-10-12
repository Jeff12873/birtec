// L'icône d'IASSITEC.
//
// Par défaut : interface/icone.svg et interface/icone.png.
// L'administrateur peut en importer une autre (écran Administration) : elle est enregistrée
// dans le fichier .datassitec, donc la même pour tous les postes. Chaque poste en garde une copie
// dans cache/ pour ses raccourcis (icone.png sous Linux, icone.ico sous Windows).

import fs from 'node:fs'
import path from 'node:path'
import { chemins } from './installation.js'

export const ICONE_PNG_LOCALE = path.join(chemins.cache, 'icone.png')
export const ICONE_ICO_LOCALE = path.join(chemins.cache, 'icone.ico')

// Met à jour la copie locale utilisée par les raccourcis. Seul le PNG convient aux raccourcis :
// une icône SVG ou JPEG s'affiche dans IASSITEC, mais les raccourcis gardent l'icône par défaut.
export function mettreAJourIconeLocale(octets, type) {
  try {
    const png = type === 'image/png' && octets ? Buffer.from(octets) : fs.readFileSync(path.join(chemins.interface, 'icone.png'))
    if (fs.existsSync(ICONE_PNG_LOCALE) && fs.readFileSync(ICONE_PNG_LOCALE).equals(png)) return
    fs.mkdirSync(chemins.cache, { recursive: true })
    fs.writeFileSync(ICONE_PNG_LOCALE, png)
    ecrireIco(png, ICONE_ICO_LOCALE)
  } catch {
    // une icône de raccourci n'est pas indispensable
  }
}

// Fichier .ico minimal qui contient directement l'image PNG (accepté depuis Windows Vista).
export function ecrireIco(png, ico) {
  const entete = Buffer.alloc(22)
  entete.writeUInt16LE(0, 0) // réservé
  entete.writeUInt16LE(1, 2) // type : icône
  entete.writeUInt16LE(1, 4) // une seule image
  entete.writeUInt8(0, 6) // largeur 256 (0 = 256)
  entete.writeUInt8(0, 7) // hauteur 256
  entete.writeUInt16LE(1, 10) // plans de couleur
  entete.writeUInt16LE(32, 12) // bits par pixel
  entete.writeUInt32LE(png.length, 14)
  entete.writeUInt32LE(22, 18) // l'image commence juste après l'en-tête
  fs.mkdirSync(path.dirname(ico), { recursive: true })
  fs.writeFileSync(ico, Buffer.concat([entete, png]))
}
