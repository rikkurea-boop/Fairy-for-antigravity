# Fairy III · H.D.D Desktop Overlay & Plugin cho Google Antigravity (Tiếng Việt)

Phiên bản hợp nhất từ [`AssassinVIX/fairy-zzz-plugin`](https://github.com/AssassinVIX/fairy-zzz-plugin) và đôi mắt [`Chengzhibense/Fairy-DSH`](https://github.com/Chengzhibense/Fairy-DSH) dành riêng cho **Google Antigravity** (Windows & macOS) — bao gồm cả **Ứng dụng Desktop Overlay ngoài** và **Plugin gốc trong Antigravity** cùng **bộ giọng tiếng Việt H.D.D** tổng hợp theo phong cách Android.

---

## 1. Cấu trúc dự án

- **`antigravity-plugin/` (Plugin gốc cài vào `~/.gemini/config/plugins/fairy-zzz/`):**
  - `plugin.json`: Khai báo plugin `fairy-zzz` (`Fairy III · H.D.D (VI)`).
  - `rules/AGENTS.md`: Quy tắc nhân cách Fairy III tiếng Việt (`Master` / `ngài`), ưu tiên độ chính xác kỹ thuật và an toàn công cụ.
  - `hooks.json` + `scripts/fairy-hook.mjs`: Ghi telemetry nhẹ (<60ms, fail-open) cho 5 sự kiện `SessionStart`, `PreInvocation`, `PostToolUse`, `PostInvocation`, `Stop` vào `~/.gemini/antigravity/plugin_data/fairy-zzz/state.json`.
  - `sidecars/fairy-hud/`: Giao diện phụ Aux Pane kèm cầu nối **Hybrid Two-Way Bridge** (`http://127.0.0.1:<port>/api/hybrid`, SSE `/api/events`, phát media VP9 `boot.webm` / `boot.mp4`).
  - `assets/voice/`: Bộ 6 tệp lời chào tiếng Việt H.D.D theo khung giờ (`greet.wav`, `greet-morning.wav`, `greet-noon.wav`, `greet-afternoon.wav`, `greet-evening.wav`, `greet-night.wav`).
- **`desktop-app/` (Ứng dụng Desktop Overlay Electron):**
  - Cửa sổ trong suốt, Always-on-Top, xuyên chuột thông minh (`setShape` trên Windows thu gọn quanh mắt + bubble để không xung đột phần cứng video/YouTube), phát video `boot.webm` và giọng chào H.D.D khi khởi động.
  - Đầy đủ **8 biểu cảm mắt**: `idle`, `thinking`, `working`, `comforting`, `smug`, `alert`, `done`, `sleepy`, thay đổi linh hoạt theo ngữ cảnh hội thoại và Voice Chat.
  - **Double-Click (<=300ms):** Kích hoạt trực tiếp **Antigravity Voice Mode (`🔊 Voice Mode`)** qua Windows UI Automation (`scripts/antigravity-voice-worker.ps1` + đánh thức `Chrome_RenderWidgetHostHWND`) hoặc macOS `osascript`, hoặc mở **Hybrid Chat** / `Win+H` / **Bảng H.D.D**.
  - **Click & Hold (`0.22s`):** Kéo thả mắt Fairy tự do trên màn hình (`Alt/Cmd + Shift + F` để bật/tắt nhanh).
- **`scripts/`**:
  - `sync-to-antigravity.mjs`: Đồng bộ mã nguồn & assets từ `antigravity-plugin/` vào `~/.gemini/config/plugins/fairy-zzz/`.
  - `antigravity-voice-worker.ps1`: Worker PowerShell/UIA nền giúp kích hoạt Voice Mode chính xác không cần hiệu chỉnh tọa độ thủ công.
  - `setup-desktop-and-startup.ps1`: Tạo shortcut Desktop/Start Menu, icon `fairy.ico` và Scheduled Task khởi chạy sớm khi đăng nhập Windows.
- **`voice-lab/`**:
  - `tune_fairy_jp.py` + `ref_trucly_raw.wav`: Bộ DSP tái tạo giọng nữ trưởng thành pha chất Android (Semitone Auto-Tune + Warm Vocoder + Independent Formant Shift `+6.5%` + Syllable Tail Gate) kết hợp `VieNeu-TTS`.

---

## 2. Cài đặt sau khi Clone

### Yêu cầu
- **Node.js 18+** (Windows hoặc macOS)
- **Tùy chọn tạo lại giọng nói:** Python 3.11+, `ffmpeg`, `uv` và repo `VieNeu-TTS` (bộ WAV dựng sẵn đã nằm sẵn trong `assets/voice/` và `antigravity-plugin/assets/voice/`).

### Trên Windows
1. Cài dependencies cho Desktop App và đồng bộ Plugin sang Antigravity:
   ```powershell
   cd desktop-app
   npm install
   cd ..
   node scripts/sync-to-antigravity.mjs
   ```
2. Khởi chạy ngay bằng **`Start-Fairy-Desktop.bat`** (tắt bằng **`Stop-Fairy-Desktop.bat`** hoặc icon **Fairy** dưới khay hệ thống).
3. *(Tùy chọn)* Tạo shortcut & bật Intro khởi động cùng Windows:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/setup-desktop-and-startup.ps1
   ```
   Hoặc dùng **`Enable-Startup-Intro.bat`** / **`Disable-Startup-Intro.bat`**.

### Trên MacBook (macOS · Apple Silicon & Intel)
1. Nhấn đúp **`install-mac.command`** (hoặc chạy `bash install-mac.command` trong Terminal — nếu macOS hỏi Gatekeeper, chuột phải → **Open**). Script sẽ tự đồng bộ `antigravity-plugin/` vào `~/.gemini/config/plugins/fairy-zzz/` và cài Electron cho macOS.
2. Nhấn đúp **`Start-Fairy-Mac.command`** để mở Overlay (tắt bằng **`Stop-Fairy-Mac.command`**).
3. Phím tắt trên macOS: **`Cmd + Shift + F`** (hoặc `Option + Shift + F`).

---

## 3. Tạo thêm câu thoại giọng Fairy (Tùy chọn)
```bash
# Trong voice-lab/VieNeu-TTS (đã chạy uv sync):
uv run python ../tune_fairy_jp.py --build-pack --out-dir ../../assets/voice --copy-to ../../antigravity-plugin/assets/voice
uv run python ../tune_fairy_jp.py --text "Khẳng định: tác vụ đã hoàn tất, Master." --out ../../assets/voice/custom.wav
```

---

## 4. Độ an toàn tài khoản Google
- Kết nối trạng thái đi qua `hooks.json` chính thức của Antigravity (ghi JSON cục bộ tại `~/.gemini/antigravity/plugin_data/fairy-zzz/state.json`), còn kênh thoại dùng tương tác UI hệ điều hành chuẩn (UIA / AppleScript).
- App Fairy ngoài **không** đọc token/cookie Google, **không** gọi API nội bộ Google và **không** sửa tệp nhị phân gốc của Antigravity.

## Bản quyền
- Mã nguồn `fairy-zzz-plugin`: giấy phép **MIT** ([LICENSE](LICENSE)).
- Đôi mắt SVG và chuyển động `Fairy-DSH`: **Apache-2.0** ([NOTICE-fairy-dsh.md](NOTICE-fairy-dsh.md)).
