// Nouvel indicateur ITM : trois étapes avec les mêmes sélections que le rapport, et le chiffre du jour en direct.
//   1. Ce qu'on compte (une table de la GMAO : interventions, demandes…)
//   2. Les conditions (filtres)
//   3. Le nom (catégorie + nom court), la date affichée dans la liste, l'arborescence de la personne connectée
// BiRTEC écrit la requête indicateur et la requête liste, les essaie, vérifie qu'elles concordent.
// Après l'enregistrement, il propose d'en faire aussi un rapport.

import { h, vider, ic, notifier, confirmer } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { tableauResultats } from '../base/vue.js'
import { section, caseACocher, caseRequete, listeFiltres, sansLancement, choixFiches, apprendre, nouveauBloc, nouveauRapport } from '../constructeur/vue.js'

let brouillon = null // { etat, categorie, nomCourt, dateIndicateur, arborescence, id }

function nouveau() {
  return { etat: { sujet: '', filtres: [], etat: 'sans_corbeille' }, categorie: 'Maintenance', nomCourt: '', dateIndicateur: '', arborescence: true, id: null }
}

export default {
  chemin: 'indicateur',
  titre: 'Nouvel indicateur',
  icone: 'graphique',
  menu: false,
  aide: 'itm',
  rafraichir: false,

  async afficher(zone) {
    // Un indicateur à reprendre (Modifier, ou « en faire aussi un indicateur » depuis un rapport).
    const repris = sessionStorage.getItem('birtec-indicateur')
    if (repris) {
      sessionStorage.removeItem('birtec-indicateur')
      const r = JSON.parse(repris)
      const nom = String(r.nom || '')
      const m = nom.match(/^\[\s*([^\]]+?)\s*\]\s*-?\s*(.*)$/)
      brouillon = {
        ...nouveau(),
        etat: { ...nouveau().etat, ...r.etat },
        categorie: m ? m[1] : 'Maintenance',
        nomCourt: m ? m[2] : nom,
        dateIndicateur: r.dateIndicateur || '',
        arborescence: r.arborescence !== false,
        id: r.id || null,
      }
    }
    brouillon ||= nouveau()
    const b = brouillon
    const e = b.etat
    const [sujets, indicateurs] = await Promise.all([api('/api/constructeur/sujets'), api('/api/itm/indicateurs').catch(() => [])])
    const categories = [...new Set(indicateurs.map((i) => i.nom.match(/^\[([^\]]+)\]/)?.[1]).filter(Boolean))].sort()
    let catalogue = e.sujet ? await api(`/api/constructeur/champs/${encodeURIComponent(e.sujet)}`).catch(() => null) : null
    let aApprendre = []

    const formulaire = h('div', { class: 'grille' })
    const apercu = h('div', { class: 'carte apercu-constructeur' })
    let minuterie = null
    const changer = () => {
      dessiner()
      clearTimeout(minuterie)
      minuterie = setTimeout(rafraichir, 600)
    }

    // ---- phrase pour l'IA
    const phrase = h('input', { type: 'text', placeholder: 'Ex. : les demandes d’intervention en retard' })
    const boutonIA = h('button', { onclick: remplirAvecIA }, ic('etincelle', 16), 'Remplir avec l’IA')
    phrase.addEventListener('keydown', (ev) => ev.key === 'Enter' && remplirAvecIA())
    async function remplirAvecIA() {
      if (!phrase.value.trim()) return notifier('Décrivez l’indicateur en une phrase.', 'erreur')
      boutonIA.disabled = true
      vider(boutonIA, ic('etincelle', 16), 'L’IA remplit…')
      try {
        const r = await api('/api/constructeur/proposer', { methode: 'POST', corps: { phrase: phrase.value, sujet: null } })
        // Un indicateur n'a pas de paramètre : une période « choisie au lancement » devient le mois en cours.
        const filtres = sansLancement((r.etat.filtres || []).map((f) => (f.operateur === 'periode' && f.valeurs?.[0] === 'demandee' ? { ...f, valeurs: ['mois_en_cours'] } : f)))
        Object.assign(e, { sujet: r.etat.sujet, filtres, etat: r.etat.etat || 'sans_corbeille' })
        if (r.titre) b.nomCourt = r.titre
        aApprendre = r.aApprendre || []
        catalogue = await api(`/api/constructeur/champs/${encodeURIComponent(e.sujet)}`)
        notifier('Formulaire rempli : vérifiez, le chiffre se met à jour.')
        for (const a of r.avertissements || []) notifier(a, 'erreur')
        changer()
      } catch (erreur) {
        notifier(erreur.message, 'erreur')
      } finally {
        boutonIA.disabled = false
        vider(boutonIA, ic('etincelle', 16), 'Remplir avec l’IA')
      }
    }

    function dessiner() {
      const champs = new Map((catalogue?.champs || []).map((c) => [c.id, c]))
      const nomChamp = (id) => {
        const c = champs.get(id)
        return c ? (c.niveau ? `${c.libelle} · ${c.groupe.split(' › ').at(-1)}` : c.libelle) : '?'
      }
      const numero = (n) => h('span', { class: 'numero-etape' }, String(n))
      const choixSujet = h('select', {
        onchange: async () => {
          Object.assign(e, { sujet: choixSujet.value, filtres: [], etat: 'sans_corbeille' })
          b.dateIndicateur = ''
          catalogue = choixSujet.value ? await api(`/api/constructeur/champs/${encodeURIComponent(choixSujet.value)}`) : null
          changer()
        },
      },
        h('option', { value: '' }, '— Choisir —'),
        h('optgroup', { label: 'Décrites dans le dictionnaire' }, sujets.filter((s) => s.decrite).map((s) => h('option', { value: s.table, selected: s.table === e.sujet }, s.libelle))),
        h('optgroup', { label: 'Autres tables' }, sujets.filter((s) => !s.decrite).map((s) => h('option', { value: s.table, selected: s.table === e.sujet }, s.libelle))))
      const etapes = [section(numero(1), 'Ce qu’on compte', h('label', { class: 'champ' }, h('span', {}, 'Le nombre de…'), choixSujet))]

      if (catalogue) {
        const aActif = catalogue.champs.some((c) => c.chemin === '' && c.colonne.toUpperCase() === 'ACTIF')
        etapes.push(section(numero(2), 'Les conditions', [
          listeFiltres(e.filtres, { catalogue, champs, nomChamp, sujet: e.sujet, changer, sansLancement: true }),
          aApprendre.map((expression) => h('div', { class: 'bandeau', style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
            ic('alerte'), h('span', { style: { flex: 1 } }, `« ${expression} » : BiRTEC ne sait pas à quoi cela correspond dans la base.`),
            h('button', { class: 'petit', onclick: async () => { if (await apprendre(expression, catalogue, e)) { aApprendre = aApprendre.filter((x) => x !== expression); changer() } } }, ic('livre', 14), 'Lui apprendre'),
            h('button', { class: 'petit discret', onclick: () => { aApprendre = aApprendre.filter((x) => x !== expression); dessiner() } }, 'Ignorer'))),
          aActif ? h('div', { class: 'actions' }, choixFiches(e, changer)) : null,
        ]))

        const categorie = h('input', { type: 'text', value: b.categorie, list: 'categories-itm', style: { width: '160px' } })
        categorie.addEventListener('change', () => { b.categorie = categorie.value.trim(); changer() })
        const nomCourt = h('input', { type: 'text', value: b.nomCourt, placeholder: 'Ex. : DI en retard', style: { flex: 1 } })
        nomCourt.addEventListener('change', () => { b.nomCourt = nomCourt.value.trim(); changer() })
        const dates = catalogue.champs.filter((c) => c.niveau === 0 && (c.nature === 'date' || c.nature === 'date8'))
        etapes.push(section(numero(3), 'Le nom et l’affichage', [
          h('div', { class: 'champ' }, h('span', {}, 'Nom dans la GMAO'),
            h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, '[', categorie, '] -', nomCourt),
            h('datalist', { id: 'categories-itm' }, categories.map((c) => h('option', { value: c })))),
          h('label', { class: 'champ' }, h('span', {}, 'Date affichée dans la liste (facultatif)'),
            h('select', { onchange: (ev) => { b.dateIndicateur = ev.target.value; changer() } }, h('option', { value: '' }, '— Aucune —'), dates.map((c) => h('option', { value: c.id, selected: b.dateIndicateur === c.id }, c.libelle)))),
          caseACocher(b.arborescence, 'Limiter à l’arborescence de la personne connectée (si la GMAO a une variable pour cette fenêtre)', (v) => { b.arborescence = v; changer() }),
        ]))
      }
      vider(formulaire, etapes)
    }

    const corps = (enregistrer) => ({ etat: e, nom: `[${b.categorie || 'Divers'}] - ${b.nomCourt || catalogue?.sujet.libelle || 'Indicateur'}`, dateIndicateur: b.dateIndicateur || null, arborescence: b.arborescence, enregistrer, id: b.id })

    async function rafraichir() {
      const entete = h('div', { class: 'carte-entete' },
        h('h2', {}, ic('graphique', 18), 'Aujourd’hui'),
        h('button', { class: 'principal', disabled: !catalogue, onclick: enregistrer }, ic('coche', 16), b.id ? 'Mettre à jour l’indicateur' : 'Enregistrer l’indicateur'))
      if (!catalogue) return vider(apercu, entete, h('p', { class: 'texte-2' }, 'Choisissez ce qu’on compte, ou décrivez l’indicateur en une phrase et « Remplir avec l’IA ».'))
      vider(apercu, entete, h('p', { class: 'discret curseur' }, 'Essai sur la base'))
      const r = await api('/api/constructeur/indicateur', { methode: 'POST', corps: corps(false) }).catch((erreur) => ({ erreurs: [erreur.message] }))
      vider(apercu, entete,
        r.valeur !== undefined && r.valeur !== null
          ? h('div', { class: 'chiffre-apercu' }, h('strong', {}, String(r.valeur)), h('span', {}, `${r.nom} — fenêtre de la GMAO : ${r.fenetre}`))
          : null,
        (r.erreurs || []).map((x) => h('div', { class: 'bandeau' }, ic('alerte'), x)),
        (r.avertissements || []).map((x) => h('p', { class: 'discret', style: { fontSize: '13px' } }, '• ', x)),
        r.liste ? h('p', { class: 'texte-2' }, `La liste ouverte depuis l’indicateur : ${r.liste.total} fiche(s)${r.liste.tronque ? ' (début)' : ''}.`) : null,
        r.liste ? tableauResultats(r.liste) : null,
        r.requeteIndicateur ? h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'discret' }, 'Les deux requêtes pour la GMAO'),
          caseRequete('Requête indicateur', r.requeteIndicateur), caseRequete('Requête liste', r.requeteListe)) : null)
    }

    async function enregistrer() {
      if (!b.nomCourt.trim()) return notifier('Donnez un nom court à l’indicateur (étape 3).', 'erreur')
      try {
        const r = await api('/api/constructeur/indicateur', { methode: 'POST', corps: corps(true) })
        if (!r.id) return notifier(`L’indicateur n’a pas été enregistré : ${(r.erreurs || []).join(' ; ') || 'erreur inconnue'}`, 'erreur')
        notifier(b.id ? 'Indicateur mis à jour' : 'Indicateur enregistré : ses requêtes sont prêtes à copier')
        const sujet = e.sujet
        const filtres = structuredClone(e.filtres)
        const etatFiches = e.etat
        const dateIndicateur = b.dateIndicateur
        const titre = b.nomCourt
        brouillon = null
        if (await confirmer('L’indicateur est prêt. En faire aussi un rapport (la liste des mêmes fiches, à imprimer ou exporter) ?', { texte: 'Créer le rapport' })) {
          // La liste de l'indicateur devient le premier tableau du rapport : code, désignation, date.
          const champs = (catalogue?.champs || []).filter((c) => c.niveau === 0 && (/^code/i.test(c.libelle) || /^d[ée]signation$/i.test(c.libelle))).map((c) => c.id)
          if (dateIndicateur) champs.push(dateIndicateur)
          const bloc = nouveauBloc('tableau', sujet)
          Object.assign(bloc.etat, { filtres, etat: etatFiches, champs: [...new Set(champs)] })
          const rapport = nouveauRapport([bloc])
          rapport.aspect.titre = titre
          sessionStorage.setItem('birtec-rapport', JSON.stringify({ rapport }))
          location.hash = '#/constructeur/rapport'
          return
        }
        location.hash = `#/itm/${r.id}`
      } catch (erreur) {
        notifier(erreur.message, 'erreur')
      }
    }

    vider(zone,
      h('div', { class: 'entete-page' },
        h('div', {}, h('h1', {}, b.id ? 'Modifier l’indicateur' : 'Nouvel indicateur ITM'), h('p', { class: 'sous-titre' }, 'Ce qu’on compte et les conditions : BiRTEC écrit les deux requêtes de la GMAO.')),
        h('div', { class: 'actions' },
          h('a', { class: 'bouton discret', href: '#/constructeur' }, ic('retour', 16), 'Rapport ou indicateur'),
          h('button', { class: 'discret', onclick: () => { brouillon = nouveau(); window.ktec.recharger() } }, ic('rafraichir', 16), 'Recommencer'))),
      h('div', { class: 'carte phrase-ia' }, ic('etincelle', 18), phrase, boutonIA),
      h('div', { class: 'constructeur-grille' }, formulaire, apercu))
    dessiner()
    rafraichir()
  },
}
