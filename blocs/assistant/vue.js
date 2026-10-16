// L'assistant : une discussion avec l'IA, qui connaît la structure de la base MySQL et le site.
// C'est le point d'entrée unique : requêtes SQL, rapports BIRT et indicateurs ITM.
// Sous chaque requête SQL proposée : Exécuter (résultat affiché sous la requête), Console, Copier.
// Sous une description de rapport : « Créer le rapport » ; sous une définition d'indicateur : « Créer l'indicateur ».
// La conversation est gardée sur ce poste.

import { h, vider, ic, notifier, fenetre } from '/socle/ui.js'
import { api, flux } from '/socle/api.js'
import { texteIA } from '/socle/texte-ia.js'
import { etat } from '/socle/etat.js'
import { tableauResultats } from '/blocs/base/vue.js'
import { creerRapport } from '/blocs/rapports/vue.js'

const SUGGESTIONS = [
  'Quelles tables contiennent les interventions et comment sont-elles liées ?',
  'Calcule le MTBF par équipement sur 12 mois',
  'Explique-moi à quoi sert la table des mouvements de stock',
  'Les pièces dont le stock réel est sous le stock minimum, avec leur valeur',
]

// Conversation en cours : [{ role: 'agent' | 'assistant', contenu }]
let conversation = lireConversation()
let contexte = { tables: [], notes: [], requetes: [] } // ce que l'IA a reçu pour la dernière question
let enCours = null // AbortController de la réponse en cours

export default {
  chemin: 'assistant',
  titre: 'Question libre',
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
            h('h2', { style: { color: 'var(--texte)', marginBottom: '6px' } }, 'Une question sur la base ou une requête inhabituelle ?'),
            h('p', {}, 'Pour un rapport ou un indicateur courant, le formulaire « Nouveau rapport » est plus simple et plus sûr. Ici : expliquer une table, écrire un calcul (MTBF…), comprendre une requête.'),
            h('p', {}, h('a', { class: 'bouton', href: '#/constructeur' }, ic('plus', 16), 'Nouveau rapport ou indicateur')),
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
          if (type === 'reflexion') reponse.reflexion = (reponse.reflexion || 0) + donnees
          if (type === 'texte') reponse.contenu += donnees
          // BiRTEC a trouvé une table ou une colonne inexistante : la réponse est réécrite.
          if (type === 'correction') {
            reponse.contenu = ''
            reponse.corrections = (reponse.corrections || 0) + 1
          }
          if (type === 'avertissement') reponse.alertes = donnees.erreurs
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
          h('div', { class: 'actions', style: { marginBottom: '16px' } },
            h('button', { onclick: nouvelleConversation }, ic('plus', 16), 'Nouvelle conversation'),
            h('button', { class: 'discret', title: 'Comment l’IA doit mener la discussion', onclick: modifierConsignes }, ic('crayon', 16), 'Consignes'),
          ),
          h('h3', { style: { marginBottom: '8px' } }, 'Donné à l’IA'),
          panneauTables,
          h('h3', { style: { margin: '22px 0 8px' } }, 'Bon à savoir'),
          h('ul', { class: 'texte-2', style: { paddingLeft: '18px', fontSize: '14px', margin: 0 } },
            h('li', {}, 'Sous chaque requête : « Exécuter » pour voir le résultat, « Console » pour la retoucher.'),
            h('li', {}, 'Les requêtes ne peuvent que lire la base : rien n’est jamais modifié.'),
            h('li', {}, 'Chaque requête est contrôlée sur la vraie structure ; une colonne inexistante fait réécrire la réponse.'),
            h('li', {}, 'Les rapports et indicateurs créés sont gardés dans les onglets Rapports et Indicateurs ITM.'),
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

// L'assistant peut finir par « CHOIX : réponse 1 | réponse 2 » (boutons, une réponse)
// et/ou « OPTIONS : complément 1 | complément 2 » (cases à cocher, réponses oui / non).
function separerChoix(contenu) {
  const lignes = contenu.split('\n')
  const lire = (mot) => {
    const index = lignes.findIndex((l) => new RegExp(`^\\s*\\**${mot}\\**\\s*:`, 'i').test(l))
    if (index < 0) return []
    const valeurs = lignes[index].replace(new RegExp(`^\\s*\\**${mot}\\**\\s*:\\s*`, 'i'), '').split('|').map((c) => c.trim()).filter(Boolean)
    lignes.splice(index, 1)
    return valeurs
  }
  const choix = lire('CHOIX')
  const options = lire('OPTIONS')
  return { texte: lignes.join('\n'), choix, options }
}

function dessinerOptions(options, envoyer) {
  const cases = options.map((o) => ({ o, c: h('input', { type: 'checkbox' }) }))
  return h('div', { class: 'carte-rapport', style: { marginTop: '10px' } },
    h('div', { class: 'discret', style: { fontSize: '13px', marginBottom: '6px' } }, 'Compléments proposés :'),
    cases.map(({ o, c }) => h('label', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '4px 0' } }, c, o)),
    h('div', { class: 'actions', style: { marginTop: '8px' } },
      h('button', {
        class: 'petit principal',
        onclick: () => {
          const oui = cases.filter((x) => x.c.checked).map((x) => x.o)
          const non = cases.filter((x) => !x.c.checked).map((x) => x.o)
          envoyer(`${oui.length ? `Je retiens : ${oui.join(' ; ')}.` : 'Je ne retiens aucun complément.'}${non.length && oui.length ? ` Je ne retiens pas : ${non.join(' ; ')}.` : ''}`)
        },
      }, ic('coche', 14), 'Valider'),
    ),
  )
}

