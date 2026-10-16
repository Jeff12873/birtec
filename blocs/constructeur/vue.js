// Nouveau rapport : un formulaire simple, avec l'aperçu en direct.
//   1. Sujet  2. Colonnes (liste détaillée) ou regroupements et totaux (synthèse)  3. Filtres  4. Présentation
// BiRTEC écrit le SQL lui-même ; « Remplir avec l'IA » pré-remplit le formulaire à partir d'une phrase.

import { h, vider, ic, notifier, fenetre } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat as etatAppli } from '/socle/etat.js'
import { demanderMotDePasse } from '/blocs/configuration/vue.js'
import { tableauResultats } from '/blocs/base/vue.js'

const PERIODES = { mois_en_cours: 'Mois en cours', mois_precedent: 'Mois précédent', '30_jours': '30 derniers jours', annee_en_cours: 'Année en cours', '12_mois': '12 derniers mois', depassee: 'Dépassée (avant aujourd’hui)', a_venir: 'À venir (à partir d’aujourd’hui)', demandee: 'Choisie au lancement du rapport' }
const OPERATEURS = {
  texte: { egal: 'est', different: 'n’est pas', contient: 'contient', commence: 'commence par', vide: 'est vide', non_vide: 'n’est pas vide' },
  nombre: { egal: '=', '>=': '≥', '<=': '≤', vide: 'est vide', non_vide: 'n’est pas vide' },
  date8: { periode: 'période', '>=': 'à partir du', '<=': 'jusqu’au', entre: 'entre', vide: 'est vide' },
  date: { periode: 'période', '>=': 'à partir du', '<=': 'jusqu’au', entre: 'entre', vide: 'est vide' },
}
const THEMES = { charte: 'Charte du site', sobre: 'Sobre', bleu: 'Bleu', vert: 'Vert', orange: 'Orange', impression: 'Noir et blanc' }

let brouillon = null // { etat, aspect, nom } gardé quand on change d'écran

function nouveau(sujet = '') {
  return { etat: { sujet, mode: 'liste', champs: [], regroupements: [], mesures: [{ fonction: 'nombre', champ: null }], filtres: [], etat: 'sans_corbeille', totaux: true, tri: null }, aspect: { titre: '', sousTitre: '', theme: 'charte', logo: true, image: '', description: '', positionDescription: 'entete', orientation: '' }, nom: null }
}

