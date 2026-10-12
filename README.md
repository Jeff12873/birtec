# BiRTEC

Assistant IA pour écrire les requêtes SQL et concevoir les rapports **Eclipse BIRT 4.x** de la GMAO,
à partir de la vraie structure de la base **MySQL**. L'IA (un modèle libre, Qwen3.5) tourne sur le poste :
rien ne sort de l'entreprise.

- **Connexion MySQL en lecture seule** : le mot de passe est demandé à chaque ouverture, jamais enregistré ;
  seules les requêtes de lecture sont acceptées.
- **Assistant** : décrit en français ce que vous voulez, il choisit les tables utiles, écrit la requête, et
  « Exécuter » montre le résultat tout de suite.
- **Base de données** : tables, colonnes, liens, premières lignes, console SQL.
- **Configuration** : connexion, rapports modèles, bibliothèques et ressources BIRT.
- Windows et Linux, installé dans le profil de l'utilisateur, **version hors ligne** sur clé USB.

À venir : création des fichiers `.rptdesign` d'après vos rapports modèles, aperçu et export (PDF, Excel, Word…),
modification de rapports existants, onglet « Création d'indicateurs ITM ».

## Installer sur un poste

- **Avec Internet** : télécharger [BiRTEC.zip](https://github.com/Jeff12873/birtec/releases/latest/download/BiRTEC.zip),
  le décompresser, puis `Preparer BiRTEC.bat` (Windows) ou `sh preparer-birtec.sh` (Linux).
- **Sans Internet** : kit hors ligne fabriqué par `Fabriquer kit hors ligne.bat` ou `sh fabriquer-kit-hors-ligne.sh`
  sur un PC connecté, copié sur clé USB : voir [docs/HORS-LIGNE.md](docs/HORS-LIGNE.md).

La préparation installe dans le profil : le moteur d'IA (llama.cpp) et son modèle, Java 21, le moteur BIRT
et le pilote MySQL. Si IASSITEC est installé sur le poste, ses modèles d'IA sont réutilisés.

## Développer

Aucune dépendance npm, aucune compilation côté Node : seulement Node 24.

```sh
node outils/preparer.js --ici --sans-raccourcis   # une fois : IA, Java, BIRT, pilote MySQL
node serveur/demarrer.js                          # lance BiRTEC (http://127.0.0.1:47900)
```

| Dossier | Contenu |
|---|---|
| `serveur/socle/` | Serveur web, IA (`ia.js`), connexion MySQL (`mysql.js`), réglages, téléchargements |
| `moteur-java/Moteur.java` | Le programme Java : connexion, structure de la base, requêtes en lecture seule (puis moteur BIRT) |
| `blocs/<écran>/` | `serveur.js` (routes), `vue.js` (écran) : assistant, base, configuration, aide |
| `interface/` | Page, thème vert (`theme.css`), icône, outils d'écran, aide |
| `outils/` | Préparation d'un poste, catalogue des versions, fabrication du kit hors ligne |

Voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Composants tiers

llama.cpp (MIT), modèles Qwen (Apache 2.0), Eclipse Temurin (GPLv2 + exception Classpath), Eclipse BIRT (EPL 2.0),
MySQL Connector/J (GPLv2 + exception FOSS) : tous téléchargés par la préparation, jamais inclus dans ce dépôt.
Tracés d'icônes Lucide (ISC).
