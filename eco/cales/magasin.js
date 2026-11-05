// Le magasin de BiRTEC éco+ : le fichier de schéma glissé sur la page (exporté par K.NOVA), et ce que la page y
// ajoute (disposition de la constellation, colonnes proposées, passages…), gardés dans le navigateur (IndexedDB).
// Rien ne part du poste.

const BASE = 'birtec-eco'
let donnees = null

const ouvrir = () => new Promise((ok, ko) => {
  const r = indexedDB.open(BASE, 1)
  r.onupgradeneeded = () => r.result.createObjectStore('fichier')
  r.onsuccess = () => ok(r.result)
  r.onerror = () => ko(r.error)
})
async function lireIdb() {
  const db = await ouvrir()
  return new Promise((ok, ko) => {
    const r = db.transaction('fichier').objectStore('fichier').get('schema')
    r.onsuccess = () => ok(r.result || null)
    r.onerror = () => ko(r.error)
  })
}
async function ecrireIdb(valeur) {
  const db = await ouvrir()
  return new Promise((ok, ko) => {
    const t = db.transaction('fichier', 'readwrite')
    t.objectStore('fichier').put(valeur, 'schema')
    t.oncomplete = () => ok()
    t.onerror = () => ko(t.error)
  })
}

export async function chargerMagasin() {
  try {
    donnees = await lireIdb()
  } catch {
    donnees = null
  }
  return donnees
}

// Un fichier de schéma exporté par K.NOVA (format « birtec-eco-schema »).
export async function definirSchema(fichier) {
  if (fichier?.format !== 'birtec-eco-schema' || !Array.isArray(fichier.schema?.tables)) throw new Error('Ce n’est pas un fichier de schéma de BiRTEC (exporté par K.NOVA, bouton « Pour BiRTEC éco+ » de la constellation).')
  donnees = { ...fichier, infos: { ...(fichier.infos || {}) } }
  await ecrireIdb(donnees).catch(() => {})
  return donnees
}

export const magasin = () => donnees

let minuterie = null
export function lireInfo(cle, defaut = null) {
  const v = donnees?.infos?.[cle]
  return v === undefined ? defaut : v
}
export function ecrireInfo(cle, valeur) {
  if (!donnees) throw new Error('Aucun schéma chargé.')
  donnees.infos[cle] = valeur
  clearTimeout(minuterie)
  minuterie = setTimeout(() => ecrireIdb(donnees).catch(() => {}), 500)
  return valeur
}
