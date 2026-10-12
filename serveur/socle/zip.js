// Lecture des fichiers ZIP, sans bibliothèque.
//
// Sert à trois choses :
//   - lire les documents Office et LibreOffice (.docx, .xlsx, .pptx, .odt, .ods), qui sont des ZIP ;
//   - décompresser llama.cpp sous Windows ;
//   - appliquer une mise à jour de BiRTEC.
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
