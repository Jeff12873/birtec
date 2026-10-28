// Nouveau : on choisit d'abord ce qu'on crée, un rapport ou un indicateur ITM.
//   #/constructeur          → le choix
//   #/constructeur/rapport  → l'éditeur de rapport : une page faite de blocs (tableau, graphique, tableau croisé,
//                             chiffre clé, texte, saut de page), chacun construit avec les champs ou en SQL libre
//   #/indicateur            → l'éditeur d'indicateur (bloc « indicateur »)
// BiRTEC écrit le SQL lui-même ; « Remplir avec l'IA » pré-remplit un bloc à partir d'une phrase.
// Les morceaux de formulaire (choix d'un champ, d'une valeur, ligne de filtre…) sont partagés avec l'indicateur.

import { h, vider, ic, notifier, fenetre, confirmer } from '/socle/ui.js'
import { api, adresse } from '/socle/api.js'
import { etat as etatAppli } from '/socle/etat.js'
import { barres, barresHorizontales, anneau } from '/socle/graphiques.js'
import { demanderMotDePasse } from '../configuration/vue.js'
import { tableauResultats } from '../base/vue.js'

export const PERIODES = { mois_en_cours: 'Mois en cours', mois_precedent: 'Mois précédent', '30_jours': '30 derniers jours', annee_en_cours: 'Année en cours', '12_mois': '12 derniers mois', depassee: 'Dépassée (avant aujourd’hui)', a_venir: 'À venir (à partir d’aujourd’hui)', glissante: 'Les N derniers… (au choix)', demandee: 'Choisie au lancement du rapport' }
const UNITES = { jours: 'jours', semaines: 'semaines', mois: 'mois', ans: 'ans' }
const OPERATEURS = {
  texte: { egal: 'est', different: 'n’est pas', contient: 'contient', commence: 'commence par', vide: 'est vide', non_vide: 'n’est pas vide', demande: 'choisi au lancement (dans la liste)' },
  nombre: { egal: '=', '>=': '≥', '<=': '≤', compare: 'comparé à une autre colonne', vide: 'est vide', non_vide: 'n’est pas vide' },
  date8: { periode: 'période', '>=': 'à partir du', '<=': 'jusqu’au', entre: 'entre', compare: 'comparée à une autre date', vide: 'est vide' },
  date: { periode: 'période', '>=': 'à partir du', '<=': 'jusqu’au', entre: 'entre', compare: 'comparée à une autre date', vide: 'est vide' },
}
const THEMES = { charte: 'Charte du site', sobre: 'Sobre', bleu: 'Bleu', vert: 'Vert', orange: 'Orange', impression: 'Noir et blanc' }
const TYPES_BLOCS = {
  tableau: { libelle: 'Tableau', icone: 'tableau', aide: 'Une liste détaillée ou une synthèse (regroupements, totaux)' },
  graphique: { libelle: 'Graphique', icone: 'graphique', aide: 'Barres, courbe, aires ou camembert' },
  croise: { libelle: 'Tableau croisé', icone: 'tableur', aide: 'Une valeur au croisement d’une ligne et d’une colonne (ex. lignes × mois)' },
  chiffre: { libelle: 'Chiffre clé', icone: 'eclair', aide: 'Un seul chiffre, en grand' },
  texte: { libelle: 'Texte', icone: 'document', aide: 'Un paragraphe libre' },
  saut: { libelle: 'Saut de page', icone: 'retour', aide: 'La suite commence sur une nouvelle page' },
}
const FORMES = { barres: 'Barres', barres_horizontales: 'Barres couchées', courbe: 'Courbe', aires: 'Aires', camembert: 'Camembert' }
const FORMATS = { texte: 'Texte', entier: 'Entier', decimal: 'Décimal', pourcentage: 'Pourcentage', date: 'Date', dateheure: 'Date et heure' }
const TOTAUX = { '': 'Pas de total', somme: 'Somme', moyenne: 'Moyenne', nombre: 'Nombre', min: 'Minimum', max: 'Maximum' }
const CALCULS = { '-': 'A − B', '+': 'A + B', '*': 'A × B', '/': 'A ÷ B', pct: 'A en % de B', jours: 'Jours entre B et A', heures: 'Heures entre B et A' }
const REGLES = { '>': '>', '>=': '≥', '<': '<', '<=': '≤', '=': '=', '<>': '≠', vide: 'est vide', non_vide: 'n’est pas vide' }
const COULEURS = { rouge: 'Rouge', orange: 'Orange', vert: 'Vert', bleu: 'Bleu', gras: 'Gras' }
const FONCTIONS = { somme: 'Somme', moyenne: 'Moyenne', min: 'Minimum', max: 'Maximum' }

let brouillon = null // { rapport, nom, choisi } gardé quand on change d'écran

function etatVide(sujet = '') {
  return { sujet, mode: 'liste', champs: [], regroupements: [], mesures: [{ fonction: 'nombre', champ: null }], filtres: [], etat: 'sans_corbeille', totaux: true, tri: null, calculees: [] }
}

export function nouveauBloc(type, sujet = '') {
  switch (type) {
    case 'tableau':
      return { type, titre: '', source: 'champs', etat: etatVide(sujet), regles: {} }
    case 'graphique':
      return { type, titre: '', source: 'champs', forme: 'barres', empile: false, valeurs: true, etat: { ...etatVide(sujet), mode: 'synthese' } }
    case 'croise':
      return { type, titre: '', source: 'champs', totaux: true, etat: { ...etatVide(sujet), mode: 'synthese' } }
    case 'chiffre':
      return { type, titre: '', source: 'champs', libelle: '', etat: { ...etatVide(sujet), mode: 'synthese' } }
    case 'texte':
      return { type, titre: '', texte: '' }
    default:
      return { type: 'saut' }
  }
}

export function nouveauRapport(blocs = [nouveauBloc('tableau')]) {
  return { aspect: { titre: '', sousTitre: '', theme: 'charte', logo: true, image: '', description: '', positionDescription: 'entete', orientation: '' }, parametres: [], blocs }
}

export default {
  chemin: 'constructeur',
  titre: 'Nouveau',
  icone: 'plus',
  menu: 'admin',
  groupe: 'Créer',
  aide: 'constructeur',
  rafraichir: false,

  async afficher(zone, { id }) {
    // Un rapport à reprendre (Modifier, ou « en faire aussi un rapport » depuis un indicateur).
    const repris = sessionStorage.getItem('birtec-rapport')
    if (repris) {
      sessionStorage.removeItem('birtec-rapport')
      const r = JSON.parse(repris)
      brouillon = { rapport: { ...nouveauRapport([]), ...r.rapport }, nom: r.nom || null, choisi: 0 }
      if (id !== 'rapport') return void (location.hash = '#/constructeur/rapport')
    }
    const phrase = sessionStorage.getItem('birtec-phrase')
    if (phrase && id !== 'rapport') return void (location.hash = '#/constructeur/rapport')
    if (id === 'rapport') return editeurRapport(zone)
    return choix(zone)
  },
}

// ---------------------------------------------------------------- le choix du début

function choix(zone) {
  const carte = (href, icone, titre, texte, exemples) => h('a', { class: 'carte carte-choix', href },
    h('div', { class: 'icone-choix' }, ic(icone, 30)),
    h('h2', {}, titre),
    h('p', { class: 'texte-2' }, texte),
    h('p', { class: 'discret', style: { fontSize: '13px' } }, exemples))
  vider(zone,
    h('div', { class: 'entete-page' },
      h('div', {}, h('h1', {}, 'Nouveau'), h('p', { class: 'sous-titre' }, 'Que voulez-vous créer ?'))),
    h('div', { class: 'choix-creation' },
      carte('#/constructeur/rapport', 'document', 'Un rapport',
        'Une ou plusieurs pages : tableaux, graphiques, tableaux croisés, chiffres clés, textes. Construit avec les champs, ou en SQL libre. Exporté en PDF, Excel, Word…',
        'Ex. : les dépannages du mois par ligne, avec un graphique par semaine et le détail.'),
      carte('#/indicateur', 'graphique', 'Un indicateur ITM',
        'Un chiffre à suivre dans la GMAO : ce qu’on compte et les conditions. BiRTEC écrit la requête indicateur et la requête liste, et vérifie qu’elles concordent.',
        'Ex. : les demandes d’intervention en retard.')),
    brouillon ? h('p', { class: 'discret', style: { marginTop: '14px' } }, ic('crayon', 14), ' Un rapport est en cours : ', h('a', { href: '#/constructeur/rapport' }, 'le reprendre'), '.') : null)
}

// ---------------------------------------------------------------- l'éditeur de rapport

