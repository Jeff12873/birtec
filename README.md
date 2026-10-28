# BiRTEC

Application de la suite **[KTEC](https://github.com/Jeff12873/ktec)** : elle s'ouvre depuis le portail KTEC, qui lui
fournit l'IA, la connexion MySQL (commune à toutes les applications) et le fichier de connaissances `.ktec`.

Assistant IA pour écrire les requêtes SQL et concevoir les rapports **Eclipse BIRT 4.x** de la GMAO,
à partir de la vraie structure de la base **MySQL**. L'IA (un modèle libre, Qwen3.5) tourne sur le poste :
rien ne sort de l'entreprise.

- **Connexion MySQL en lecture seule** : réglée par l'administrateur dans KTEC, chiffrée dans le fichier de connaissances ;
  seules les requêtes de lecture sont acceptées.
- **Accueil** : indicateurs du jour et raccourcis de rapports, à organiser par glisser-déposer.
- **Nouveau rapport** (la façon simple) : un formulaire en 4 étapes (sujet, colonnes ou synthèse, filtres,
  présentation) avec aperçu en direct ; BiRTEC écrit lui-même le SQL à partir du dictionnaire et des liens.
  « Remplir avec l'IA » pré-remplit le formulaire d'après une phrase (l'IA comprend, BiRTEC choisit les champs
  et cherche la valeur exacte des filtres dans la base). Filtres : valeurs, périodes, comparaison entre deux colonnes.
  Le même formulaire crée les **indicateurs ITM** (requête indicateur + requête liste, essayées et concordantes).
- **Question libre** : l'IA explique la base ou écrit une requête inhabituelle (calcul, sous-requête). Chaque
  requête est contrôlée sur la vraie structure (tables, colonnes, alias) et réécrite en cas d'erreur ; l'IA raisonne
  avant d'écrire du SQL et reçoit les chemins de jointure calculés.
- **Rapports** : fichiers `.rptdesign` vérifiés dans le moteur BIRT, aperçu avec paramètres, export PDF, Excel, Word,
  HTML, LibreOffice ou PowerPoint.
- **Indicateurs ITM** : requête indicateur (`VAL`) et requête liste associée, tirées d'une même définition, essayées
  sur la base (chiffre = nombre de lignes, pas de doublon, état filtré), à coller dans la GMAO.
- **Connaissances** : tout ce que BiRTEC sait du site (conventions, structure de la base, liens, requêtes, rapports
  modèles, bibliothèques) est rangé dans **le fichier `.ktec`** (commun aux applications KTEC), hors du programme. Ce dépôt ne contient aucune donnée
  de site : c'est une coquille vide.
- **Base de données** : tables à donner ou non à l'IA, dictionnaire (noms clairs, descriptions), console SQL, extraction.
- **Constellation** : toutes les tables en bulles et leurs liens (zoom, bulles figées, clés de liaison), chemin le
  plus court entre deux tables, impression PDF.
- **Extraction** : les tables choisies (ou celles d'un chemin de la Constellation) téléchargées en CSV dans un .zip,
  avec leur structure et les noms clairs du dictionnaire.
- Windows et Linux, installé dans le profil de l'utilisateur, **version hors ligne** sur clé USB.

Aspect des rapports : charte du fichier `.ktec` (couleurs, feuille de style, logo, conventions de connexion),
thèmes au choix, image centrée en haut, description en en-tête ou en pied. À venir : graphiques.

## Installer sur un poste

BiRTEC s'installe avec KTEC : voir le [dépôt ktec](https://github.com/Jeff12873/ktec). KTEC installe une seule fois
ce que les applications partagent (moteur d'IA et modèle, Java 21, moteur BIRT, pilote MySQL).

À chaque envoi sur `main`, GitHub fabrique `birtec.zip` (l'application seule) et le publie dans les Releases : c'est
ce paquet que l'installateur KTEC télécharge.

## Développer

Aucune dépendance npm : seulement Node 24, et un dossier KTEC à côté. Dans le `reglages-poste.json` de KTEC :

```json
{ "applisDev": ["/chemin/vers/BiRTEC"] }
```

puis `node serveur/demarrer.js` dans KTEC, et ouvrir http://127.0.0.1:47700/birtec/.

| Dossier | Contenu |
|---|---|
| `app.json` | Nom, description, icône, composants nécessaires (Java, BIRT, IA) |
| `blocs/<écran>/` | `serveur.js` (routes), `vue.js` (écran) : accueil, constructeur, rapports, itm, base, schema, connaissances, assistant, configuration, aide |
| `interface/` | Menu (`menu.js`), styles propres (`app.css`), icône, pages d'aide |

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Composants tiers

llama.cpp (MIT), modèles Qwen (Apache 2.0), Eclipse Temurin (GPLv2 + exception Classpath), Eclipse BIRT (EPL 2.0),
MySQL Connector/J (GPLv2 + exception FOSS) : tous installés par KTEC, jamais inclus dans ce dépôt.
Tracés d'icônes Lucide (ISC).
