#!/bin/sh
# Prépare BiRTEC sous Linux (une seule fois) : installe Node dans le profil,
# puis lance outils/preparer.js qui fait le reste (moteur d'IA, modèle, raccourcis).
#
# Usage : sh preparer-birtec.sh       (options : voir outils/preparer.js)
set -e
cd "$(dirname "$0")"

DEST="${XDG_DATA_HOME:-$HOME/.local/share}/birtec"
NODE_VERSION=v24.21.0   # version de Node utilisée par BiRTEC (aussi dans « Preparer BiRTEC.bat »)

telecharger() {
  if command -v curl >/dev/null; then curl -L --fail -o "$2" "$1"; else wget -O "$2" "$1"; fi
}

if [ ! -x "$DEST/moteur/node/bin/node" ] && [ -f hors-ligne/node/bin/node ]; then
  # Version hors ligne : Node est dans le kit, on le copie au lieu de le télécharger.
  # (chmod : un kit fabriqué sous Windows ou copié depuis une clé USB a perdu le droit d'exécution)
  echo "Copie de Node depuis le kit hors ligne…"
  mkdir -p "$DEST/moteur"
  cp -r hors-ligne/node "$DEST/moteur/node"
  chmod +x "$DEST/moteur/node/bin/node"
fi

if [ ! -x "$DEST/moteur/node/bin/node" ]; then
  echo "Téléchargement de Node $NODE_VERSION…"
  mkdir -p "$DEST/moteur"
  telecharger "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" "$DEST/moteur/node.tar.xz"
  tar -xJf "$DEST/moteur/node.tar.xz" -C "$DEST/moteur"
  rm -rf "$DEST/moteur/node"
  mv "$DEST/moteur/node-$NODE_VERSION-linux-x64" "$DEST/moteur/node"
  rm "$DEST/moteur/node.tar.xz"
fi

# Lancé par un double-clic, sans terminal : on ne pose pas de question.
if [ -t 0 ]; then
  "$DEST/moteur/node/bin/node" outils/preparer.js "$@"
else
  "$DEST/moteur/node/bin/node" outils/preparer.js --oui "$@"
fi
