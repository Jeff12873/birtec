// Rapports : la liste des rapports créés par BiRTEC, leur aperçu (avec les paramètres) et leur export
// au format choisi. Un rapport se crée depuis l'assistant (bouton « Créer le rapport ») ou ici, en
// collant sa description.

import { h, vider, ic, essayer, notifier, confirmer, fenetre, dateHeureFr, deuxPanneaux } from '/socle/ui.js'
import { api, adresse } from '/socle/api.js'
import { etat } from '/socle/etat.js'
import { demanderMotDePasse } from '../configuration/vue.js'

let formatChoisi = 'pdf'
try {
  formatChoisi = localStorage.getItem('birtec-format') || 'pdf'
} catch {
  // stockage indisponible : PDF par défaut
}

export default {
  chemin: 'rapports',
  titre: 'Rapports',
  icone: 'document',
  menu: true,
  groupe: 'Mes créations',
  aide: 'rapports',

  async afficher(zone, { id }) {
    const rapports = await api('/api/rapports')
    const liste = h('div', { class: 'liste-tables' },
      rapports.length
        ? rapports.map((r) => h('a', { href: `#/rapports/${encodeURIComponent(r.nom)}`, class: r.nom === id ? 'actif' : '', title: `Modifié ${dateHeureFr(r.modifie)}` }, ic('document', 14), ' ', r.titre))
        : h('p', { class: 'discret' }, 'Aucun rapport pour l’instant.'))
    const detail = h('div', { class: 'grille' })

    vider(
      zone,
      h('div', { class: 'entete-page' },
        h('div', {}, h('h1', {}, 'Rapports'), h('p', { class: 'sous-titre' }, 'Rapports BIRT créés par BiRTEC : aperçu, export, fichier .rptdesign')),
        h('div', { class: 'actions' },
          h('a', { class: 'bouton principal', href: '#/constructeur/rapport' }, ic('plus', 16), 'Nouveau rapport'),
          h('button', { class: 'discret', onclick: () => { sessionStorage.setItem('birtec-question', 'Je veux créer un rapport BIRT. Pose-moi les questions utiles (contenu, période, regroupements, totaux), puis donne sa description.'); location.hash = '#/assistant' } }, ic('etincelle', 16), 'Avec l’assistant'),
          h('button', { class: 'discret', onclick: () => creerDepuisDescription(), title: 'Décrire le rapport en quelques phrases : le formulaire se remplit tout seul' }, ic('plus', 16), 'Décrire un rapport'),
        ),
      ),
      deuxPanneaux(
        h('div', { class: 'carte', style: { padding: '12px' } }, liste),
        detail,
        { cle: 'rapports', largeur: 380 },
      ),
    )

    if (id && rapports.some((r) => r.nom === id)) await afficherRapport(detail, id)
    else vider(detail, h('div', { class: 'carte' }, h('p', { class: 'texte-2' },
      rapports.length ? 'Choisissez un rapport à gauche.' : 'Aucun rapport pour l’instant : « Nouveau rapport » pour en créer un en quelques clics.')))
  },
}

