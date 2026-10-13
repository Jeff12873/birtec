// Rapports : la liste des rapports créés par BiRTEC, leur aperçu (avec les paramètres) et leur export
// au format choisi. Un rapport se crée depuis l'assistant (bouton « Créer le rapport ») ou ici, en
// collant sa description.

import { h, vider, ic, essayer, notifier, confirmer, fenetre, dateHeureFr } from '/socle/ui.js'
import { api } from '/socle/api.js'
import { etat } from '/socle/etat.js'
import { demanderMotDePasse } from '/blocs/configuration/vue.js'

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
          h('button', { onclick: () => { sessionStorage.setItem('birtec-question', 'Je veux créer un rapport BIRT. Pose-moi les questions utiles (contenu, période, regroupements, totaux), puis donne sa description.'); location.hash = '#/assistant' } }, ic('etincelle', 16), 'Créer avec l’assistant'),
          h('button', { class: 'discret', onclick: () => creerDepuisDescription() }, ic('plus', 16), 'Coller une description'),
        ),
      ),
      h('div', { style: { display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: '16px', alignItems: 'start' } },
        h('div', { class: 'carte', style: { padding: '12px' } }, liste),
        detail,
      ),
    )

    if (id && rapports.some((r) => r.nom === id)) await afficherRapport(detail, id)
    else vider(detail, h('div', { class: 'carte' }, h('p', { class: 'texte-2' },
      rapports.length ? 'Choisissez un rapport à gauche.' : 'Demandez un rapport à l’assistant (par exemple « rapport des heures par équipement sur une période, groupé par famille ») : il propose sa description, puis le bouton « Créer le rapport » le fabrique et le vérifie.')))
  },
}

async function afficherRapport(zone, nom) {
  const rapport = await api(`/api/rapports/${encodeURIComponent(nom)}`)
  const formats = await api('/api/rapports/formats')

  // Un champ par paramètre du rapport, prérempli avec sa valeur par défaut.
  const champs = rapport.parametres.map((p) => {
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
      vider(messages, resultat.erreurs.length ? h('div', { class: 'bandeau' }, ic('alerte'), resultat.erreurs.join(' — ')) : null)
      cadre.src = resultat.adresse
    } catch (erreur) {
      vider(messages, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
    }
  }

  async function exporter() {
    if (!etat.connexion.ouverte) return demanderMotDePasse().then(exporter)
    const format = choixFormat.value
    notifier(`Export ${formats[format].libelle} en cours…`)
    await essayer(async () => {
      const reponse = await fetch(`/api/rapports/${encodeURIComponent(nom)}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-BIRTEC': '1' },
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
          h('a', { class: 'bouton petit discret', href: `/api/rapports/${encodeURIComponent(nom)}/fichier`, title: 'Le fichier à ouvrir dans BIRT ou à déposer dans la GMAO' }, ic('telecharger', 14), '.rptdesign'),
          rapport.description ? h('button', { class: 'petit discret', onclick: () => creerDepuisDescription(rapport.description, nom) }, ic('crayon', 14), 'Modifier') : null,
          h('button', { class: 'petit discret danger', onclick: () => supprimer(nom) }, ic('poubelle', 14), 'Supprimer'),
        ),
      ),
      champs.length ? h('div', { class: 'parametres-rapport' }, champs.map((c) => c.element)) : null,
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
  else vider(messages, h('p', { class: 'discret' }, 'Connexion MySQL fermée : « Aperçu » demandera le mot de passe.'))
}

// Création (ou modification) à partir d'une description JSON, collée ou reprise d'un rapport existant.
async function creerDepuisDescription(description = null, nom = null) {
  const zoneTexte = h('textarea', { class: 'sql', rows: 18, spellcheck: false }, description ? JSON.stringify(description, null, 2) : '')
  const valeur = await fenetre({
    titre: nom ? 'Modifier le rapport' : 'Créer un rapport depuis sa description',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, 'Description du rapport (format donné dans l’aide « Rapports ») : titre, requête, paramètres, colonnes, groupes, totaux.'),
      zoneTexte),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: nom ? 'Refaire le rapport' : 'Créer le rapport', classe: 'principal', action: () => zoneTexte.value },
    ],
  })
  if (!valeur) return
  let lue
  try {
    lue = JSON.parse(valeur)
  } catch {
    return notifier('Description illisible : ce doit être du JSON.', 'erreur')
  }
  await creerRapport(lue, nom)
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
    location.hash = `#/rapports/${encodeURIComponent(resultat.nom)}`
    window.birtec.recharger()
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
