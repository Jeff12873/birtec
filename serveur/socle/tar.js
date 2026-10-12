// Décompression des archives .tar.gz, sans outil externe (pour fabriquer un kit Linux depuis Windows).
//
// Une archive tar est une suite de fichiers, chacun précédé d'un en-tête de 512 octets (nom, taille, type…).
// Les liens symboliques (ex. libllama.so → libllama.so.0) sont remplacés par une copie du fichier visé :
// Windows ne sait pas toujours créer de liens, et une copie fonctionne partout.

import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

export function extraireTarGz(octets, dossier) {
  const tar = zlib.gunzipSync(octets)
  const liens = []
  let nomLong = null

  for (let position = 0; position + 512 <= tar.length; ) {
    const entete = tar.subarray(position, position + 512)
    if (entete.every((o) => o === 0)) break // fin de l'archive

    const texte = (debut, longueur) => entete.toString('utf8', debut, debut + longueur).replace(/\0.*$/s, '')
    const taille = parseInt(texte(124, 12).trim() || '0', 8)
    const type = String.fromCharCode(entete[156] || 48) // '0' fichier, '5' dossier, '2' lien, 'L' nom long, 'x' extension
    const prefixe = texte(345, 155)
    let nom = nomLong || (prefixe ? `${prefixe}/${texte(0, 100)}` : texte(0, 100))
    nomLong = null
    const mode = parseInt(texte(100, 8).trim() || '644', 8)
    const contenu = tar.subarray(position + 512, position + 512 + taille)
    position += 512 + Math.ceil(taille / 512) * 512

    if (type === 'L') {
      nomLong = contenu.toString('utf8').replace(/\0.*$/s, '') // le vrai nom du fichier suivant
      continue
    }
    if (type === 'x' || type === 'g') {
      const chemin = contenu.toString('utf8').match(/\d+ path=([^\n]+)\n/)
      if (chemin) nomLong = chemin[1]
      continue
    }

    const destination = path.join(dossier, nom)
    if (!path.resolve(destination).startsWith(path.resolve(dossier))) continue // protection contre « ../ »
    if (type === '5') fs.mkdirSync(destination, { recursive: true })
    else if (type === '2') liens.push({ destination, cible: texte(157, 100) })
    else if (type === '0' || type === '\0' || type === '7') {
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, contenu)
      if (process.platform !== 'win32') fs.chmodSync(destination, mode & 0o777)
    }
  }

  // Liens : une fois tous les fichiers posés, on copie le fichier visé (un lien peut viser un autre lien).
  for (let tour = 0; tour < 5 && liens.length; tour++) {
    for (const lien of [...liens]) {
      const vise = path.resolve(path.dirname(lien.destination), lien.cible)
      if (!fs.existsSync(vise) || fs.statSync(vise).isDirectory()) continue
      fs.copyFileSync(vise, lien.destination)
      liens.splice(liens.indexOf(lien), 1)
    }
  }
}
