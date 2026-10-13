# Architecture

```
navigateur ──► serveur Node (127.0.0.1:47900) ──► llama.cpp (IA)
                         │
                         ├──► fichier .birtec (SQLite : connaissances du site)
                         └──► java Moteur <commande> ──► MySQL (lecture seule)
                                                    └──► moteur BIRT (vérification, aperçu, exports)
```

- **Node** (`serveur/`) sert l'interface, garde le mot de passe MySQL en mémoire et lance le moteur Java pour chaque
  opération : `tester`, `schema`, `requete`, `verifier`, `rendu`. Le mot de passe passe par l'entrée standard du moteur,
  jamais en option.
- **Moteur Java** (`moteur-java/Moteur.java`) : compilé par la préparation dans `moteur/classes`. Connexion en lecture
  seule, requêtes de lecture uniquement (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN), 30 s au plus. Pour `rendu`, les sources
  JDBC du rapport (et leurs profils de connexion) sont remplacées par la connexion de BiRTEC.
- **Fichier .birtec** (`serveur/socle/birtec.js`) : notes, structure des tables, liens, requêtes et fichiers BIRT du site.
  Le programme ne contient aucune donnée du site ; tout est dans ce fichier, hors du dépôt.
  Importation d'un dossier : `blocs/connaissances/importation.js`.
- **Assistant** (`blocs/assistant/serveur.js`) : pour chaque question, `blocs/base/schema.js` choisit les tables utiles
  (mots de la question, tables citées par les conventions et par les requêtes du site proches de la question, tables liées)
  et donne à l'IA les conventions (notes « toujours »), les notes et requêtes du site en rapport, et la structure.
- **Rapports** (`blocs/rapports/`) : `generateur.js` transforme une description JSON (écrite par l'IA) en `.rptdesign`
  (format BIRT 4.8, source « BDD » avec profil de connexion choisi par les paramètres `s` et `bdd`) ; `serveur.js` le
  vérifie, le fait tourner, demande à l'IA de corriger la description en cas d'erreur (2 essais), puis aperçu et exports.

Réglages du poste : `reglages-poste.json` (connexion MySQL sans mot de passe, dossier de travail, fichier .birtec).
Dossier de travail (par défaut `Documents/BiRTEC`) : `rapports/` et `connaissances.birtec`.

Les fondations (IA, préparation, kits hors ligne, serveur web, interface) viennent d'IASSITEC.
