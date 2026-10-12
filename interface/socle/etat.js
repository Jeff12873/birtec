// L'état général, demandé au serveur toutes les 4 secondes : fichier ouvert, mode administrateur,
// état de l'IA, publication sur le partage… Les écrans s'y abonnent avec surChangement().

import { api } from './api.js'

export const etat = { pret: false }
const abonnes = new Set()

export function surChangement(fonction) {
  abonnes.add(fonction)
  return () => abonnes.delete(fonction)
}

export async function actualiserEtat() {
  try {
    const nouveau = await api('/api/etat')
    const ancien = { ...etat }
    Object.assign(etat, nouveau, { pret: true, injoignable: false })
    for (const fonction of abonnes) fonction(etat, ancien)
  } catch {
    if (!etat.injoignable) {
      etat.injoignable = true
      for (const fonction of abonnes) fonction(etat, etat)
    }
  }
  return etat
}

export function suivreEtat() {
  setInterval(actualiserEtat, 4000)
  return actualiserEtat()
}

export const estAdmin = () => Boolean(etat.admin)
