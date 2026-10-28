// Base de données : liste des tables, détail d'une table, console SQL (lecture seule).

import { h, vider, ic, essayer, notifier, deuxPanneaux, fenetre } from '/socle/ui.js'
import { api, adresse } from '/socle/api.js'
import { etat } from '/socle/etat.js'
import { demanderMotDePasse } from '../configuration/vue.js'

let sqlConsole = 'SELECT * FROM '

export default {
  chemin: 'base',
  titre: 'Base de données',
  icone: 'base',
  menu: 'admin',
  groupe: 'Ma base',
  aide: 'base',

  async afficher(zone, { id, query }) {
    if (query.sql) sqlConsole = query.sql
    const schema = await api('/api/schema')
    // Connexion fermée : on montre la structure gardée dans le fichier .ktec.
    const ferme = !etat.connexion.ouverte
      ? h('div', { class: 'bandeau' }, ic('cadenas'), h('span', { style: { flex: 1 } }, 'Connexion à la GMAO indisponible : structure du fichier .ktec, sans exécution de requêtes.'))
      : null
    const filtre = h('input', { type: 'search', placeholder: 'Filtrer les tables…' })
    const liste = h('div', { class: 'liste-tables' })
    const detail = h('div')
    const console_ = consoleSQL()

    // Une case par table : décochée, la table n'est jamais donnée à l'IA (gardé dans le fichier .ktec).
    const voirEcartees = h('input', { type: 'checkbox', checked: localStorage.getItem('birtec-voir-ecartees') === '1', onchange: () => { try { localStorage.setItem('birtec-voir-ecartees', voirEcartees.checked ? '1' : '0') } catch {} dessinerListe() } })
    function dessinerListe() {
      const texte = filtre.value.toLowerCase()
      vider(liste, schema.tables
        .filter((t) => voirEcartees.checked || !t.exclue || t.nom === id)
        .filter((t) => !texte || [t.nom, t.commentaire, t.libelle, t.description].join(' ').toLowerCase().includes(texte))
        .map((t) => {
          const coche = h('input', {
            type: 'checkbox', checked: !t.exclue, title: 'Prise en compte par l’IA',
            onclick: (e) => e.stopPropagation(),
            onchange: async () => {
              t.exclue = !coche.checked
              await api('/api/dictionnaire', { methode: 'POST', corps: { table: t.nom, exclue: t.exclue } })
              lien.classList.toggle('ecartee', t.exclue)
            },
          })
          const lien = h('a', { href: `#/base/${encodeURIComponent(t.nom)}`, class: `${t.nom === id ? 'actif' : ''} ${t.exclue ? 'ecartee' : ''}`, title: [t.libelle, t.description, t.commentaire].filter(Boolean).join(' — ') },
            coche, ' ', h('span', { class: 'mono' }, t.nom), t.libelle ? h('span', { class: 'discret', style: { fontSize: '12px', display: 'block', marginLeft: '22px' } }, t.libelle) : null)
          return lien
        }))
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
        h('div', {}, h('h1', {}, 'Base de données'), h('p', { class: 'sous-titre' }, `${schema.base} — ${schema.tables.length} tables. Cochez les tables à donner à l’IA, nommez et décrivez-les : tout est gardé dans le fichier .ktec.`)),
        h('button', { onclick: () => choisirTablesAExtraire(schema.tables, id) }, ic('telecharger', 16), 'Extraire des tables…'),
        h('a', { class: 'bouton discret', href: `#/schema${id ? `/${encodeURIComponent(id)}` : ''}` }, ic('reseau', 16), 'Constellation'),
        h('button', { onclick: async () => { await essayer(() => api('/api/schema?rafraichir=1'), 'Structure relue'); window.ktec.recharger() } }, ic('rafraichir', 16), 'Relire la structure'),
      ),
      deuxPanneaux(
        h('div', { class: 'carte', style: { padding: '12px' } },
          filtre,
          h('div', { class: 'discret', style: { fontSize: '12px', margin: '8px 0', display: 'flex', flexDirection: 'column', gap: '4px' } },
            `${schema.tables.filter((t) => !t.exclue).length} tables données à l’IA sur ${schema.tables.length}`,
            h('label', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, voirEcartees, 'Voir les tables écartées'),
            etat.connexion.ouverte ? h('a', { href: '#', onclick: async (e) => { e.preventDefault(); const r = await api('/api/dictionnaire/ecarter-vides', { methode: 'POST' }); notifier(`${r.ecartees} table(s) vide(s) écartée(s)`); window.ktec.recharger() } }, 'Écarter les tables vides') : null),
          liste),
        h('div', { class: 'grille' }, detail, console_.element),
        { cle: 'base', largeur: 300 },
      ),
    )
  },
}