async function editeurRapport(zone) {
  brouillon ||= { rapport: nouveauRapport(), nom: null, choisi: 0 }
  const rapport = brouillon.rapport
  const [sujets, themes, fichiers] = await Promise.all([
    api('/api/constructeur/sujets'),
    api('/api/rapports-themes').catch(() => Object.keys(THEMES)),
    api('/api/connaissances/fichiers').catch(() => ({})),
  ])
  // Les champs de chaque sujet, chargés une fois.
  const catalogues = new Map()
  const catalogueDe = async (sujet) => {
    if (!sujet) return null
    if (!catalogues.has(sujet)) catalogues.set(sujet, await api(`/api/constructeur/champs/${encodeURIComponent(sujet)}`).catch(() => null))
    return catalogues.get(sujet)
  }
  // Dernier aperçu de chaque bloc (colonnes rendues par sa requête, paramètres qu'il crée).
  const apercus = new WeakMap()

  const listeBlocs = h('div', { class: 'carte' })
  const editeur = h('div', { class: 'grille' })
  const reglages = h('div', { class: 'grille' })
  const apercu = h('div', { class: 'carte apercu-constructeur' })
  let ongletApercu = 'bloc'
  let minuterie = null

  const blocChoisi = () => rapport.blocs[brouillon.choisi] || null
  const changer = ({ liste = true } = {}) => {
    if (liste) dessinerListe()
    dessinerEditeur()
    clearTimeout(minuterie)
    minuterie = setTimeout(rafraichirApercu, 500)
  }
  const choisir = (i) => {
    brouillon.choisi = i
    ongletApercu = 'bloc'
    changer()
  }

  // ---- phrase pour l'IA : remplit le bloc choisi (ou en ajoute un)
  const phrase = h('input', { type: 'text', placeholder: 'Ex. : les dépannages des 12 derniers mois par ligne, avec le nombre et le temps d’arrêt' })
  const boutonIA = h('button', { onclick: remplirAvecIA }, ic('etincelle', 16), 'Remplir avec l’IA')
  phrase.addEventListener('keydown', (e) => e.key === 'Enter' && remplirAvecIA())
  async function remplirAvecIA() {
    if (!phrase.value.trim()) return notifier('Décrivez ce que vous voulez en une phrase.', 'erreur')
    boutonIA.disabled = true
    vider(boutonIA, ic('etincelle', 16), 'L’IA remplit le bloc…')
    try {
      const r = await api('/api/constructeur/proposer', { methode: 'POST', corps: { phrase: phrase.value, sujet: null } })
      const etat = { ...etatVide(), ...r.etat }
      // « en graphique », « courbe », « camembert » : un graphique plutôt qu'un tableau.
      const mots = phrase.value.toLowerCase()
      const forme = /camembert|r[ée]partition/.test(mots) ? 'camembert' : /courbe|[ée]volution/.test(mots) ? 'courbe' : /graphique|histogramme|barres/.test(mots) ? 'barres' : null
      let bloc
      if (forme && etat.mode === 'synthese' && etat.regroupements.length) bloc = { ...nouveauBloc('graphique'), forme, etat: { ...etat, mode: 'synthese' } }
      else bloc = { ...nouveauBloc('tableau'), etat }
      bloc.aApprendre = r.aApprendre || []
      const actuel = blocChoisi()
      const vide = actuel && actuel.source !== 'sql' && actuel.etat && !actuel.etat.sujet
      if (vide) rapport.blocs[brouillon.choisi] = bloc
      else {
        rapport.blocs.push(bloc)
        brouillon.choisi = rapport.blocs.length - 1
      }
      if (r.titre && !rapport.aspect.titre) rapport.aspect.titre = r.titre
      await catalogueDe(etat.sujet)
      notifier('Bloc rempli : vérifiez et ajustez, l’aperçu se met à jour.')
      for (const a of r.avertissements || []) notifier(a, 'erreur')
      changer()
      dessinerReglages()
    } catch (erreur) {
      notifier(erreur.message, 'erreur')
    } finally {
      boutonIA.disabled = false
      vider(boutonIA, ic('etincelle', 16), 'Remplir avec l’IA')
    }
  }

  // ---- liste des blocs
  function dessinerListe() {
    const resume = (b) => {
      if (b.titre) return b.titre
      if (b.type === 'texte') return (b.texte || 'Texte vide').slice(0, 40)
      if (b.type === 'saut') return 'Nouvelle page'
      if (b.source === 'sql') return 'SQL libre'
      return sujets.find((s) => s.table === b.etat?.sujet)?.libelle || 'À choisir'
    }
    const deplacer = (i, j) => {
      ;[rapport.blocs[i], rapport.blocs[j]] = [rapport.blocs[j], rapport.blocs[i]]
      brouillon.choisi = j
      changer()
    }
    vider(listeBlocs,
      h('div', { class: 'carte-entete' }, h('h2', {}, ic('document', 18), 'Les blocs du rapport')),
      h('div', { class: 'liste-blocs' },
        rapport.blocs.map((b, i) => h('div', { class: `ligne-bloc${i === brouillon.choisi ? ' actif' : ''}`, onclick: () => choisir(i) },
          ic(TYPES_BLOCS[b.type].icone, 16),
          h('span', { class: 'type-bloc' }, TYPES_BLOCS[b.type].libelle),
          h('span', { class: 'resume-bloc' }, resume(b)),
          h('span', { class: 'actions-bloc' },
            i > 0 ? h('button', { class: 'discret petit', title: 'Monter', onclick: (e) => { e.stopPropagation(); deplacer(i, i - 1) } }, '↑') : null,
            i < rapport.blocs.length - 1 ? h('button', { class: 'discret petit', title: 'Descendre', onclick: (e) => { e.stopPropagation(); deplacer(i, i + 1) } }, '↓') : null,
            h('button', { class: 'discret petit', title: 'Dupliquer', onclick: (e) => { e.stopPropagation(); rapport.blocs.splice(i + 1, 0, structuredClone(b)); brouillon.choisi = i + 1; changer() } }, ic('copier', 13)),
            h('button', { class: 'discret petit', title: 'Retirer', onclick: (e) => { e.stopPropagation(); rapport.blocs.splice(i, 1); brouillon.choisi = Math.max(0, Math.min(brouillon.choisi, rapport.blocs.length - 1)); changer() } }, ic('x', 13)))))),
      rapport.blocs.length ? null : h('p', { class: 'discret' }, 'Aucun bloc : ajoutez-en un.'),
      h('div', { class: 'ajout-blocs' }, Object.entries(TYPES_BLOCS).map(([type, t]) => h('button', {
        class: 'petit', title: t.aide,
        onclick: () => {
          // Un nouveau bloc reprend le sujet et les filtres du bloc choisi : souvent le même périmètre, montré autrement.
          const modele = blocChoisi()
          const bloc = nouveauBloc(type, modele?.etat?.sujet || '')
          if (bloc.etat && modele?.etat) bloc.etat.filtres = structuredClone(modele.etat.filtres || [])
          rapport.blocs.splice(brouillon.choisi + 1, 0, bloc)
          brouillon.choisi = Math.min(brouillon.choisi + 1, rapport.blocs.length - 1)
          changer()
        },
      }, ic('plus', 13), t.libelle))))
  }

  // ---- édition du bloc choisi
  async function dessinerEditeur() {
    const b = blocChoisi()
    if (!b) return vider(editeur)
    const t = TYPES_BLOCS[b.type]
    const titreBloc = h('input', { type: 'text', value: b.titre || '', placeholder: 'Facultatif' })
    titreBloc.addEventListener('change', () => { b.titre = titreBloc.value; changer() })
    const contenu = [h('label', { class: 'champ' }, h('span', {}, 'Titre du bloc'), titreBloc)]

    if (b.type === 'texte') {
      const zoneTexte = h('textarea', { rows: 6, placeholder: 'Le texte, tel qu’il apparaîtra dans le rapport' }, b.texte || '')
      zoneTexte.addEventListener('change', () => { b.texte = zoneTexte.value; changer() })
      contenu.push(zoneTexte)
    } else if (b.type === 'saut') {
      contenu.length = 0
      contenu.push(h('p', { class: 'texte-2' }, 'Les blocs suivants commencent sur une nouvelle page.'))
    } else {
      // Avec les champs ou en SQL libre : on peut passer de l'un à l'autre (les champs → SQL garde la requête).
      contenu.push(h('div', { class: 'actions' },
        h('button', { class: b.source !== 'sql' ? 'principal' : '', onclick: () => { if (b.source === 'sql') versChamps(b) } }, ic('table', 15), 'Avec les champs'),
        h('button', { class: b.source === 'sql' ? 'principal' : '', title: 'Écrire ou retoucher la requête vous-même', onclick: () => { if (b.source !== 'sql') versSql(b) } }, ic('console', 15), 'SQL libre')))
      if (b.source === 'sql') contenu.push(...editeurSql(b))
      else contenu.push(...(await editeurChamps(b)))
      if (b.type === 'tableau') contenu.push(miseEnEvidence(b))
    }
    vider(editeur, section(ic(t.icone, 18), `${t.libelle}${b.titre ? ` — ${b.titre}` : ''}`, contenu))
  }

  // Les champs → SQL libre : la requête écrite par BiRTEC devient modifiable, ses « ? » redeviennent « :nom ».
  async function versSql(b) {
    const r = await api('/api/constructeur/bloc', { methode: 'POST', corps: { bloc: b, parametres: rapport.parametres } }).catch((e) => ({ erreurs: [e.message] }))
    if (r.erreurs?.length && !r.sql) return notifier(r.erreurs[0], 'erreur')
    for (const p of r.parametres || []) if (!rapport.parametres.some((q) => q.nom === p.nom)) rapport.parametres.push(p)
    b.sql = nommerMarques(r.sql, r.liaisons || [])
    b.source = 'sql'
    b.choix = choixDepuisChamps(b, r.colonnes || [])
    if (b.type === 'tableau') b.choix.colonnes = (r.colonnes || []).map((c) => ({ champ: c.champ, libelle: c.libelle, format: c.format, total: c.total || '' }))
    changer()
    dessinerReglages()
  }
  async function versChamps(b) {
    if (b.etat?.sujet) {
      if (!(await confirmer('Revenir aux champs ? La requête retouchée à la main sera remplacée par celle des champs.', { texte: 'Revenir aux champs' }))) return
    } else {
      b.etat ||= nouveauBloc(b.type).etat
    }
    b.source = 'champs'
    changer()
  }

  // ---- bloc construit avec les champs
  async function editeurChamps(b) {
    const e = b.etat
    const catalogue = await catalogueDe(e.sujet)
    const champs = new Map((catalogue?.champs || []).map((c) => [c.id, c]))
    const nomChamp = (id) => {
      const c = champs.get(id)
      return c ? (c.niveau ? `${c.libelle} · ${c.groupe.split(' › ').at(-1)}` : c.libelle) : '?'
    }
    const puce = (texte, retirer, extra = null) => h('span', { class: 'puce-champ' }, texte, extra, h('button', { class: 'discret', title: 'Retirer', onclick: retirer }, ic('x', 12)))
    const choixSujet = h('select', {
      onchange: async () => {
        Object.assign(e, { ...nouveauBloc(b.type, choixSujet.value).etat })
        b.regles = {}
        await catalogueDe(choixSujet.value)
        changer()
      },
    },
      h('option', { value: '' }, '— Choisir —'),
      h('optgroup', { label: 'Décrites dans le dictionnaire' }, sujets.filter((s) => s.decrite).map((s) => h('option', { value: s.table, selected: s.table === e.sujet }, s.libelle))),
      h('optgroup', { label: 'Autres tables' }, sujets.filter((s) => !s.decrite).map((s) => h('option', { value: s.table, selected: s.table === e.sujet }, s.libelle))))
    const parties = [h('label', { class: 'champ' }, h('span', {}, b.type === 'tableau' ? 'Une ligne = un(e)…' : 'On compte ou on totalise des…'), choixSujet)]
    if (!catalogue) return parties

    // Un emplacement de regroupement (axe, lignes, colonnes…) : un champ, avec mois / année pour une date.
    const emplacement = (i, libelle, facultatif = false) => {
      const g = e.regroupements[i]
      return h('div', { class: 'champ' }, h('span', {}, libelle),
        h('div', { class: 'puces' },
          g?.champ
            ? puce(nomChamp(g.champ), () => { e.regroupements[i] = null; nettoyer(); changer() }, granularite(g, champs.get(g.champ), changer))
            : h('button', { class: `petit${facultatif ? ' discret' : ''}`, onclick: async () => { const id = await choisirChamp(catalogue, libelle); if (id) { e.regroupements[i] = { champ: id, par: champs.get(id)?.nature.startsWith('date') ? 'mois' : 'valeur' }; changer() } } }, ic('plus', 14), facultatif ? 'Choisir (facultatif)' : 'Choisir')))
    }
    // Garde les emplacements à leur place (lignes / colonnes) sans laisser de trou à la fin.
    const nettoyer = () => { while (e.regroupements.length && !e.regroupements.at(-1)) e.regroupements.pop() }
    const libelleMesure = (m) => (m.fonction === 'nombre' ? `Nombre de ${catalogue.sujet.libelle.replace(/\s*\(.*\)\s*$/, '').toLowerCase()}` : `${{ somme: 'Total', moyenne: 'Moyenne', min: 'Minimum', max: 'Maximum' }[m.fonction]} : ${nomChamp(m.champ)}`)
    const mesures = (une = false) => h('div', { class: 'champ' }, h('span', {}, une ? 'La valeur' : 'Les valeurs'),
      h('div', { class: 'puces' },
        e.mesures.map((m, i) => puce(libelleMesure(m), () => { e.mesures.splice(i, 1); changer() })),
        !une || !e.mesures.length ? h('button', { class: 'petit discret', onclick: async () => { const m = await choisirMesure(catalogue); if (m) { if (une) e.mesures = [m]; else e.mesures.push(m); changer() } } }, ic('plus', 14), une ? 'Choisir' : 'Valeur') : null))

    if (b.type === 'tableau') {
      const mode = (valeur, texte, aide) => h('button', { class: e.mode === valeur ? 'principal' : '', title: aide, onclick: () => { e.mode = valeur; changer() } }, texte)
      parties.push(h('div', { class: 'actions' },
        mode('liste', 'Liste détaillée', 'Une ligne par élément, avec les colonnes choisies'),
        mode('synthese', 'Synthèse (compter, totaliser)', 'Une ligne par groupe : nombre, totaux')))
      if (e.mode === 'liste') {
        parties.push(
          h('div', { class: 'champ' }, h('span', {}, 'Colonnes, dans l’ordre'),
            h('div', { class: 'puces' },
              e.champs.map((id, i) => puce(nomChamp(id), () => { e.champs.splice(i, 1); changer() },
                i > 0 ? h('button', { class: 'discret', title: 'Avancer', onclick: () => { [e.champs[i - 1], e.champs[i]] = [e.champs[i], e.champs[i - 1]]; changer() } }, '‹') : null)),
              h('button', { class: 'petit', onclick: async () => { const id = await choisirChamp(catalogue, 'Ajouter une colonne'); if (id) { e.champs.push(id); changer() } } }, ic('plus', 14), 'Colonne'))),
          h('div', { class: 'champ' }, h('span', {}, 'Colonnes calculées'),
            h('div', { class: 'puces' },
              (e.calculees || []).map((k, i) => puce(k.libelle || CALCULS[k.op], () => { e.calculees.splice(i, 1); changer() })),
              h('button', { class: 'petit discret', title: 'Durée entre deux dates, écart, pourcentage…', onclick: async () => { const k = await choisirCalcul(catalogue); if (k) { (e.calculees ||= []).push(k); changer() } } }, ic('plus', 14), 'Calcul'))),
          h('div', { class: 'champ' }, h('span', {}, 'Regrouper par (avec sous-totaux)'),
            h('div', { class: 'puces' },
              e.regroupements.filter(Boolean).map((g, i) => puce(nomChamp(g.champ), () => { e.regroupements.splice(i, 1); changer() }, granularite(g, champs.get(g.champ), changer))),
              e.regroupements.length < 3 ? h('button', { class: 'petit discret', onclick: async () => { const id = await choisirChamp(catalogue, 'Regrouper par'); if (id) { e.regroupements.push({ champ: id, par: 'valeur' }); changer() } } }, ic('plus', 14), 'Groupe') : null)),
          e.regroupements.length ? caseACocher(Boolean(b.sautDePage), 'Une nouvelle page pour chaque groupe', (v) => { b.sautDePage = v; changer() }) : null,
          h('div', { class: 'champ' }, h('span', {}, 'Trier par'), triListe(e, nomChamp, changer)),
        )
      } else {
        parties.push(
          h('div', { class: 'champ' }, h('span', {}, 'Regrouper par'),
            h('div', { class: 'puces' },
              e.regroupements.filter(Boolean).map((g, i) => puce(nomChamp(g.champ), () => { e.regroupements.splice(i, 1); changer() }, granularite(g, champs.get(g.champ), changer))),
              e.regroupements.length < 3 ? h('button', { class: 'petit', onclick: async () => { const id = await choisirChamp(catalogue, 'Regrouper par'); if (id) { e.regroupements.push({ champ: id, par: champs.get(id)?.nature.startsWith('date') ? 'mois' : 'valeur' }); changer() } } }, ic('plus', 14), 'Regrouper par') : null)),
          mesures(),
          caseACocher(e.tri?.champ === '__mesure', 'Trier du plus grand au plus petit (classement)', (v) => { e.tri = v ? { champ: '__mesure', sens: 'desc' } : null; changer() }),
        )
      }
      parties.push(caseACocher(e.totaux !== false, 'Totaux en bas des colonnes de nombres', (v) => { e.totaux = v; changer() }))
    } else if (b.type === 'graphique') {
      parties.push(
        h('label', { class: 'champ' }, h('span', {}, 'Forme'), h('select', { onchange: (ev) => { b.forme = ev.target.value; changer() } }, Object.entries(FORMES).map(([v, t]) => h('option', { value: v, selected: b.forme === v }, t)))),
        emplacement(0, b.forme === 'camembert' ? 'Les parts (une par…)' : 'L’axe (une barre ou un point par…)'),
        b.forme === 'camembert' ? null : emplacement(1, 'Séparer par (une couleur par…)', true),
        mesures(b.forme === 'camembert'),
        b.forme === 'camembert' ? null : caseACocher(Boolean(b.empile), 'Empiler (barres ou aires les unes sur les autres)', (v) => { b.empile = v; changer() }),
        caseACocher(b.valeurs !== false, 'Écrire les valeurs sur le graphique', (v) => { b.valeurs = v; changer() }),
        caseACocher(e.tri?.champ === '__mesure', 'Du plus grand au plus petit', (v) => { e.tri = v ? { champ: '__mesure', sens: 'desc' } : null; changer() }),
      )
    } else if (b.type === 'croise') {
      parties.push(
        emplacement(0, 'En lignes (ex. ligne de production)'),
        emplacement(1, 'En colonnes (ex. mois)'),
        mesures(true),
        caseACocher(b.totaux !== false, 'Totaux de chaque ligne, de chaque colonne et total général', (v) => { b.totaux = v; changer() }),
      )
    } else if (b.type === 'chiffre') {
      const libelle = h('input', { type: 'text', value: b.libelle || '', placeholder: 'Ex. : dépannages ce mois-ci' })
      libelle.addEventListener('change', () => { b.libelle = libelle.value; changer() })
      parties.push(mesures(true), h('label', { class: 'champ' }, h('span', {}, 'Texte sous le chiffre'), libelle))
    }

    // Filtres
    const aActif = catalogue.champs.some((c) => c.chemin === '' && c.colonne.toUpperCase() === 'ACTIF')
    parties.push(h('div', { class: 'champ' }, h('span', {}, 'Quelles lignes ?'),
      listeFiltres(e.filtres, { catalogue, champs, nomChamp, sujet: e.sujet, changer }),
      (b.aApprendre || []).map((expression) => h('div', { class: 'bandeau', style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
        ic('alerte'), h('span', { style: { flex: 1 } }, `« ${expression} » : BiRTEC ne sait pas à quoi cela correspond dans la base.`),
        h('button', { class: 'petit', onclick: async () => { if (await apprendre(expression, catalogue, e)) { b.aApprendre = b.aApprendre.filter((x) => x !== expression); changer() } } }, ic('livre', 14), 'Lui apprendre'),
        h('button', { class: 'petit discret', onclick: () => { b.aApprendre = b.aApprendre.filter((x) => x !== expression); changer() } }, 'Ignorer'))),
      aActif ? h('div', { class: 'actions' }, choixFiches(e, changer)) : null))
    return parties
  }

  // ---- bloc en SQL libre
  function editeurSql(b) {
    const zone = h('textarea', { class: 'sql', rows: 10, spellcheck: false, placeholder: 'SELECT …\nFROM …\nWHERE date >= :debut AND date <= :fin' }, b.sql || '')
    zone.addEventListener('change', () => { b.sql = zone.value; changer({ liste: false }) })
    const colonnes = (apercus.get(b)?.colonnes || []).map((c) => c.champ)
    const choixColonne = (cle, libelle, facultatif = false) => h('label', { class: 'champ' }, h('span', {}, libelle),
      h('select', { onchange: (ev) => { b.choix[cle] = ev.target.value || null; changer({ liste: false }) } },
        h('option', { value: '' }, facultatif ? '— Aucune —' : '— Choisir —'),
        colonnes.map((c) => h('option', { value: c, selected: b.choix?.[cle] === c }, c))))
    b.choix ||= {}
    const parties = [
      h('p', { class: 'discret', style: { fontSize: '13px' } }, 'Une requête de lecture (SELECT). Les paramètres du rapport s’écrivent ', h('code', {}, ':nom'), ' (ex. ', h('code', {}, ':debut'), ') : voir « Paramètres ». BiRTEC vérifie les tables et les colonnes.'),
      zone,
      h('div', { class: 'actions' }, h('button', { class: 'petit', onclick: () => { b.sql = zone.value; changer({ liste: false }) } }, ic('lecture', 14), 'Exécuter')),
    ]
    if (!colonnes.length) {
      parties.push(h('p', { class: 'discret' }, 'Exécutez la requête pour choisir le rôle de ses colonnes.'))
      return parties
    }
    if (b.type === 'tableau') {
      // Chaque colonne de la requête : affichée ou non, son titre, son format, son total.
      const lignes = colonnes.map((nom) => {
        const actuelle = (b.choix.colonnes || []).find((c) => c.champ === nom)
        return { nom, actuelle }
      })
      const maj = (nom, changement) => {
        const liste = b.choix.colonnes ||= []
        const c = liste.find((x) => x.champ === nom)
        if (changement === null) b.choix.colonnes = liste.filter((x) => x.champ !== nom)
        else if (c) Object.assign(c, changement)
        else liste.push({ champ: nom, libelle: nom, format: apercus.get(b)?.colonnes.find((x) => x.champ === nom)?.format || 'texte', total: '', ...changement })
        changer({ liste: false })
      }
      parties.push(h('div', { class: 'champ' }, h('span', {}, 'Colonnes affichées'),
        h('table', { class: 'table-colonnes' },
          h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Colonne'), h('th', {}, 'Titre'), h('th', {}, 'Format'), h('th', {}, 'Total'))),
          h('tbody', {}, lignes.map(({ nom, actuelle }) => {
            const titre = h('input', { type: 'text', value: actuelle?.libelle || nom, disabled: !actuelle })
            titre.addEventListener('change', () => maj(nom, { libelle: titre.value }))
            return h('tr', {},
              h('td', {}, h('input', { type: 'checkbox', checked: Boolean(actuelle), onchange: (ev) => maj(nom, ev.target.checked ? {} : null) })),
              h('td', { class: 'mono' }, nom),
              h('td', {}, titre),
              h('td', {}, h('select', { disabled: !actuelle, onchange: (ev) => maj(nom, { format: ev.target.value }) }, Object.entries(FORMATS).map(([v, t]) => h('option', { value: v, selected: (actuelle?.format || 'texte') === v }, t)))),
              h('td', {}, h('select', { disabled: !actuelle, onchange: (ev) => maj(nom, { total: ev.target.value }) }, Object.entries(TOTAUX).map(([v, t]) => h('option', { value: v, selected: (actuelle?.total || '') === v }, t)))))
          })))),
        h('div', { class: 'grille grille-2' },
          [0, 1].map((i) => h('label', { class: 'champ' }, h('span', {}, i ? 'Puis par (facultatif)' : 'Regrouper par (facultatif)'),
            h('select', { onchange: (ev) => { const g = (b.choix.groupes ||= []); g[i] = ev.target.value || null; b.choix.groupes = g.filter(Boolean); changer({ liste: false }) } },
              h('option', { value: '' }, '— Aucun —'),
              colonnes.map((c) => h('option', { value: c, selected: b.choix.groupes?.[i] === c }, c)))))))
    } else if (b.type === 'graphique') {
      parties.push(
        h('label', { class: 'champ' }, h('span', {}, 'Forme'), h('select', { onchange: (ev) => { b.forme = ev.target.value; changer({ liste: false }) } }, Object.entries(FORMES).map(([v, t]) => h('option', { value: v, selected: b.forme === v }, t)))),
        choixColonne('categorie', b.forme === 'camembert' ? 'Les parts' : 'L’axe (catégories)'),
        b.forme === 'camembert' ? null : choixColonne('serie', 'Séparer par (une couleur par…)', true),
        h('div', { class: 'champ' }, h('span', {}, 'Les valeurs'),
          h('div', { class: 'puces' }, colonnes.map((c) => h('label', { class: 'valeur-filtre' },
            h('input', { type: 'checkbox', checked: (b.choix.series || []).includes(c), onchange: (ev) => { const s = new Set(b.choix.series || []); ev.target.checked ? s.add(c) : s.delete(c); b.choix.series = [...s]; changer({ liste: false }) } }), c)))),
        b.forme === 'camembert' ? null : caseACocher(Boolean(b.empile), 'Empiler', (v) => { b.empile = v; changer({ liste: false }) }),
        caseACocher(b.valeurs !== false, 'Écrire les valeurs sur le graphique', (v) => { b.valeurs = v; changer({ liste: false }) }),
      )
    } else if (b.type === 'croise') {
      parties.push(
        choixColonne('lignes', 'En lignes'),
        choixColonne('colonnes', 'En colonnes'),
        choixColonne('valeur', 'La valeur'),
        h('label', { class: 'champ' }, h('span', {}, 'Calcul des croisements et des totaux'),
          h('select', { onchange: (ev) => { b.choix.fonction = ev.target.value; changer({ liste: false }) } }, Object.entries(FONCTIONS).map(([v, t]) => h('option', { value: v, selected: (b.choix.fonction || 'somme') === v }, t)))),
        caseACocher(b.totaux !== false, 'Totaux', (v) => { b.totaux = v; changer({ liste: false }) }),
      )
    } else if (b.type === 'chiffre') {
      const libelle = h('input', { type: 'text', value: b.libelle || '' })
      libelle.addEventListener('change', () => { b.libelle = libelle.value; changer({ liste: false }) })
      parties.push(choixColonne('champ', 'La valeur (première ligne)'),
        h('label', { class: 'champ' }, h('span', {}, 'Format'), h('select', { onchange: (ev) => { b.choix.format = ev.target.value; changer({ liste: false }) } }, ['entier', 'decimal', 'pourcentage'].map((v) => h('option', { value: v, selected: (b.choix.format || 'entier') === v }, FORMATS[v])))),
        h('label', { class: 'champ' }, h('span', {}, 'Texte sous le chiffre'), libelle))
    }
    return parties
  }

  // ---- mises en évidence (tableau) : la cellule change de couleur selon sa valeur
  function miseEnEvidence(b) {
    const colonnes = (apercus.get(b)?.colonnes || []).filter((c) => b.source !== 'sql' || (b.choix?.colonnes || []).some((x) => x.champ === c.champ))
    b.regles ||= {}
    const lignes = Object.entries(b.regles).flatMap(([champ, regles]) => regles.map((r, i) => ({ champ, r, i })))
    return h('div', { class: 'champ' }, h('span', {}, 'Mises en évidence'),
      lignes.map(({ champ, r, i }) => h('div', { class: 'ligne-filtre' },
        h('span', { class: 'nom-filtre' }, colonnes.find((c) => c.champ === champ)?.libelle || champ),
        h('select', { onchange: (ev) => { r.operateur = ev.target.value; changer({ liste: false }) } }, Object.entries(REGLES).map(([v, t]) => h('option', { value: v, selected: r.operateur === v }, t))),
        ['vide', 'non_vide'].includes(r.operateur) ? null : (() => { const v = h('input', { type: 'text', value: r.valeur ?? '', style: { width: '110px' } }); v.addEventListener('change', () => { r.valeur = v.value; changer({ liste: false }) }); return v })(),
        h('select', { onchange: (ev) => { r.couleur = ev.target.value; changer({ liste: false }) } }, Object.entries(COULEURS).map(([v, t]) => h('option', { value: v, selected: r.couleur === v }, t))),
        h('button', { class: 'discret', title: 'Retirer', onclick: () => { b.regles[champ].splice(i, 1); if (!b.regles[champ].length) delete b.regles[champ]; changer({ liste: false }) } }, ic('x', 14)))),
      colonnes.length
        ? h('div', { class: 'actions' }, h('select', {
          onchange: (ev) => { if (!ev.target.value) return; (b.regles[ev.target.value] ||= []).push({ operateur: '>', valeur: '', couleur: 'rouge' }); changer({ liste: false }) },
        }, h('option', { value: '' }, '+ Mettre en évidence une colonne…'), colonnes.map((c) => h('option', { value: c.champ }, c.libelle))))
        : h('p', { class: 'discret', style: { fontSize: '13px' } }, 'Les colonnes apparaîtront ici après l’aperçu.'))
  }

  // ---- paramètres et présentation
  function dessinerReglages() {
    const a = rapport.aspect
    const champTexte = (cle, libelle, attributs = {}) => {
      const entree = h('input', { type: 'text', value: a[cle] || '', ...attributs })
      entree.addEventListener('change', () => { a[cle] = entree.value; dessinerListe() })
      return h('label', { class: 'champ' }, h('span', {}, libelle), entree)
    }
    const choixAspect = (cle, libelle, options) => h('label', { class: 'champ' }, h('span', {}, libelle),
      h('select', { onchange: (ev) => { a[cle] = ev.target.value } }, Object.entries(options).map(([v, t]) => h('option', { value: v, selected: (a[cle] || '') === v }, t))))

    const parametres = rapport.parametres
    const ligneParametre = (p, i) => {
      const entree = (cle, attributs = {}) => { const e = h('input', { type: 'text', value: p[cle] ?? '', ...attributs }); e.addEventListener('change', () => { p[cle] = e.value.trim(); changer({ liste: false }) }); return e }
      return h('div', { class: 'ligne-filtre' },
        h('code', {}, ':'), entree('nom', { style: { width: '110px' }, placeholder: 'nom', title: 'Le nom à écrire dans le SQL : :nom' }),
        entree('libelle', { style: { width: '140px' }, placeholder: 'Libellé affiché' }),
        h('select', { onchange: (ev) => { p.type = ev.target.value; changer({ liste: false }) } }, ['texte', 'entier', 'decimal', 'date'].map((v) => h('option', { value: v, selected: (p.type || 'texte') === v }, FORMATS[v]))),
        entree('defaut', { style: { width: '120px' }, placeholder: 'Valeur par défaut' }),
        p.liste ? h('span', { class: 'discret', title: p.liste.requete }, ' (liste)') : null,
        h('button', { class: 'discret', title: 'Retirer', onclick: () => { parametres.splice(i, 1); changer({ liste: false }); dessinerReglages() } }, ic('x', 14)))
    }
    vider(reglages,
      section(ic('reglages', 18), 'Paramètres demandés au lancement', [
        h('p', { class: 'discret', style: { fontSize: '13px' } }, 'Les filtres « période choisie au lancement » et « choisi au lancement (dans la liste) » ajoutent leurs paramètres tout seuls. Ceux d’ici servent au SQL libre (', h('code', {}, ':nom'), ').'),
        parametres.map(ligneParametre),
        h('div', { class: 'actions' }, h('button', { class: 'petit discret', onclick: () => { parametres.push({ nom: `p${parametres.length + 1}`, libelle: '', type: 'texte', defaut: '' }); dessinerReglages() } }, ic('plus', 14), 'Paramètre')),
      ]),
      section(ic('document', 18), 'Présentation', [
        h('div', { class: 'grille grille-2' },
          champTexte('titre', 'Titre du rapport', { placeholder: 'Ex. : Dépannages du mois' }),
          champTexte('sousTitre', 'Sous-titre'),
          choixAspect('theme', 'Thème', Object.fromEntries(themes.map((t) => [t, THEMES[t] || t]))),
          choixAspect('orientation', 'Orientation', { '': 'Automatique', portrait: 'Portrait', paysage: 'Paysage' }),
          choixAspect('image', 'Image centrée en haut', { '': 'Aucune', ...Object.fromEntries((fichiers.images?.fichiers || []).map((f) => [f.nom, f.nom])) }),
          choixAspect('positionDescription', 'Description', { entete: 'En en-tête', pied: 'En bas de page' }),
        ),
        champTexte('description', 'Texte de description (facultatif)'),
        caseACocher(a.logo !== false, 'Logo de la GMAO en haut de page', (v) => { a.logo = v }),
      ]))
  }

  // ---- aperçu : le bloc choisi (ses données), ou le rapport entier fabriqué par BIRT
  async function rafraichirApercu() {
    const onglets = h('div', { class: 'onglets' },
      h('a', { href: '#', class: ongletApercu === 'bloc' ? 'actif' : '', onclick: (ev) => { ev.preventDefault(); ongletApercu = 'bloc'; rafraichirApercu() } }, 'Ce bloc'),
      h('a', { href: '#', class: ongletApercu === 'rapport' ? 'actif' : '', onclick: (ev) => { ev.preventDefault(); ongletApercu = 'rapport'; rafraichirApercu() } }, 'Le rapport entier'))
    const entete = h('div', { class: 'carte-entete' },
      h('h2', {}, ic('oeil', 18), 'Aperçu'),
      h('div', { class: 'actions' },
        h('button', { class: 'principal', onclick: creer }, ic('document', 16), brouillon.nom ? 'Mettre à jour le rapport' : 'Créer le rapport')))
    if (ongletApercu === 'rapport') return apercuRapport(entete, onglets)

    const b = blocChoisi()
    if (!b) return vider(apercu, entete, onglets, h('p', { class: 'texte-2' }, 'Ajoutez un bloc à gauche.'))
    if (!['tableau', 'graphique', 'croise', 'chiffre'].includes(b.type)) return vider(apercu, entete, onglets, h('p', { class: 'texte-2' }, 'Ce bloc n’a pas de données : voyez « Le rapport entier ».'))
    if (b.source !== 'sql' && !b.etat?.sujet) return vider(apercu, entete, onglets, h('p', { class: 'texte-2' }, 'Choisissez de quoi parle le bloc, ou décrivez-le en une phrase et « Remplir avec l’IA ».'))
    vider(apercu, entete, onglets, h('p', { class: 'discret curseur' }, 'Aperçu'))
    const r = await api('/api/constructeur/bloc', { methode: 'POST', corps: { bloc: b, parametres: rapport.parametres } }).catch((erreur) => ({ erreurs: [erreur.message] }))
    const avant = apercus.get(b)?.colonnes?.map((c) => c.champ).join()
    apercus.set(b, r)
    // Les colonnes ont changé : l'éditeur (rôles des colonnes en SQL libre, mises en évidence) se redessine.
    if ((r.colonnes || []).map((c) => c.champ).join() !== avant) dessinerEditeur()
    if (blocChoisi() !== b || ongletApercu !== 'bloc') return
    const libelles = (r.colonnes || []).map((c) => c.libelle || c.champ)
    vider(apercu, entete, onglets,
      (r.erreurs || []).map((x) => h('div', { class: 'bandeau' }, ic('alerte'), x)),
      (r.avertissements || []).map((x) => h('p', { class: 'discret', style: { fontSize: '13px' } }, '• ', x)),
      r.resultat && b.type === 'graphique' ? dessinGraphique(b, r) : null,
      r.resultat && b.type === 'chiffre' ? h('div', { class: 'chiffre-apercu' }, h('strong', {}, String(r.resultat.lignes[0]?.[0] ?? '—')), h('span', {}, b.libelle || libelles[0] || '')) : null,
      r.total !== undefined && b.type !== 'chiffre' ? h('p', { class: r.total ? 'texte-2' : 'bandeau' }, r.total ? `${r.total} ligne(s)${r.total > 50 ? ' (50 premières affichées)' : ''}.` : 'Aucune ligne : le bloc serait vide. Élargissez les filtres.') : null,
      r.resultat ? tableauResultats({ ...r.resultat, colonnes: r.resultat.colonnes.map((c, i) => ({ ...c, nom: libelles[i] || c.nom })) }) : null,
      r.sql ? h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'discret' }, 'Requête SQL'), h('pre', { class: 'code', 'data-langue': 'sql' }, h('code', {}, r.sql))) : null,
    )
  }

  async function apercuRapport(entete, onglets) {
    const cadre = h('iframe', { class: 'apercu-rapport', title: 'Aperçu du rapport' })
    const messages = h('div', {}, h('p', { class: 'discret curseur' }, 'Le moteur BIRT fabrique le rapport'))
    vider(apercu, entete, onglets, messages, cadre)
    if (!etatAppli.connexion.ouverte) await demanderMotDePasse().catch(() => {})
    const r = await api('/api/constructeur/rapport/apercu', { methode: 'POST', corps: { rapport } }).catch((erreur) => ({ erreurs: [erreur.message] }))
    vider(messages,
      (r.erreurs || []).map((x) => h('div', { class: 'bandeau' }, ic('alerte'), x)),
      (r.avertissements || []).map((x) => h('p', { class: 'discret', style: { fontSize: '13px' } }, '• ', x)),
      (r.parametres || []).length ? h('p', { class: 'discret', style: { fontSize: '13px' } }, `Avec les valeurs par défaut des paramètres : ${r.parametres.map((p) => `${p.libelle || p.nom} = ${p.defaut || '(tous)'}`).join(', ')}.`) : null)
    if (r.adresse) cadre.src = adresse(r.adresse)
    else cadre.remove()
  }

  // ---- création, puis proposition d'en faire aussi un indicateur
  async function creer() {
    if (!etatAppli.connexion.ouverte) await demanderMotDePasse().catch(() => {})
    notifier('Fabrication du rapport…')
    try {
      const r = await api('/api/constructeur/rapport/creer', { methode: 'POST', corps: { rapport, nom: brouillon.nom } })
      if (!r.ok) return notifier(`Le rapport n’a pas pu être fabriqué : ${r.erreurs.join(' ; ')}`, 'erreur')
      for (const a of r.avertissements || []) notifier(a, 'erreur')
      notifier(brouillon.nom ? 'Rapport mis à jour' : 'Rapport créé')
      const source = rapport.blocs.find((b) => b.source !== 'sql' && b.etat?.sujet)
      const titre = rapport.aspect.titre
      brouillon = null
      if (source && await confirmer('Le rapport est prêt. En faire aussi un indicateur ITM (le même sujet et les mêmes filtres, comptés dans la GMAO) ?', { texte: 'Créer l’indicateur' })) {
        sessionStorage.setItem('birtec-indicateur', JSON.stringify({ etat: { sujet: source.etat.sujet, filtres: sansLancement(source.etat.filtres), etat: source.etat.etat }, nom: titre }))
        location.hash = '#/indicateur'
        return
      }
      location.hash = `#/rapports/${encodeURIComponent(r.nom)}`
    } catch (erreur) {
      notifier(erreur.message, 'erreur')
    }
  }

  vider(
    zone,
    h('div', { class: 'entete-page' },
      h('div', {}, h('h1', {}, brouillon.nom ? 'Modifier le rapport' : 'Nouveau rapport'), h('p', { class: 'sous-titre' }, 'Des blocs les uns sous les autres : tableaux, graphiques, tableaux croisés, chiffres, textes.')),
      h('div', { class: 'actions' },
        h('a', { class: 'bouton discret', href: '#/constructeur' }, ic('retour', 16), 'Rapport ou indicateur'),
        h('button', { class: 'discret', onclick: async () => { if (await confirmer('Tout recommencer ? Le rapport en cours sera effacé.', { texte: 'Recommencer', danger: true })) { brouillon = null; window.ktec.recharger() } } }, ic('rafraichir', 16), 'Recommencer'))),
    h('div', { class: 'carte phrase-ia' }, ic('etincelle', 18), phrase, boutonIA),
    h('div', { class: 'constructeur-grille' }, h('div', { class: 'grille' }, listeBlocs, editeur, reglages), apercu),
  )
  for (const b of rapport.blocs) if (b.etat?.sujet) await catalogueDe(b.etat.sujet)
  dessinerListe()
  dessinerEditeur()
  dessinerReglages()
  rafraichirApercu()
  // Description en texte libre depuis l'écran Rapports : on la donne à « Remplir avec l'IA ».
  const transmise = sessionStorage.getItem('birtec-phrase')
  if (transmise) {
    sessionStorage.removeItem('birtec-phrase')
    phrase.value = transmise
    remplirAvecIA()
  }
}

