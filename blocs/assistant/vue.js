// L'assistant : une discussion avec l'IA, qui connaît la structure de la base MySQL.
// Sous chaque requête SQL proposée : Exécuter (résultat affiché sous la requête), Console, Copier.
// La conversation est gardée sur ce poste.

import { h, vider, ic, notifier } from '/socle/ui.js'
import { api, flux } from '/socle/api.js'
import { texteIA } from '/socle/texte-ia.js'
import { etat } from '/socle/etat.js'
import { tableauResultats } from '/blocs/base/vue.js'
import { creerRapport } from '/blocs/rapports/vue.js'

const SUGGESTIONS = [
  'Liste des ordres de travail du mois, par équipement, avec le total des heures',
  'Quelles tables contiennent les interventions et comment sont-elles liées ?',
  'Écris une requête avec un paramètre de période pour un rapport BIRT',
  'Comment faire un total par groupe dans un tableau BIRT ?',
]

// Conversation en cours : [{ role: 'agent' | 'assistant', contenu }]
let conversation = lireConversation()
let contexte = { tables: [], notes: [], requetes: [] } // ce que l'IA a reçu pour la dernière question
let enCours = null // AbortController de la réponse en cours

export default {
  chemin: 'assistant',
  titre: 'Assistant IA',
  icone: 'etincelle',
  menu: true,
  aide: 'assistant',
  rafraichir: false, // ne pas recharger l'écran pendant une discussion

  async afficher(zone) {
    const panneauTables = h('div', { class: 'texte-2', style: { fontSize: '14px' } })
    const dessinerTables = () =>
      vider(panneauTables, contexte.tables.length || contexte.notes.length
        ? [
            contexte.tables.map((t) => h('div', {}, h('a', { href: `#/base/${encodeURIComponent(t)}`, class: 'mono' }, t))),
            contexte.notes.length ? h('h4', { style: { margin: '12px 0 4px' } }, 'Notes du site') : null,
            contexte.notes.map((n) => h('div', { class: 'discret' }, n)),
            contexte.requetes.length ? h('h4', { style: { margin: '12px 0 4px' } }, 'Requêtes du site') : null,
            contexte.requetes.map((r) => h('div', { class: 'discret' }, r)),
          ]
        : h('span', { class: 'discret' }, 'Les tables, notes et requêtes données à l’IA s’afficheront ici.'))
    dessinerTables()

    const messages = h('div', { class: 'messages' })
    const saisie = h('textarea', {
      placeholder: 'Posez votre question… (Entrée pour envoyer, Maj + Entrée pour aller à la ligne)',
      rows: 2,
      onkeydown: (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          envoyer()
        }
      },
      oninput: () => {
        saisie.style.height = 'auto'
        saisie.style.height = Math.min(220, saisie.scrollHeight) + 'px'
      },
    })
    const boutonEnvoyer = h('button', { class: 'principal', title: 'Envoyer', onclick: () => (enCours ? arreter() : envoyer()) }, ic('avion', 18))

    function dessinerMessages() {
      vider(messages)
      if (!conversation.length) {
        messages.append(
          h(
            'div',
            { class: 'vide', style: { paddingTop: '60px' } },
            ic('oiseau', 44),
            h('h2', { style: { color: 'var(--texte)', marginBottom: '6px' } }, 'Quel rapport voulez-vous construire ?'),
            h('p', {}, 'L’assistant connaît la structure de votre base MySQL : il écrit les requêtes, les explique et aide à concevoir les rapports BIRT.'),
            h('div', { class: 'suggestions', style: { justifyContent: 'center', marginTop: '18px' } }, SUGGESTIONS.map((s) => h('button', { onclick: () => envoyer(s) }, s))),
          ),
        )
        return
      }
      conversation.forEach((message, i) => messages.append(dessinerMessage({ ...message, dernier: i === conversation.length - 1 }, envoyer)))
    }

    async function envoyer(texte) {
      const question = (texte ?? saisie.value).trim()
      if (!question || enCours) return
      saisie.value = ''
      saisie.style.height = 'auto'

      const historique = conversation.map((m) => ({ role: m.role, contenu: m.contenu }))
      conversation.push({ role: 'agent', contenu: question })
      const reponse = { role: 'assistant', contenu: '', enCours: true }
      conversation.push(reponse)
      dessinerMessages()
      let element = messages.lastElementChild
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const remplacer = () => {
        const nouveau = dessinerMessage(reponse, envoyer)
        element.replaceWith(nouveau)
        element = nouveau
      }

      enCours = new AbortController()
      vider(boutonEnvoyer, ic('stop', 18))
      boutonEnvoyer.title = 'Arrêter'
      try {
        await flux('/api/assistant', { question, historique }, (type, donnees) => {
          if (type === 'tables') {
            contexte = donnees
            dessinerTables()
          }
          if (type === 'texte') reponse.contenu += donnees
          if (type === 'erreur') reponse.contenu += `\n\n⚠ ${donnees.message}`
          remplacer()
        }, enCours.signal)
      } catch (erreur) {
        if (erreur.name !== 'AbortError') reponse.contenu += `\n\n⚠ ${erreur.message}`
      } finally {
        reponse.enCours = false
        enCours = null
        vider(boutonEnvoyer, ic('avion', 18))
        boutonEnvoyer.title = 'Envoyer'
        dessinerMessages()
        garderConversation()
        saisie.focus()
      }
    }

    function arreter() {
      enCours?.abort()
    }

    function nouvelleConversation() {
      arreter()
      conversation = []
      garderConversation()
      dessinerMessages()
      saisie.focus()
    }

    dessinerMessages()
    vider(
      zone,
      h(
        'div',
        { class: 'discussion' },
        h(
          'div',
          { class: 'fil' },
          !etat.ia?.installee ? h('div', { class: 'bandeau' }, ic('alerte'), "L'IA n'est pas installée sur ce poste : l'assistant montre seulement les passages trouvés. Voir l’aide « Installation ».") : null,
          messages,
          h('div', { class: 'saisie' }, h('div', { class: 'saisie-boite' }, saisie, boutonEnvoyer)),
        ),
        h(
          'div',
          { class: 'carte', style: { position: 'sticky', top: '86px' } },
          h('div', { class: 'actions', style: { marginBottom: '16px' } }, h('button', { onclick: nouvelleConversation }, ic('plus', 16), 'Nouvelle conversation')),
          h('h3', { style: { marginBottom: '8px' } }, 'Donné à l’IA'),
          panneauTables,
          h('h3', { style: { margin: '22px 0 8px' } }, 'Bon à savoir'),
          h('ul', { class: 'texte-2', style: { paddingLeft: '18px', fontSize: '14px', margin: 0 } },
            h('li', {}, 'Sous chaque requête : « Exécuter » pour voir le résultat, « Console » pour la retoucher.'),
            h('li', {}, 'Les requêtes ne peuvent que lire la base : rien n’est jamais modifié.'),
            h('li', {}, 'Précisez la période, les regroupements et les totaux voulus.'),
          ),
        ),
      ),
    )
    saisie.focus()

    // Question transmise par la page de recherche (« Poser la question à l'IA »).
    const transmise = sessionStorage.getItem('birtec-question')
    if (transmise) {
      sessionStorage.removeItem('birtec-question')
      envoyer(transmise)
    }
  },
}

