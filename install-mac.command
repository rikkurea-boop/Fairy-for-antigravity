#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Neu đang chạy qua Rosetta 2 trên máy Apple Silicon (M1/M2/M3/M4), chuyển ngay về native arm64
if [ "$(uname -m)" != "arm64" ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  exec arch -arm64 /bin/bash "$0" "$@"
fi

echo "=== Cai dat Fairy III H.D.D cho Google Antigravity (macOS / Apple Silicon) ==="
echo "Kien truc CPU: $(uname -m)"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Loi: Can cai dat Node.js arm64 (>= 18) truoc khi chay script nay (https://nodejs.org/ hoac: brew install node)."
  read -r -p "Nhan Enter de dong..."
  exit 1
fi

if command -v brew >/dev/null 2>&1; then
  if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "-> Dang cai dat ffmpeg ban native Apple Silicon qua Homebrew..."
    brew install ffmpeg || true
  fi
  if ! command -v uv >/dev/null 2>&1; then
    echo "-> Dang cai dat uv qua Homebrew..."
    brew install uv || true
  fi
fi

chmod +x install-mac.command Start-Fairy-Mac.command Stop-Fairy-Mac.command Setup-Siri-Mac.command scripts/setup-siri-mac.sh
node scripts/sync-to-antigravity.mjs

echo "-> Dang cai dat Electron cho macOS ($(uname -m))..."
(
  cd desktop-app
  if [ "$(uname -m)" = "arm64" ]; then
    npm_config_arch=arm64 npm install
  else
    npm install
  fi
)

# Thiet lap VieNeu-TTS trong voice-lab/VieNeu-TTS (ONNX P-core mac dinh hoac --mps cho Metal GPU)
VIENEU_DIR="voice-lab/VieNeu-TTS"
if command -v uv >/dev/null 2>&1; then
  if [ ! -d "$VIENEU_DIR" ]; then
    echo "-> Dang tai VieNeu-TTS v3 Turbo cho Apple Silicon..."
    git clone --depth 1 https://github.com/pnnbao97/VieNeu-TTS.git "$VIENEU_DIR" || true
  fi
  if [ -d "$VIENEU_DIR" ]; then
    echo "-> Dang dong bo moi truong Python cho VieNeu-TTS (arm64 P-cores)..."
    (
      cd "$VIENEU_DIR"
      if [ "${1:-}" = "--mps" ]; then
        uv sync --extra legacy || uv sync
      else
        uv sync
      fi
    ) || echo "Canh bao: Khong the tu dong uv sync VieNeu-TTS; app van hoat dong voi bo giam sat & am thanh co ban."
  fi
else
  echo "Luu y: Neu muon bat giong may VieNeu-TTS cuc bo tren M1 Pro, hay cai 'brew install uv ffmpeg' roi chay lai install-mac.command."
fi

echo "-> Dang thiet lap launcher ~/Applications/Fairy.app & Phim tat Hey Siri..."
/bin/bash scripts/setup-siri-mac.sh --no-open || true

echo ""
echo "Hoan tat! Tu nay ngai chi can click dup Start-Fairy-Mac.command hoac chay Setup-Siri-Mac.command de them \"Hey Siri, khoi dong Fairy\"."
read -r -p "Nhan Enter de dong..."
