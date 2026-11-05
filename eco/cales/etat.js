// « /socle/etat.js » dans BiRTEC éco+ : pas de serveur ni de fichier partagé ; la page est son propre administrateur
// (le SQL et les réglages de LA PHRASE sont montrés, et gardés dans le navigateur).
export const etat = { pret: true, admin: true, modeAdmin: true, connexion: { ouverte: false, configuree: false }, partage: {} }
export const surChangement = () => () => {}
export const actualiserEtat = async () => etat
export const suivreEtat = async () => etat
export const estAdmin = () => true
export const peutModifier = () => true
export const modeAdmin = () => true