export default {
  chemin: 'constructeur',
  titre: 'Nouveau rapport',
  icone: 'plus',
  menu: true,
  aide: 'constructeur',
  rafraichir: false,

  async afficher(zone) {
    const repris = sessionStorage.getItem('birtec-constructeur')
    if (repris) {
      sessionStorage.removeItem('birtec-constructeur')
      brouillon = { ...nouveau(), ...JSON.parse(repris) }
    }
    brouillon ||= nouveau()
    const sujets = await api('/api/constructeur/sujets')
    const [themes, fichiers] = await Promise.all([api('/api/rapports-themes').catch(() => Object.keys(THEMES)), api('/api/connaissances/fichiers').catch(() => ({}))])
    let catalogue = brouillon.etat.sujet ? await api(`/api/constructeur/champs/${encodeURIComponent(brouillon.etat.sujet)}`).catch(() => null) : null
    const parId = () => new Map((catalogue?.champs || []).map((c) => [c.id, c]))

    const formulaire = h('div', { class: 'grille' })
    const apercu = h('div', { class: 'carte apercu-constructeur' })
    let minuterie = null
    const changer = () => {
      dessinerFormulaire()
      clearTimeout(minuterie)
      minuterie = setTimeout(rafraichirApercu, 500)
    }

    // ---- phrase pour l'IA
    const phrase = h('input', { type: 'text', placeholder: 'Ex. : les dépannages des 12 derniers mois par ligne, avec le nombre et le temps d’arrêt' })
    const boutonIA = h('button', { onclick: remplirAvecIA }, ic('etincelle', 16), 'Remplir avec l’IA')
    phrase.addEventListener('keydown', (e) => e.key === 'Enter' && remplirAvecIA())
    async function remplirAvecIA() {
      if (!phrase.value.trim()) return notifier('Décrivez le rapport en une phrase.', 'erreur')
      boutonIA.disabled = true
      vider(boutonIA, ic('etincelle', 16), 'L’IA remplit le formulaire…')
      try {
        const r = await api('/api/constructeur/proposer', { methode: 'POST', corps: { phrase: phrase.value, sujet: null } })
        brouillon.etat = { ...nouveau().etat, ...r.etat }
        if (r.titre) brouillon.aspect.titre = r.titre
        catalogue = await api(`/api/constructeur/champs/${encodeURIComponent(r.etat.sujet)}`)
        notifier('Formulaire rempli : vérifiez et ajustez, l’aperçu se met à jour.')
        for (const a of r.avertissements || []) notifier(a, 'erreur')
        changer()
      } catch (erreur) {
        notifier(erreur.message, 'erreur')
      } finally {
        boutonIA.disabled = false
        vider(boutonIA, ic('etincelle', 16), 'Remplir avec l’IA')
      }
    }

    // ---- formulaire
    function dessinerFormulaire() {
      const e = brouillon.etat
      const a = brouillon.aspect
      const champs = parId()
      const nomChamp = (id) => {
        const c = champs.get(id)
        return c ? (c.niveau ? `${c.libelle} · ${c.groupe.split(' › ').at(-1)}` : c.libelle) : '?'
      }
      const puce = (texte, retirer, extra = null) => h('span', { class: 'puce-champ' }, texte, extra, h('button', { class: 'discret', title: 'Retirer', onclick: retirer }, ic('x', 12)))

      // 1. Sujet
      const choixSujet = h('select', {
        onchange: async () => {
          brouillon = { ...nouveau(choixSujet.value), aspect: { ...brouillon.aspect, titre: '' } }
          catalogue = choixSujet.value ? await api(`/api/constructeur/champs/${encodeURIComponent(choixSujet.value)}`) : null
          changer()
        },
      },
        h('option', { value: '' }, '— Choisir —'),
        h('optgroup', { label: 'Décrites dans le dictionnaire' }, sujets.filter((s) => s.decrite).map((s) => h('option', { value: s.table, selected: s.table === e.sujet }, s.libelle))),
        h('optgroup', { label: 'Autres tables' }, sujets.filter((s) => !s.decrite).map((s) => h('option', { value: s.table, selected: s.table === e.sujet }, s.libelle))))

      const etapes = [
        section('1', 'De quoi parle le rapport ?', h('label', { class: 'champ' }, h('span', {}, 'Une ligne du rapport = un(e)…'), choixSujet)),
      ]

      if (catalogue) {
        // 2. Contenu
        const mode = (valeur, texte, aide) => h('button', { class: e.mode === valeur ? 'principal' : '', title: aide, onclick: () => { e.mode = valeur; changer() } }, texte)
        const contenu = [h('div', { class: 'actions' },
          mode('liste', 'Liste détaillée', 'Une ligne par élément, avec les colonnes choisies'),
          mode('synthese', 'Synthèse (compter, totaliser)', 'Une ligne par groupe : nombre, totaux'))]
        if (e.mode === 'liste') {
          contenu.push(
            h('div', { class: 'champ' }, h('span', {}, 'Colonnes, dans l’ordre'),
              h('div', { class: 'puces' },
                e.champs.map((id, i) => puce(nomChamp(id), () => { e.champs.splice(i, 1); changer() },
                  i > 0 ? h('button', { class: 'discret', title: 'Avancer', onclick: () => { [e.champs[i - 1], e.champs[i]] = [e.champs[i], e.champs[i - 1]]; changer() } }, '‹') : null)),
                h('button', { class: 'petit', onclick: async () => { const id = await choisirChamp(catalogue, 'Ajouter une colonne'); if (id) { e.champs.push(id); changer() } } }, ic('plus', 14), 'Colonne'))),
            h('div', { class: 'champ' }, h('span', {}, 'Regrouper par (avec sous-totaux)'),
              h('div', { class: 'puces' },
                e.regroupements.map((g, i) => puce(nomChamp(g.champ), () => { e.regroupements.splice(i, 1); changer() }, granularite(g, champs.get(g.champ), changer))),
                e.regroupements.length < 2 ? h('button', { class: 'petit discret', onclick: async () => { const id = await choisirChamp(catalogue, 'Regrouper par'); if (id) { e.regroupements.push({ champ: id, par: 'valeur' }); changer() } } }, ic('plus', 14), 'Groupe') : null)),
            h('div', { class: 'champ' }, h('span', {}, 'Trier par'), triListe(e, catalogue, nomChamp, changer)),
          )
        } else {
          contenu.push(
            h('div', { class: 'champ' }, h('span', {}, 'Regrouper par'),
              h('div', { class: 'puces' },
                e.regroupements.map((g, i) => puce(nomChamp(g.champ), () => { e.regroupements.splice(i, 1); changer() }, granularite(g, champs.get(g.champ), changer))),
                e.regroupements.length < 3 ? h('button', { class: 'petit', onclick: async () => { const id = await choisirChamp(catalogue, 'Regrouper par'); if (id) { e.regroupements.push({ champ: id, par: champs.get(id)?.nature.startsWith('date') ? 'mois' : 'valeur' }); changer() } } }, ic('plus', 14), 'Regrouper par') : null)),
            h('div', { class: 'champ' }, h('span', {}, 'Valeurs calculées'),
              h('div', { class: 'puces' },
                e.mesures.map((m, i) => puce(m.fonction === 'nombre' ? `Nombre de ${catalogue.sujet.libelle.replace(/\s*\(.*\)\s*$/, '').toLowerCase()}` : `${{ somme: 'Total', moyenne: 'Moyenne', min: 'Minimum', max: 'Maximum' }[m.fonction]} : ${nomChamp(m.champ)}`, () => { e.mesures.splice(i, 1); changer() })),
                h('button', { class: 'petit discret', onclick: async () => { const m = await choisirMesure(catalogue); if (m) { e.mesures.push(m); changer() } } }, ic('plus', 14), 'Valeur'))),
            h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
              h('input', { type: 'checkbox', checked: e.tri?.champ === '__mesure', onchange: (ev) => { e.tri = ev.target.checked ? { champ: '__mesure', sens: 'desc' } : null; changer() } }),
              'Trier du plus grand au plus petit (classement)'),
          )
        }
        contenu.push(h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: e.totaux !== false, onchange: (ev) => { e.totaux = ev.target.checked; changer() } }), 'Totaux en bas des colonnes de nombres'))
        etapes.push(section('2', 'Que montrer ?', contenu))

        // 3. Filtres
        const aActif = catalogue.champs.some((c) => c.chemin === '' && c.colonne.toUpperCase() === 'ACTIF')
        etapes.push(section('3', 'Quelles lignes ?', [
          e.filtres.map((f, i) => ligneFiltre(f, champs.get(f.champ), nomChamp(f.champ), e.sujet, () => { e.filtres.splice(i, 1); changer() }, changer)),
          h('div', { class: 'actions' },
            h('button', { class: 'petit', onclick: async () => { const id = await choisirChamp(catalogue, 'Filtrer sur'); if (id) { const c = champs.get(id); e.filtres.push({ champ: id, operateur: c.nature.startsWith('date') ? 'periode' : 'egal', valeurs: c.nature.startsWith('date') ? ['mois_en_cours'] : [] }); changer() } } }, ic('plus', 14), 'Filtre'),
            aActif ? h('select', { title: 'Fiches prises en compte', onchange: (ev) => { e.etat = ev.target.value; changer() } },
              [['sans_corbeille', 'Toutes sauf la corbeille'], ['courantes', 'Courantes seulement'], ['toutes', 'Toutes, corbeille comprise']].map(([v, t]) => h('option', { value: v, selected: e.etat === v }, t))) : null),
        ]))

        // 4. Présentation
        const champTexte = (cle, libelle, attributs = {}) => {
          const entree = h('input', { type: 'text', value: a[cle] || '', ...attributs })
          entree.addEventListener('change', () => { a[cle] = entree.value })
          return h('label', { class: 'champ' }, h('span', {}, libelle), entree)
        }
        const choix = (cle, libelle, options) => h('label', { class: 'champ' }, h('span', {}, libelle),
          h('select', { onchange: (ev) => { a[cle] = ev.target.value } }, Object.entries(options).map(([v, t]) => h('option', { value: v, selected: (a[cle] || '') === v }, t))))
        etapes.push(section('4', 'Présentation', [
          h('div', { class: 'grille grille-2' },
            champTexte('titre', 'Titre', { placeholder: catalogue.sujet.libelle }),
            champTexte('sousTitre', 'Sous-titre'),
            choix('theme', 'Thème', Object.fromEntries(themes.map((t) => [t, THEMES[t] || t]))),
            choix('orientation', 'Orientation', { '': 'Automatique', portrait: 'Portrait', paysage: 'Paysage' }),
            choix('image', 'Image centrée en haut', { '': 'Aucune', ...Object.fromEntries((fichiers.images?.fichiers || []).map((f) => [f.nom, f.nom])) }),
            choix('positionDescription', 'Description', { entete: 'En en-tête', pied: 'En bas de page' }),
          ),
          champTexte('description', 'Texte de description (facultatif)'),
          h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('input', { type: 'checkbox', checked: a.logo !== false, onchange: (ev) => { a.logo = ev.target.checked } }), 'Logo de la GMAO en haut de page'),
        ]))
      }
      vider(formulaire, etapes)
    }

    // ---- aperçu
    async function rafraichirApercu() {
      if (!catalogue) return vider(apercu, h('p', { class: 'texte-2' }, 'Choisissez de quoi parle le rapport, ou décrivez-le en une phrase et « Remplir avec l’IA ».'))
      vider(apercu, h('p', { class: 'discret curseur' }, 'Aperçu'))
      const r = await api('/api/constructeur/apercu', { methode: 'POST', corps: { etat: brouillon.etat, aspect: brouillon.aspect } }).catch((erreur) => ({ erreurs: [erreur.message] }))
      vider(apercu,
        h('div', { class: 'carte-entete' },
          h('h2', {}, ic('oeil', 18), 'Aperçu'),
          h('button', { class: 'principal', disabled: Boolean(r.erreurs?.length), onclick: creer }, ic('document', 16), brouillon.nom ? 'Mettre à jour le rapport' : 'Créer le rapport')),
        (r.erreurs || []).map((x) => h('div', { class: 'bandeau' }, ic('alerte'), x)),
        (r.avertissements || []).map((x) => h('p', { class: 'discret', style: { fontSize: '13px' } }, '• ', x)),
        r.total !== undefined ? h('p', { class: r.total ? 'texte-2' : 'bandeau' }, r.total ? `${r.total} ligne(s) dans le rapport${r.total > 50 ? ' (50 premières affichées)' : ''}.` : 'Aucune ligne : le rapport serait vide. Élargissez les filtres.') : null,
        r.resultat ? tableauResultats({ ...r.resultat, colonnes: r.resultat.colonnes.map((c, i) => ({ ...c, nom: r.colonnes?.[i]?.libelle || c.nom })) }) : null,
        r.sql ? h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'discret' }, 'Requête SQL écrite par BiRTEC'), h('pre', { class: 'code', 'data-langue': 'sql' }, h('code', {}, r.sql))) : null,
      )
    }

    async function creer() {
      if (!etatAppli.connexion.ouverte) await demanderMotDePasse().catch(() => {})
      notifier('Fabrication du rapport…')
      try {
        const r = await api('/api/constructeur/creer', { methode: 'POST', corps: { etat: brouillon.etat, aspect: brouillon.aspect, nom: brouillon.nom } })
        if (!r.ok) return notifier(`Le rapport n’a pas pu être fabriqué : ${r.erreurs.join(' ; ')}`, 'erreur')
        for (const a of r.avertissements || []) notifier(a, 'erreur')
        notifier('Rapport créé')
        brouillon = null
        location.hash = `#/rapports/${encodeURIComponent(r.nom)}`
      } catch (erreur) {
        notifier(erreur.message, 'erreur')
      }
    }

    vider(
      zone,
      h('div', { class: 'entete-page' },
        h('div', {}, h('h1', {}, brouillon.nom ? 'Modifier le rapport' : 'Nouveau rapport'), h('p', { class: 'sous-titre' }, 'Choisissez, l’aperçu suit. BiRTEC écrit la requête lui-même.')),
        h('button', { class: 'discret', onclick: () => { brouillon = nouveau(); window.birtec.recharger() } }, ic('rafraichir', 16), 'Recommencer'),
      ),
      h('div', { class: 'carte phrase-ia' }, ic('etincelle', 18), phrase, boutonIA),
      h('div', { class: 'constructeur-grille' }, formulaire, apercu),
    )
    dessinerFormulaire()
    rafraichirApercu()
  },
}

