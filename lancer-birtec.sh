#!/bin/sh
# Lance BiRTEC sous Linux : démarre le serveur local, qui ouvre ensuite le navigateur.
cd "$(dirname "$0")" || exit 1

NODE=moteur/node/bin/node
[ -x "$NODE" ] || NODE=node   # en développement : le Node du système

while true; do
  "$NODE" serveur/demarrer.js "$@"
  [ $? -eq 42 ] || break       # 42 = redémarrage demandé (après une mise à jour)
done
