// Un PDF d'une page fait d'une seule image JPEG, écrit à la main (pas de bibliothèque).
// Un PDF n'est qu'une liste d'objets numérotés suivie d'une table de leurs positions (xref).

// jpeg : les octets du JPEG ; largeur, hauteur : sa taille en pixels ; page : la taille de la page en points (1/72 de pouce).
export function pdfDepuisJpeg(jpeg, largeur, hauteur, page = { largeur: 1190.55, hauteur: 841.89 }) {
  const encodeur = new TextEncoder()
  const morceaux = []
  const positions = []
  let taille = 0
  const ecrire = (morceau) => {
    const octets = typeof morceau === 'string' ? encodeur.encode(morceau) : morceau
    morceaux.push(octets)
    taille += octets.length
  }
  const objet = (numero, corps) => {
    positions[numero] = taille
    ecrire(`${numero} 0 obj\n${corps}\nendobj\n`)
  }

  const dessin = `q ${page.largeur} 0 0 ${page.hauteur} 0 0 cm /Im0 Do Q`
  ecrire('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  objet(1, '<< /Type /Catalog /Pages 2 0 R >>')
  objet(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  objet(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.largeur} ${page.hauteur}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)
  positions[4] = taille
  ecrire(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${largeur} /Height ${hauteur} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`)
  ecrire(jpeg)
  ecrire('\nendstream\nendobj\n')
  objet(5, `<< /Length ${dessin.length} >>\nstream\n${dessin}\nendstream`)

  const debutXref = taille
  ecrire(`xref\n0 6\n0000000000 65535 f \n${positions.slice(1).map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`)
  ecrire(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF\n`)
  return new Blob(morceaux, { type: 'application/pdf' })
}
