#!/bin/bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Tự động chuyển về native Apple Silicon (arm64) nếu đang chạy dưới Rosetta 2
if [ "$(uname -m)" != "arm64" ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  exec arch -arm64 /bin/bash "$0" "$@"
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Script nay chi danh cho macOS (Apple Silicon)."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_SUPPORT_DIR="$HOME/Library/Application Support/FairyHDD"
DISPATCH_SH="$APP_SUPPORT_DIR/fairy-dispatch.sh"
SHORTCUTS_DIR="$APP_SUPPORT_DIR/Shortcuts"
APP_DIR="$HOME/Applications/Fairy.app"
ICON_SRC="$REPO_DIR/antigravity-plugin/assets/icon-180.png"
if [ ! -f "$ICON_SRC" ]; then
  ICON_SRC="$REPO_DIR/assets/icon-180.png"
fi

NO_OPEN=0
for arg in "$@"; do
  if [ "$arg" = "--no-open" ]; then
    NO_OPEN=1
  fi
done

mkdir -p "$HOME/Applications" "$APP_SUPPORT_DIR" "$SHORTCUTS_DIR"

# 1. Script điều phối nhanh (<20ms qua /api/cmd nếu đã chạy, hoặc khởi chạy Electron --force-boot)
cat > "$DISPATCH_SH" <<EOF
#!/bin/bash
export PATH="/opt/homebrew/bin:/usr/local/bin:\$PATH"
export PYTORCH_ENABLE_MPS_FALLBACK=1

REPO_DIR="$REPO_DIR"
DESKTOP_DIR="\$REPO_DIR/desktop-app"
EP_FILE="\$HOME/.gemini/antigravity/plugin_data/fairy-zzz/desktop-endpoint.json"
ARG="\${1:-replay-boot}"

case "\$ARG" in
  fairy://briefing*|briefing*) CMD="briefing-now" ;;
  fairy://instant*|instant*)   CMD="open-instant" ;;
  fairy://greet*|greet*)       CMD="replay-greet" ;;
  fairy://toggle*|toggle*)     CMD="toggle-bubble" ;;
  fairy://clipboard*|fairy://read-clipboard*|read-clipboard*) CMD="read-clipboard" ;;
  *)                           CMD="replay-boot" ;;
esac

EP_PORT=""
EP_PID=""
if [ -f "\$EP_FILE" ]; then
  if command -v node >/dev/null 2>&1; then
    read -r EP_PORT EP_PID <<JSON
\$(node -e "try{const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log((d.port||'')+' '+(d.pid||''))}catch{console.log(' ')}" "\$EP_FILE")
JSON
  elif command -v python3 >/dev/null 2>&1; then
    read -r EP_PORT EP_PID <<JSON
\$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]));print(d.get('port',''),d.get('pid',''))" "\$EP_FILE" 2>/dev/null || echo "")
JSON
  fi
fi

if [ -n "\$EP_PORT" ] && [ -n "\$EP_PID" ] && kill -0 "\$EP_PID" 2>/dev/null; then
  if curl -fsS -m 1.5 -X POST "http://127.0.0.1:\${EP_PORT}/api/cmd" \\
    -H 'Content-Type: application/json' \\
    -d "{\\"cmd\\":\\"\${CMD}\\"}" >/dev/null 2>&1; then
    exit 0
  fi
fi

