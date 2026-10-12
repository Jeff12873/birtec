// Mise en forme des réponses de l'IA (elle écrit en « Markdown » simple) :
// titres, gras, listes, tableaux, code, blocs de code (```sql … ```), et renvois aux sources [1], [2]…
// Le texte est d'abord échappé : l'IA ne peut pas injecter de HTML dans la page.

const echapper = (texte) => texte.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function enLigne(texte) {
  return echapper(texte)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[(\d{1,2})\]/g, '<span class="renvoi" data-source="$1">$1</span>')
}

export function texteIA(texte) {
  const lignes = texte.replace(/\r/g, '').split('\n')
  let html = ''
  let liste = null // 'ul' ou 'ol'
  let tableau = []

  const fermerListe = () => {
    if (liste) html += `</${liste}>`
    liste = null
  }
  const fermerTableau = () => {
    if (!tableau.length) return
    const lignesTableau = tableau.filter((l) => !/^\s*\|?\s*:?-{2,}/.test(l))
    const cellules = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => enLigne(c.trim()))
    const [entete, ...corps] = lignesTableau
    html += '<table><thead><tr>' + cellules(entete).map((c) => `<th>${c}</th>`).join('') + '</tr></thead><tbody>'
    html += corps.map((l) => '<tr>' + cellules(l).map((c) => `<td>${c}</td>`).join('') + '</tr>').join('')
    html += '</tbody></table>'
    tableau = []
  }

  let code = null // bloc de code en cours : { langue, lignes }
  for (const ligne of lignes) {
    const borne = ligne.match(/^\s*```\s*([\w-]*)/)
    if (borne) {
      if (code) {
        html += `<pre class="code" data-langue="${echapper(code.langue)}"><code>${echapper(code.lignes.join('\n'))}</code></pre>`
        code = null
      } else {
        fermerListe()
        fermerTableau()
        code = { langue: borne[1].toLowerCase(), lignes: [] }
      }
      continue
    }
    if (code) {
      code.lignes.push(ligne)
      continue
    }
    if (/^\s*\|.*\|\s*$/.test(ligne)) {
      fermerListe()
      tableau.push(ligne)
      continue
    }
    fermerTableau()

    let m
    if ((m = ligne.match(/^\s*#{1,4}\s+(.*)/))) {
      fermerListe()
      html += `<p><strong>${enLigne(m[1])}</strong></p>`
    } else if ((m = ligne.match(/^\s*[-*•]\s+(.*)/))) {
      if (liste !== 'ul') {
        fermerListe()
        html += '<ul>'
        liste = 'ul'
      }
      html += `<li>${enLigne(m[1])}</li>`
    } else if ((m = ligne.match(/^\s*(\d+)[.)]\s+(.*)/))) {
      if (liste !== 'ol') {
        fermerListe()
        html += `<ol start="${m[1]}">`
        liste = 'ol'
      }
      html += `<li>${enLigne(m[2])}</li>`
    } else if (ligne.trim() === '') {
      fermerListe()
    } else {
      fermerListe()
      html += `<p>${enLigne(ligne)}</p>`
    }
  }
  // Bloc de code pas encore fermé (réponse en cours d'écriture) : on l'affiche quand même.
  if (code) html += `<pre class="code" data-langue="${echapper(code.langue)}"><code>${echapper(code.lignes.join('\n'))}</code></pre>`
  fermerListe()
  fermerTableau()
  return html
}
