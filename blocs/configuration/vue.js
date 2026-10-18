// Configuration : connexion MySQL (commune à toutes les applications KTEC), réglages du poste. (Fichiers BIRT et connaissances : écran « Connaissances ».)

import { h, vider, ic, fenetre, formulaire, notifier, essayer, confirmer } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat, actualiserEtat } from '/socle/etat.js'
import { demanderMotDePasse } from '/socle/connexion.js'

export default {
  chemin: 'configuration',
  titre: 'Configuration',
  icone: 'reglages',
  menu: true,
  groupe: 'Réglages',
  aide: 'configuration',

  async afficher(zone) {
    vider(
      zone,
      h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, 'Configuration'), h('p', { class: 'sous-titre' }, 'Connexion à la base et réglages de ce poste'))),
      h('div', { class: 'grille grille-2' }, carteMySQL(), cartePoste()),
    )
  },
}

// ---------------------------------------------------------------- mot de passe (à chaque ouverture)

// La demande du mot de passe est commune à toutes les applications KTEC (une seule connexion).
export { demanderMotDePasse } from '/socle/connexion.js'

// ---------------------------------------------------------------- connexion MySQL

function carteMySQL() {
  const c = etat.connexion
  const form = formulaire(
    [
      { nom: 'serveur', libelle: 'Serveur', obligatoire: true, aide: 'Nom ou adresse IP du serveur MySQL' },
      { nom: 'port', libelle: 'Port', type: 'nombre', defaut: 3306 },
      { nom: 'base', libelle: 'Base de données', obligatoire: true },
      { nom: 'utilisateur', libelle: 'Utilisateur', obligatoire: true, aide: 'De préférence un compte en lecture seule' },
    ],
    c,
  )
  const statut = c.ouverte
    ? h('div', { class: `bandeau ${c.infos?.compteEnEcriture ? '' : 'info'}` }, ic(c.infos?.compteEnEcriture ? 'alerte' : 'coche'),
        `Connecté à ${c.infos?.serveur || 'MySQL'}${c.infos?.compteEnEcriture ? ' — attention : ce compte peut modifier la base' : ' — compte en lecture seule'}.`)
    : c.configuree
      ? h('div', { class: 'bandeau' }, ic('cadenas'), 'Connexion fermée : le mot de passe est demandé à chaque ouverture.')
      : h('div', { class: 'bandeau info' }, ic('base'), 'Renseignez la connexion à la base MySQL de la GMAO.')

  return h(
    'div',
    { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('base', 18), 'Connexion MySQL')),
    statut,
    form.element,
    h('div', { class: 'actions', style: { marginTop: '14px' } },
      h('button', {
        class: 'principal',
        onclick: async () => {
          const ok = await essayer(() => api('/api/ktec/configuration/mysql', { methode: 'POST', corps: form.lire() }), 'Connexion enregistrée')
          if (ok !== undefined) {
            await actualiserEtat()
            demanderMotDePasse().then(() => window.ktec.recharger())
          }
        },
      }, 'Enregistrer et se connecter'),
      c.configuree && !c.ouverte ? h('button', { onclick: () => demanderMotDePasse().then(() => window.ktec.recharger()) }, ic('cadenas', 16), 'Saisir le mot de passe') : null,
      c.ouverte ? h('button', { class: 'discret', onclick: async () => { await api('/api/ktec/session', { methode: 'DELETE' }); await actualiserEtat(); window.ktec.recharger() } }, 'Fermer la connexion') : null,
    ),
  )
}

// ---------------------------------------------------------------- ce poste

function cartePoste() {
  const ia = etat.ia || {}
  const arret = h('input', { type: 'number', min: 1, max: 480, value: etat.poste?.arretIAMinutes || 20, style: { width: '110px' } })
  const ligne = (libelle, valeur) => h('div', { style: { display: 'flex', gap: '12px', padding: '6px 0', borderBottom: '1px solid var(--bord)' } }, h('span', { class: 'discret', style: { minWidth: '140px' } }, libelle), h('span', {}, valeur || '—'))
  return h(
    'div',
    { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('puce', 18), 'Ce poste')),
    ligne('Modèle d’IA', ia.installee ? ia.modele : 'non installé'),
    ligne('Calcul sur', ia.appareil),
    ligne('Java et BIRT', etat.java ? 'installés' : 'non installés : lancez l’installation de KTEC'),
    ligne('Connaissances', h('a', { href: '#/connaissances', class: 'mono' }, etat.fichierKtec)),
    h('label', { class: 'champ', style: { marginTop: '14px' } }, h('span', {}, 'Mettre l’IA en veille après (minutes)'), arret),
    h('div', { class: 'actions', style: { marginTop: '14px' } },
      h('button', { onclick: () => essayer(() => api('/api/ktec/poste', { methode: 'POST', corps: { arretIAMinutes: Number(arret.value) } }), 'Enregistré') }, 'Enregistrer'),
      h('button', {
        class: 'discret',
        onclick: async () => {
          if (!(await confirmer('Arrêter KTEC (toutes les applications) ? Relancez-le ensuite avec son raccourci.'))) return
          await api('/api/ktec/quitter', { methode: 'POST' })
          document.body.innerHTML = '<div class="accueil"><div class="accueil-titre"><h1>KTEC est arrêté</h1><p class="sous-titre">Vous pouvez fermer cet onglet.</p></div></div>'
        },
      }, ic('sortie', 16), 'Arrêter KTEC'),
    ),
  )
}