// Un aperçu rapide du graphique dans la page (le vrai est fabriqué par BIRT : « Le rapport entier »).
function dessinGraphique(b, r) {
  const { colonnes, lignes } = r.resultat
  if (!lignes.length) return null
  const nbDims = b.source === 'sql' ? null : (b.etat.regroupements || []).filter((g) => g?.champ).length
  const iCat = b.source === 'sql' ? colonnes.findIndex((c) => c.nom === b.choix?.categorie) : 0
  const iSerie = b.source === 'sql' ? colonnes.findIndex((c) => c.nom === b.choix?.serie) : nbDims > 1 ? 1 : -1
  const iValeurs = b.source === 'sql' ? (b.choix?.series || []).map((s) => colonnes.findIndex((c) => c.nom === s)).filter((i) => i >= 0) : colonnes.map((_, i) => i).slice(nbDims)
  if (iCat < 0 || !iValeurs.length) return null
  const teintes = ['#3b82f6', '#2dd4bf', '#f59e0b', '#f05252', '#8b5cf6', '#22c55e', '#ec4899', '#64748b']
  if (b.forme === 'camembert') {
    const parts = lignes.slice(0, 8).map((l, i) => ({ nom: String(l[iCat]), valeur: Number(l[iValeurs[0]]) || 0, couleur: teintes[i % teintes.length] }))
    return h('div', { class: 'dessin-graphique dessin-camembert' }, anneau(parts),
      h('div', { class: 'legende-camembert' }, parts.map((p) => h('div', {}, h('span', { class: 'pastille', style: { background: p.couleur } }), `${p.nom} : ${p.valeur}`))))
  }
  if (b.forme === 'barres_horizontales' && iSerie < 0) {
    return h('div', { class: 'dessin-graphique' }, barresHorizontales(lignes.slice(0, 15).map((l) => ({ etiquette: String(l[iCat]), valeur: Number(l[iValeurs[0]]) || 0 }))))
  }
  const categories = [...new Set(lignes.map((l) => String(l[iCat])))]
  const series = iSerie >= 0
    ? [...new Set(lignes.map((l) => String(l[iSerie])))].slice(0, 8).map((s, i) => ({ cle: s, nom: s, couleur: teintes[i % teintes.length] }))
    : iValeurs.map((iv, i) => ({ cle: String(iv), nom: colonnes[iv].nom, couleur: teintes[i % teintes.length] }))
  const donnees = categories.slice(0, 24).map((cat) => {
    const valeurs = {}
    for (const l of lignes.filter((x) => String(x[iCat]) === cat)) {
      if (iSerie >= 0) valeurs[String(l[iSerie])] = (valeurs[String(l[iSerie])] || 0) + (Number(l[iValeurs[0]]) || 0)
      else for (const iv of iValeurs) valeurs[String(iv)] = Number(l[iv]) || 0
    }
    return { etiquette: cat, valeurs }
  })
  return h('div', { class: 'dessin-graphique' }, barres(donnees, series, { hauteur: 220 }),
    h('p', { class: 'discret', style: { fontSize: '12px' } }, 'Aperçu simplifié : la forme exacte est dans « Le rapport entier ».'))
}

