// Connaissances : ce que BiRTEC sait du site, rangé dans le fichier .birtec.
// Notes (conventions…), structure des tables, requêtes du site, fichiers BIRT (modèles, ressources).

import { h, vider, ic, fenetre, notifier, essayer, confirmer, tailleFr, dateHeureFr, nombreFr } from '/socle/ui.js'
import { api } from '/socle/api.js'

const ONGLETS = { notes: 'Notes', tables: 'Tables', requetes: 'Requêtes', fichiers: 'Fichiers BIRT' }

export default {
  chemin: 'connaissances',
  titre: 'Connaissances',
  icone: 'livre',
  menu: true,
  groupe: 'Ma base',
  aide: 'connaissances',

  async afficher(zone, { id }) {
    const onglet = ONGLETS[id] ? id : 'notes'
    const resume = await api('/api/connaissances')
    const contenu = h('div', {}, h('p', { class: 'discret' }, 'Chargement…'))
    vider(
      zone,
      h('div', { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Connaissances'), h('p', { class: 'sous-titre' }, 'Ce que BiRTEC sait de votre GMAO : conventions, structure, requêtes et rapports du site')),
        h('div', { class: 'actions' },
          h('button', { class: 'principal', onclick: importer }, ic('dossier', 16), 'Importer un dossier'),
          h('button', { class: 'discret', onclick: modifierCharte }, ic('crayon', 16), 'Charte des rapports'),
          h('button', { class: 'discret', onclick: () => changerFichier(resume.chemin) }, ic('document', 16), 'Autre fichier .birtec'),
        ),
      ),
      carteFichier(resume),
      h('div', { class: 'onglets' }, Object.entries(ONGLETS).map(([cle, libelle]) => h('a', { href: `#/connaissances/${cle}`, class: cle === onglet ? 'actif' : '' }, libelle))),
      contenu,
    )
    await { notes: ongletNotes, tables: ongletTables, requetes: ongletRequetes, fichiers: ongletFichiers }[onglet](contenu)
  },
}

function carteFichier(r) {
  const chiffre = (valeur, libelle) => h('div', { class: 'chiffre' }, h('strong', {}, nombreFr(valeur)), h('span', {}, libelle))
  return h('div', { class: 'carte', style: { marginBottom: '16px' } },
    h('div', { class: 'carte-entete' },
      h('h2', {}, ic('livre', 18), 'Fichier de connaissances'),
      h('a', { class: 'bouton petit discret', href: '/api/connaissances/telecharger', title: 'Une copie de sauvegarde du fichier' }, ic('telecharger', 14), 'Copie'),
    ),
    h('p', { class: 'texte-2' }, h('span', { class: 'mono' }, r.chemin), ` — ${tailleFr(r.taille)}`),
    h('div', { class: 'chiffres' },
      chiffre(r.notes, 'notes'), chiffre(r.tables, 'tables'), chiffre(r.liens, 'liens'), chiffre(r.requetes, 'requêtes'),
      chiffre(r.fichiers.modeles || 0, 'modèles'), chiffre(r.fichiers.ressources || 0, 'ressources'),
    ),
    h('p', { class: 'discret', style: { fontSize: '13px', marginBottom: 0 } }, 'Ce fichier reste sur ce poste (ou là où vous le rangez) : il n’est jamais publié avec le programme. Copiez-le pour le sauvegarder ou l’utiliser sur un autre poste.'),
  )
}

// ---------------------------------------------------------------- importation et choix du fichier

async function demanderChemin({ titre, explication, valeur = '', bouton }) {
  const champ = h('input', { type: 'text', value: valeur, class: 'mono', style: { width: '100%' } })
  return fenetre({
    titre,
    contenu: h('div', {}, h('p', { class: 'texte-2' }, explication), champ),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: bouton, classe: 'principal', action: () => champ.value.trim() || false },
    ],
  })
}

async function importer() {
  const dossier = await demanderChemin({
    titre: 'Importer un dossier',
    explication: 'Chemin d’un dossier de documents (sous-dossiers compris) : export de structure de la base (CREATE TABLE), requêtes .sql, notes .md/.txt/.docx, rapports .rptdesign, bibliothèques, feuilles de style… Les fichiers de connexion contenant un mot de passe sont ignorés.',
    bouton: 'Importer',
  })
  if (!dossier) return
  notifier('Importation en cours…')
  try {
    const b = await api('/api/connaissances/importer', { methode: 'POST', corps: { dossier } })
    await fenetre({
      titre: 'Importation terminée',
      contenu: h('div', {},
        h('ul', {},
          h('li', {}, `${b.tables} tables, ${b.liens} liens importés, ${b.liensDeduits} liens déduits des noms de colonnes`),
          h('li', {}, `${b.requetes} requêtes, ${b.notes} notes`),
          h('li', {}, `${b.modeles} rapports modèles, ${b.ressources} ressources`),
        ),
        b.ignores.length ? [h('p', {}, 'Laissés de côté :'), h('ul', { class: 'discret' }, b.ignores.map((i) => h('li', {}, i)))] : null,
      ),
      boutons: [{ texte: 'Fermer', classe: 'principal', valeur: true }],
    })
    window.birtec.recharger()
  } catch (erreur) {
    notifier(erreur.message, 'erreur')
  }
}