// ---------------------------------------------------------------- morceaux du formulaire

function section(numero, titre, contenu) {
  return h('div', { class: 'carte section-constructeur' }, h('h2', {}, h('span', { class: 'numero-etape' }, numero), titre), h('div', { class: 'grille' }, contenu))
}

function granularite(g, c, changer) {
  if (!c || !c.nature.startsWith('date')) return null
  return h('select', { class: 'mini', onchange: (ev) => { g.par = ev.target.value; changer() } },
    [['valeur', 'jour'], ['mois', 'par mois'], ['annee', 'par année']].map(([v, t]) => h('option', { value: v, selected: (g.par || 'valeur') === v }, t)))
}

function triListe(e, catalogue, nomChamp, changer) {
  const candidats = [...new Set([...(e.champs || [])])]
  return h('div', { style: { display: 'flex', gap: '6px' } },
    h('select', { onchange: (ev) => { e.tri = ev.target.value ? { champ: ev.target.value, sens: e.tri?.sens || 'asc' } : null; changer() } },
      h('option', { value: '' }, '— Aucun tri —'),
      candidats.map((id) => h('option', { value: id, selected: e.tri?.champ === id }, nomChamp(id)))),
    e.tri ? h('select', { onchange: (ev) => { e.tri.sens = ev.target.value; changer() } },
      h('option', { value: 'asc', selected: e.tri.sens !== 'desc' }, 'croissant'),
      h('option', { value: 'desc', selected: e.tri.sens === 'desc' }, 'décroissant')) : null)
}