// La requête des champs devenue SQL libre : chaque « ? » (hors chaînes) redevient « :nom ».
function nommerMarques(sql, liaisons) {
  let i = 0
  return String(sql || '').split(/('(?:[^'\\]|\\.|'')*')/).map((m, n) => (n % 2 ? m : m.replace(/\?/g, () => `:${liaisons[i++] || 'parametre'}`))).join('')
}

// Rôle des colonnes repris du bloc « champs » quand il passe en SQL libre.
function choixDepuisChamps(b, colonnes) {
  const dims = (b.etat?.regroupements || []).filter((g) => g?.champ).length
  const col = (i) => colonnes[i]?.champ || null
  if (b.type === 'graphique') return { categorie: col(0), serie: dims > 1 ? col(1) : null, series: colonnes.slice(dims).map((c) => c.champ) }
  if (b.type === 'croise') return { lignes: col(0), colonnes: col(1), valeur: col(2), fonction: 'somme' }
  if (b.type === 'chiffre') return { champ: col(0), format: colonnes[0]?.format === 'decimal' ? 'decimal' : 'entier' }
  return { colonnes: [], groupes: [] }
}

// ---------------------------------------------------------------- morceaux de formulaire (partagés)

export function section(icone, titre, contenu) {
  return h('div', { class: 'carte section-constructeur' }, h('h2', {}, icone, titre), h('div', { class: 'grille' }, contenu))
}