async function afficherRapport(zone, nom) {
  const rapport = await api(`/api/rapports/${encodeURIComponent(nom)}`)
  const formats = await api('/api/rapports/formats')

  // Un champ par paramètre du rapport, prérempli avec sa valeur par défaut ; une liste déroulante
  // pour ceux « à choisir dans une liste » (valeurs lues dans la base).
  const champs = rapport.parametres.map((p) => {
    if (p.liste) {
      const champ = h('select', {}, h('option', { value: '' }, p.optionnel ? '(Toutes)' : '— Choisir —'))
      api(`/api/rapports/${encodeURIComponent(nom)}/parametres/${encodeURIComponent(p.nom)}`)
        .then((valeurs) => champ.append(...valeurs.map((v) => h('option', { value: v, selected: String(v) === String(p.defaut) }, v))))
        .catch(() => {})
      return { nom: p.nom, champ, element: h('label', { class: 'champ' }, h('span', {}, p.libelle), champ) }
    }
    const type = { date: 'date', dateTime: 'datetime-local', integer: 'number', decimal: 'number', float: 'number' }[p.type] || 'text'
    const champ = h('input', { type, value: p.defaut, step: type === 'number' ? 'any' : null })
    return { nom: p.nom, champ, element: h('label', { class: 'champ' }, h('span', {}, p.libelle), champ) }
  })
  const valeurs = () => Object.fromEntries(champs.map((c) => [c.nom, c.champ.value.replace('T', ' ')]))

  const cadre = h('iframe', { class: 'apercu-rapport', title: 'Aperçu du rapport' })
  const messages = h('div')
  const choixFormat = h('select', { onchange: () => { formatChoisi = choixFormat.value; try { localStorage.setItem('birtec-format', formatChoisi) } catch {} } },
    Object.entries(formats).map(([cle, f]) => h('option', { value: cle, selected: cle === formatChoisi }, f.libelle)))

  async function apercu() {
    if (!etat.connexion.ouverte) return demanderMotDePasse().then(apercu)
    vider(messages, h('p', { class: 'discret curseur' }, 'Le moteur BIRT fabrique l’aperçu'))
    try {
      const resultat = await api(`/api/rapports/${encodeURIComponent(nom)}/apercu`, { methode: 'POST', corps: { parametres: valeurs() } })
      const graves = resultat.erreurs.filter((e) => !e.startsWith('Avertissement'))
      vider(messages,
        graves.length ? h('div', { class: 'bandeau' }, ic('alerte'), graves.join(' — ')) : null,
        resultat.lignes === 0 ? h('div', { class: 'bandeau' }, ic('alerte'), 'Aucune ligne pour ces paramètres : le rapport est vide. Vérifiez les paramètres, ou demandez à l’assistant de revoir les filtres de la requête.') : null,
        resultat.lignes > 0 ? h('p', { class: 'discret', style: { fontSize: '13px' } }, `${resultat.lignes} ligne${resultat.lignes > 1 ? 's' : ''} dans le rapport.`) : null)
      cadre.src = adresse(resultat.adresse)
    } catch (erreur) {
      vider(messages, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
    }
  }

  async function exporter() {
    if (!etat.connexion.ouverte) return demanderMotDePasse().then(exporter)
    const format = choixFormat.value
    notifier(`Export ${formats[format].libelle} en cours…`)
    await essayer(async () => {
      const reponse = await fetch(adresse(`/api/rapports/${encodeURIComponent(nom)}/export`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-KTEC': '1' },
        body: JSON.stringify({ format, parametres: valeurs() }),
      })
      if (!reponse.ok) throw new Error((await reponse.json().catch(() => ({}))).erreur || `Erreur ${reponse.status}`)
      telecharger(await reponse.blob(), `${nom}.${format}`)
    }, 'Export terminé')
  }

  vider(
    zone,
    h('div', { class: 'carte' },
      h('div', { class: 'carte-entete' },
        h('h2', {}, ic('document', 18), rapport.titre || nom),
        h('div', { class: 'actions' },
          h('a', { class: 'bouton petit discret', href: adresse(`/api/rapports/${encodeURIComponent(nom)}/fichier`), title: 'Le fichier à ouvrir dans BIRT ou à déposer dans la GMAO' }, ic('telecharger', 14), '.rptdesign'),
          rapport.description?.constructeur
            ? h('button', { class: 'petit discret', onclick: () => modifier(rapport.description, nom) }, ic('crayon', 14), 'Modifier')
            : rapport.description ? h('button', { class: 'petit discret', onclick: () => creerDepuisDescription(rapport.description, nom) }, ic('crayon', 14), 'Modifier') : null,
          h('button', { class: 'petit discret danger', onclick: () => supprimer(nom) }, ic('poubelle', 14), 'Supprimer'),
        ),
      ),
      champs.length ? h('div', { class: 'parametres-rapport' }, champs.map((c) => c.element)) : null,
      rapport.description ? await reglagesAspect(nom, rapport.description, apercu) : null,
      h('div', { class: 'actions', style: { marginTop: '12px' } },
        h('button', { class: 'principal', onclick: apercu }, ic('oeil', 16), 'Aperçu'),
        h('span', { style: { flex: 1 } }),
        choixFormat,
        h('button', { onclick: exporter }, ic('telecharger', 16), 'Exporter'),
      ),
      messages,
    ),
    h('div', { class: 'carte', style: { padding: 0, overflow: 'hidden' } }, cadre),
  )
  if (etat.connexion.ouverte) apercu()
  else vider(messages, h('p', { class: 'discret' }, 'Connexion à la GMAO indisponible : pas d’aperçu pour l’instant.'))
}

// Aspect d'un rapport créé par BiRTEC : thème, image centrée en haut, logo. Appliqué sans passer par l'IA.
async function reglagesAspect(nom, description, apercu) {
  const [themes, fichiers] = await Promise.all([api('/api/rapports-themes'), api('/api/connaissances/fichiers')])
  const LIBELLES = { charte: 'Charte du site', sobre: 'Sobre', bleu: 'Bleu', vert: 'Vert', orange: 'Orange', impression: 'Noir et blanc (impression)' }
  const theme = h('select', {}, themes.map((t) => h('option', { value: t, selected: (description.theme || 'charte') === t }, LIBELLES[t] || t)))
  const image = h('select', {},
    h('option', { value: '' }, 'Aucune'),
    (fichiers.images?.fichiers || []).map((f) => h('option', { value: f.nom, selected: description.image === f.nom }, f.nom)))
  const logo = h('input', { type: 'checkbox', checked: description.logo !== false })
  const choixImage = h('input', {
    type: 'file', accept: '.png,.jpg,.jpeg,.gif,.bmp', style: { display: 'none' },
    onchange: async (e) => {
      const fichier = e.target.files[0]
      if (!fichier) return
      await api('/api/connaissances/fichiers/images', { methode: 'POST', fichier, entetes: { 'X-Nom': encodeURIComponent(fichier.name) } })
      image.append(h('option', { value: fichier.name }, fichier.name))
      image.value = fichier.name
      notifier(`${fichier.name} ajoutée au fichier .ktec`)
    },
  })
  const appliquer = async () => {
    try {
      const r = await api(`/api/rapports/${encodeURIComponent(nom)}/refaire`, { methode: 'POST', corps: { theme: theme.value, image: image.value || null, logo: logo.checked } })
      notifier('Aspect appliqué')
      for (const a of r.avertissements || []) notifier(a, 'erreur')
      apercu()
    } catch (erreur) {
      notifier(erreur.message, 'erreur')
    }
  }
  return h('details', { style: { marginTop: '12px' } },
    h('summary', { class: 'discret' }, 'Aspect : thème, image en haut, logo'),
    h('div', { class: 'parametres-rapport', style: { alignItems: 'end' } },
      h('label', { class: 'champ' }, h('span', {}, 'Thème'), theme),
      h('label', { class: 'champ' }, h('span', {}, 'Image centrée en haut'), h('div', { style: { display: 'flex', gap: '6px' } }, image, h('button', { class: 'petit', title: 'Importer une image', onclick: () => choixImage.click() }, ic('plus', 14)), choixImage)),
      h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, logo, 'Logo de la GMAO en haut de page'),
      h('button', { onclick: appliquer }, ic('rafraichir', 16), 'Appliquer'),
    ),
  )
}

