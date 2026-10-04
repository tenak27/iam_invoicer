#!/bin/bash
# Contrôle des DMG macOS sur une machine GitHub : signature, verdict Gatekeeper, puis
# auto-contrôle réel de l'application (base, interface, société, client, PDF) pour chaque
# architecture (Intel via Rosetta). Résultats en annotations GitHub et dans selftest-mac/.
# Usage : scripts/mac-selftest.sh dist/*.dmg
set -u
OUT="$PWD/selftest-mac"
mkdir -p "$OUT"
FAIL=0
note() { echo "::$1 title=$2::$3"; }

for dmg in "$@"; do
  name=$(basename "$dmg" .dmg)
  echo "==================== $name"
  MNT=$(hdiutil attach -nobrowse -readonly "$dmg" | grep -o '/Volumes/.*' | head -1)
  APP_SRC="$MNT/IAM INVOICER.app"
  if [ ! -d "$APP_SRC" ]; then note error "$name" "Application absente du DMG"; FAIL=1; continue; fi

  # 1. Signature (sans elle, macOS déclare l'application « endommagée »)
  if SIG=$(codesign --verify --deep --strict --verbose=2 "$APP_SRC" 2>&1); then
    SIGINFO=$(codesign -dv "$APP_SRC" 2>&1 | grep -E 'Signature|TeamIdentifier' | tr '\n' ' ')
  else
    note error "$name signature" "$(echo "$SIG" | tr '\n' ' ')"; FAIL=1
  fi
  ARCHS=$(lipo -archs "$APP_SRC/Contents/MacOS/IAM INVOICER")
  MINOS=$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$APP_SRC/Contents/Info.plist" 2>/dev/null || echo '?')

  # 2. Copie dans un dossier « Applications » de test, avec l'attribut de téléchargement
  DEST="$RUNNER_TEMP/apps-$name"
  rm -rf "$DEST" && mkdir -p "$DEST" && cp -R "$APP_SRC" "$DEST/"
  APP="$DEST/IAM INVOICER.app"
  xattr -w com.apple.quarantine "0081;$(printf %x "$(date +%s)");Safari;" "$APP"
  GK=$(spctl --assess --type execute -vv "$APP" 2>&1 | tr '\n' ' ')
  note notice "$name installation" "Architecture $ARCHS · macOS $MINOS minimum · ${SIGINFO:-signature invalide} · Gatekeeper : $GK"
  xattr -dr com.apple.quarantine "$APP"
  hdiutil detach "$MNT" -quiet || true

  # 3. Auto-contrôle de l'application
  RUN=""
  case "$ARCHS" in
    *arm64*) [ "$(uname -m)" = "arm64" ] && RUN="arch -arm64" ;;
  esac
  if [ -z "$RUN" ]; then
    if [ "$(uname -m)" = "arm64" ] && arch -x86_64 /usr/bin/true 2>/dev/null; then RUN="arch -x86_64"
    elif [ "$(uname -m)" = "x86_64" ]; then RUN="arch -x86_64"
    else note warning "$name auto-contrôle" "Rosetta indisponible : $ARCHS non exécuté"; continue; fi
  fi
  RES="$OUT/$name"
  rm -rf "$RES" && mkdir -p "$RES"
  env -u ELECTRON_RUN_AS_NODE IAM_ERP_DATA="$RES/donnees" IAM_SELFTEST="$RES" \
    $RUN "$APP/Contents/MacOS/IAM INVOICER" > "$RES/sortie.log" 2>&1 &
  PID=$!
  for _ in $(seq 1 180); do kill -0 $PID 2>/dev/null || break; sleep 1; done
  if kill -0 $PID 2>/dev/null; then
    kill -9 $PID 2>/dev/null
    note error "$name auto-contrôle" "Bloqué après 180 s. Journal : $(tail -c 1500 "$RES/donnees/logs/demarrage.log" 2>/dev/null | tr '\n' ' ')"
    FAIL=1; continue
  fi
  wait $PID; CODE=$?
  cp "$RES/donnees/logs/demarrage.log" "$RES/" 2>/dev/null || true
  if [ -f "$RES/selftest.json" ]; then
    node scripts/selftest-report.cjs "$RES/selftest.json" "$name" || FAIL=1
    [ "$CODE" = "0" ] || FAIL=1
  else
    note error "$name auto-contrôle" "Code $CODE sans résultat. Sortie : $(tail -c 1200 "$RES/sortie.log" | tr '\n' ' ') Journal : $(tail -c 1200 "$RES/donnees/logs/demarrage.log" 2>/dev/null | tr '\n' ' ')"
    FAIL=1
  fi
done
exit $FAIL
