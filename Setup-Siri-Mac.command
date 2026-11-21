#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(uname -m)" != "arm64" ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  exec arch -arm64 /bin/bash "$0" "$@"
fi

chmod +x scripts/setup-siri-mac.sh
/bin/bash scripts/setup-siri-mac.sh "$@"
read -r -p "Nhan Enter de dong..."