export function caseACocher(coche, texte, quand) {
  return h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: coche, onchange: (ev) => quand(ev.target.checked) }), texte)
}

// Une requête dans sa propre case, avec son bouton « Copier » (à coller tel quel dans la GMAO).
export function caseRequete(titre, sql) {
  return h('div', { class: 'case-requete' },
    h('div', { class: 'carte-entete' },
      h('h3', {}, titre),
      h('button', { class: 'petit discret', onclick: () => navigator.clipboard.writeText(sql).then(() => notifier(`${titre} copiée`)) }, ic('copier', 14), 'Copier')),
    h('pre', { class: 'code' }, h('code', {}, sql)))
}

// Les conditions, liées par ET / OU, avec des groupes entre parenthèses (en cascade, sur 3 niveaux).
// Chaque élément après le premier porte son lien avec le précédent : { lien: 'et' | 'ou' }.
// Un groupe : { groupe: [ … ], lien }. Comme à la lecture, ET passe avant OU ; un groupe change cet ordre.
export function listeFiltres(filtres, ctx, profondeur = 0) {
  const { catalogue, champs, nomChamp, sujet, changer, sansLancement = false } = ctx
  const lien = (f) => h('select', { class: `lien-filtre${f.lien === 'ou' ? ' ou' : ''}`, title: 'Lien avec la condition précédente', onchange: (ev) => { f.lien = ev.target.value; changer() } },
    h('option', { value: 'et', selected: f.lien !== 'ou' }, 'ET'),
    h('option', { value: 'ou', selected: f.lien === 'ou' }, 'OU'))
  const ajouterCondition = async (liste) => {
    const id = await choisirChamp(catalogue, 'Condition sur')
    if (!id) return
    liste.push({ ...nouveauFiltre(champs.get(id)), lien: 'et' })
    changer()
  }
  return h('div', { class: `liste-filtres${profondeur ? ' groupe-filtres' : ''}` },
    filtres.map((f, i) => h('div', { class: 'element-filtre' },
      i > 0 ? lien(f) : null,
      Array.isArray(f.groupe)
        ? h('div', { class: 'cadre-groupe' },
          h('div', { class: 'entete-groupe' }, h('span', { class: 'discret' }, '( groupe'), h('button', { class: 'discret petit', title: 'Retirer le groupe', onclick: () => { filtres.splice(i, 1); changer() } }, ic('x', 13))),
          listeFiltres(f.groupe, ctx, profondeur + 1),
          h('span', { class: 'discret' }, ')'))
        : ligneFiltre(f, champs.get(f.champ), nomChamp(f.champ), sujet, () => { filtres.splice(i, 1); changer() }, changer, catalogue, nomChamp, { sansLancement }))),
    h('div', { class: 'actions' },
      h('button', { class: 'petit', onclick: () => ajouterCondition(filtres) }, ic('plus', 14), 'Condition'),
      profondeur < 3 ? h('button', { class: 'petit discret', title: 'Des conditions entre parenthèses, ex. : (type = dépannage OU type = amélioration) ET ligne = 3', onclick: async () => {
        const groupe = []
        const id = await choisirChamp(catalogue, 'Première condition du groupe')
        if (!id) return
        groupe.push(nouveauFiltre(champs.get(id)))
        filtres.push({ groupe, lien: 'et' })
        changer()
      } }, ic('plus', 14), 'Groupe ( … )') : null))
}