// Détail d'une table : nom clair et description (modifiables, gardés dans le .ktec), colonnes, liens.
function afficherTable(zone, table, console_) {
  // Un champ qui enregistre dans le dictionnaire quand on le quitte.
  const champ = (valeur, enregistrer, attributs = {}) => {
    const entree = h('input', { type: 'text', value: valeur || '', class: 'champ-dico', ...attributs })
    entree.addEventListener('change', async () => {
      await enregistrer(entree.value.trim())
      entree.classList.add('enregistre')
      setTimeout(() => entree.classList.remove('enregistre'), 1200)
    })
    return entree
  }
  const dico = (colonne, cle) => (valeur) => api('/api/dictionnaire', { methode: 'POST', corps: { table: table.nom, colonne, [cle]: valeur } })

  vider(
    zone,
    h('div', { class: 'carte' },
      h('div', { class: 'carte-entete' }, h('h2', {}, ic('table', 18), table.nom), h('span', { class: 'discret' }, table.commentaire || '')),
      table.exclue ? h('div', { class: 'bandeau' }, ic('alerte'), 'Table écartée : elle n’est pas donnée à l’IA (cochez-la dans la liste pour la reprendre).') : null,
      h('div', { class: 'grille grille-2', style: { marginBottom: '12px' } },
        h('label', { class: 'champ' }, h('span', {}, 'Nom clair'), champ(table.libelle, dico('', 'libelle'), { placeholder: 'ex. Rapport d’intervention' })),
        h('label', { class: 'champ' }, h('span', {}, 'Description (pour l’IA)'), champ(table.description, dico('', 'description'), { placeholder: 'À quoi sert la table, comment la relier…' })),
      ),
      h('div', { class: 'tableau-conteneur' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Colonne', 'Type', 'Clé', 'Nom clair', 'Description'].map((t) => h('th', {}, t)))),
        h('tbody', {}, table.colonnes.map((c) => h('tr', {},
          h('td', { class: 'mono', title: c.commentaire || '' }, c.nom), h('td', { class: 'texte-2' }, c.type + (c.taille ? `(${c.taille})` : '')),
          h('td', {}, c.cle ? h('span', { class: 'etiquette accent' }, 'clé') : ''),
          h('td', {}, champ(c.libelle, dico(c.nom, 'libelle'))),
          h('td', {}, champ(c.description, dico(c.nom, 'description'), { placeholder: c.commentaire || '' })),
        ))),
      )),
      table.liens.length ? h('p', { class: 'texte-2', style: { marginTop: '12px' } }, 'Liens : ', table.liens.map((l) => [h('a', { href: `#/base/${encodeURIComponent(l.versTable)}`, class: 'mono' }, `${l.colonne} → ${l.versTable}.${l.versColonne}`), l.libelle ? ` (${l.libelle})` : '', ' '])) : null,
      h('div', { class: 'actions', style: { marginTop: '12px' } },
        h('button', { onclick: () => console_.executer(`SELECT * FROM ${table.nom}`, 20) }, ic('lecture', 15), 'Voir les 20 premières lignes'),
        h('button', { onclick: () => extraireTables([table.nom]) }, ic('telecharger', 15), 'Télécharger cette table'),
        h('a', { class: 'bouton', href: `#/schema/${encodeURIComponent(table.nom)}` }, ic('reseau', 15), 'Constellation'),
        h('a', { class: 'bouton', href: '#/assistant', onclick: () => sessionStorage.setItem('birtec-question', `Explique à quoi sert la table ${table.nom} et ses principales colonnes.`) }, ic('oiseau', 15), 'Demander à l’IA'),
      ),
    ),
  )
}

