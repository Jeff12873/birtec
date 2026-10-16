// Lecture et fabrication des fichiers ZIP, sans bibliothèque.
//
// Sert à :
//   - lire les documents Office et LibreOffice (.docx, .xlsx, .pptx, .odt, .ods), qui sont des ZIP ;
//   - décompresser llama.cpp sous Windows ;
//   - appliquer une mise à jour de BiRTEC ;
//   - fabriquer l'archive d'une extraction de tables (creerZip).
//
// Seules les deux méthodes de compression courantes sont gérées : « stockée » et « deflate ».

import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

// Renvoie la liste des fichiers du ZIP : [{ nom, lire() → Buffer }]
export function lireZip(octets) {
  const fin = chercherFinDuRepertoire(octets)
  const nombre = octets.readUInt16LE(fin + 10)
  let position = octets.readUInt32LE(fin + 16)
  const fichiers = []

  for (let i = 0; i < nombre; i++) {
    if (octets.readUInt32LE(position) !== 0x02014b50) throw new Error('ZIP abîmé')
    const methode = octets.readUInt16LE(position + 10)
    const tailleCompressee = octets.readUInt32LE(position + 20)
    const longueurNom = octets.readUInt16LE(position + 28)
    const longueurExtra = octets.readUInt16LE(position + 30)
    const longueurCommentaire = octets.readUInt16LE(position + 32)
    const debutLocal = octets.readUInt32LE(position + 42)
    const nom = octets.toString('utf8', position + 46, position + 46 + longueurNom)

    fichiers.push({
      nom,
      lire() {
        // L'en-tête local peut avoir des champs de longueur différente de ceux du répertoire.
        const debutDonnees = debutLocal + 30 + octets.readUInt16LE(debutLocal + 26) + octets.readUInt16LE(debutLocal + 28)
        const donnees = octets.subarray(debutDonnees, debutDonnees + tailleCompressee)
        if (methode === 0) return Buffer.from(donnees)
        if (methode === 8) return zlib.inflateRawSync(donnees)
        throw new Error(`Compression non gérée (${methode}) pour ${nom}`)
      },
    })
    position += 46 + longueurNom + longueurExtra + longueurCommentaire
  }
  return fichiers
}

function chercherFinDuRepertoire(octets) {
  // La signature de fin se trouve dans les derniers 64 Ko (commentaire éventuel compris).
  for (let i = octets.length - 22; i >= Math.max(0, octets.length - 65558); i--) {
    if (octets.readUInt32LE(i) === 0x06054b50) return i
  }
  throw new Error("Ce fichier n'est pas un ZIP valide")
}

// Raccourci : contenu texte d'un fichier précis du ZIP (ou null s'il n'existe pas).
export function lireTexteDansZip(fichiers, nom) {
  const fichier = fichiers.find((f) => f.nom === nom)
  return fichier ? fichier.lire().toString('utf8') : null
}

// Décompresse tout le ZIP dans un dossier. « garder(nom) » permet d'ignorer certains fichiers.
export function decompresser(octets, dossier, garder = () => true) {
  for (const fichier of lireZip(octets)) {
    if (fichier.nom.endsWith('/') || !garder(fichier.nom)) continue
    const destination = path.join(dossier, fichier.nom)
    if (!destination.startsWith(path.resolve(dossier))) continue // protection contre « ../ »
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, fichier.lire())
  }
}

// Fabrique un fichier .zip à partir de [{ nom, octets }] (compression « deflate », noms en UTF-8).
export function creerZip(fichiers) {
  const locaux = []
  const centraux = []
  let decalage = 0
  const maintenant = new Date()
  const heure = (maintenant.getHours() << 11) | (maintenant.getMinutes() << 5) | (maintenant.getSeconds() >> 1)
  const jour = ((maintenant.getFullYear() - 1980) << 9) | ((maintenant.getMonth() + 1) << 5) | maintenant.getDate()
  for (const f of fichiers) {
    const nom = Buffer.from(f.nom, 'utf8')
    const brut = Buffer.isBuffer(f.octets) ? f.octets : Buffer.from(f.octets)
    const compresse = zlib.deflateRawSync(brut)
    const crc = zlib.crc32(brut)
    const entete = Buffer.alloc(30)
    entete.writeUInt32LE(0x04034b50, 0)
    entete.writeUInt16LE(20, 4) // version nécessaire
    entete.writeUInt16LE(0x0800, 6) // noms en UTF-8
    entete.writeUInt16LE(8, 8) // deflate
    entete.writeUInt16LE(heure, 10)
    entete.writeUInt16LE(jour, 12)
    entete.writeUInt32LE(crc, 14)
    entete.writeUInt32LE(compresse.length, 18)
    entete.writeUInt32LE(brut.length, 22)
    entete.writeUInt16LE(nom.length, 26)
    entete.writeUInt16LE(0, 28)
    locaux.push(entete, nom, compresse)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version créatrice
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(heure, 12)
    central.writeUInt16LE(jour, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compresse.length, 20)
    central.writeUInt32LE(brut.length, 24)
    central.writeUInt16LE(nom.length, 28)
    central.writeUInt32LE(decalage, 42)
    centraux.push(central, nom)
    decalage += entete.length + nom.length + compresse.length
  }
  const tailleCentral = centraux.reduce((t, b) => t + b.length, 0)
  const fin = Buffer.alloc(22)
  fin.writeUInt32LE(0x06054b50, 0)
  fin.writeUInt16LE(fichiers.length, 8)
  fin.writeUInt16LE(fichiers.length, 10)
  fin.writeUInt32LE(tailleCentral, 12)
  fin.writeUInt32LE(decalage, 16)
  return Buffer.concat([...locaux, ...centraux, fin])
}