// Les conditions sans les choix « au lancement » (un indicateur n'a pas de paramètre), à tous les niveaux.
export function sansLancement(filtres = []) {
  return filtres
    .filter((f) => Array.isArray(f.groupe) || (f.operateur !== 'demande' && f.valeurs?.[0] !== 'demandee'))
    .map((f) => (Array.isArray(f.groupe) ? { ...f, groupe: sansLancement(f.groupe) } : f))
    .filter((f) => !Array.isArray(f.groupe) || f.groupe.length)
}

export function nouveauFiltre(c) {
  const date = c.nature.startsWith('date')
  return { champ: c.id, operateur: date ? 'periode' : 'egal', valeurs: date ? ['mois_en_cours'] : [] }
}

// Les fiches prises en compte (si le sujet a une colonne ACTIF).
export function choixFiches(e, changer) {
  return h('select', { title: 'Fiches prises en compte', onchange: (ev) => { e.etat = ev.target.value; changer() } },
    [['sans_corbeille', 'Toutes sauf la corbeille'], ['courantes', 'Courantes seulement'], ['toutes', 'Toutes, corbeille comprise']].map(([v, t]) => h('option', { value: v, selected: e.etat === v }, t)))
}

// « Lui apprendre » : l'expression (« niveau 1 ») devient un filtre choisi ici, retenu dans le .ktec
// pour ce sujet ; la prochaine phrase qui la contient aura ce filtre directement.
export async function apprendre(expression, catalogue, e) {
  const id = await choisirChamp(catalogue, `« ${expression} » correspond à quelle colonne ?`, (c) => c.nature === 'texte')
  if (!id) return false
  const c = catalogue.champs.find((x) => x.id === id)
  const valeurs = await choisirValeurs(e.sujet, c, [])
  if (!valeurs?.length) return false
  await api('/api/constructeur/vocabulaire', { methode: 'POST', corps: { expression, sujet: e.sujet, champ: id, valeurs } })
  e.filtres.push({ champ: id, operateur: 'egal', valeurs })
  notifier(`Retenu : « ${expression} » donnera désormais ce filtre (gardé dans le fichier .ktec).`)
  return true
}

