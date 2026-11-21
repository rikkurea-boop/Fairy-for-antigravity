#!/bin/bash
cd "$(dirname "$0")/desktop-app" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PYTORCH_ENABLE_MPS_FALLBACK=1

if [ ! -x "./node_modules/.bin/electron" ]; then
  echo "Chua cai Electron cho macOS. Vui long chay install-mac.command truoc."
  read -r -p "Nhan Enter de dong..."
  exit 1
fi

if [ "$(uname -m)" = "arm64" ] || [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  nohup arch -arm64 ./node_modules/.bin/electron . >/tmp/fairy-desktop-overlay.log 2>&1 </dev/null &
else
  nohup ./node_modules/.bin/electron . >/tmp/fairy-desktop-overlay.log 2>&1 </dev/null &
fi
disown 2>/dev/null || true
echo "Fairy III H.D.D Desktop Overlay da khoi chay o che do nen (Apple Silicon native)."
