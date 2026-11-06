// Les visites guidées de BiRTEC (moteur : /socle/visite.js de K.NOVA), lancées depuis le wiki par
// « Voir le cas d'usage » (/birtec/#/schema?visite=<id>). Les tables et champs sont pris dans la base du site
// (window.birtecPhrase.exemple(), blocs/schema/vue.js) : aucun nom de table n'est écrit ici.

const phrase = () => window.birtecPhrase
let ex = null // la table d'exemple, choisie au début de la visite

// Le panneau de fin : « Et maintenant ? » (administrateur), sinon le titre « Chemin de la phrase » et ce qui suit.
function panneauFinal() {
  const et = document.querySelector('.et-maintenant')
  if (et) return et
  return [...document.querySelectorAll('h2')].find((t) => /Chemin de la phrase/.test(t.textContent))?.parentElement || null
}

export const visites = {
  'composer-une-phrase': {
    titre: 'Composer une phrase',
    etapes: [
      {
        attendre: '.ligne-depart-phrase',
        cible: '.ligne-depart-phrase',
        titre: 'Tout part de LA PHRASE',
        texte: 'On dit en français ce qu’on veut consulter, choix par choix : pas de SQL, pas d’IA. Je vais composer une phrase devant vous.',
        avant: async () => { ex = phrase()?.exemple() },
      },
      {
        cible: '.ligne-depart-phrase',
        titre: 'Ce qu’on consulte',
        avant: () => ex && phrase().choisirDepart(ex.table),
        texte: () => (ex ? `Je choisis « ${ex.libelle} » : une table principale de votre base, un objet métier.` : 'Choisissez la table à consulter dans cette liste.'),
      },
      {
        attendre: '.compteur-phrase',
        cible: '.resultat-phrase',
        titre: 'Le compteur et l’aperçu',
        texte: 'Le nombre de lignes et les premières lignes s’affichent tout de suite, et suivent chaque choix.',
      },
      {
        cible: '.conditions-phrase',
        titre: 'Une condition',
        avant: () => ex && phrase().ajouterCondition({ table: ex.table, colonne: ex.date, op: 'egal', quand: 'derniers', valeurs: ['3', 'mois'] }),
        texte: () => (ex ? `« qui ont ${ex.libelleDate} dans les derniers 3 mois » : un champ de date a ses propres choix, et la période suit le calendrier.` : 'Les conditions s’ajoutent avec « qui… ».'),
      },
      {
        attendre: '.compteur-phrase',
        cible: '.compteur-phrase',
        titre: 'Le compteur a suivi',
        texte: 'Moins de lignes : seules celles des 3 derniers mois restent. On peut ajouter d’autres conditions (et qui…, OU un autre cas, groupe).',
      },
      {
        cible: '.liste-conditions .ajouts-condition',
        titre: 'Aller plus loin',
        texte: '« et qui… » ajoute une condition à remplir aussi ; « OU un autre cas » garde aussi les lignes d’un autre cas ; « ( groupe ) » lit des conditions ensemble.',
      },
      {
        // « Et maintenant ? » est réservé à l'administrateur ; sinon on montre le chemin de la phrase.
        attendre: () => panneauFinal(),
        cible: () => panneauFinal(),
        titre: 'Et maintenant ?',
        texte: () => (document.querySelector('.et-maintenant')
          ? 'La phrase est prête : en faire un rapport BIRT, un indicateur GMAO, enregistrer son SQL ou extraire pour Excel. À vous de jouer !'
          : 'Le chemin de la phrase s’est allumé dans la constellation. En mode administrateur, « Et maintenant ? » en fait un rapport BIRT, un indicateur GMAO, un SQL ou un classeur Excel.'),
      },
    ],
  },
}