function granularite(g, c, changer) {
  if (!c || !c.nature.startsWith('date')) return null
  return h('select', { class: 'mini', onchange: (ev) => { g.par = ev.target.value; changer() } },
    [['valeur', 'jour'], ['mois', 'par mois'], ['annee', 'par année']].map(([v, t]) => h('option', { value: v, selected: (g.par || 'valeur') === v }, t)))
}

function triListe(e, nomChamp, changer) {
  const candidats = [...new Set([...(e.champs || [])])]
  return h('div', { style: { display: 'flex', gap: '6px' } },
    h('select', { onchange: (ev) => { e.tri = ev.target.value ? { champ: ev.target.value, sens: e.tri?.sens || 'asc' } : null; changer() } },
      h('option', { value: '' }, '— Aucun tri —'),
      candidats.map((id) => h('option', { value: id, selected: e.tri?.champ === id }, nomChamp(id)))),
    e.tri ? h('select', { onchange: (ev) => { e.tri.sens = ev.target.value; changer() } },
      h('option', { value: 'asc', selected: e.tri.sens !== 'desc' }, 'croissant'),
      h('option', { value: 'desc', selected: e.tri.sens === 'desc' }, 'décroissant')) : null)
}

// Une ligne de filtre. sansLancement : pas de choix « au lancement » (un indicateur n'a pas de paramètre).
export function ligneFiltre(f, c, nom, sujet, retirer, changer, catalogue, nomChamp, { sansLancement = false } = {}) {
  if (!c) return null
  const operateurs = { ...(OPERATEURS[c.nature] || OPERATEURS.texte) }
  if (sansLancement) delete operateurs.demande
  const operateur = h('select', { onchange: (ev) => { f.operateur = ev.target.value; f.valeurs = f.operateur === 'periode' ? ['mois_en_cours'] : f.operateur === 'compare' ? ['<', ''] : []; changer() } },
    Object.entries(operateurs).map(([v, t]) => h('option', { value: v, selected: f.operateur === v }, t)))
  let valeur = null
  if (f.operateur === 'compare') {
    // Comparaison avec une autre colonne de même nature (nombre avec nombre, date avec date).
    const memeNature = (x) => (c.nature === 'nombre' ? x.nature === 'nombre' : x.nature === 'date' || x.nature === 'date8') && x.id !== c.id
    valeur = h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
      h('select', { onchange: (ev) => { f.valeurs[0] = ev.target.value; changer() } },
        [['<', '<'], ['<=', '≤'], ['>', '>'], ['>=', '≥'], ['=', '='], ['<>', '≠']].map(([v, t]) => h('option', { value: v, selected: (f.valeurs[0] || '<') === v }, t))),
      h('button', { class: 'petit', onclick: async () => { const id = await choisirChamp(catalogue, 'Comparer à', memeNature); if (id) { f.valeurs[1] = id; changer() } } },
        f.valeurs[1] ? nomChamp(f.valeurs[1]) : 'Choisir la colonne…'))
  } else if (f.operateur === 'periode') {
    // Période glissante « mois:4 » : le nombre et l'unité se règlent à côté.
    const glissante = /^(jours|semaines|mois|ans):(\d+)$/.exec(f.valeurs[0] || '')
    const periodes = { ...PERIODES }
    if (sansLancement) delete periodes.demandee
    const choixPeriode = h('select', { onchange: (ev) => { f.valeurs = [ev.target.value === 'glissante' ? 'mois:3' : ev.target.value]; changer() } },
      Object.entries(periodes).map(([v, t]) => h('option', { value: v, selected: glissante ? v === 'glissante' : f.valeurs[0] === v }, t)))
    if (glissante) {
      const nombre = h('input', { type: 'number', min: 1, max: 999, value: glissante[2], style: { width: '80px' } })
      const unite = h('select', {}, Object.entries(UNITES).map(([v, t]) => h('option', { value: v, selected: glissante[1] === v }, t)))
      const maj = () => { f.valeurs = [`${unite.value}:${Math.max(1, Number(nombre.value) || 1)}`]; changer() }
      nombre.addEventListener('change', maj)
      unite.addEventListener('change', maj)
      valeur = h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, choixPeriode, nombre, unite)
    } else valeur = choixPeriode
  } else if (['vide', 'non_vide', 'demande'].includes(f.operateur)) {
    valeur = f.operateur === 'demande' ? h('span', { class: 'discret', style: { fontSize: '13px' } }, 'vide = toutes les valeurs') : null
  } else if (f.operateur === 'entre') {
    const de = h('input', { type: 'date', value: f.valeurs[0] || '' })
    const a = h('input', { type: 'date', value: f.valeurs[1] || '' })
    const maj = () => { f.valeurs = [de.value, a.value]; changer() }
    de.addEventListener('change', maj)
    a.addEventListener('change', maj)
    valeur = h('span', { style: { display: 'flex', gap: '6px' } }, de, a)
  } else if (c.nature.startsWith('date')) {
    valeur = h('input', { type: 'date', value: f.valeurs[0] || '', onchange: (ev) => { f.valeurs = [ev.target.value]; changer() } })
  } else if (['egal', 'different'].includes(f.operateur) && c.nature === 'texte') {
    // Les valeurs existantes, à cocher (chargées à la demande).
    valeur = h('button', { class: 'petit', onclick: async () => { const v = await choisirValeurs(sujet, c, f.valeurs); if (v) { f.valeurs = v; changer() } } },
      f.valeurs.length ? `${f.valeurs.slice(0, 3).join(', ')}${f.valeurs.length > 3 ? ` (+${f.valeurs.length - 3})` : ''}` : 'Choisir les valeurs…')
  } else {
    valeur = h('input', { type: c.nature === 'nombre' ? 'number' : 'text', value: f.valeurs[0] || '', onchange: (ev) => { f.valeurs = [ev.target.value]; changer() } })
  }
  return h('div', { class: 'ligne-filtre' }, h('span', { class: 'nom-filtre' }, nom), operateur, valeur, h('button', { class: 'discret', title: 'Retirer le filtre', onclick: retirer }, ic('x', 14)))
}