if [ -x "\$DESKTOP_DIR/node_modules/.bin/electron" ]; then
  cd "\$DESKTOP_DIR" || exit 1
  FLAG="--force-boot"
  URL_FLAG=""
  if [[ "\$ARG" == fairy://* ]]; then
    URL_FLAG="\$ARG"
  fi
  if [ "\$(uname -m)" = "arm64" ] || [ "\$(sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
    nohup arch -arm64 ./node_modules/.bin/electron . "\$FLAG" \$URL_FLAG >/tmp/fairy-desktop-overlay.log 2>&1 </dev/null &
  else
    nohup ./node_modules/.bin/electron . "\$FLAG" \$URL_FLAG >/tmp/fairy-desktop-overlay.log 2>&1 </dev/null &
  fi
  disown 2>/dev/null || true
fi
EOF
chmod +x "$DISPATCH_SH"

# 2. Tạo ~/Applications/Fairy.app bằng osacompile (xử lý được cả bấm mở App lẫn GURL fairy://)
rm -rf "$APP_DIR"
TMP_APPLESCRIPT="$(mktemp /tmp/fairy-app-XXXXXX.applescript)"
cat > "$TMP_APPLESCRIPT" <<EOF
on run
  do shell script "/bin/bash " & quoted form of "$DISPATCH_SH" & " replay-boot"
end run

on open location theURL
  do shell script "/bin/bash " & quoted form of "$DISPATCH_SH" & " " & quoted form of theURL
end open location
EOF

if command -v osacompile >/dev/null 2>&1 && osacompile -o "$APP_DIR" "$TMP_APPLESCRIPT" >/dev/null 2>&1; then
  rm -f "$TMP_APPLESCRIPT"
else
  rm -f "$TMP_APPLESCRIPT"
  mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources"
  cat > "$APP_DIR/Contents/MacOS/Fairy" <<EOF
#!/bin/bash
exec "$DISPATCH_SH" "replay-boot"
EOF
  chmod +x "$APP_DIR/Contents/MacOS/Fairy"
fi

mkdir -p "$APP_DIR/Contents/Resources"

# Chuyển icon-180.png sang Fairy.icns nếu có sips + iconutil
if [ -f "$ICON_SRC" ] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  ICONSET_DIR="$(mktemp -d /tmp/FairyIcon.XXXXXX)/Fairy.iconset"
  mkdir -p "$ICONSET_DIR"
  sips -z 16 16     "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16.png"      >/dev/null 2>&1 || true
  sips -z 32 32     "$ICON_SRC" --out "$ICONSET_DIR/icon_16x16@2x.png"   >/dev/null 2>&1 || true
  sips -z 32 32     "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32.png"      >/dev/null 2>&1 || true
  sips -z 64 64     "$ICON_SRC" --out "$ICONSET_DIR/icon_32x32@2x.png"   >/dev/null 2>&1 || true
  sips -z 128 128   "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128.png"    >/dev/null 2>&1 || true
  sips -z 256 256   "$ICON_SRC" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null 2>&1 || true
  sips -z 256 256   "$ICON_SRC" --out "$ICONSET_DIR/icon_256x256.png"    >/dev/null 2>&1 || true
  iconutil -c icns "$ICONSET_DIR" -o "$APP_DIR/Contents/Resources/Fairy.icns" >/dev/null 2>&1 || true
  rm -rf "$(dirname "$ICONSET_DIR")"
fi

PLIST_PATH="$APP_DIR/Contents/Info.plist"
EXEC_NAME="applet"
if [ -f "$APP_DIR/Contents/MacOS/Fairy" ]; then
  EXEC_NAME="Fairy"
elif [ -f "$PLIST_PATH" ] && command -v /usr/libexec/PlistBuddy >/dev/null 2>&1; then
  CUR_EXEC="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$PLIST_PATH" 2>/dev/null || echo 'applet')"
  if [ -n "$CUR_EXEC" ]; then EXEC_NAME="$CUR_EXEC"; fi
fi

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>vi</string>
  <key>CFBundleDisplayName</key>
  <string>Fairy</string>
  <key>CFBundleExecutable</key>
  <string>$EXEC_NAME</string>
  <key>CFBundleIconFile</key>
  <string>Fairy</string>
  <key>CFBundleIdentifier</key>
  <string>com.fairyzzz.hdd.overlay</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Fairy</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>3.0.1</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSArchitecturePriority</key>
  <array>
    <string>arm64</string>
  </array>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>Fairy H.D.D Deep Link</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>fairy</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
EOF

codesign --force --deep --sign - "$APP_DIR" >/dev/null 2>&1 || true
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREG" ]; then
  "$LSREG" -f "$APP_DIR" >/dev/null 2>&1 || true
fi

# 3. Tạo và ký 2 Apple Shortcuts sẵn dùng cho Siri
build_open_app_shortcut() {
  local out_file="$1"
  local tmp_xml="${out_file}.unsigned.plist"
  local tmp_bin="${out_file}.unsigned.shortcut"
  cat > "$tmp_xml" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.openapp</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFAppIdentifier</key>
        <string>com.fairyzzz.hdd.overlay</string>
        <key>WFSelectedApp</key>
        <dict>
          <key>BundleIdentifier</key>
          <string>com.fairyzzz.hdd.overlay</string>
          <key>Name</key>
          <string>Fairy</string>
        </dict>
      </dict>
    </dict>
  </array>
  <key>WFWorkflowClientVersion</key>
  <string>2605.0.5</string>
  <key>WFWorkflowHasShortcutInputVariables</key>
  <false/>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconGlyphNumber</key>
    <integer>59722</integer>
    <key>WFWorkflowIconStartColor</key>
    <integer>431817727</integer>
  </dict>
  <key>WFWorkflowImportQuestions</key>
  <array/>
  <key>WFWorkflowInputContentItemClasses</key>
  <array>
    <string>WFStringContentItem</string>
  </array>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>900</integer>
  <key>WFWorkflowMinimumClientVersionString</key>
  <string>900</string>
  <key>WFWorkflowOutputContentItemClasses</key>
  <array/>
  <key>WFWorkflowTypes</key>
  <array/>
</dict>
</plist>
PLIST
  plutil -convert binary1 "$tmp_xml" -o "$tmp_bin"
  if command -v shortcuts >/dev/null 2>&1; then
    if shortcuts sign --mode anyone --input "$tmp_bin" --output "$out_file" >/dev/null 2>&1 || \
       shortcuts sign --mode people-who-know-me --input "$tmp_bin" --output "$out_file" >/dev/null 2>&1; then
      rm -f "$tmp_xml" "$tmp_bin"
      return 0
    fi
  fi
  mv "$tmp_bin" "$out_file"
  rm -f "$tmp_xml"
}

build_open_url_shortcut() {
  local out_file="$1"
  local target_url="$2"
  local url_uuid="11111111-2222-4333-8444-555555555551"
  local tmp_xml="${out_file}.unsigned.plist"
  local tmp_bin="${out_file}.unsigned.shortcut"
  cat > "$tmp_xml" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>WFWorkflowActions</key>
  <array>
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.url</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>UUID</key>
        <string>${url_uuid}</string>
        <key>WFURLActionURL</key>
        <string>${target_url}</string>
      </dict>
    </dict>
    <dict>
      <key>WFWorkflowActionIdentifier</key>
      <string>is.workflow.actions.openurl</string>
      <key>WFWorkflowActionParameters</key>
      <dict>
        <key>WFInput</key>
        <dict>
          <key>Value</key>
          <dict>
            <key>OutputName</key>
            <string>URL</string>
            <key>OutputUUID</key>
            <string>${url_uuid}</string>
            <key>Type</key>
            <string>ActionOutput</string>
          </dict>
          <key>WFSerializationType</key>
          <string>WFTextTokenAttachment</string>
        </dict>
      </dict>
    </dict>
  </array>
  <key>WFWorkflowClientVersion</key>
  <string>2605.0.5</string>
  <key>WFWorkflowHasShortcutInputVariables</key>
  <false/>
  <key>WFWorkflowIcon</key>
  <dict>
    <key>WFWorkflowIconGlyphNumber</key>
    <integer>59722</integer>
    <key>WFWorkflowIconStartColor</key>
    <integer>431817727</integer>
  </dict>
  <key>WFWorkflowImportQuestions</key>
  <array/>
  <key>WFWorkflowInputContentItemClasses</key>
  <array>
    <string>WFStringContentItem</string>
  </array>
  <key>WFWorkflowMinimumClientVersion</key>
  <integer>900</integer>
  <key>WFWorkflowMinimumClientVersionString</key>
  <string>900</string>
  <key>WFWorkflowOutputContentItemClasses</key>
  <array/>
  <key>WFWorkflowTypes</key>
  <array/>
</dict>
</plist>
PLIST
  plutil -convert binary1 "$tmp_xml" -o "$tmp_bin"
  if command -v shortcuts >/dev/null 2>&1; then
    if shortcuts sign --mode anyone --input "$tmp_bin" --output "$out_file" >/dev/null 2>&1 || \
       shortcuts sign --mode people-who-know-me --input "$tmp_bin" --output "$out_file" >/dev/null 2>&1; then
      rm -f "$tmp_xml" "$tmp_bin"
      return 0
    fi
  fi
  mv "$tmp_bin" "$out_file"
  rm -f "$tmp_xml"
}

SC_BOOT="$SHORTCUTS_DIR/Khởi động Fairy.shortcut"
SC_BRIEF="$SHORTCUTS_DIR/Báo cáo Fairy.shortcut"
build_open_app_shortcut "$SC_BOOT"
build_open_url_shortcut "$SC_BRIEF" "fairy://briefing"

echo ""
echo "=== Da thiet lap tich hop Hey Siri cho Fairy (Apple Silicon) ==="
echo "1) App launcher: $APP_DIR"
echo "   -> Ngai co the noi ngay: \"Hey Siri, open Fairy\""
echo "2) Phim tat Siri da ky:"
echo "   - $SC_BOOT  (\"Hey Siri, khoi dong Fairy\")"
echo "   - $SC_BRIEF (\"Hey Siri, bao cao Fairy\")"
echo ""

if [ "$NO_OPEN" -eq 0 ]; then
  open "$SC_BOOT" || true
  echo "Da mo cua so them Phim tat \"Khởi động Fairy\". Hay bam \"Add Shortcut\" (Them Phim tat)."
fi
