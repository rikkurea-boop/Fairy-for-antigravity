#!/bin/bash
cd "$(dirname "$0")/desktop-app" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
export PYTORCH_ENABLE_MPS_FALLBACK=1

if [ ! -x "./node_modules/.bin/electron" ]; then
  echo "Chua cai Electron cho macOS. Vui long chay install-mac.command truoc."
  read -r -p "Nhan Enter de dong..."
  exit 1
fi

FORCE_BOOT_FLAG=""
if [ "${1:-}" = "--boot" ] || [ "${1:-}" = "--force-boot" ]; then
  FORCE_BOOT_FLAG="--force-boot"
  EP_FILE="$HOME/.gemini/antigravity/plugin_data/fairy-zzz/desktop-endpoint.json"
  if [ -f "$EP_FILE" ] && command -v node >/dev/null 2>&1; then
    read -r EP_PORT EP_PID <<JSON
$(node -e "try{const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log((d.port||'')+' '+(d.pid||''))}catch{console.log(' ')}" "$EP_FILE")
JSON
    if [ -n "$EP_PORT" ] && [ -n "$EP_PID" ] && kill -0 "$EP_PID" 2>/dev/null; then
      if curl -fsS -m 1.5 -X POST "http://127.0.0.1:${EP_PORT}/api/cmd" -H 'Content-Type: application/json' -d '{"cmd":"replay-boot"}' >/dev/null 2>&1; then
        echo "Fairy III H.D.D da bat man hinh Boot."
        exit 0
      fi
    fi
  fi
fi

if [ "$(uname -m)" = "arm64" ] || [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  nohup arch -arm64 ./node_modules/.bin/electron . $FORCE_BOOT_FLAG >/tmp/fairy-desktop-overlay.log 2>&1 </dev/null &
else
  nohup ./node_modules/.bin/electron . $FORCE_BOOT_FLAG >/tmp/fairy-desktop-overlay.log 2>&1 </dev/null &
fi
disown 2>/dev/null || true
echo "Fairy III H.D.D Desktop Overlay da khoi chay o che do nen (Apple Silicon native)."