// ---------------------------------------------------------------- extraction des données

// Télécharge les tables (données en CSV, structure et lisez-moi) dans un fichier .zip.
// Réutilisé par la Constellation.
export async function extraireTables(tables) {
  if (!tables.length) return notifier('Aucune table choisie.', 'erreur')
  if (!etat.connexion.ouverte) await demanderMotDePasse().catch(() => {})
  notifier(`Extraction de ${tables.length} table(s)…`)
  try {
    const reponse = await fetch(adresse('/api/extraction'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KTEC': '1' }, body: JSON.stringify({ tables }) })
    if (!reponse.ok) throw new Error((await reponse.json().catch(() => ({}))).erreur || `Erreur ${reponse.status}`)
    const nom = decodeURIComponent((reponse.headers.get('Content-Disposition') || '').match(/filename\*=UTF-8''([^;]+)/)?.[1] || 'extraction.zip')
    const lien = h('a', { href: URL.createObjectURL(await reponse.blob()), download: nom })
    document.body.append(lien)
    lien.click()
    lien.remove()
    setTimeout(() => URL.revokeObjectURL(lien.href), 10_000)
    notifier(`Extraction prête : ${nom}`)
  } catch (erreur) {
    notifier(erreur.message, 'erreur')
  }
}

// Fenêtre de choix des tables à extraire (cases à cocher, filtre, tout cocher).
async function choisirTablesAExtraire(tables, actuelle) {
  const choisies = new Set(actuelle ? [actuelle] : [])
  const filtre = h('input', { type: 'search', placeholder: 'Filtrer les tables…' })
  const voirEcartees = h('input', { type: 'checkbox' })
  const liste = h('div', { class: 'liste-champs', style: { columns: '2 220px' } })
  const compteur = h('span', { class: 'discret' })
  const visibles = () => {
    const texte = filtre.value.toLowerCase()
    return tables.filter((t) => (voirEcartees.checked || !t.exclue) && (!texte || `${t.nom} ${t.libelle || ''}`.toLowerCase().includes(texte)))
  }
  const dessiner = () => {
    vider(liste, visibles().map((t) => {
      const coche = h('input', { type: 'checkbox', checked: choisies.has(t.nom), onchange: () => { coche.checked ? choisies.add(t.nom) : choisies.delete(t.nom); compter() } })
      return h('label', { class: 'valeur-filtre', title: t.libelle || '' }, coche, h('span', { class: 'mono' }, t.nom), t.libelle ? h('span', { class: 'discret' }, ` ${t.libelle}`) : null)
    }))
    compter()
  }
  const compter = () => (compteur.textContent = `${choisies.size} table(s) choisie(s)`)
  filtre.addEventListener('input', dessiner)
  voirEcartees.addEventListener('change', dessiner)
  dessiner()
  const ok = await fenetre({
    titre: 'Extraire des tables',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, 'Les tables cochées sont téléchargées dans un fichier .zip : un fichier CSV par table (s’ouvre dans Excel), leur structure avec les noms clairs du dictionnaire, et un lisez-moi. 200 000 lignes au plus par table.'),
      h('div', { class: 'actions' }, filtre,
        h('button', { class: 'petit discret', onclick: () => { for (const t of visibles()) choisies.add(t.nom); dessiner() } }, 'Tout cocher'),
        h('button', { class: 'petit discret', onclick: () => { choisies.clear(); dessiner() } }, 'Tout décocher'),
        h('label', { class: 'case-schema' }, voirEcartees, 'Tables écartées')),
      liste,
      compteur),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Télécharger', classe: 'principal', action: () => (choisies.size ? [...choisies] : false) },
    ],
  })
  if (ok) extraireTables(ok)
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