// Création (ou modification) à partir d'une description JSON, collée ou reprise d'un rapport existant.
async function creerDepuisDescription(description = null, nom = null) {
  // Nouveau rapport : la description en mots (comme on la dirait à un collègue). Modifier un rapport existant :
  // sa description technique (JSON), pour les retouches fines.
  const zoneTexte = h('textarea', { class: description ? 'sql' : '', rows: description ? 18 : 8, spellcheck: !description, placeholder: 'Ex. : les demandes d’intervention de maintenance des 4 derniers mois, avec leur machine et leur état, triées par date' }, description ? JSON.stringify(description, null, 2) : '')
  const valeur = await fenetre({
    titre: nom ? 'Modifier le rapport' : 'Décrire le rapport à créer',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, nom
        ? 'Description technique du rapport (format donné dans l’aide « Rapports ») : titre, requête, paramètres, colonnes, groupes, totaux.'
        : 'Décrivez le rapport en quelques phrases, avec vos mots : ce qu’on liste ou ce qu’on compte, les colonnes, les filtres, la période. Le formulaire « Nouveau rapport » se remplit tout seul, vous vérifiez, l’aperçu suit.'),
      zoneTexte),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: nom ? 'Refaire le rapport' : 'Remplir le formulaire', classe: 'principal', action: () => zoneTexte.value },
    ],
  })
  if (!valeur?.trim()) return
  // Une description technique (JSON) est toujours acceptée ; sinon c'est du texte, confié au formulaire.
  let lue = null
  try {
    lue = JSON.parse(valeur)
  } catch {}
  if (lue && typeof lue === 'object') return creerRapport(lue, nom)
  sessionStorage.setItem('birtec-phrase', valeur.trim())
  location.hash = '#/constructeur/rapport'
}

