# Architecture

```
navigateur ──► serveur Node (127.0.0.1:47900) ──► llama.cpp (IA)
                         │
                         └──► java Moteur <commande> ──► MySQL (lecture seule)
                                                    └──► moteur BIRT (aperçu, exports — à venir)
```

- **Node** (`serveur/`) sert l'interface, garde le mot de passe MySQL en mémoire et lance le moteur Java pour chaque
  opération : `tester`, `schema`, `requete`. Le mot de passe passe par l'entrée standard du moteur, jamais en option.
- **Moteur Java** (`moteur-java/Moteur.java`) : compilé par la préparation dans `moteur/classes`. Connexion en lecture
  seule, requêtes de lecture uniquement (SELECT, WITH, SHOW, DESCRIBE, EXPLAIN), une à la fois, 30 s au plus.
- **Assistant** (`blocs/assistant/serveur.js`) : pour chaque question, `blocs/base/schema.js` choisit les tables utiles
  (mots de la question comparés aux noms et commentaires, plus les tables liées) et les décrit à l'IA avec les consignes.

Réglages du poste : `reglages-poste.json` (connexion MySQL sans mot de passe, dossier de travail).
Dossier de travail (par défaut `Documents/BiRTEC`) : `rapports/`, `modeles/`, `ressources/`.

Les fondations (IA, préparation, kits hors ligne, serveur web, interface) viennent d'IASSITEC.
