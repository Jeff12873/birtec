# Architecture

BiRTEC est une application **KTEC** : le portail KTEC ([dépôt ktec](https://github.com/Jeff12873/ktec)) fournit le
serveur web, la coquille de l'interface, l'IA, la connexion MySQL, le moteur Java et le fichier de connaissances `.ktec`.
Ce dépôt ne contient que ce qui est propre à BiRTEC.

```
navigateur ──► KTEC (127.0.0.1:47700) ──► /api/birtec/…  (routes des blocs de BiRTEC)
                    │
                    ├──► llama.cpp (IA, commune)
                    ├──► fichier .ktec (SQLite : connaissances du site, communes)
                    └──► java Moteur <commande> ──► MySQL (lecture seule)
                                               └──► moteur BIRT (vérification, aperçu, exports)
```

- `app.json` décrit l'application au portail ; `interface/menu.js` donne la liste des écrans à la coquille commune ;
  `interface/app.css` ajoute les styles propres à BiRTEC au thème commun.
- Les blocs importent le socle commun par `ktec/…` côté serveur (`import { lireInfo } from 'ktec/ktec.js'`) et par
  `/socle/…` côté écran. Leurs routes `/api/…` sont rangées par KTEC sous `/api/birtec/…` ; côté écran, `api()` et
  `adresse()` ajoutent ce préfixe d'eux-mêmes.
- **Fichier .ktec** (socle `ktec.js`) : notes, structure des tables, liens, requêtes, dictionnaire, indicateurs et
  fichiers BIRT du site. Le programme ne contient aucune donnée du site ; tout est dans ce fichier, hors du dépôt.
  Importation d'un dossier : `blocs/connaissances/importation.js`.
- **Constructeur** (`blocs/constructeur/`) : `catalogue.js` liste les sujets (tables en forme de fiche) et, pour un
  sujet, les champs atteignables par les liens (meilleur chemin par table, liens nommés d'abord, tables filles décrites) ;
  `requete.js` écrit le SQL (jointures, filtres, périodes, synthèse) ; l'IA ne sert qu'à pré-remplir le formulaire.
- **Contrôle du SQL** (`blocs/base/verification.js`) : tables, colonnes et alias de chaque requête écrite par l'IA,
  avec les tables qui ont la colonne cherchée ; utilisé par l'assistant, les rapports et les indicateurs.
- **Dictionnaire** (tables `dictionnaire` et `liens_dico` du .ktec) : noms clairs, descriptions, tables écartées ;
  appliqué à la structure par `blocs/base/schema.js`, qui calcule aussi les chemins de jointure (`cheminsDeJointure`).
- **Assistant** (`blocs/assistant/serveur.js`) : pour chaque question, `blocs/base/schema.js` choisit les tables utiles
  (mots de la question, tables citées par les conventions et par les requêtes du site proches de la question, tables liées)
  et donne à l'IA les conventions (notes « toujours »), les notes et requêtes du site en rapport, et la structure.
- **Rapports** (`blocs/rapports/`) : `generateur.js` transforme une description JSON (écrite par l'IA) en `.rptdesign`
  (format BIRT 4.8 ; aspect, source de données, profil de connexion et paramètres cachés selon la « charte » du .ktec) ; `serveur.js` le
  vérifie, le fait tourner, demande à l'IA de corriger la description en cas d'erreur (2 essais), puis aperçu et exports.

- **Indicateurs ITM** (`blocs/itm/`) : `indicateur.js` assemble la requête indicateur et la requête liste à partir d'une
  définition (jointures, conditions, date, tri) ; `serveur.js` fait écrire la définition par l'IA, essaie les deux
  requêtes (variables de la GMAO remplacées par leurs valeurs d'essai) et fait corriger en cas d'écart.
  Fenêtres et variables de la GMAO : réglage « itm » du .ktec.

Réglages du poste (`reglages-poste.json` de KTEC) : connexion MySQL sans mot de passe, dossier de travail, fichier .ktec.
Dossier de travail (par défaut `Documents/KTEC`) : `rapports/` (avec la description `<nom>.birtec.json` de chaque
rapport) et `connaissances.ktec`. Au premier lancement de KTEC, l'ancien `Documents/BiRTEC/connaissances.birtec` et ses
rapports sont copiés là (l'original reste en place).
