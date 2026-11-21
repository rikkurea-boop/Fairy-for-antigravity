#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

echo "=== Cai dat Fairy III H.D.D cho Google Antigravity (macOS) ==="
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Loi: Can cai dat Node.js (>= 18) truoc khi chay script nay (https://nodejs.org/)."
  read -r -p "Nhan Enter de dong..."
  exit 1
fi

chmod +x install-mac.command Start-Fairy-Mac.command Stop-Fairy-Mac.command
node scripts/sync-to-antigravity.mjs

cd desktop-app
npm install

echo ""
echo "Hoan tat! Tu nay ngai chi can click dup Start-Fairy-Mac.command de mo Fairy Desktop Overlay."
read -r -p "Nhan Enter de dong..."