async function changerFichier(actuel) {
  const chemin = await demanderChemin({
    titre: 'Autre fichier .birtec',
    explication: 'Chemin du fichier à ouvrir. S’il n’existe pas, un fichier vide est créé à cet endroit.',
    valeur: actuel,
    bouton: 'Ouvrir',
  })
  if (!chemin) return
  await essayer(() => api('/api/connaissances/fichier', { methode: 'POST', corps: { chemin } }), 'Fichier ouvert')
  window.birtec.recharger()
}

// ---------------------------------------------------------------- charte des rapports

async function modifierCharte() {
  const charte = await api('/api/connaissances/charte')
  const zoneTexte = h('textarea', { class: 'sql', rows: 24, spellcheck: false }, JSON.stringify(charte, null, 2))
  const ok = await fenetre({
    titre: 'Charte des rapports',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, 'Aspect et conventions des rapports créés par BiRTEC, pour qu’ils ressemblent à ceux de la GMAO et s’y déposent tels quels : couleurs, police, feuille de style et logo ; nom de la source de données, pilote, profil de connexion ; paramètres cachés passés par la GMAO. Voir l’aide « Rapports ».'),
      zoneTexte),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: () => api('/api/connaissances/charte', { methode: 'POST', corps: JSON.parse(zoneTexte.value) }).then(() => true) },
    ],
  })
  if (ok) notifier('Charte enregistrée : elle s’applique aux prochains rapports créés.')
}

// ---------------------------------------------------------------- notes

async function ongletNotes(zone) {
  const notes = await api('/api/connaissances/notes')
  vider(zone,
    h('div', { class: 'actions', style: { marginBottom: '12px' } },
      h('button', { onclick: () => modifierNote() }, ic('plus', 16), 'Nouvelle note'),
      h('span', { class: 'discret' }, 'Les notes « toujours » sont données à l’IA à chaque question ; les autres seulement quand elles parlent du sujet.'),
    ),
    notes.length
      ? notes.map((n) => h('div', { class: 'carte', style: { marginBottom: '10px' } },
          h('div', { class: 'carte-entete' },
            h('h3', {}, n.titre, n.toujours ? h('span', { class: 'etiquette accent', style: { marginLeft: '8px' } }, 'toujours') : null),
            h('div', { class: 'actions' },
              h('button', { class: 'petit discret', onclick: () => modifierNote(n) }, ic('crayon', 14), 'Modifier'),
              h('button', { class: 'petit discret danger', onclick: async () => { if (await confirmer(`Supprimer la note « ${n.titre} » ?`, { texte: 'Supprimer', danger: true })) { await api(`/api/connaissances/notes/${n.id}`, { methode: 'DELETE' }); window.birtec.recharger() } } }, ic('poubelle', 14)),
            ),
          ),
          h('pre', { class: 'note-contenu' }, n.contenu.length > 1200 ? n.contenu.slice(0, 1200) + ' …' : n.contenu),
          n.source ? h('div', { class: 'discret', style: { fontSize: '12px' } }, n.source) : null,
        ))
      : h('div', { class: 'carte vide' }, 'Aucune note. Importez un dossier ou écrivez les conventions de votre GMAO (format des dates, statuts, tables principales…).'),
  )
}

async function modifierNote(note = {}) {
  const titre = h('input', { type: 'text', value: note.titre || '' })
  const contenu = h('textarea', { rows: 16, class: 'sql', spellcheck: true }, note.contenu || '')
  const toujours = h('input', { type: 'checkbox', checked: Boolean(note.toujours) })
  const ok = await fenetre({
    titre: note.id ? 'Modifier la note' : 'Nouvelle note',
    large: true,
    contenu: h('div', { class: 'grille' },
      h('label', { class: 'champ' }, h('span', {}, 'Titre'), titre),
      h('label', { class: 'champ' }, h('span', {}, 'Contenu'), contenu),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, toujours, 'Donner cette note à l’IA à chaque question (conventions du site)'),
    ),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: () => api('/api/connaissances/notes', { methode: 'POST', corps: { id: note.id, titre: titre.value, contenu: contenu.value, toujours: toujours.checked } }).then(() => true) },
    ],
  })
  if (ok) window.birtec.recharger()
}

// ---------------------------------------------------------------- tables