function dessinerMessage(message, envoyer) {
  if (message.role === 'agent') return h('div', { class: 'message agent' }, message.contenu)

  const { texte: contenu, choix, options } = separerChoix(message.contenu)
  const texte = h('div', { class: `texte-ia ${message.enCours ? 'curseur' : ''}`, html: contenu ? texteIA(contenu) : '' })
  if (!message.contenu && message.enCours) {
    texte.innerHTML = message.reflexion
      ? `<p class="discret">L’IA réfléchit à la requête… (${Math.round(message.reflexion / 4)} mots de raisonnement)</p>`
      : '<p class="discret">L’IA lit la structure de la base…</p>'
  }
  if (!message.enCours) for (const bloc of texte.querySelectorAll('pre.code[data-langue="sql"]')) ajouterActionsSQL(bloc)
  if (!message.enCours) for (const bloc of texte.querySelectorAll('pre.code[data-langue="rapport"], pre.code[data-langue="json"]')) ajouterActionsRapport(bloc)
  if (!message.enCours) for (const bloc of texte.querySelectorAll('pre.code[data-langue="indicateur"]')) ajouterActionsIndicateur(bloc)

  return h(
    'div',
    { class: 'message ia' },
    h('div', { class: 'avatar' }, ic('oiseau', 20)),
    h(
      'div',
      { class: 'corps' },
      message.corrections ? h('div', { class: 'discret', style: { fontSize: '12px', marginBottom: '6px' } }, ic('coche', 12), ` Réponse vérifiée et corrigée par BiRTEC (${message.corrections} fois) : une requête citait une table ou une colonne inexistante.`) : null,
      texte,
      message.alertes?.length ? h('div', { class: 'bandeau', style: { marginTop: '8px' } }, ic('alerte'), h('span', {}, 'Erreurs restantes après correction : ', message.alertes.join(' — '))) : null,
      !message.enCours && options.length && message.dernier ? dessinerOptions(options, envoyer) : null,
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

// Sous une définition d'indicateur : le résumé, et le bouton qui assemble, vérifie, essaie et enregistre.
function ajouterActionsIndicateur(bloc) {
  let definition
  try {
    definition = JSON.parse(bloc.textContent)
  } catch {
    return
  }
  bloc.style.display = 'none'
  const resultat = h('div')
  const creer = async (forcer = false) => {
    if (!etat.connexion.ouverte) notifier('Connexion MySQL fermée : l’indicateur ne pourra pas être essayé sur la base.', 'erreur')
    vider(resultat, h('p', { class: 'discret curseur' }, 'BiRTEC assemble les deux requêtes et les essaie sur la base'))
    try {
      const r = await api('/api/itm/creer', { methode: 'POST', corps: { definition, demande: definition.explication || '', forcer } })
      vider(resultat,
        r.corrections?.length ? h('p', { class: 'discret', style: { fontSize: '12px' } }, `Corrigé automatiquement ${r.corrections.length} fois.`) : null,
        r.erreurs.map((e) => h('div', { class: 'bandeau' }, ic('alerte'), e)),
        r.valeur !== undefined && r.valeur !== null ? h('p', {}, h('strong', {}, String(r.valeur)), ` fiche(s) aujourd’hui — liste de ${r.liste?.total ?? '?'} ligne(s).`) : null,
        r.id
          ? h('div', { class: 'actions' }, h('a', { class: 'bouton petit principal', href: `#/itm/${r.id}` }, ic('graphique', 14), 'Ouvrir l’indicateur (requêtes à copier)'))
          : h('div', { class: 'actions' }, h('button', { class: 'petit', onclick: () => creer(true) }, 'Enregistrer quand même')),
      )
      if (r.id) notifier(`Indicateur « ${r.definition.nom} » enregistré`)
    } catch (erreur) {
      vider(resultat, h('div', { class: 'bandeau' }, ic('alerte'), erreur.message))
    }
  }
  bloc.before(
    h('div', { class: 'carte-rapport' },
      h('strong', {}, ic('graphique', 15), ' ', definition.nom || 'Indicateur'),
      h('div', { class: 'texte-2', style: { fontSize: '13px', margin: '4px 0 8px' } },
        `Compte les fiches de la table ${definition.table || definition.fenetre || '?'}`, definition.explication ? ` — ${definition.explication}` : ''),
      h('div', { class: 'actions' },
        h('button', { class: 'petit principal', onclick: () => creer() }, ic('graphique', 14), 'Créer l’indicateur'),
        h('button', { class: 'petit discret', onclick: () => { bloc.style.display = bloc.style.display ? '' : 'none' } }, 'Voir la définition'),
      ),
      resultat,
    ),
  )
}

// La démarche que suit l'IA (gardée dans le fichier .birtec).
async function modifierConsignes() {
  const { consignes, parDefaut } = await api('/api/assistant/consignes')
  const zoneTexte = h('textarea', { rows: 14, style: { width: '100%' } }, consignes)
  const ok = await fenetre({
    titre: 'Consignes de l’IA',
    large: true,
    contenu: h('div', {},
      h('p', { class: 'texte-2' }, 'Comment l’assistant doit interpréter vos demandes et mener la discussion avant de créer un rapport ou un indicateur. Gardées dans le fichier .birtec.'),
      zoneTexte,
      h('div', { class: 'actions', style: { marginTop: '8px' } }, h('button', { class: 'petit discret', onclick: () => { zoneTexte.value = parDefaut } }, 'Revenir aux consignes par défaut'))),
    boutons: [
      { texte: 'Annuler', classe: 'discret', valeur: null },
      { texte: 'Enregistrer', classe: 'principal', action: () => api('/api/assistant/consignes', { methode: 'POST', corps: { consignes: zoneTexte.value } }).then(() => true) },
    ],
  })
  if (ok) notifier('Consignes enregistrées')
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