// Choisir un champ dans le catalogue : recherche, champs groupés par table.
export function choisirChamp(catalogue, titre, filtre = () => true) {
  const recherche = h('input', { type: 'search', placeholder: 'Chercher (ex. date, équipement, temps)…' })
  const liste = h('div', { class: 'liste-champs' })
  let resoudre
  const promesse = new Promise((r) => (resoudre = r))
  const dessiner = () => {
    const texte = recherche.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    const champs = catalogue.champs.filter(filtre).filter((c) => !texte || `${c.libelle} ${c.groupe} ${c.colonne}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(texte))
    const groupes = [...new Set(champs.map((c) => c.groupe))]
    vider(liste, groupes.slice(0, 60).map((g, i) => h('details', { open: i < 4 || Boolean(texte) },
      h('summary', {}, g, h('span', { class: 'discret' }, ` (${champs.filter((c) => c.groupe === g).length})`)),
      champs.filter((c) => c.groupe === g).map((c) => h('a', { href: '#', class: c.decrit ? 'decrit' : '', onclick: (e) => { e.preventDefault(); resoudre(c.id); document.querySelector('.voile .fenetre-entete button')?.click() } },
        c.libelle, h('span', { class: 'discret mono' }, ` ${c.colonne}`), c.multiplie ? h('span', { class: 'discret', title: 'Table fille : peut multiplier les lignes' }, ' ⋯') : null)))))
  }
  recherche.addEventListener('input', dessiner)
  dessiner()
  fenetre({ titre, large: true, contenu: h('div', {}, recherche, liste), boutons: [{ texte: 'Annuler', classe: 'discret', valeur: null }] }).then(() => resoudre(null))
  return promesse
}

export async function choisirMesure(catalogue) {
  const fonction = h('select', {}, [['nombre', 'Nombre (compter)'], ['somme', 'Total de…'], ['moyenne', 'Moyenne de…'], ['max', 'Maximum de…'], ['min', 'Minimum de…']].map(([v, t]) => h('option', { value: v }, t)))
  const choix = await fenetre({ titre: 'Valeur calculée', contenu: h('label', { class: 'champ' }, h('span', {}, 'Calcul'), fonction), boutons: [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Suivant', classe: 'principal', action: () => fonction.value }] })
  if (!choix) return null
  if (choix === 'nombre') return { fonction: 'nombre', champ: null }
  const id = await choisirChamp(catalogue, 'Sur quel nombre ?', (c) => c.nature === 'nombre')
  return id ? { fonction: choix, champ: id } : null
}

// Une colonne calculée : A (opération) B, où B est un champ ou un nombre.
async function choisirCalcul(catalogue) {
  const operation = h('select', {}, Object.entries(CALCULS).map(([v, t]) => h('option', { value: v }, t)))
  const libelle = h('input', { type: 'text', placeholder: 'Ex. : Durée (h)' })
  const etape1 = await fenetre({
    titre: 'Colonne calculée',
    contenu: h('div', { class: 'grille' },
      h('label', { class: 'champ' }, h('span', {}, 'Calcul'), operation),
      h('label', { class: 'champ' }, h('span', {}, 'Titre de la colonne'), libelle),
      h('p', { class: 'discret', style: { fontSize: '13px' } }, 'Ensuite : choisissez A, puis B (un autre champ, ou un nombre pour + − × ÷).')),
    boutons: [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Choisir A', classe: 'principal', action: () => operation.value }],
  })
  if (!etape1) return null
  const dates = ['jours', 'heures'].includes(etape1)
  const nature = (c) => (dates ? c.nature === 'date' || c.nature === 'date8' : c.nature === 'nombre')
  const a = await choisirChamp(catalogue, dates ? 'A : la date de fin' : 'A : le premier nombre', nature)
  if (!a) return null
  let b = null
  let valeur = null
  if (!dates && ['+', '-', '*', '/'].includes(etape1)) {
    const nombre = h('input', { type: 'number', step: 'any', placeholder: 'ou un nombre' })
    const choix = await fenetre({
      titre: 'B : un autre champ, ou un nombre',
      contenu: h('label', { class: 'champ' }, h('span', {}, 'Nombre (laisser vide pour choisir un champ)'), nombre),
      boutons: [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Suivant', classe: 'principal', action: () => ({ nombre: nombre.value }) }],
    })
    if (!choix) return null
    if (choix.nombre !== '') valeur = Number(choix.nombre)
  }
  if (valeur === null) {
    b = await choisirChamp(catalogue, dates ? 'B : la date de début' : 'B : le second nombre', nature)
    if (!b) return null
  }
  return { libelle: libelle.value.trim(), a, op: etape1, b, valeur }
}

export async function choisirValeurs(sujet, c, actuelles) {
  const zone = h('div', {}, h('p', { class: 'discret curseur' }, 'Lecture des valeurs'))
  const coches = new Set(actuelles)
  const promesse = fenetre({
    titre: `${c.libelle} : valeurs`,
    large: true,
    contenu: zone,
    boutons: [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Valider', classe: 'principal', action: () => [...coches] }],
  })
  try {
    const valeurs = await api('/api/constructeur/valeurs', { methode: 'POST', corps: { sujet, champ: c.id } })
    const recherche = h('input', { type: 'search', placeholder: 'Filtrer…' })
    const liste = h('div', { class: 'liste-champs' })
    const dessiner = () => vider(liste, valeurs.filter((v) => String(v.valeur).toLowerCase().includes(recherche.value.toLowerCase())).slice(0, 300).map((v) => {
      const coche = h('input', { type: 'checkbox', checked: coches.has(String(v.valeur)), onchange: () => (coche.checked ? coches.add(String(v.valeur)) : coches.delete(String(v.valeur))) })
      return h('label', { class: 'valeur-filtre' }, coche, String(v.valeur), h('span', { class: 'discret' }, ` (${v.nombre})`))
    }))
    recherche.addEventListener('input', dessiner)
    dessiner()
    vider(zone, recherche, liste)
  } catch (erreur) {
    vider(zone, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
  }
  return promesse
}
