// « Aperçu d'un export » : un fichier Excel ou CSV (le résultat d'une requête lancée ailleurs, un export de la
// GMAO…) affiché en tableau, trié d'un clic sur une colonne et filtré en tapant. Rien n'est envoyé.
import { h, vider, ic, notifier, nombreFr } from '/socle/ui.js'

let charge = null // { nom, entetes, lignes }
const MAX = 2000

function lireCsv(octets) {
  let texte
  try {
    texte = new TextDecoder('utf-8', { fatal: true }).decode(octets)
  } catch {
    texte = new TextDecoder('windows-1252').decode(octets)
  }
  return XLSX.read(texte, { type: 'string', raw: true })
}

async function lire(fichier) {
  const octets = new Uint8Array(await fichier.arrayBuffer())
  const classeur = /\.(csv|txt)$/i.test(fichier.name) ? lireCsv(octets) : XLSX.read(octets, { type: 'array', cellDates: true })
  const feuille = classeur.Sheets[classeur.SheetNames[0]]
  const tableau = XLSX.utils.sheet_to_json(feuille, { header: 1, raw: false, defval: '' })
  const [entetes = [], ...lignes] = tableau.filter((l) => l.some((v) => String(v).trim()))
  return { nom: fichier.name, entetes: entetes.map((e, i) => String(e || `Colonne ${i + 1}`)), lignes }
}

export function apercu(zone) {
  const choix = h('input', { type: 'file', accept: '.xlsx,.xls,.ods,.csv,.txt', style: { display: 'none' } })
  const ouvrir = async (fichier) => {
    if (!fichier) return
    try {
      charge = await lire(fichier)
      dessiner()
    } catch (erreur) {
      notifier(`Fichier illisible : ${erreur.message}`, 'erreur')
    }
  }
  choix.addEventListener('change', () => ouvrir(choix.files[0]))
  const corps = h('div')
  const carte = h('div', { class: 'carte' },
    h('div', { class: 'carte-entete' }, h('h2', {}, ic('tableau', 18), 'Aperçu d’un export'),
      h('div', { class: 'actions' }, h('button', { class: 'petit', onclick: () => choix.click() }, ic('dossier', 14), 'Ouvrir un fichier'))),
    choix, corps)
  carte.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation() })
  carte.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); ouvrir(e.dataTransfer.files[0]) })
  vider(zone, carte)

  let tri = { col: -1, sens: 1 }
  const filtre = h('input', { type: 'search', placeholder: 'Filtrer (tous les mots, dans toutes les colonnes)…' })
  const resultat = h('div')
  function dessinerTable() {
    const mots = filtre.value.trim().toLowerCase().split(/\s+/).filter(Boolean)
    let lignes = charge.lignes.filter((l) => mots.every((m) => l.some((v) => String(v).toLowerCase().includes(m))))
    if (tri.col >= 0) {
      const nombre = (v) => { const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && String(v).trim() !== '' ? n : null }
      lignes = [...lignes].sort((a, b) => {
        const [x, y] = [a[tri.col], b[tri.col]]
        const [nx, ny] = [nombre(x), nombre(y)]
        return (nx !== null && ny !== null ? nx - ny : String(x).localeCompare(String(y), 'fr', { numeric: true })) * tri.sens
      })
    }
    vider(resultat,
      h('p', { class: 'discret' }, `${nombreFr(lignes.length)} ligne${lignes.length > 1 ? 's' : ''}${lignes.length > MAX ? ` (les ${nombreFr(MAX)} premières affichées)` : ''}`),
      h('div', { class: 'tableau-conteneur', style: { maxHeight: '65vh' } },
        h('table', { class: 'tableau' },
          h('thead', {}, h('tr', {}, charge.entetes.map((e, i) => h('th', { class: 'triable', title: 'Trier (un 2e clic inverse)', onclick: () => { tri = { col: i, sens: tri.col === i ? -tri.sens : 1 }; dessinerTable() } }, e, tri.col === i ? (tri.sens > 0 ? ' ▲' : ' ▼') : '')))),
          h('tbody', {}, lignes.slice(0, MAX).map((l) => h('tr', {}, charge.entetes.map((_, i) => h('td', {}, String(l[i] ?? '')))))))))
  }
  filtre.addEventListener('input', dessinerTable)
  function dessiner() {
    if (!charge) return vider(corps, h('div', { class: 'depot-eco petit-depot' }, ic('tableau', 30), h('p', {}, 'Glissez ici un fichier Excel, LibreOffice ou CSV : il s’affiche en tableau, trié et filtré. Il ne quitte pas le poste.')))
    vider(corps, h('div', { class: 'filtres-eco' }, h('b', {}, charge.nom), filtre), resultat)
    dessinerTable()
  }
  dessiner()
}
