// Configuration : connexion MySQL (commune à toutes les applications KTEC, voir /socle/reglages.js), réglages du poste. (Fichiers BIRT et connaissances : écran « Connaissances ».)

import { h, vider, ic, essayer, notifier } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { carteMySQL, cartePoste } from '/socle/reglages.js'

export default {
  chemin: 'configuration',
  titre: 'Configuration',
  icone: 'reglages',
  menu: 'admin',
  groupe: 'Réglages',
  aide: 'configuration',

  async afficher(zone) {
    vider(
      zone,
      h('div', { class: 'entete-page' }, h('div', {}, h('h1', {}, 'Configuration'), h('p', { class: 'sous-titre' }, 'Connexion à la base et réglages de ce poste'))),
      h('div', { class: 'grille grille-2' }, carteMySQL(() => window.ktec.recharger()), cartePoste(() => window.ktec.recharger()), carteModele()),
    )
  },
}

// ---------------------------------------------------------------- modèle de données

// Le modèle de données du site (blocs/phrase/modele.js) : ce que LA PHRASE doit savoir de la base pour guider
// (machines, fiches techniques). Rangé dans le fichier .ktec ; BiRTEC le propose en reconnaissant la forme des
// tables, l'administrateur vérifie, corrige au besoin, et enregistre.
function carteModele() {
  const resume = h('div')
  const texte = h('textarea', { class: 'sql', rows: 14, spellcheck: false })
  const details = h('details', {}, h('summary', { class: 'discret' }, 'Corriger à la main'), texte)
  const types = h('div', { class: 'types-objets' })
  let schema = null
  let courant = null
  // Le texte « Corriger à la main » suit le tableau des types : « Enregistrer » ne lit que lui.
  // (Une ligne sans table n'y entre pas.)
  const synchroniser = () => {
    texte.value = JSON.stringify({ ...courant, objets: Object.fromEntries(Object.entries(courant.objets).filter(([, o]) => o.table)) }, null, 2)
  }
  const montrer = (modele, provisoire = false) => {
    courant = modele || { objets: {} }
    texte.value = modele ? JSON.stringify(modele, null, 2) : ''
    dessinerTypes()
    const ft = modele?.ficheTechnique
    const ligne = (titre, valeur) => h('div', { class: 'ligne-modele' }, h('span', { class: 'discret' }, titre), h('span', { class: 'mono' }, valeur || '—'))
    vider(resume,
      provisoire ? h('div', { class: 'bandeau info' }, ic('etincelle'), 'Proposition : vérifiez, puis « Enregistrer ».') : null,
      !modele ? h('p', { class: 'texte-2' }, 'Pas encore de modèle de données : « Reconnaître » le propose d’après la base.') : [
        ligne('Machines', modele.machine ? `${modele.machine.table} (code ${modele.machine.code}, nom ${modele.machine.nom})` : null),
        ligne('Fiches techniques : valeurs', ft ? `${ft.valeurs.table} — objet ${ft.valeurs.typeObjet} / ${ft.valeurs.idObjet}` : null),
        ligne('… modèles', ft ? `${ft.modeles.table}.${ft.modeles.code}` : null),
        ligne('… champs', ft ? `${ft.champs.table}.${ft.champs.code}` : null),
      ])
  }
  // Les types d'objets : la valeur de la colonne « type » (PIECE, RI…) et la table qu'elle désigne. Réglés ici, ils
  // passent avant ce que BiRTEC reconnaît sur les données.
  const choisirTable = (code, nomTable) => {
    const t = schema?.tables.find((x) => x.nom === nomTable)
    if (!t) return
    const cle = t.colonnes.find((c) => c.cle) || t.colonnes.find((c) => /^id_|_id$|^id$/i.test(c.nom))
    const textes = t.colonnes.filter((c) => /char|text/i.test(c.type || '') && !c.cle && !/^id_|_id$/i.test(c.nom))
    const nom = textes.find((c) => /desi/i.test(c.nom)) || textes.find((c) => /libel|intitul|^nom|nom$/i.test(c.nom)) || textes[0] || cle
    courant.objets[code] = { table: t.nom, cle: cle?.nom, nom: nom?.nom }
  }
  function dessinerTypes() {
    const objets = (courant.objets ||= {})
    const tables = (schema?.tables || []).map((t) => t.nom).sort((a, b) => a.localeCompare(b))
    const choix = (valeur) => h('select', {}, h('option', { value: '' }, '— table —'), ...tables.map((n) => h('option', { value: n, selected: n === valeur }, n)))
    const ligneType = (code, o) => {
      const champCode = h('input', { value: code, placeholder: 'PIECE, RI…', class: 'mono', onchange: () => {
        const nouveau = champCode.value.trim().toUpperCase()
        if (!nouveau || nouveau === code) { champCode.value = code; return }
        if (objets[nouveau]) { champCode.value = code; return notifier(`Le type ${nouveau} existe déjà.`, 'erreur') }
        objets[nouveau] = objets[code]; delete objets[code]; synchroniser(); dessinerTypes()
      } })
      const champTable = choix(o.table)
      champTable.onchange = () => { choisirTable(code, champTable.value); synchroniser() }
      return h('div', { class: 'ligne-type' }, champCode, h('span', { class: 'discret' }, '→'), champTable,
        h('button', { class: 'petit', title: 'Retirer ce type', onclick: () => { delete objets[code]; synchroniser(); dessinerTypes() } }, ic('poubelle', 14)))
    }
    vider(types,
      h('div', { class: 'ligne-modele' }, h('span', { class: 'discret' }, 'Types d’objets'), h('span', { class: 'texte-2' }, 'La valeur de la colonne « type » des fiches et la table qu’elle désigne.')),
      ...Object.entries(objets).map(([code, o]) => ligneType(code, o)),
      h('button', { class: 'petit', onclick: () => {
        let n = 1
        while (objets[`TYPE${n}`]) n++
        objets[`TYPE${n}`] = { table: '', cle: '', nom: '' }
        synchroniser(); dessinerTypes()
      } }, ic('plus', 14), 'Ajouter un type'))
  }
  api('/api/schema').then((r) => { schema = r; if (courant) dessinerTypes() }).catch(() => {})
  api('/api/modele').then((r) => montrer(r.modele)).catch(() => montrer(null))
  return h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('reseau', 18), 'Modèle de données')),
    h('p', { class: 'texte-2', style: { marginTop: 0 } }, 'Ce que LA PHRASE doit savoir de la base pour guider : la table des machines (reliée à l’arborescence de PDRTEC et aux parcs d’AITEC) et les fiches techniques (modèle, champ, valeur, et les objets auxquels elles se rattachent). Gardé dans le fichier .ktec : rien de la base n’est écrit dans le logiciel.'),
    resume,
    types,
    details,
    h('div', { class: 'actions', style: { marginTop: '12px' } },
      h('button', { onclick: async () => { const r = await essayer(() => api('/api/modele/reconnaitre', { methode: 'POST', corps: {} })); if (r) montrer(r.modele, true) } }, ic('etincelle', 16), 'Reconnaître'),
      h('button', { class: 'principal', onclick: async () => {
        let modele
        try { modele = JSON.parse(texte.value) } catch { return notifier('Le modèle corrigé n’est pas lisible (JSON).', 'erreur') }
        const r = await essayer(() => api('/api/modele', { methode: 'POST', corps: { modele } }), 'Modèle de données enregistré')
        if (r) montrer(r.modele)
      } }, 'Enregistrer')))
}

// ---------------------------------------------------------------- mot de passe (à chaque ouverture)

// La demande du mot de passe est commune à toutes les applications KTEC (une seule connexion).
export { demanderMotDePasse } from '/socle/connexion.js'
