#!/bin/sh
# Fabrique un kit hors ligne de BiRTEC (pour Linux ou pour Windows), à copier sur une clé USB.
# À lancer sur un PC connecté à Internet : sh fabriquer-kit-hors-ligne.sh
set -e
cd "$(dirname "$0")"

NODE_VERSION=v24.21.0   # version de Node utilisée par BiRTEC (aussi dans preparer-birtec.sh)
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/birtec"

if [ -f moteur/node/bin/node ]; then NODE=moteur/node/bin/node
elif [ -f "$DEST/moteur/node/bin/node" ]; then NODE="$DEST/moteur/node/bin/node"
elif [ -f hors-ligne/node/bin/node ]; then NODE=hors-ligne/node/bin/node; chmod +x "$NODE"
elif command -v node >/dev/null; then NODE=node
else
  echo "Téléchargement de Node $NODE_VERSION…"
  mkdir -p "$DEST/moteur"
  if command -v curl >/dev/null; then curl -L --fail -o "$DEST/moteur/node.tar.xz" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"
  else wget -O "$DEST/moteur/node.tar.xz" "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"; fi
  tar -xJf "$DEST/moteur/node.tar.xz" -C "$DEST/moteur"
  mv "$DEST/moteur/node-$NODE_VERSION-linux-x64" "$DEST/moteur/node"
  rm "$DEST/moteur/node.tar.xz"
  NODE="$DEST/moteur/node/bin/node"
fi

"$NODE" outils/fabriquer-kit-hors-ligne.js --choisir "$@"