async function ongletTables(zone) {
  const tables = await api('/api/connaissances/tables')
  const filtre = h('input', { type: 'search', placeholder: 'Filtrer les tables…', style: { maxWidth: '320px' } })
  const corps = h('tbody')
  const dessiner = () => {
    const texte = filtre.value.toLowerCase()
    vider(corps, tables.filter((t) => !texte || t.nom.toLowerCase().includes(texte) || t.commentaire.toLowerCase().includes(texte)).slice(0, 500).map((t) =>
      h('tr', {}, h('td', {}, h('a', { href: `#/base/${encodeURIComponent(t.nom)}`, class: 'mono' }, t.nom)), h('td', { class: 'nombre' }, t.colonnes), h('td', { class: 'nombre' }, t.liens), h('td', { class: 'discret' }, t.commentaire))))
  }
  filtre.addEventListener('input', dessiner)
  dessiner()
  vider(zone, tables.length
    ? h('div', { class: 'carte' },
        h('p', { class: 'texte-2' }, 'Structure gardée dans le fichier : elle est mise à jour à chaque lecture de la base, et sert à l’assistant même quand la connexion MySQL est fermée.'),
        filtre,
        h('div', { class: 'tableau-conteneur', style: { marginTop: '12px' } }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'Table'), h('th', {}, 'Colonnes'), h('th', {}, 'Liens'), h('th', {}, 'Commentaire'))), corps)))
    : h('div', { class: 'carte vide' }, 'Aucune table : connectez-vous à MySQL (la structure est alors enregistrée) ou importez un export « CREATE TABLE ».'))
}

// ---------------------------------------------------------------- requêtes

async function ongletRequetes(zone) {
  const requetes = await api('/api/connaissances/requetes')
  vider(zone, requetes.length
    ? requetes.map((r) => h('details', { class: 'carte', style: { marginBottom: '8px' } },
        h('summary', {}, h('strong', {}, r.titre), h('span', { class: 'discret', style: { marginLeft: '10px', fontSize: '12px' } }, r.source || '')),
        r.description ? h('p', { class: 'texte-2', style: { whiteSpace: 'pre-wrap' } }, r.description) : null,
        h('pre', { class: 'code', 'data-langue': 'sql' }, h('code', {}, r.sql)),
        h('div', { class: 'actions' },
          h('a', { class: 'bouton petit', href: `#/base?sql=${encodeURIComponent(r.sql)}` }, ic('console', 14), 'Console'),
          h('button', { class: 'petit discret danger', onclick: async () => { if (await confirmer(`Retirer la requête « ${r.titre} » ?`, { texte: 'Retirer', danger: true })) { await api(`/api/connaissances/requetes/${r.id}`, { methode: 'DELETE' }); window.birtec.recharger() } } }, ic('poubelle', 14), 'Retirer'),
        ),
      ))
    : h('div', { class: 'carte vide' }, 'Aucune requête. Importez un dossier contenant vos fichiers .sql ou vos rapports : l’IA s’en inspire pour écrire les nouvelles.'))
}

// ---------------------------------------------------------------- fichiers BIRT

async function ongletFichiers(zone) {
  const categories = await api('/api/connaissances/fichiers')
  vider(zone, h('div', { class: 'grille grille-2' }, Object.entries(categories).map(([cle, c]) => blocFichiers(cle, c))))
}

function blocFichiers(cle, categorie) {
  const choix = h('input', {
    type: 'file',
    multiple: true,
    accept: categorie.extensions.join(','),
    style: { display: 'none' },
    onchange: async (e) => {
      for (const fichier of e.target.files) {
        await essayer(() => api(`/api/connaissances/fichiers/${cle}`, { methode: 'POST', fichier, entetes: { 'X-Nom': encodeURIComponent(fichier.name) } }), `${fichier.name} ajouté`)
      }
      window.birtec.recharger()
    },
  })
  const adresse = (f) => `/api/connaissances/fichiers/${cle}/${encodeURIComponent(f.nom)}`
  return h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, categorie.libelle), h('button', { class: 'petit', onclick: () => choix.click() }, ic('plus', 14), 'Ajouter'), choix),
    h('div', { class: 'discret', style: { fontSize: '12px', marginBottom: '8px' } }, categorie.extensions.join(' ')),
    categorie.fichiers.length
      ? h('div', { class: 'tableau-conteneur' }, h('table', {}, h('tbody', {}, categorie.fichiers.map((f) =>
          h('tr', {},
            h('td', {}, h('a', { href: adresse(f), title: f.source || '' }, f.nom)),
            h('td', { class: 'nombre discret' }, tailleFr(f.taille)),
            h('td', { class: 'discret' }, dateHeureFr(f.modifie)),
            h('td', { class: 'actions' },
              cle === 'modeles' ? h('button', { class: 'petit discret', title: 'Copier dans les rapports pour l’aperçu', onclick: async () => { const { nom } = await api(`/api/connaissances/modeles/${encodeURIComponent(f.nom)}/vers-rapports`, { methode: 'POST' }); location.hash = `#/rapports/${encodeURIComponent(nom)}` } }, ic('oeil', 14)) : null,
              h('button', { class: 'petit discret danger', title: 'Retirer', onclick: async () => { if (await confirmer(`Retirer ${f.nom} du fichier .birtec ?`, { texte: 'Retirer', danger: true })) { await api(adresse(f), { methode: 'DELETE' }); window.birtec.recharger() } } }, ic('poubelle', 14)),
            ),
          )))))
      : h('div', { class: 'vide', style: { padding: '18px' } }, 'Aucun fichier.'),
  )
}