// L'assistant peut finir par « CHOIX : réponse 1 | réponse 2 » : on affiche ces réponses en boutons.
function separerChoix(contenu) {
  const lignes = contenu.split('\n')
  const index = lignes.findIndex((l) => /^\s*\**CHOIX\**\s*:/i.test(l))
  if (index < 0) return { texte: contenu, choix: [] }
  const choix = lignes[index].replace(/^\s*\**CHOIX\**\s*:\s*/i, '').split('|').map((c) => c.trim()).filter(Boolean)
  return { texte: lignes.slice(0, index).join('\n'), choix }
}

function dessinerMessage(message, envoyer) {
  if (message.role === 'agent') return h('div', { class: 'message agent' }, message.contenu)

  const { texte: contenu, choix } = separerChoix(message.contenu)
  const texte = h('div', { class: `texte-ia ${message.enCours ? 'curseur' : ''}`, html: contenu ? texteIA(contenu) : '' })
  if (!message.contenu && message.enCours) texte.innerHTML = '<p class="discret">L’IA lit la structure de la base…</p>'
  if (!message.enCours) for (const bloc of texte.querySelectorAll('pre.code[data-langue="sql"]')) ajouterActionsSQL(bloc)
  if (!message.enCours) for (const bloc of texte.querySelectorAll('pre.code[data-langue="rapport"], pre.code[data-langue="json"]')) ajouterActionsRapport(bloc)

  return h(
    'div',
    { class: 'message ia' },
    h('div', { class: 'avatar' }, ic('oiseau', 20)),
    h(
      'div',
      { class: 'corps' },
      texte,
      !message.enCours && choix.length && message.dernier
        ? h('div', { class: 'suggestions', style: { marginTop: '10px' } }, choix.map((c) => h('button', { onclick: () => envoyer(c) }, c)))
        : null,
      !message.enCours && message.contenu
        ? h('div', { class: 'actions', style: { marginTop: '8px' } }, h('button', { class: 'discret petit', onclick: () => navigator.clipboard.writeText(contenu).then(() => notifier('Réponse copiée')) }, 'Copier'))
        : null,
    ),
  )
}

