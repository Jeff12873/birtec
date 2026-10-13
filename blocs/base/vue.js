// Base de données : liste des tables, détail d'une table, console SQL (lecture seule).

import { h, vider, ic, essayer, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat } from '/socle/etat.js'
import { demanderMotDePasse } from '/blocs/configuration/vue.js'

let sqlConsole = 'SELECT * FROM '

export default {
  chemin: 'base',
  titre: 'Base de données',
  icone: 'base',
  menu: true,
  aide: 'base',

  async afficher(zone, { id, query }) {
    if (query.sql) sqlConsole = query.sql
    const schema = await api('/api/schema')
    // Connexion fermée : on montre la structure gardée dans le fichier .birtec.
    const ferme = !etat.connexion.ouverte
      ? h('div', { class: 'bandeau' }, ic('cadenas'), h('span', { style: { flex: 1 } }, 'Connexion MySQL fermée : structure du fichier .birtec. Connectez-vous pour exécuter des requêtes.'), h('button', { onclick: () => demanderMotDePasse().then(() => window.birtec.recharger()) }, 'Se connecter'))
      : null
    const filtre = h('input', { type: 'search', placeholder: 'Filtrer les tables…' })
    const liste = h('div', { class: 'liste-tables' })
    const detail = h('div')
    const console_ = consoleSQL()

    function dessinerListe() {
      const texte = filtre.value.toLowerCase()
      vider(liste, schema.tables
        .filter((t) => !texte || t.nom.toLowerCase().includes(texte) || (t.commentaire || '').toLowerCase().includes(texte))
        .map((t) => h('a', { href: `#/base/${encodeURIComponent(t.nom)}`, class: t.nom === id ? 'actif' : '', title: t.commentaire || '' }, ic(t.type === 'VIEW' ? 'oeil' : 'table', 14), ' ', t.nom)))
    }
    filtre.addEventListener('input', dessinerListe)
    dessinerListe()

    const table = schema.tables.find((t) => t.nom === id)
    if (table) afficherTable(detail, table, console_)
    else vider(detail, h('div', { class: 'carte' }, h('p', { class: 'texte-2' }, `${schema.tables.length} tables dans la base « ${schema.base} ». Choisissez-en une à gauche pour voir ses colonnes, ses liens et ses premières lignes.`)))

    vider(
      zone,
      ferme,
      h('div', { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Base de données'), h('p', { class: 'sous-titre' }, `${schema.base} — ${schema.tables.length} tables`)),
        h('button', { onclick: async () => { await essayer(() => api('/api/schema?rafraichir=1'), 'Structure relue'); window.birtec.recharger() } }, ic('rafraichir', 16), 'Relire la structure'),
      ),
      h('div', { style: { display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: '16px', alignItems: 'start' } },
        h('div', { class: 'carte', style: { padding: '12px' } }, filtre, h('div', { style: { height: '10px' } }), liste),
        h('div', { class: 'grille' }, detail, console_.element),
      ),
    )
  },
}

function afficherTable(zone, table, console_) {
  vider(
    zone,
    h('div', { class: 'carte' },
      h('div', { class: 'carte-entete' }, h('h2', {}, ic('table', 18), table.nom), h('span', { class: 'discret' }, table.commentaire || '')),
      h('div', { class: 'tableau-conteneur' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Colonne', 'Type', 'Clé', 'Vide possible', 'Commentaire'].map((t) => h('th', {}, t)))),
        h('tbody', {}, table.colonnes.map((c) => h('tr', {},
          h('td', { class: 'mono' }, c.nom), h('td', { class: 'texte-2' }, c.type + (c.taille ? `(${c.taille})` : '')),
          h('td', {}, c.cle ? h('span', { class: 'etiquette accent' }, 'clé') : ''), h('td', {}, c.vide ? 'oui' : ''), h('td', { class: 'texte-2' }, c.commentaire || ''),
        ))),
      )),
      table.liens.length ? h('p', { class: 'texte-2', style: { marginTop: '12px' } }, 'Liens : ', table.liens.map((l) => [h('a', { href: `#/base/${encodeURIComponent(l.versTable)}`, class: 'mono' }, `${l.colonne} → ${l.versTable}.${l.versColonne}`), ' '])) : null,
      h('div', { class: 'actions', style: { marginTop: '12px' } },
        h('button', { onclick: () => console_.executer(`SELECT * FROM ${table.nom}`, 20) }, ic('lecture', 15), 'Voir les 20 premières lignes'),
        h('a', { class: 'bouton', href: '#/assistant', onclick: () => sessionStorage.setItem('birtec-question', `Explique à quoi sert la table ${table.nom} et ses principales colonnes.`) }, ic('oiseau', 15), 'Demander à l’IA'),
      ),
    ),
  )
}

// La console SQL : réutilisée aussi par l'assistant (« Exécuter » sous une requête).
export function consoleSQL() {
  const saisie = h('textarea', { class: 'sql', spellcheck: false }, sqlConsole)
  saisie.addEventListener('input', () => (sqlConsole = saisie.value))
  saisie.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) executer()
  })
  const resultats = h('div')

  async function executer(sql = saisie.value, limite = 200) {
    if (sql !== saisie.value) {
      saisie.value = sql
      sqlConsole = sql
    }
    vider(resultats, h('p', { class: 'discret curseur' }, 'Exécution'))
    const r = await essayer(() => api('/api/requete', { methode: 'POST', corps: { sql, limite } }))
    vider(resultats, r ? tableauResultats(r) : null)
  }

  return {
    executer,
    element: h('div', { class: 'carte' },
      h('div', { class: 'carte-entete' }, h('h2', {}, ic('console', 18), 'Console SQL'), h('span', { class: 'discret' }, 'lecture seule — Ctrl+Entrée pour exécuter')),
      saisie,
      h('div', { class: 'actions', style: { marginTop: '10px' } }, h('button', { class: 'principal', onclick: () => executer() }, ic('lecture', 15), 'Exécuter')),
      resultats,
    ),
  }
}

export function tableauResultats(r) {
  const csv = () => [r.colonnes.map((c) => c.nom), ...r.lignes].map((l) => l.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(';')).join('\n')
  return h('div', {},
    h('p', { class: 'discret', style: { margin: '12px 0 4px' } },
      `${r.lignes.length} ligne${r.lignes.length > 1 ? 's' : ''}${r.tronque ? ' (les suivantes ne sont pas affichées)' : ''} — ${r.dureeMs} ms `,
      h('button', { class: 'discret petit', onclick: () => navigator.clipboard.writeText(csv()).then(() => notifier('Résultat copié (à coller dans Excel)')) }, ic('copier', 14), 'Copier'),
    ),
    h('div', { class: 'tableau-conteneur resultats' }, h('table', {},
      h('thead', {}, h('tr', {}, r.colonnes.map((c) => h('th', { title: c.type }, c.nom)))),
      h('tbody', {}, r.lignes.map((l) => h('tr', {}, l.map((v) => h('td', {}, v === null ? h('span', { class: 'discret' }, 'NULL') : v))))),
    )),
  )
}