// Rouvre l'éditeur sur un rapport créé avec le formulaire. Les rapports d'avant les blocs (un seul tableau)
// deviennent un rapport d'un seul bloc.
function modifier(d, nom) {
  const c = d.constructeur
  const aspect = { titre: d.titre, sousTitre: d.sousTitre, theme: d.theme, logo: d.logo, image: d.image || '', description: d.description, positionDescription: d.positionDescription, orientation: d.orientation }
  const rapport = c.version === 2
    ? { aspect: { ...aspect, ...c.aspect }, parametres: c.parametres || [], blocs: c.blocs || [] }
    : { aspect, parametres: [], blocs: [{ type: 'tableau', titre: '', source: 'champs', etat: { calculees: [], ...c }, regles: {} }] }
  sessionStorage.setItem('birtec-rapport', JSON.stringify({ rapport, nom }))
  location.hash = '#/constructeur/rapport'
}

// Utilisé aussi par l'assistant. Affiche une fenêtre d'attente pendant la fabrication et la vérification.
export async function creerRapport(description, nom = null) {
  if (!etat.connexion.ouverte) await demanderMotDePasse()
  notifier('Fabrication et vérification du rapport dans le moteur BIRT…')
  try {
    const resultat = await api('/api/rapports/generer', { methode: 'POST', corps: { description, nom } })
    if (!resultat.ok) {
      await fenetre({
        titre: 'Le rapport n’a pas pu être fabriqué',
        contenu: h('div', {}, h('p', {}, 'Erreurs signalées :'), h('ul', {}, resultat.erreurs.map((e) => h('li', { class: 'mono' }, e))),
          h('p', { class: 'texte-2' }, 'Précisez la demande à l’assistant ou corrigez la description.')),
        boutons: [{ texte: 'Fermer', classe: 'principal', valeur: true }],
      })
      return null
    }
    notifier(resultat.corrections.length ? `Rapport créé (corrigé automatiquement ${resultat.corrections.length} fois)` : 'Rapport créé')
    for (const a of resultat.avertissements || []) notifier(a, 'erreur')
    location.hash = `#/rapports/${encodeURIComponent(resultat.nom)}`
    window.ktec.recharger()
    return resultat.nom
  } catch (erreur) {
    notifier(erreur.message, 'erreur')
    return null
  }
}

async function supprimer(nom) {
  if (!(await confirmer(`Supprimer le rapport « ${nom} » ? Le fichier .rptdesign sera effacé du dossier de travail.`, { texte: 'Supprimer', danger: true }))) return
  await essayer(() => api(`/api/rapports/${encodeURIComponent(nom)}`, { methode: 'DELETE' }), 'Rapport supprimé')
  location.hash = '#/rapports'
}

function telecharger(blob, nomFichier) {
  const lien = h('a', { href: URL.createObjectURL(blob), download: nomFichier })
  document.body.append(lien)
  lien.click()
  lien.remove()
  setTimeout(() => URL.revokeObjectURL(lien.href), 10_000)
}
