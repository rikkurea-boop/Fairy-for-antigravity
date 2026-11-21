#!/bin/bash
cd "$(dirname "$0")/desktop-app" || exit 1

if [ ! -x "./node_modules/.bin/electron" ]; then
  echo "Chua cai Electron cho macOS. Vui long chay install-mac.command truoc."
  read -r -p "Nhan Enter de dong..."
  exit 1
fi

nohup ./node_modules/.bin/electron . >/tmp/fairy-desktop-overlay.log 2>&1 </dev/null &
disown 2>/dev/null || true
echo "Fairy III H.D.D Desktop Overlay da khoi chay o che do nen."