function ligneFiltre(f, c, nom, sujet, retirer, changer) {
  if (!c) return null
  const operateurs = OPERATEURS[c.nature] || OPERATEURS.texte
  const operateur = h('select', { onchange: (ev) => { f.operateur = ev.target.value; f.valeurs = f.operateur === 'periode' ? ['mois_en_cours'] : []; changer() } },
    Object.entries(operateurs).map(([v, t]) => h('option', { value: v, selected: f.operateur === v }, t)))
  let valeur = null
  if (f.operateur === 'periode') {
    valeur = h('select', { onchange: (ev) => { f.valeurs = [ev.target.value]; changer() } }, Object.entries(PERIODES).map(([v, t]) => h('option', { value: v, selected: f.valeurs[0] === v }, t)))
  } else if (['vide', 'non_vide'].includes(f.operateur)) {
    valeur = null
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
function choisirChamp(catalogue, titre, filtre = () => true) {
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

async function choisirMesure(catalogue) {
  const fonction = h('select', {}, [['nombre', 'Nombre (compter)'], ['somme', 'Total de…'], ['moyenne', 'Moyenne de…'], ['max', 'Maximum de…'], ['min', 'Minimum de…']].map(([v, t]) => h('option', { value: v }, t)))
  const choix = await fenetre({ titre: 'Valeur calculée', contenu: h('label', { class: 'champ' }, h('span', {}, 'Calcul'), fonction), boutons: [{ texte: 'Annuler', classe: 'discret', valeur: null }, { texte: 'Suivant', classe: 'principal', action: () => fonction.value }] })
  if (!choix) return null
  if (choix === 'nombre') return { fonction: 'nombre', champ: null }
  const id = await choisirChamp(catalogue, 'Sur quel nombre ?', (c) => c.nature === 'nombre')
  return id ? { fonction: choix, champ: id } : null
}

async function choisirValeurs(sujet, c, actuelles) {
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
