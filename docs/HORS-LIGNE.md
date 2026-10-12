# Version hors ligne

Pour les postes **sans connexion à Internet**. La version en ligne (`BiRTEC.zip` sur GitHub, qui télécharge
Node, llama.cpp et le modèle pendant la préparation) reste la version normale ; la version hors ligne est un
**kit** qui contient déjà tout.

## Fabriquer le kit (sur un PC connecté à Internet)

Le plus simple : **double-cliquer sur `Fabriquer kit hors ligne.bat`** (Windows) ou lancer
**`sh fabriquer-kit-hors-ligne.sh`** (Linux). Trois questions : pour quels postes (Windows ou Linux), quels
modèles, quel dossier. **Un kit Windows se fabrique depuis Linux, et inversement** : les archives sont
décompressées par BiRTEC lui-même (`serveur/socle/zip.js` et `serveur/socle/tar.js`), sans outil du système.
Les lanceurs se trouvent aussi dans chaque kit : on peut fabriquer un kit Linux à partir d'un kit Windows
(et inversement) en reprenant ses modèles, sans les retélécharger.

En ligne de commande :

```sh
node outils/fabriquer-kit-hors-ligne.js                      # Windows, modèles petit + moyen (~11 Go)
node outils/fabriquer-kit-hors-ligne.js --modeles moyen,grand # avec le modèle lourd (~31 Go)
node outils/fabriquer-kit-hors-ligne.js --systeme linux       # kit pour des postes Linux
```

Le kit est créé à côté du dossier BiRTEC (`BiRTEC-hors-ligne-windows`). Les modèles déjà présents (sur le PC
ou dans le kit d'où l'on part) sont repris ; tout est vérifié (taille et empreinte). Relancer complète un kit
interrompu ou met à jour le programme d'un kit existant.

Un kit Linux fabriqué sous Windows (ou copié sur une clé USB) perd les droits d'exécution des programmes :
la préparation les remet d'elle-même.

Le kit est trop gros pour les Releases GitHub (2 Go par fichier au plus) : il se copie sur une clé USB
(formatée en exFAT ou NTFS : un modèle dépasse 4 Go) ou sur un partage réseau.

## Contenu

```
BiRTEC-hors-ligne-windows/
├── Preparer BiRTEC.bat, Lancer BiRTEC.bat, serveur/, blocs/, interface/…   ← le programme, comme le zip
├── LISEZ-MOI (hors ligne).txt
└── hors-ligne/
    ├── kit.json          ← système, version, modèles inclus
    ├── node/             ← Node pour Windows
    ├── llama-vulkan/     ← llama.cpp, carte graphique
    ├── llama-cpu/        ← llama.cpp, processeur seul
    ├── java/             ← Java 21 (Temurin)
    ├── birt/             ← moteur BIRT (ReportEngine)
    ├── mysql-connector-j-….jar ← pilote MySQL
    └── modeles/          ← fichiers GGUF des modèles inclus + modèle de recherche
```

## Installer un poste

Lancer `Preparer BiRTEC.bat` depuis le kit. La préparation voit le dossier `hors-ligne/` et **copie** au lieu
de télécharger ; elle ne propose que les modèles présents dans le kit. Le reste (installation dans le profil,
analyse du poste, essai, raccourcis) est identique à la version en ligne.

## Limites

- Pas de mise à jour automatique (le bouton de l'écran Administration demande Internet) : fabriquer un nouveau
  kit et relancer la préparation ; le fichier de l'atelier et les réglages sont gardés.
- Le changement de modèle depuis Administration › Réglages télécharge le modèle : sur un poste hors ligne,
  relancer plutôt la préparation depuis un kit qui contient le modèle voulu.
