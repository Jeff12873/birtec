// Configuration : connexion MySQL, fichiers de configuration BIRT, réglages du poste.

import { h, vider, ic, fenetre, formulaire, notifier, essayer, confirmer, tailleFr, dateHeureFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat, actualiserEtat } from '/socle/etat.js'

export default {
  chemin: 'configuration',
  titre: 'Configuration',
  icone: 'reglages',
  menu: true,
  aide: 'configuration',

  async afficher(zone) {
    vider(
      zone,
      h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, 'Configuration'), h('p', { class: 'sous-titre' }, 'Connexion à la base, fichiers BIRT et réglages de ce poste'))),
      h('div', { class: 'grille grille-2' }, carteMySQL(), cartePoste(), carteFichiersBirt()),
    )
  },
}

// ---------------------------------------------------------------- mot de passe (à chaque ouverture)

export async function demanderMotDePasse() {
  const c = etat.connexion
  const champ = h('input', { type: 'password', autocomplete: 'current-password' })
  await fenetre({
    titre: 'Connexion à MySQL',
    contenu: h(
      'div',
      {},
      h('p', { class: 'texte-2' }, `Base « ${c.base} » sur ${c.serveur}:${c.port}, utilisateur « ${c.utilisateur} ».`),
      h('label', { class: 'champ' }, h('span', {}, 'Mot de passe'), champ, h('small', { class: 'aide' }, 'Gardé en mémoire jusqu’à la fermeture de BiRTEC, jamais enregistré.')),
    ),
    boutons: [
      { texte: 'Plus tard', classe: 'discret' },
      {
        texte: 'Se connecter',
        classe: 'principal',
        action: async () => {
          const infos = await api('/api/session', { methode: 'POST', corps: { motDePasse: champ.value } })
          await actualiserEtat()
          notifier(`Connecté : ${infos.serveur}`)
          if (infos.compteEnEcriture) notifier('Attention : ce compte MySQL peut modifier la base. BiRTEC ne fait que lire, mais un compte en lecture seule est plus sûr.', 'erreur')
        },
      },
    ],
  })
}

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
          const ok = await essayer(() => api('/api/configuration/mysql', { methode: 'POST', corps: form.lire() }), 'Connexion enregistrée')
          if (ok !== undefined) {
            await actualiserEtat()
            demanderMotDePasse().then(() => window.birtec.recharger())
          }
        },
      }, 'Enregistrer et se connecter'),
      c.configuree && !c.ouverte ? h('button', { onclick: () => demanderMotDePasse().then(() => window.birtec.recharger()) }, ic('cadenas', 16), 'Saisir le mot de passe') : null,
      c.ouverte ? h('button', { class: 'discret', onclick: async () => { await api('/api/session', { methode: 'DELETE' }); await actualiserEtat(); window.birtec.recharger() } }, 'Fermer la connexion') : null,
    ),
  )
}

// ---------------------------------------------------------------- fichiers de configuration BIRT

function carteFichiersBirt() {
  const zone = h('div', {}, h('p', { class: 'discret' }, 'Chargement…'))
  async function dessiner() {
    const dossiers = await api('/api/fichiers-birt')
    vider(
      zone,
      h('p', { class: 'texte-2' }, 'Dossier de travail : ', h('span', { class: 'mono' }, etat.dossierTravail)),
      h('div', { class: 'grille grille-2' }, Object.entries(dossiers).map(([cle, d]) => blocFichiers(cle, d, dessiner))),
    )
  }
  dessiner()
  return h(
    'div',
    { class: 'carte pleine' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('document', 18), 'Fichiers de configuration BIRT')),
    h('p', { class: 'texte-2' }, 'Rapports modèles (mise en page, styles, page maîtresse à reprendre), bibliothèques (.rptlibrary), fichiers de traduction (.properties), images, feuilles de style… BiRTEC s’en sert pour construire les rapports et pour l’aperçu.'),
    zone,
  )
}

function blocFichiers(cle, dossier, redessiner) {
  const choix = h('input', {
    type: 'file',
    multiple: true,
    accept: dossier.extensions.join(','),
    style: { display: 'none' },
    onchange: async (e) => {
      for (const fichier of e.target.files) {
        await essayer(() => api(`/api/fichiers-birt/${cle}`, { methode: 'POST', fichier, entetes: { 'X-Nom': encodeURIComponent(fichier.name) } }), `${fichier.name} ajouté`)
      }
      redessiner()
    },
  })
  return h(
    'div',
    {},
    h('div', { class: 'actions', style: { justifyContent: 'space-between', marginBottom: '8px' } }, h('h3', {}, dossier.libelle), h('button', { class: 'petit', onclick: () => choix.click() }, ic('plus', 14), 'Ajouter'), choix),
    h('div', { class: 'discret', style: { fontSize: '12px', marginBottom: '8px' } }, dossier.extensions.join(' ')),
    dossier.fichiers.length
      ? h('div', { class: 'tableau-conteneur' }, h('table', {}, h('tbody', {}, dossier.fichiers.map((f) =>
          h('tr', {},
            h('td', {}, f.nom),
            h('td', { class: 'nombre discret' }, tailleFr(f.taille)),
            h('td', { class: 'discret' }, dateHeureFr(f.modifie)),
            h('td', {}, h('button', { class: 'petit danger', title: 'Retirer', onclick: async () => { if (await confirmer(`Retirer ${f.nom} ?`, { texte: 'Retirer', danger: true })) { await essayer(() => api(`/api/fichiers-birt/${cle}/${encodeURIComponent(f.nom)}`, { methode: 'DELETE' })); redessiner() } } }, ic('poubelle', 14))),
          )))))
      : h('div', { class: 'vide', style: { padding: '18px' } }, 'Aucun fichier.'),
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
    ligne('Java et BIRT', etat.java ? 'installés' : 'non installés : lancez la préparation'),
    h('label', { class: 'champ', style: { marginTop: '14px' } }, h('span', {}, 'Mettre l’IA en veille après (minutes)'), arret),
    h('div', { class: 'actions', style: { marginTop: '14px' } },
      h('button', { onclick: () => essayer(() => api('/api/poste', { methode: 'POST', corps: { arretIAMinutes: Number(arret.value) } }), 'Enregistré') }, 'Enregistrer'),
      h('button', {
        class: 'discret',
        onclick: async () => {
          if (!(await confirmer('Fermer BiRTEC ? Relancez-le ensuite avec son raccourci.'))) return
          await api('/api/quitter', { methode: 'POST' })
          document.body.innerHTML = '<div class="accueil"><div class="accueil-titre"><h1>BiRTEC est fermé</h1><p class="sous-titre">Vous pouvez fermer cet onglet.</p></div></div>'
        },
      }, ic('sortie', 16), 'Quitter BiRTEC'),
    ),
  )
}
