# Fairy III · H.D.D cho Google Antigravity

**Tiếng Việt** · [English](#english)

Bộ nâng cấp toàn diện đưa **Fairy** — AI Tổng hợp Đa năng Thế hệ III của hệ thống H.D.D (*Hollow Deep Dive System*, *Zenless Zone Zero*) — lên **Google Antigravity** (Windows & macOS Apple Silicon). Dự án kết hợp **Ứng dụng Desktop Overlay trong suốt**, **Plugin Antigravity chính thức**, **Giọng nói tiếng Việt cục bộ (`VieNeu-TTS` + DSP 2 lớp)** và **Quản gia AI H.D.D** hoạt động xuyên suốt trong lẫn ngoài Antigravity.

> **Lưu ý nguồn gốc:** Kho lưu trữ này là bản fork phát triển chuyên biệt cho **Google Antigravity** từ [`AssassinVIX/fairy-zzz-plugin`](https://github.com/AssassinVIX/fairy-zzz-plugin) và bộ hình ảnh/hoạt ảnh mắt [`Chengzhibense/Fairy-DSH`](https://github.com/Chengzhibense/Fairy-DSH).

![Khởi động H.D.D](screenshots/01-boot.gif)
![Chào đầu phiên H.D.D](screenshots/02-greet.png)

| 8 Biểu cảm mắt H.D.D | Bảng cài đặt Overlay |
| --- | --- |
| ![Biểu cảm mắt](screenshots/03-eye-states.png) | ![Cài đặt](screenshots/04-settings.png) |

---

## Tính năng chính

### 1. Desktop Overlay Trong suốt (Windows & Apple Silicon `arm64`)
- **Trình tự Boot & Chào đầu phiên:** Phát video khởi động VP9 kèm âm thanh, tự động chào theo 5 khung giờ (`greet-morning/noon/afternoon/evening/night.wav`), sau đó thu gọn mắt Fairy về neo nổi Always-on-Top.
- **8 biểu cảm mắt thời gian thực:** `idle` (Quan sát), `thinking` (Suy luận), `working` (Thực thi), `comforting` (Dịu dàng), `smug` (Đắc ý), `alert` (Cảnh báo), `done` (Hoàn tất), `sleepy` (Trực đêm) với chớp mắt ngẫu nhiên, nhìn theo chuột và hiệu ứng glitch H.D.D 2 lớp.
- **Xuyên chuột thông minh & tối ưu đa nền tảng:** Cửa sổ OS thu gọn đúng vùng mắt và bong bóng để không cản chuột hay xung đột video nền; hỗ trợ kéo thả tự do (`0.22s`), bật kết xuất GPU Metal trên Apple Silicon (`M1/M2/M3/M4` native `arm64`, chống chạy dưới Rosetta 2).

### 2. Giọng nói máy Fairy Tiếng Việt cục bộ (`VieNeu-TTS` + DSP)
- **Tái tạo âm sắc Fairy:** Kết hợp `VieNeu-TTS` với bộ xử lý `tune_fairy_jp.py` / `fairy_tts_daemon.py` (Auto-Tune, tăng formant độc lập, vocoder ấm kiểu Android) trên NVIDIA CUDA (Windows) hoặc ONNX P-cores / Metal MPS (Apple Silicon).
- **Đồng bộ thời gian thực độ trễ thấp:** Nhận tín hiệu qua luồng đẩy IPC trực tiếp (`POST /api/hook-push`) từ `fairy-hook.mjs` và bộ đọc phụ đề trực tiếp ở Voice Mode (Windows UI Automation / macOS AppleScript).
- **Tự động tắt tiếng Antigravity mặc định:** Cô lập tắt riêng âm thanh Antigravity qua Windows Core Audio (`WASAPI`) Volume Mixer để Master chỉ nghe giọng máy Fairy, đồng thời lọc bỏ hoàn toàn lời người dùng và chống đọc lặp.

### 3. Hệ thống Quản gia AI H.D.D (4+1 Nâng cấp)
- **Giám sát "Tiêu thụ Điện năng H.D.D":** Quét tăng dần token thực tế (`input_tokens`, `output_tokens`, `cache_read_tokens`, phân rã theo mô hình) từ `transcript.jsonl` cục bộ và đối chiếu với **Định mức Điện năng ngày** tự chỉnh (`5M–100M`). Tự động nhắc đúng giọng Fairy khi vượt ngưỡng `75% / 90% / 100%`, tăng đột biến `>= 500K` token, AFK `>= 45 phút` hoặc làm việc qua nửa đêm.
- **Giao thức Báo cáo Đầu phiên:** Tự động (hoặc khi bấm `📋 Báo cáo`) kiểm tra nhanh nhánh Git và tệp chưa commit của tối đa 4 kho gần nhất cùng lượng token hôm nay và số ghi chú ghim, rồi đọc tóm tắt `Khẳng định: ...`.
- **Chế độ Trợ lý Tức thì (`AGY` ↔ `TỨC THÌ`):** Tách khỏi Voice Mode của Antigravity để dùng ngoài trình duyệt và các app AI khác (`ChatGPT`, `Claude`, `Gemini Web`, `Perplexity`...):
  - **Nhận diện cửa sổ đang mở** và **Tự đọc Clipboard** ngay khi copy văn bản trên trình duyệt/app ngoài.
  - **Thực thi lệnh nhanh tiếng Việt:** `help`, `báo cáo`, `điện năng`, `đọc clipboard`, `bật/tắt tự đọc`, `pomodoro 25`, `ghi nhớ <nội dung>`, `mở chatgpt/claude/gemini/github`, `tìm <từ khóa>`, `git`, `mở thư mục`, `antigravity: <câu hỏi>`.
  - **Hàng nút rảnh tay một chạm:** `📋 Báo cáo`, `🔊 Đọc Clip`, `👁 Tự đọc`, `⏱ 25p`, `📂 Thư mục`, `🌿 Git`.
- **Trí nhớ Dài hạn H.D.D:** Lưu bền vững tại `~/.gemini/antigravity/plugin_data/fairy-zzz/hdd-memory.json` (số phiên, giờ hoạt động, app hay dùng, thư mục dự án đã học, lịch sử token 14 ngày, ghi chú ghim).
- **Tích hợp `"Hey Siri, khởi động Fairy"` (Apple Silicon):** Script `Setup-Siri-Mac.command` tạo ứng dụng `~/Applications/Fairy.app` native `arm64`, đăng ký deep-link `fairy://` và ký sẵn Apple Shortcuts (`Khởi động Fairy.shortcut`, `Báo cáo Fairy.shortcut`) để gọi Siri bật ngay màn hình Boot hoặc báo cáo đầu phiên.

---

## Phím tắt toàn cục

| Thao tác | Windows | macOS |
| --- | --- | --- |
| Bật / Tắt bong bóng H.D.D | `Alt + Shift + F` (hoặc `Ctrl + Shift + F`) | `Option + Shift + F` (hoặc `Cmd + Shift + F`) |
| Mở nhanh **Trợ lý Tức thì** | `Alt + Shift + A` | `Option + Shift + A` / `Cmd + Option + A` |
| **Đọc Clipboard ngay** bằng giọng Fairy | `Alt + Shift + R` | `Option + Shift + R` / `Cmd + Option + R` |
| Nhấp đúp mắt Fairy | Hành động tùy chọn (`Voice Mode`, `Chat Hybrid`, `Trợ lý tức thì`, `Win+H`, `Bảng H.D.D`) | Hành động tùy chọn |

---

## Cài đặt nhanh

### Yêu cầu
- **Node.js 18+** (Windows hoặc macOS `arm64` / Intel)
- **Tùy chọn giọng nói cục bộ `VieNeu-TTS`:** Python 3.11+, `ffmpeg`, `uv` (bộ 6 tệp WAV chào dựng sẵn đã có trong `assets/voice/` và `antigravity-plugin/assets/voice/`).

### Trên Windows
1. Cài phụ thuộc cho Desktop App và đồng bộ plugin sang `~/.gemini/config/plugins/fairy-zzz/`:
   ```powershell
   cd desktop-app
   npm install
   cd ..
   node scripts/sync-to-antigravity.mjs
   ```
2. Khởi chạy ngay bằng **`Start-Fairy-Desktop.bat`** (tắt bằng **`Stop-Fairy-Desktop.bat`** hoặc menu biểu tượng **Fairy** ở khay hệ thống).
3. *(Tùy chọn)* Tạo lối tắt Desktop & bật tự khởi chạy Intro H.D.D khi đăng nhập Windows:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/setup-desktop-and-startup.ps1
   ```
   Hoặc dùng **`Enable-Startup-Intro.bat`** / **`Disable-Startup-Intro.bat`**.

### Trên macOS · Apple Silicon (M1 / M2 / M3 / M4)
1. Nhấn đúp **`install-mac.command`** (hoặc chạy `bash install-mac.command` — nếu macOS hỏi Gatekeeper, chuột phải → **Open**). Script tự ép chạy native `arm64`, cài `ffmpeg` / `uv` (nếu có Homebrew), đồng bộ plugin, cài Electron `arm64` và chuẩn bị `VieNeu-TTS`.
2. Nhấn đúp **`Start-Fairy-Mac.command`** để mở Overlay (tắt bằng **`Stop-Fairy-Mac.command`**).
3. *(Tùy chọn Siri)* Nhấn đúp **`Setup-Siri-Mac.command`** rồi bấm **Add Shortcut** khi macOS hiện cửa sổ thêm phím tắt; sau đó có thể gọi *"Hey Siri, khởi động Fairy"* hoặc *"Hey Siri, open Fairy"*.

### *(Tùy chọn)* Tạo lại bộ giọng nói Fairy cục bộ
```bash
cd voice-lab/VieNeu-TTS
uv run python ../tune_fairy_jp.py --build-pack --out-dir ../../assets/voice --copy-to ../../antigravity-plugin/assets/voice
uv run python ../tune_fairy_jp.py --text "Khẳng định: tác vụ đã hoàn tất, Master." --out ../../assets/voice/custom.wav
```

---

## Cấu trúc thư mục

```text
antigravity-plugin/              # Plugin Google Antigravity (sync sang ~/.gemini/config/plugins/fairy-zzz/)
  ├── plugin.json                # Khai báo plugin & sidecar
  ├── hooks.json                 # Hook SessionStart, PreInvocation, PostToolUse, PostInvocation, Stop
  ├── rules/AGENTS.md            # Quy tắc nhân cách Fairy III · H.D.D tiếng Việt
  ├── scripts/fairy-hook.mjs     # Ghi state.json + đẩy IPC tức thì sang Desktop Overlay
  ├── sidecars/fairy-hud/        # Aux Pane + Hybrid Two-Way Bridge
  └── assets/voice/              # Bộ 6 WAV chào H.D.D
desktop-app/                     # Ứng dụng Electron Overlay
  ├── electron-main.cjs          # Main process, HTTP/IPC bridge, TTS daemon, Voice subtitle poller
  ├── butler-core.cjs            # Quản gia AI: Token monitor, Briefing, Bộ nhớ dài hạn, Bộ phân tích lệnh
  ├── preload-desktop.cjs        # ContextBridge an toàn cho renderer
  └── renderer/                  # Giao diện mắt Fairy 8 biểu cảm, bong bóng H.D.D, Cài đặt
scripts/                         # Tự động hóa Windows & macOS
  ├── sync-to-antigravity.mjs    # Đồng bộ antigravity-plugin/ -> ~/.gemini/config/plugins/fairy-zzz/
  ├── antigravity-voice-worker.ps1 # Windows UIA Voice Mode + đọc phụ đề + WASAPI Mute + Foreground app
  ├── setup-desktop-and-startup.ps1 # Tạo shortcut & Scheduled Task mở máy Windows
  └── setup-siri-mac.sh          # Tạo ~/Applications/Fairy.app, fairy:// & Phím tắt Siri đã ký
voice-lab/                       # Bộ DSP & daemon giọng nói VieNeu-TTS (CUDA & Apple Silicon)
```

---

## Độ an toàn tài khoản Google
- Toàn bộ kết nối với Antigravity đi qua `hooks.json` hợp lệ, đọc log `transcript.jsonl` cục bộ và tương tác UI chuẩn của hệ điều hành (UI Automation / AppleScript).
- Ứng dụng **không** đọc cookie/token Google, **không** gọi API nội bộ trái phép và **không** sửa đổi tệp cài đặt lõi của Antigravity.

---

## Bản quyền & Ghi nhận nguồn gốc
- Mã nguồn dự án phát hành theo giấy phép **MIT** ([LICENSE](LICENSE)).
- Đôi mắt SVG, chuyển động mắt và logic nháy mắt/glitch tham khảo từ [`Chengzhibense/Fairy-DSH`](https://github.com/Chengzhibense/Fairy-DSH) (**Apache-2.0**, chi tiết xem [NOTICE-fairy-dsh.md](NOTICE-fairy-dsh.md)).
- Phát triển từ nền tảng giao diện plugin gốc [`AssassinVIX/fairy-zzz-plugin`](https://github.com/AssassinVIX/fairy-zzz-plugin).
- Hình ảnh nhân vật và video khởi động *Fairy / H.D.D* thuộc bản quyền **miHoYo / HoYoverse** (*Zenless Zone Zero*), chỉ sử dụng cho mục đích cá nhân phi thương mại.

---

# English

**Tiếng Việt** · **English**

A **Fairy III · Zenless Zone Zero H.D.D Desktop Overlay, Plugin & AI Butler** built for **Google Antigravity** on **Windows** and **macOS (Apple Silicon native `arm64`)**, forked from [`AssassinVIX/fairy-zzz-plugin`](https://github.com/AssassinVIX/fairy-zzz-plugin) with eye geometry adapted from [`Chengzhibense/Fairy-DSH`](https://github.com/Chengzhibense/Fairy-DSH).

- **Transparent Always-on-Top Overlay:** Full-screen H.D.D boot sequence, time-aware greetings, 8 live eye expressions synced via Antigravity hooks, smart click-through shaping, and macOS Metal GPU acceleration.
- **Local Vietnamese Neural TTS (`VieNeu-TTS` + 2-layer DSP):** Real-time response & Voice Mode subtitle speech (via IPC hook push + Windows UIA / macOS AppleScript), automatic per-app Antigravity mute via Windows WASAPI, and anti-repeat/user-speech filtering.
- **H.D.D AI Butler System:**
  - **Local Token & "Electricity Bill" Monitor:** Incrementally aggregates real `input/output/cache_read` tokens from local `transcript.jsonl` against a configurable daily budget (`5M–100M`).
  - **Daily Session Briefing:** Summarizes Git branch/uncommitted count across recent repos, daily token burn, and pinned notes on startup or one-click.
  - **Instant Assistant Mode (`AGY` ↔ `TỨC THÌ`):** Standalone butler mode outside Antigravity with foreground app detection, **Auto Clipboard Read** for browsers and external AI web apps, Pomodoro timer, hands-free actions, and natural Vietnamese commands.
  - **Persistent H.D.D Memory:** Stored at `~/.gemini/antigravity/plugin_data/fairy-zzz/hdd-memory.json`.
  - **Hey Siri Support (Apple Silicon):** Run `Setup-Siri-Mac.command` to install native `~/Applications/Fairy.app` (`fairy://` deep-links + signed Apple Shortcuts).

See [Vietnamese setup instructions](#cài-đặt-nhanh) above for quick-start commands. Released under **MIT** ([LICENSE](LICENSE)) and **Apache-2.0** ([NOTICE-fairy-dsh.md](NOTICE-fairy-dsh.md)).
