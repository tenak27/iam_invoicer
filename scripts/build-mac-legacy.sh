#!/bin/bash
# DMG « Mac plus ancien » : la version courante d'Electron exige macOS 13 (Ventura) ou plus.
# Cette variante, fabriquée avec Electron 32, fonctionne de macOS 10.15 (Catalina) à 12 (Monterey).
# Electron 32 ne reçoit plus de correctifs de sécurité : à réserver aux Mac qui ne peuvent pas
# passer à macOS 13. Fichiers : dist-ancien/IAM-INVOICER-<version>-<arch>-macos-ancien.dmg
set -euo pipefail
npm install --no-save --no-audit --no-fund electron@32
V=$(node -p "require('electron/package.json').version")
echo "Electron $V (macOS 10.15 minimum)"
npx electron-vite build
npx electron-builder --mac --publish never \
  -c.electronVersion="$V" \
  -c.mac.minimumSystemVersion=10.15 \
  '-c.mac.artifactName=IAM-INVOICER-${version}-${arch}-macos-ancien.${ext}' \
  -c.directories.output=dist-ancien