// Boutons sous une requête SQL : exécuter (résultat juste en dessous), ouvrir dans la console, copier.
function ajouterActionsSQL(bloc) {
  const sql = bloc.textContent
  const resultat = h('div')
  bloc.after(
    h('div', { class: 'actions-code' },
      h('button', {
        class: 'petit',
        onclick: async () => {
          if (!etat.connexion.ouverte) return notifier('Connexion MySQL fermée : saisissez le mot de passe (en haut à droite).', 'erreur')
          vider(resultat, h('p', { class: 'discret curseur' }, 'Exécution'))
          try {
            vider(resultat, tableauResultats(await api('/api/requete', { methode: 'POST', corps: { sql, limite: 50 } })))
          } catch (erreur) {
            vider(resultat, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
          }
        },
      }, ic('lecture', 14), 'Exécuter'),
      h('a', { class: 'bouton petit', href: `#/base?sql=${encodeURIComponent(sql)}` }, ic('console', 14), 'Console'),
      h('button', { class: 'petit discret', onclick: () => navigator.clipboard.writeText(sql).then(() => notifier('Requête copiée')) }, ic('copier', 14), 'Copier'),
    ),
    resultat,
  )
}

// Sous une description de rapport : le résumé, et le bouton qui fabrique le .rptdesign.
function ajouterActionsRapport(bloc) {
  let description
  try {
    description = JSON.parse(bloc.textContent)
  } catch {
    return // pas une description de rapport
  }
  if (!description?.requete || !Array.isArray(description.colonnes)) return
  bloc.style.display = 'none'
  const voir = h('button', { class: 'petit discret', onclick: () => { bloc.style.display = bloc.style.display ? '' : 'none' } }, 'Voir la description')
  bloc.before(
    h('div', { class: 'carte-rapport' },
      h('strong', {}, ic('document', 15), ' ', description.titre || 'Rapport'),
      h('div', { class: 'texte-2', style: { fontSize: '13px', margin: '4px 0 8px' } },
        `Colonnes : ${description.colonnes.map((c) => c.libelle || c.champ).join(', ')}`,
        description.groupes?.length ? ` — groupé par ${description.groupes.map((g) => g.libelle || g.champ).join(', ')}` : '',
        description.parametres?.length ? ` — paramètres : ${description.parametres.map((p) => p.libelle || p.nom).join(', ')}` : ''),
      h('div', { class: 'actions' },
        h('button', { class: 'petit principal', onclick: async (e) => { const bouton = e.currentTarget; bouton.disabled = true; await creerRapport(description); bouton.disabled = false } }, ic('document', 14), 'Créer le rapport'),
        voir,
      ),
    ),
  )
}

// La conversation survit à un changement d'écran et au rechargement de la page.
function lireConversation() {
  try {
    return JSON.parse(localStorage.getItem('birtec-conversation') || '[]')
  } catch {
    return []
  }
}

function garderConversation() {
  try {
    localStorage.setItem('birtec-conversation', JSON.stringify(conversation.slice(-40)))
  } catch {
    // stockage indisponible : la conversation ne sera simplement pas gardée
  }
}
