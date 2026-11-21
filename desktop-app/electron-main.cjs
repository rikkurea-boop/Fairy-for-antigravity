/**
 * Electron main process for Fairy III · H.D.D Desktop Overlay.
 * Provides a transparent, Always-on-Top, click-through overlay window docked
 * cleanly alongside Google Antigravity without modifying Antigravity host files.
 */
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
  shell,
} = require('electron');
const { execFile, execFileSync, spawn } = require('node:child_process');
const {
  closeSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} = require('node:fs');
const { createServer, request: httpRequest } = require('node:http');
const { homedir } = require('node:os');
const { dirname, extname, join } = require('node:path');
const {
  classifyForegroundApp,
  createButlerCore,
  formatCompactTokens,
  parseButlerCommand,
  pickQuip,
} = require('./butler-core.cjs');

const IS_SMOKE_TEST = process.env.FAIRY_SMOKE_TEST === '1';
const FORCE_BOOT = process.argv.includes('--force-boot') || process.env.FAIRY_FORCE_BOOT === '1';
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE_NAME = 'FairyIII_HDD_Intro';

if (!IS_SMOKE_TEST) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  }
  try {
    app.setAsDefaultProtocolClient('fairy');
  } catch {
    // Ignore protocol registration errors in portable environments.
  }
}

if (IS_MAC && app.dock) {
  app.dock.hide();
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Bật kết xuất GPU mặc định để cửa sổ trong suốt khử viền alpha mịn; chỉ tắt khi cần chẩn đoán.
if (process.env.FAIRY_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
} else if (IS_MAC) {
  // Bật Metal backend trên Apple Silicon (M1 Pro) để khử rách hình ở ProMotion 120 Hz.
  app.commandLine.appendSwitch('enable-features', 'Metal');
}

const ROOT_DIR = __dirname;
const RENDERER_DIR = join(ROOT_DIR, 'renderer');
const PLUGIN_ROOT = join(ROOT_DIR, '..', 'antigravity-plugin');
const ASSETS_DIR = join(PLUGIN_ROOT, 'assets');
const APP_DATA_DIR = join(homedir(), '.gemini', 'antigravity');
const STATE_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'state.json');
const DESKTOP_ENDPOINT_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'desktop-endpoint.json');
const SIDECAR_INFO_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'sidecar.json');
const BRIDGE_INBOX_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'bridge-inbox.json');
const SIDECAR_LOG_FILE = join(APP_DATA_DIR, 'sidecar_data', 'fairy-zzz', 'fairy-hud', 'logs', 'sidecar.log');
const BRAIN_DIR = join(APP_DATA_DIR, 'brain');
const VOICE_CHATS_DIR = join(APP_DATA_DIR, 'voice_chats');
const CONV_ID_RE = /^[0-9a-f-]{8,}$/i;
const VOICE_WORKER_SCRIPT = join(ROOT_DIR, '..', 'scripts', 'antigravity-voice-worker.ps1');

function resolveTtsPythonExe() {
  const envPy = String(process.env.FAIRY_PYTHON_EXE || '').trim();
  if (envPy && existsSync(envPy)) return envPy;
  const venvRoot = join(ROOT_DIR, '..', 'voice-lab', 'VieNeu-TTS', '.venv');
  const candidates = IS_WIN
    ? [join(venvRoot, 'Scripts', 'python.exe')]
    : [join(venvRoot, 'bin', 'python'), join(venvRoot, 'bin', 'python3')];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

const TTS_PYTHON_EXE = resolveTtsPythonExe();
const TTS_DAEMON_SCRIPT = join(ROOT_DIR, '..', 'voice-lab', 'fairy_tts_daemon.py');

const ASSET_MAP = {
  '/assets/boot.webm': { file: join(ASSETS_DIR, 'boot.webm'), type: 'video/webm' },
  '/assets/boot.mp4': { file: join(ASSETS_DIR, 'boot.mp4'), type: 'video/mp4' },
  '/assets/hero.png': { file: join(ASSETS_DIR, 'hero.png'), type: 'image/png' },
  '/assets/poster.jpg': { file: join(ASSETS_DIR, 'poster.jpg'), type: 'image/jpeg' },
  '/assets/icon-180.png': { file: join(ASSETS_DIR, 'icon-180.png'), type: 'image/png' },
  '/assets/icon.svg': { file: join(PLUGIN_ROOT, 'icon.svg'), type: 'image/svg+xml; charset=utf-8' },
};

const MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wav': 'audio/wav',
};

let mainWin = null;
let tray = null;
let mediaServer = null;
let stateWatcher = null;
let voiceWatcher = null;
let transcriptWatcher = null;
let watchedTranscriptDir = '';
let lastObservedTranscriptDir = '';
let pollTimer = null;
let lastStateKey = '';
let mediaPort = 0;
let latestHookEntry = null;
let liveUiaSubtitle = null;
let uiaPollTimer = null;
let uiaPollInFlight = false;
let uiaCommittedText = '';
let uiaSubSeq = 0;

const butler = createButlerCore({ appDataDir: APP_DATA_DIR, brainDir: BRAIN_DIR });
let cachedTokenUsage = null;
let lastTokenScanAt = 0;
let currentActiveApp = null;
let lastObservedAppAt = 0;
let lastAiWebTipAt = 0;
let lastUserActivityAt = Date.now();
let pomodoroState = { active: false, startedAt: 0, endsAt: 0, remainingSec: 0, durationMin: 25 };
let pomodoroTimer = null;
let activeAppTimer = null;
let alertTimer = null;
let clipboardTimer = null;
let lastSeenClipboardText = '';
let pendingControlCmd = '';

function findProtocolArg(argv) {
  if (!Array.isArray(argv)) return '';
  return argv.find((a) => typeof a === 'string' && /^fairy:\/\//i.test(a.trim())) || '';
}

function protocolUrlToControlCmd(rawUrl) {
  try {
    const u = new URL(String(rawUrl || '').trim());
    const route = `${u.hostname || ''}${u.pathname || ''}`.replace(/^\/+|\/+$/g, '').toLowerCase();
    if (!route || route === 'boot' || route === 'start') return 'replay-boot';
    if (route === 'greet') return 'replay-greet';
    if (route === 'briefing' || route === 'report') return 'briefing-now';
    if (route === 'instant' || route === 'butler') return 'open-instant';
    if (route === 'toggle' || route === 'bubble') return 'toggle-bubble';
    if (route === 'read-clipboard' || route === 'clipboard') return 'read-clipboard';
    if (route === 'settings') return 'open-settings';
  } catch {}
  return '';
}

if (FORCE_BOOT || protocolUrlToControlCmd(findProtocolArg(process.argv)) === 'replay-boot') {
  pendingControlCmd = 'replay-boot';
} else {
  pendingControlCmd = protocolUrlToControlCmd(findProtocolArg(process.argv));
}

function serveMediaWithRange(req, res, filePath, contentType) {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const total = stat.size;
  const headers = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };

  const rangeHeader = req.headers.range;
  if (rangeHeader && /^bytes=/i.test(rangeHeader)) {
    const spec = rangeHeader.replace(/^bytes=/i, '').split(',')[0].trim();
    const parts = spec.split('-');
    let start = parts[0] === '' ? NaN : parseInt(parts[0], 10);
    let end = parts[1] === '' ? total - 1 : parseInt(parts[1], 10);

    if (Number.isNaN(start) && !Number.isNaN(end)) {
      start = Math.max(0, total - end);
      end = total - 1;
    }
    if (Number.isNaN(end) || end >= total) end = total - 1;
    if (Number.isNaN(start) || start < 0 || start > end || start >= total) {
      res.writeHead(416, { ...headers, 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }

    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(end - start + 1),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    ...headers,
    'Content-Length': String(total),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath).pipe(res);
}

function writeDesktopEndpointFile(port) {
  if (IS_SMOKE_TEST || !port) return;
  try {
    mkdirSync(dirname(DESKTOP_ENDPOINT_FILE), { recursive: true });
    writeFileSync(
      DESKTOP_ENDPOINT_FILE,
      JSON.stringify({ port: Number(port), pid: process.pid, updatedAt: Date.now() }),
      'utf-8'
    );
  } catch {
    // Ignore desktop endpoint publish error.
  }
}

function handleHookPushRequest(req, res) {
  const chunks = [];
  let totalBytes = 0;
  let finished = false;
  req.on('data', (chunk) => {
    if (finished) return;
    totalBytes += chunk.length;
    if (totalBytes > 131072) {
      finished = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end('{"ok":false,"error":"payload_too_large"}');
      try { req.destroy(); } catch {}
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (finished) return;
    finished = true;
    try {
      const body = Buffer.concat(chunks).toString('utf-8');
      const parsed = JSON.parse(body || '{}');
      const entry = parsed?.entry && typeof parsed.entry === 'object' ? parsed.entry : parsed;
      const convId = String(parsed?.conversationId || entry?.conversationId || '').trim();
      if (convId && entry) {
        if (Array.isArray(entry.recentUserTexts)) {
          registerKnownUserSpeech(entry.recentUserTexts);
        }
        if (typeof entry.lastPromptPreview === 'string' && entry.lastPromptPreview.trim()) {
          registerKnownUserSpeech(entry.lastPromptPreview);
        }
        latestHookEntry = {
          ...entry,
          conversationId: convId,
          receivedAt: Date.now(),
          source: 'hook-ipc',
        };
        pushStateToRenderer();
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"ok":false,"error":"invalid_json"}');
    }
  });
  req.on('error', () => {
    if (!finished) {
      finished = true;
      try {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"ok":false}');
      } catch {}
    }
  });
}

function dispatchControlCommand(cmd) {
  const clean = String(cmd || '').trim();
  if (!clean || clean === 'ping') {
    return { ok: true, pong: true, pid: process.pid };
  }
  if (!mainWin || mainWin.isDestroyed()) {
    pendingControlCmd = clean;
    return { ok: true, queued: true };
  }
  if (clean === 'read-clipboard') {
    executeButlerAction({ action: 'read-clipboard' }).then((res) => {
      if (res && res.ok && mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('fairy:butler-event', res);
      }
    }).catch(() => {});
    return { ok: true, executed: 'read-clipboard' };
  }
  const allowedUiCmds = new Set([
    'replay-boot',
    'replay-greet',
    'toggle-bubble',
    'open-instant',
    'open-settings',
    'briefing-now',
    'reset-pos',
    'toggle-eye',
  ]);
  if (!allowedUiCmds.has(clean)) {
    return { ok: false, error: 'unknown_cmd' };
  }
  showOverlayWindow(mainWin, false);
  mainWin.webContents.send('fairy:cmd', clean);
  return { ok: true, dispatched: clean };
}

function handleFairyProtocolUrl(rawUrl) {
  const cmd = protocolUrlToControlCmd(rawUrl);
  if (!cmd) return { ok: false, error: 'unknown_protocol_route' };
  return dispatchControlCommand(cmd);
}

function handleLocalCmdRequest(req, res) {
  const chunks = [];
  let totalBytes = 0;
  let finished = false;
  req.on('data', (chunk) => {
    if (finished) return;
    totalBytes += chunk.length;
    if (totalBytes > 8192) {
      finished = true;
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end('{"ok":false,"error":"payload_too_large"}');
      try { req.destroy(); } catch {}
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (finished) return;
    finished = true;
    try {
      const body = Buffer.concat(chunks).toString('utf-8');
      const parsed = JSON.parse(body || '{}');
      const result = parsed?.url
        ? handleFairyProtocolUrl(parsed.url)
        : dispatchControlCommand(parsed?.cmd);
      res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{"ok":false,"error":"invalid_json"}');
    }
  });
  req.on('error', () => {
    if (!finished) {
      finished = true;
      try {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end('{"ok":false}');
      } catch {}
    }
  });
}

function startLocalMediaServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const reqPath = url.pathname;

      if (req.method === 'POST' && reqPath === '/api/hook-push') {
        handleHookPushRequest(req, res);
        return;
      }
      if (req.method === 'POST' && reqPath === '/api/cmd') {
        handleLocalCmdRequest(req, res);
        return;
      }

      if (ASSET_MAP[reqPath]) {
        const asset = ASSET_MAP[reqPath];
        serveMediaWithRange(req, res, asset.file, asset.type);
        return;
      }

      const voiceMatch = /^\/assets\/voice\/([a-z0-9_-]+\.wav)$/i.exec(reqPath);
      if (voiceMatch) {
        const pluginVoicePath = join(PLUGIN_ROOT, 'assets', 'voice', voiceMatch[1]);
        const repoVoicePath = join(ROOT_DIR, '..', 'assets', 'voice', voiceMatch[1]);
        const voicePath = existsSync(pluginVoicePath) ? pluginVoicePath : repoVoicePath;
        serveMediaWithRange(req, res, voicePath, 'audio/wav');
        return;
      }

      const rel = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
      if (rel.includes('..') || rel.includes('\\')) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const target = join(RENDERER_DIR, rel);
      try {
        const buf = readFileSync(target);
        const type = MIME_MAP[extname(target).toLowerCase()] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Length': String(buf.byteLength),
          'Cache-Control': 'no-cache',
        });
        res.end(buf);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      mediaServer = server;
      mediaPort = addr.port;
      writeDesktopEndpointFile(addr.port);
      resolve(addr.port);
    });
  });
}

function computeEffectiveMood(entry, now) {
  if (!entry) return 'idle';
  const raw = String(entry.mood || 'idle');
  const updatedAt = Number(entry.updatedAt) || 0;
  const doneAt = Number(entry.doneAt) || updatedAt;

  if (raw === 'done' && now - doneAt > 4000) return 'idle';
  if (raw === 'boot' && now - updatedAt > 12000) return 'idle';
  if ((raw === 'thinking' || raw === 'working') && now - updatedAt > 180000) return 'idle';
  return raw;
}

const B_L = '(?:^|[\\s,.;:!?("“—-])';
const B_R = '(?=$|[\\s,.;:!?)”"-])';
const USER_SPEECH_FILTER_RE = new RegExp(
  '(\\?\\s*$|' +
  B_L + '(?:' +
    'giúp\\s+tôi|cho\\s+tôi|của\\s+tôi|của\\s+mình|ý\\s+tôi|nhưng\\s+mà|nếu\\s+mà|với\\s+cả|à\\s+trước|trước\\s+tôi|sao\\s+tôi|tại\\s+sao|' +
    'gửi\\s+bạn|gửi\\s+cho\\s+bạn|hãy\\s+kiểm\\s+tra|cho\\s+thấy\\s+(?:fairy|ferry)|ferry\\s+vẫn|khá\\s+là\\s+ngắt|kiểu\\s+nó\\s+bị|' +
    'tôi\\s+(?:muốn|thấy|cảm\\s+giác|nghĩ|chỉ\\s+hỏi|đã\\s+chọn|đồng\\s+ý|vẫn\\s+(?:chưa|không|thấy)|đang\\s+(?:nghĩ|thử|test|thắc\\s+mắc|bị|xài)|không\\s+(?:thấy|nghĩ|nghe|hiểu)|có\\s+gửi|vừa\\s+gửi|chỉ\\s+cần|nhớ\\s+là|bảo\\s+là|cam\\s+kết|test\\s+thử|xác\\s+nhận|đưa\\s+đường\\s+dẫn|kiểm\\s+tra)|' +
    'vậy\\s+để\\s+tôi|chúng\\s+ta\\s+chỉ\\s+chỉnh\\s+sửa|bao\\s+giờ\\s+tôi\\s+bảo|' +
    'bạn\\s+(?:thử|hãy|làm|xóa|tìm|kiểm\\s+tra|đã\\s+tìm|đã\\s+có|tiến\\s+hành|update)|' +
    'fairy\\s+(?:nó|bị|chưa|còn|mới\\s+chỉ|vừa\\s+mới|nãy|vẫn\\s+(?:bị|không|chưa|đang\\s+bị))|' +
    'dùng\\s+trực\\s+tiếp\\s+trên|cửa\\s+sổ\\s+tab|pop-?up\\s+xin\\s+quyền|bản\\s+backup\\s+đúng\\s+không|thêm\\s+cái|với\\s+cái|' +
    'được\\s+không|đúng\\s+không|phải\\s+không|có\\s+thể\\s+dùng\\s+cái\\s+này\\s+không|nhé|nhỉ|thì\\s+mới' +
  ')' + B_R + ')',
  'i'
);
const AI_SPEECH_FILTER_RE = new RegExp(
  B_L + '(?:' +
    'ngài|master|ting~|khẳng\\s+định|đề\\s+xuất|kiến\\s+nghị|cảnh\\s+báo|ghi\\s+nhận|đính\\s+chính|tỷ\\s+lệ\\s+thành\\s+công|' +
    'tôi\\s+(?:sẽ|đang|đã|hiểu|rất\\s+vui|ghi\\s+nhận|tìm\\s+thấy|không\\s+thể|không\\s+hỗ\\s+trợ|cần|đề\\s+xuất|dự\\s+định|khuyến\\s+nghị|can\\s+thiệp|cũng|chưa|chỉ\\s+xóa|giữ|hạ|giữ\\s+nguyên|vừa)|' +
    'để\\s+(?:tôi|fairy|giúp|giấu|xử\\s+lý|đổi|ưu\\s+tiên|đảm\\s+bảo|giữ|bỏ|chặn|kiểm\\s+tra|giải\\s+quyết|ghi\\s+đè|bảo\\s+vệ|thực\\s+hiện)|' +
    'chính\\s+xác|chắc\\s+chắn\\s+rồi|đúng\\s+vậy|hoàn\\s+tất|hiện\\s+trạng|kết\\s+luận|tóm\\s+tắt|' +
    'hệ\\s+thống\\s+(?:đã|hiện|sẽ|này|h\\.?d\\.?d)|luồng\\s+ipc|đường\\s+ống|việc\\s+(?:giữ|tạo|đổi|tra\\s+cứu|tắt\\s+tiếng|chuyển)|' +
    'toàn\\s+bộ\\s+(?:dự\\s+án|cấu\\s+hình|luồng|đường\\s+ống|mã\\s+nguồn|commit|nội\\s+dung|tệp)|' +
    'mọi\\s+(?:thứ|tính\\s+năng|chỉ\\s+số|thay\\s+đổi|dữ\\s+liệu)|' +
    'kho\\s+(?:cũ|mới|lưu\\s+trữ)|bản\\s+(?:dự\\s+phòng|fork|public)|phương\\s+án\\s+(?:một|hai)|thứ\\s+(?:nhất|hai|ba)|' +
    'smoke\\s+test|trên\\s+card|cơ\\s+chế|với\\s+cấu\\s+hình|bạn\\s+hoàn\\s+toàn\\s+có\\s+thể|không\\s+(?:thể\\s+can\\s+thiệp|phải\\s+lọc)|' +
    "i'll|i\\s+will|let\\s+me|checking" +
  ')' + B_R,
  'i'
);
const MASTER_ADDRESS_RE = new RegExp(B_L + '(?:ngài|master)' + B_R, 'i');

function normalizeSpeechKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const knownUserNorms = new Set();
function registerKnownUserSpeech(textOrList) {
  const arr = Array.isArray(textOrList) ? textOrList : [textOrList];
  for (const raw of arr) {
    const norm = normalizeSpeechKey(raw);
    if (!norm || norm.length < 4) continue;
    knownUserNorms.add(norm);
    if (knownUserNorms.size > 160) {
      const oldest = knownUserNorms.values().next().value;
      if (oldest !== undefined) knownUserNorms.delete(oldest);
    }
  }
}

function isKnownUserSpeech(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (MASTER_ADDRESS_RE.test(s)) return false;
  const norm = normalizeSpeechKey(s);
  if (!norm) return false;
  if (knownUserNorms.has(norm)) return true;
  if (norm.length >= 14) {
    for (const u of knownUserNorms) {
      if (u.length >= 14 && (u.includes(norm) || norm.includes(u))) return true;
    }
  }
  return false;
}

function isAssistantVoiceSubtitle(text) {
  const s = String(text || '').trim();
  if (!s) return false;
  if (isKnownUserSpeech(s)) return false;
  const hasMaster = MASTER_ADDRESS_RE.test(s);
  if (USER_SPEECH_FILTER_RE.test(s) && !hasMaster) return false;
  return AI_SPEECH_FILTER_RE.test(s);
}

const dialogueCache = new Map();
function stripSystemWrappers(raw) {
  return String(raw || '')
    .replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, ' ')
    .replace(/<voice_instructions>[\s\S]*?<\/voice_instructions>/gi, ' ')
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, ' ');
}

function extractUserLinesFromUserContent(raw) {
  const s = stripSystemWrappers(raw);
  const blocks = Array.from(s.matchAll(/<talker_agent_context>([\s\S]*?)<\/talker_agent_context>/gi));
  const items = [];
  for (const block of blocks) {
    const body = block[1] || '';
    for (const hit of body.matchAll(/^\[[^\]]+\]\s*user:\s*"([^"]+)"/gm)) {
      const text = String(hit[1] || '').replace(/\s+/g, ' ').trim();
      if (text) items.push(text.slice(0, 340));
    }
  }
  return items;
}

function extractTalkerEntriesFromUserContent(raw) {
  const s = stripSystemWrappers(raw);
  const blocks = Array.from(s.matchAll(/<talker_agent_context>([\s\S]*?)<\/talker_agent_context>/gi));
  const items = [];
  for (const block of blocks) {
    const body = block[1] || '';
    for (const hit of body.matchAll(/^\[([^\]]+)\]\s*(talker|user):\s*"([^"]+)"/gm)) {
      const role = String(hit[2] || '').toLowerCase();
      const ts = String(hit[1] || '');
      const text = String(hit[3] || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (role === 'user') {
        if (items.length > 0) items[items.length - 1].endedByUser = true;
      } else if (role === 'talker') {
        items.push({ ts, text, endedByUser: false });
      }
    }
  }
  return items;
}

function readTailUtf8(filePath, maxBytes = 262144) {
  const st = statSync(filePath);
  const size = Number(st.size) || 0;
  if (size <= 0) return { text: '', mtimeMs: st.mtimeMs, size: 0 };
  const readLen = Math.min(maxBytes, size);
  const start = Math.max(0, size - readLen);
  const buf = Buffer.allocUnsafe(readLen);
  const fd = openSync(filePath, 'r');
  try {
    let offset = 0;
    while (offset < readLen) {
      const n = readSync(fd, buf, offset, readLen - offset, start + offset);
      if (n <= 0) break;
      offset += n;
    }
    return { text: buf.subarray(0, offset).toString('utf-8'), mtimeMs: st.mtimeMs, size };
  } finally {
    try { closeSync(fd); } catch {}
  }
}

function mergeLatestCompleteTalker(talkerListsNewestFirst) {
  const chrono = [];
  for (let i = talkerListsNewestFirst.length - 1; i >= 0; i -= 1) {
    chrono.push(...talkerListsNewestFirst[i]);
  }
  if (!chrono.length) return { liveTalkerTime: '', liveTalkerText: '', liveTalkerComplete: false };

  const END_RE = /[.!?…]["”']?\s*$/;
  const mergedItems = [];
  let accText = '';
  let accTs = '';

  for (const item of chrono) {
    const t = String(item?.text || '').trim();
    if (!t) continue;
    if (!accText) {
      accText = t;
      accTs = item.ts || '';
    } else {
      const noSpace = accText.trimEnd().endsWith('-');
      const cleanPrev = accText.replace(/-\s*$/, '').trim();
      accText = `${cleanPrev}${noSpace ? '' : ' '}${t}`.trim();
    }
    if (END_RE.test(accText) || item.endedByUser) {
      mergedItems.push({ ts: accTs || item.ts || '', text: accText.replace(/-\s*$/, '').trim(), complete: true });
      accText = '';
      accTs = '';
    }
  }

  if (accText) {
    mergedItems.push({ ts: accTs, text: accText.replace(/-\s*$/, '').trim(), complete: false });
  }
  if (!mergedItems.length) return { liveTalkerTime: '', liveTalkerText: '', liveTalkerComplete: false };

  // Ghép tối đa 2 lượt gần nhất nếu lượt kế cuối vừa hoàn chỉnh ngay trước lượt dở dang mới.
  if (mergedItems.length >= 2 && !mergedItems[mergedItems.length - 1].complete && mergedItems[mergedItems.length - 2].complete) {
    const prev = mergedItems[mergedItems.length - 2];
    const last = mergedItems[mergedItems.length - 1];
    const combined = `${prev.text} ${last.text}`.trim();
    return {
      liveTalkerTime: last.ts || prev.ts,
      liveTalkerText: combined.slice(0, 680),
      liveTalkerComplete: false,
    };
  }
  const chosen = mergedItems[mergedItems.length - 1];
  return {
    liveTalkerTime: chosen.ts,
    liveTalkerText: chosen.text.slice(0, 680),
    liveTalkerComplete: Boolean(chosen.complete),
  };
}

function cleanUserTranscriptText(raw) {
  const stripped = stripSystemWrappers(raw);
  const userLines = Array.from(stripped.matchAll(/^\[[^\]]+\]\s*user:\s*"([^"]+)"/gm))
    .map((m) => String(m[1] || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (userLines.length > 0) {
    return userLines[userLines.length - 1];
  }
  const s = stripped
    .replace(/<talker_agent_context>[\s\S]*?<\/talker_agent_context>/gi, ' ')
    .replace(/<\/?USER_REQUEST>/gi, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function extractRecentDialogueFromTranscript(transcriptPath, convId) {
  const candidates = [];
  if (transcriptPath && typeof transcriptPath === 'string') {
    if (/transcript_full\.jsonl$/i.test(transcriptPath)) {
      candidates.push(transcriptPath.replace(/transcript_full\.jsonl$/i, 'transcript.jsonl'));
    }
    candidates.push(transcriptPath);
  }
  if (convId && CONV_ID_RE.test(convId)) {
    candidates.push(join(BRAIN_DIR, convId, '.system_generated', 'logs', 'transcript.jsonl'));
  }

  for (const logPath of candidates) {
    try {
      if (!existsSync(logPath)) continue;
      const { text: tailText, mtimeMs, size } = readTailUtf8(logPath, 262144);
      lastObservedTranscriptDir = dirname(logPath);
      const cacheKey = `${mtimeMs}:${size}`;
      const cached = dialogueCache.get(logPath);
      if (cached && cached.key === cacheKey) return cached.data;

      const lines = tailText.split('\n').filter((l) => l.trim());
      let userText = '';
      let modelText = '';
      let modelRawText = '';
      let hasStepError = false;
      const recentTalkerLists = [];
      const recentUserTexts = [];
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          const item = JSON.parse(lines[i]);
          if (!modelText && item.type === 'PLANNER_RESPONSE' && typeof item.content === 'string' && item.content.trim()) {
            modelRawText = item.content.trim().slice(0, 900);
            modelText = item.content.replace(/\s+/g, ' ').trim().slice(0, 500);
          }
          if (item.type === 'USER_INPUT' && typeof item.content === 'string' && item.content.trim()) {
            const cleanU = cleanUserTranscriptText(item.content).slice(0, 500);
            if (!userText) userText = cleanU;
            if (recentUserTexts.length < 12) {
              if (cleanU) recentUserTexts.push(cleanU);
              for (const u of extractUserLinesFromUserContent(item.content)) {
                if (u && recentUserTexts.length < 12) recentUserTexts.push(u);
              }
            }
            if (recentTalkerLists.length < 4) {
              const entries = extractTalkerEntriesFromUserContent(item.content);
              if (entries.length) recentTalkerLists.push(entries);
            }
          }
          if (!hasStepError && i >= lines.length - 4 && item.status === 'ERROR') {
            hasStepError = true;
          }
          if (userText && modelText && recentTalkerLists.length >= 2) break;
        } catch {
          // Skip partial boundary line.
        }
      }
      registerKnownUserSpeech(recentUserTexts);
      const { liveTalkerText, liveTalkerTime, liveTalkerComplete } = mergeLatestCompleteTalker(recentTalkerLists);
      const data = { userText, modelText, modelRawText, liveTalkerText, liveTalkerTime, liveTalkerComplete, recentUserTexts, hasStepError, mtimeMs };
      dialogueCache.set(logPath, { key: cacheKey, data });
      return data;
    } catch {
      // Try next candidate.
    }
  }
  return { userText: '', modelText: '', modelRawText: '', liveTalkerText: '', liveTalkerTime: '', liveTalkerComplete: false, recentUserTexts: [], hasStepError: false, mtimeMs: 0 };
}

const SLEEP_RE = /(\b(đi ngủ|ngủ ngon|ngủ đây|good\s*night|ngủ thôi)\b|buồn ngủ|thức khuya quá)/i;
const ALERT_USER_RE = /(\b(lỗi|bug|crash|error|fail|failed|hỏng|ban|chặn|blocked|treo|đơ)\b|không thấy|không được|không mở|không chạy|cảnh báo|nguy hiểm|sự cố)/i;
const SMUG_RE = /(\b(giỏi|tuyệt|ngon|đỉnh|xịn|chuẩn|hoàn hảo|perfect|great|awesome|nice|amazing)\b|hay quá|tốt lắm|ok rồi|được rồi|cảm ơn|thanks|thank you|quá nhanh|quá đã|tuyệt vời)/i;
const COMFORT_RE = /(\b(mệt|buồn|chán|stress)\b|khó quá|căng thẳng|tâm sự|nói chuyện|lo sợ|lo lắng|an toàn không|yên tâm|thư giãn|fairy ơi|\bơi\b)/i;
const THINK_RE = /(\b(tại sao|phân tích|so sánh|giải thích|kiểm tra|review|đánh giá|kiến trúc)\b|như thế nào|làm sao|tìm cách|có thể làm)/i;

const VOICE_DONE_RE = /(hoàn thành|hoàn tất|đã xong|thành công)/i;
const VOICE_ALERT_RE = /(lỗi|bảo mật|xung đột|cảnh báo|không thể|chặn)/i;
const VOICE_COMFORT_RE = /(để giúp bạn|bạn vui lòng|bạn có đồng ý|hãy cho phép|bạn hãy)/i;

const voiceChatCache = new Map();
function parseVoiceChatFile(filePath, now = Date.now(), maxStaleMs = Infinity) {
  try {
    if (!filePath || !existsSync(filePath)) return null;
    const st = statSync(filePath);
    if (now - st.mtimeMs > maxStaleMs) return null;

    const cacheKey = `${st.mtimeMs}:${st.size}`;
    const hit = voiceChatCache.get(filePath);
    let parsed;
    if (hit && hit.key === cacheKey) {
      parsed = hit.parsed;
    } else {
      parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
      voiceChatCache.set(filePath, { key: cacheKey, parsed });
    }

    const chats = Array.isArray(parsed?.chats) ? parsed.chats : [];
    const lastChat = chats.at(-1);
    if (!lastChat) return null;

    let lastVoiceLine = null;
    let ownerChat = lastChat;
    const recentUserTexts = [];
    for (let c = chats.length - 1; c >= 0; c -= 1) {
      const chat = chats[c];
      const lines = Array.isArray(chat?.lines) ? chat.lines : [];
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const item = lines[i];
        if (!item || typeof item.text !== 'string' || !item.text.trim()) continue;
        if (!lastVoiceLine && item.role === 'ROLE_VOICE') {
          lastVoiceLine = item;
          ownerChat = chat;
        } else if (item.role === 'ROLE_USER' && recentUserTexts.length < 16) {
          recentUserTexts.push(item.text.trim().slice(0, 340));
        }
      }
      if (lastVoiceLine && recentUserTexts.length >= 16) break;
    }
    registerKnownUserSpeech(recentUserTexts);

    const startedAtMs = lastChat.startedAt ? Date.parse(lastChat.startedAt) || 0 : 0;
    const stoppedAtMs = lastChat.stoppedAt ? Date.parse(lastChat.stoppedAt) || 0 : 0;
    const lastVoiceText = String(lastVoiceLine?.text || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    const ownerStartMs = ownerChat?.startedAt ? Date.parse(ownerChat.startedAt) || 0 : 0;
    const lastVoiceTime = (lastVoiceLine?.time ? Date.parse(lastVoiceLine.time) : 0) || ownerStartMs || startedAtMs || st.mtimeMs;
    const voiceSessionEnded = Boolean(stoppedAtMs > 0 && stoppedAtMs >= lastVoiceTime && now - stoppedAtMs > 4500);
    const isRunning = Boolean(startedAtMs > 0 && !stoppedAtMs && now - Math.max(startedAtMs, lastVoiceTime, st.mtimeMs) < 120000);
    const isRecentLine = Boolean(lastVoiceText) && lastVoiceTime > 0 && now - lastVoiceTime < 25000 && !voiceSessionEnded;

    return {
      voiceActive: isRunning || isRecentLine,
      voiceSessionEnded,
      lastVoiceText,
      lastVoiceTime,
      recentUserTexts,
      summary: String(lastChat.summary || '').trim(),
      mtimeMs: st.mtimeMs,
    };
  } catch {
    return null;
  }
}

function readLatestVoiceChatState(convId, now = Date.now()) {
  const MAX_VOICE_AGE_MS = 10 * 60 * 1000;
  try {
    if (!existsSync(VOICE_CHATS_DIR)) {
      return { voiceActive: false, lastVoiceText: '', lastVoiceTime: 0 };
    }
    if (convId && CONV_ID_RE.test(convId)) {
      const exact = parseVoiceChatFile(join(VOICE_CHATS_DIR, `${convId}.json`), now, MAX_VOICE_AGE_MS);
      if (exact) return exact;
    }
    let best = null;
    for (const file of readdirSync(VOICE_CHATS_DIR)) {
      if (!file.endsWith('.json')) continue;
      const parsed = parseVoiceChatFile(join(VOICE_CHATS_DIR, file), now, MAX_VOICE_AGE_MS);
      if (parsed && (!best || parsed.mtimeMs > best.mtimeMs)) {
        best = parsed;
      }
    }
    return best || { voiceActive: false, lastVoiceText: '', lastVoiceTime: 0 };
  } catch {
    return { voiceActive: false, lastVoiceText: '', lastVoiceTime: 0 };
  }
}

function analyzeDialogueContext({ entry = {}, userText = '', modelText = '', voiceChat = null, hasStepError = false, now = Date.now() }) {
  const baseMood = computeEffectiveMood(entry, now);
  const promptText = String(userText || entry.lastPromptPreview || '').trim();
  const replyText = String(modelText || '').trim();
  const updatedAt = Number(entry.updatedAt) || 0;
  const freshError = Boolean(entry.lastToolError) || entry.terminationReason === 'ERROR' || Boolean(hasStepError);
  const voiceText = String(voiceChat?.lastVoiceText || '').trim();
  const voiceFresh = Boolean(voiceChat?.voiceActive) || (Boolean(voiceText) && Number(voiceChat?.lastVoiceTime) > 0 && now - Number(voiceChat.lastVoiceTime) < 30000);

  let emotionMood = 'idle';
  let dialogueQuip = '';

  if (freshError && now - updatedAt < 30000) {
    emotionMood = 'alert';
    dialogueQuip = `— Cảnh báo: Vừa phát sinh sự cố ở ${entry.lastTool || 'tiến trình'}. Để tôi kiểm tra và xử lý ngay, Master.`;
  } else if (voiceFresh) {
    if (VOICE_DONE_RE.test(voiceText)) {
      emotionMood = 'smug';
    } else if (VOICE_ALERT_RE.test(voiceText)) {
      emotionMood = 'alert';
    } else if (VOICE_COMFORT_RE.test(voiceText) || voiceChat?.voiceActive) {
      emotionMood = 'comforting';
    }
    dialogueQuip = voiceText ? `🎙️ ${voiceText}` : '🎙️ Kênh thoại Antigravity đang mở. Tôi đang lắng nghe, Master.';
  } else if (SLEEP_RE.test(promptText)) {
    emotionMood = 'sleepy';
    dialogueQuip = 'Đã muộn rồi, Master nhớ nghỉ ngơi sớm. Chế độ trực đêm của Fairy sẽ giữ liên kết ở mức tiết kiệm điện.';
  } else if (ALERT_USER_RE.test(promptText)) {
    emotionMood = 'alert';
    dialogueQuip = '— Tôi đã ghi nhận vấn đề Master vừa nêu. Đang rà soát nguyên nhân và khoanh vùng lỗi ngay.';
  } else if (SMUG_RE.test(promptText)) {
    emotionMood = 'smug';
    dialogueQuip = '— Ting~ Chuyện nhỏ thôi, Master. Hiệu suất của hệ thống H.D.D thế hệ III vốn luôn vượt kỳ vọng mà.';
  } else if (COMFORT_RE.test(promptText)) {
    emotionMood = 'comforting';
    dialogueQuip = 'Đừng căng thẳng quá, Master. Ngài cứ nói chuyện hoặc giao việc tiếp — Fairy vẫn đang đồng hành cùng ngài đây.';
  } else if (THINK_RE.test(promptText)) {
    emotionMood = 'thinking';
    dialogueQuip = 'Đang đối chiếu dữ liệu và suy luận phương án tối ưu nhất cho Master.';
  } else if (replyText) {
    const replyHead = replyText.slice(0, 260);
    if (/(cảnh báo|nghiêm trọng|thất bại|bị chặn|blocked)/i.test(replyHead)) {
      emotionMood = 'alert';
      dialogueQuip = '— Lưu ý: Có điểm cần Master kiểm tra kỹ trong phản hồi vừa rồi.';
    } else if (/(nghỉ ngơi|đừng thức|giữ sức|yên tâm|nhẹ nhàng|đã qua nửa đêm)/i.test(replyHead)) {
      emotionMood = 'comforting';
      dialogueQuip = 'Mọi thứ vẫn trong tầm kiểm soát. Master nhớ giữ nhịp nghỉ hợp lý nhé.';
    } else if (Number(entry.toolCount) >= 3 && (baseMood === 'done' || entry.lastEvent === 'Stop')) {
      emotionMood = 'smug';
      dialogueQuip = `Hoàn tất gọn gàng ${entry.toolCount} thao tác công cụ — đúng chuẩn hệ thống H.D.D, thưa Master.`;
    } else if (/(hoàn tất|thành công|đã xong|sẵn sàng)/i.test(replyHead)) {
      emotionMood = 'done';
      dialogueQuip = '— Ting~ Kết quả đã sẵn sàng để Master duyệt qua.';
    }
  }

  if (!dialogueQuip) {
    if (baseMood === 'working') {
      dialogueQuip = entry.lastTool
        ? `Đang vận hành công cụ ${entry.lastTool} theo chỉ thị của ngài.`
        : 'Đang trực tiếp xử lý tác vụ cho Master.';
    } else if (baseMood === 'thinking') {
      dialogueQuip = 'Đang phân tích ngữ cảnh và lên phương án thực thi...';
    } else if (baseMood === 'done') {
      dialogueQuip = '— Ting~ Lượt xử lý vừa hoàn tất.';
    } else {
      const hour = new Date(now).getHours();
      if (hour >= 0 && hour < 5) {
        emotionMood = 'sleepy';
        dialogueQuip = 'Đã qua nửa đêm rồi, Master. Xong việc nhớ nghỉ ngơi sớm đấy nhé.';
      }
    }
  }

  // When a turn finished recently (within 35s) or voice chat is active, hold conversational emotion cleanly.
  const doneAt = Number(entry.doneAt) || updatedAt;
  let effectiveMood = baseMood;
  if (voiceFresh && (baseMood === 'idle' || baseMood === 'done')) {
    effectiveMood = emotionMood;
  } else if (baseMood === 'idle' && emotionMood !== 'idle' && now - Math.max(doneAt, updatedAt) < 35000) {
    effectiveMood = emotionMood;
  } else if (freshError && now - updatedAt < 15000) {
    effectiveMood = 'alert';
  }

  return {
    mood: effectiveMood,
    emotionMood,
    dialogueQuip,
    voiceActive: Boolean(voiceChat?.voiceActive),
  };
}

function readLatestTranscriptFallback() {
  try {
    if (!existsSync(BRAIN_DIR)) return null;
    let newest = null;
    for (const name of readdirSync(BRAIN_DIR)) {
      if (!CONV_ID_RE.test(name)) continue;
      const logPath = join(BRAIN_DIR, name, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        const st = statSync(logPath);
        if (!newest || st.mtimeMs > newest.mtimeMs) {
          newest = { id: name, path: logPath, st };
        }
      } catch {
        // Ignore folders without transcript.
      }
    }
    if (!newest) return null;

    const { st, path: logPath, id: convId } = newest;
    const readSize = Math.min(16 * 1024, st.size);
    const start = Math.max(0, st.size - readSize);
    const buf = readFileSync(logPath);
    const lines = buf.subarray(start).toString('utf-8').split('\n').filter((l) => l.trim());
    let lastEntry = null;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        lastEntry = JSON.parse(lines[i]);
        break;
      } catch {
        // Skip partial first line.
      }
    }
    const ageMs = Date.now() - st.mtimeMs;
    const isRunning = lastEntry && (lastEntry.status === 'RUNNING' || (lastEntry.type === 'PLANNER_RESPONSE' && Array.isArray(lastEntry.tool_calls) && lastEntry.tool_calls.length > 0));
    const mood = ageMs < 20000 && isRunning ? 'working' : 'idle';
    return {
      conversationId: convId,
      mood,
      rawMood: mood,
      lastEvent: 'TranscriptFallback',
      modelName: '',
      invocationCount: 0,
      toolCount: Number(lastEntry?.step_index) || 0,
      lastTool: Array.isArray(lastEntry?.tool_calls) && lastEntry.tool_calls.length ? String(lastEntry.tool_calls.at(-1)?.name || '') : '',
      lastToolError: lastEntry?.status === 'ERROR' ? 'Lỗi bước thực thi' : '',
      terminationReason: '',
      sessionStartedAt: st.birthtimeMs || st.mtimeMs,
      doneAt: 0,
      updatedAt: st.mtimeMs,
      source: 'transcript',
    };
  } catch {
    return null;
  }
}

function discoverSidecarEndpoint() {
  let info = null;
  let infoMtime = 0;
  try {
    if (existsSync(SIDECAR_INFO_FILE)) {
      infoMtime = statSync(SIDECAR_INFO_FILE).mtimeMs;
      const parsed = JSON.parse(readFileSync(SIDECAR_INFO_FILE, 'utf-8'));
      if (parsed && Number(parsed.port) > 0) {
        info = {
          port: Number(parsed.port),
          token: String(parsed.token || ''),
          workspaceUris: Array.isArray(parsed.workspaceUris) ? parsed.workspaceUris : [],
        };
      }
    }
  } catch {
    // Ignore malformed sidecar.json.
  }

  let logPort = 0;
  let logMtime = 0;
  try {
    if (existsSync(SIDECAR_LOG_FILE)) {
      logMtime = statSync(SIDECAR_LOG_FILE).mtimeMs;
      const text = readFileSync(SIDECAR_LOG_FILE, 'utf-8');
      const matches = Array.from(text.matchAll(/listening on 127\.0\.0\.1:(\d+)/g));
      if (matches.length > 0) {
        logPort = Number(matches[matches.length - 1][1]) || 0;
      }
    }
  } catch {
    // Ignore log read error.
  }

  if (info && (!logPort || infoMtime >= logMtime - 2000)) {
    return info;
  }
  if (logPort > 0) {
    return {
      port: logPort,
      token: info && info.port === logPort ? info.token : '',
      workspaceUris: info ? info.workspaceUris : [],
    };
  }
  return { port: 0, token: '', workspaceUris: [] };
}

function discoverSidecarPort() {
  return discoverSidecarEndpoint().port;
}

  const learnedPathSet = new Set();
  const maybeLearnWorkspace = (raw) => {
    const k = String(raw || '').trim();
    if (!k || learnedPathSet.has(k)) return;
    learnedPathSet.add(k);
    if (butler.learnWorkspace(k)) butler.saveMemory();
  };

  function getCachedTokenUsage(activeConvId = '', force = false) {
    const now = Date.now();
    if (force || !cachedTokenUsage || now - lastTokenScanAt >= 5000) {
      lastTokenScanAt = now;
      cachedTokenUsage = butler.scanAntigravityTokenUsage(activeConvId, now);
    }
    return cachedTokenUsage;
  }

  function buildButlerSnapshotField(activeConvId = '', forceTokenRefresh = false) {
    const tokenUsage = getCachedTokenUsage(activeConvId, forceTokenRefresh);
    const mem = butler.loadMemory();
    return {
      memoryFile: butler.memoryFile,
      tokenUsage,
      preferences: { ...mem.preferences },
      stats: { ...mem.stats },
      pinnedNotes: [...(mem.pinnedNotes || [])],
      knownWorkspaces: [...(mem.knownWorkspaces || [])],
      activeApp: currentActiveApp,
      pomodoro: { ...pomodoroState },
    };
  }

  function readSnapshot() {
    const now = Date.now();
    let diskEntry = null;
    let store = { conversations: {} };

    try {
      if (existsSync(STATE_FILE)) {
        store = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
        const conversations = store?.conversations || {};
        const preferred = store?.latestConversationId && conversations[store.latestConversationId]
          ? conversations[store.latestConversationId]
          : Object.values(conversations).sort((a, b) => (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0))[0];
        if (preferred) {
          diskEntry = { ...preferred, source: 'hook' };
        }
      }
    } catch {
      // Ignore transient file read error.
    }

    let entry = diskEntry;
    if (latestHookEntry && latestHookEntry.conversationId) {
      const ipcConv = latestHookEntry.conversationId;
      const diskForIpc = store?.conversations?.[ipcConv];
      const ipcTime = Number(latestHookEntry.updatedAt) || 0;
      const diskTime = Number(diskForIpc?.updatedAt || diskEntry?.updatedAt) || 0;
      if (!diskEntry || ipcTime >= diskTime) {
        entry = {
          ...(diskForIpc || {}),
          ...latestHookEntry,
          source: 'hook-ipc',
        };
      }
    }

    const recentConversations = Object.values(store?.conversations || {})
      .filter((c) => c && c.conversationId)
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
      .slice(0, 8)
      .map((c) => ({
        id: String(c.conversationId),
        preview: String(c.lastPromptPreview || c.lastTool || c.conversationId).replace(/\s+/g, ' ').trim().slice(0, 48),
        mood: computeEffectiveMood(c, now),
        modelName: String(c.modelName || ''),
        updatedAt: Number(c.updatedAt) || 0,
        toolCount: Number(c.toolCount) || 0,
      }));

    const sidecarEndpoint = discoverSidecarEndpoint();
    const sidecarPort = sidecarEndpoint.port || 0;
    const hybridConnected = Boolean(sidecarPort > 0 || existsSync(STATE_FILE));
    if (Array.isArray(sidecarEndpoint.workspaceUris)) {
      sidecarEndpoint.workspaceUris.forEach(maybeLearnWorkspace);
    }

    if (!entry) {
      entry = readLatestTranscriptFallback();
    }

    const uiaOpen = Boolean(liveUiaSubtitle?.voiceOpen && now - (Number(liveUiaSubtitle?.lastSeenAt) || 0) < 5000);
    const uiaFreshText =
      liveUiaSubtitle && liveUiaSubtitle.text && now - (Number(liveUiaSubtitle.updatedAt) || 0) < 20000
        ? liveUiaSubtitle
        : null;

    if (!entry) {
      return {
        conversationId: uiaFreshText ? 'live-uia' : '',
        mood: uiaOpen ? 'comforting' : 'idle',
        emotionMood: uiaOpen ? 'comforting' : 'idle',
        dialogueQuip: uiaFreshText?.text ? `🎙️ ${uiaFreshText.text}` : '',
        lastReplySpeech: '',
        voiceActive: uiaOpen,
        voiceSessionEnded: false,
        lastVoiceText: '',
        lastVoiceTime: 0,
        liveTalkerText: uiaFreshText?.text || '',
        liveTalkerTime: uiaFreshText ? `uia:${uiaFreshText.seq}` : '',
        liveTalkerComplete: Boolean(uiaFreshText?.complete),
        hybridConnected,
        sidecarPort,
        workspaceUris: sidecarEndpoint.workspaceUris || [],
        recentConversations,
        butler: buildButlerSnapshotField('', false),
        lastPromptPreview: '',
        lastEvent: '',
        modelName: '',
        invocationCount: 0,
        toolCount: 0,
        lastTool: '',
        lastToolError: '',
        terminationReason: '',
        sessionStartedAt: 0,
        updatedAt: uiaFreshText?.updatedAt || 0,
        source: uiaFreshText ? 'uia-live' : 'none',
        serverTime: now,
      };
    }

    if (entry.cwd) maybeLearnWorkspace(entry.cwd);
    if (entry.mood === 'thinking' || entry.mood === 'working' || entry.lastEvent === 'Stop') {
      lastUserActivityAt = Math.max(lastUserActivityAt, Number(entry.updatedAt) || now);
    }

    const dialogue = extractRecentDialogueFromTranscript(entry.transcriptPath, entry.conversationId);
    const voiceChat = readLatestVoiceChatState(entry.conversationId, now);
    if (uiaOpen) {
      voiceChat.voiceActive = true;
      voiceChat.voiceSessionEnded = false;
    }

    const hookLiveTime = Number(entry.liveTalkerUpdatedAt) || 0;
    const hookLiveText = String(entry.liveTalkerText || '').trim();
    const useUia = Boolean(uiaFreshText && (!hookLiveText || uiaFreshText.updatedAt >= hookLiveTime));
    const useHookLive = Boolean(!useUia && hookLiveText && (!dialogue.liveTalkerText || hookLiveTime >= (dialogue.mtimeMs || 0) - 2000));

    const liveTalkerText = useUia
      ? uiaFreshText.text
      : useHookLive
        ? hookLiveText
        : (dialogue.liveTalkerText || '');
    const liveTalkerTime = useUia
      ? `uia:${uiaFreshText.seq}`
      : useHookLive
        ? (entry.liveTalkerTime || String(hookLiveTime))
        : (dialogue.liveTalkerTime || '');
    const liveTalkerComplete = useUia
      ? Boolean(uiaFreshText.complete)
      : useHookLive
        ? Boolean(entry.liveTalkerComplete)
        : Boolean(dialogue.liveTalkerComplete);

    const effectiveUserText = dialogue.userText || entry.lastPromptPreview || '';
    if (Array.isArray(entry.recentUserTexts)) {
      registerKnownUserSpeech(entry.recentUserTexts);
    }
    if (effectiveUserText) {
      registerKnownUserSpeech(effectiveUserText);
    }
    const hookAssistantText =
      entry.lastAssistantText && Number(entry.lastAssistantUpdatedAt || 0) >= (dialogue.mtimeMs || 0) - 2000
        ? String(entry.lastAssistantText)
        : '';
    const effectiveModelRaw = dialogue.modelRawText || dialogue.modelText || hookAssistantText || '';

    const analysis = analyzeDialogueContext({
      entry,
      userText: effectiveUserText,
      modelText: dialogue.modelText || hookAssistantText,
      voiceChat: uiaFreshText ? { ...voiceChat, lastVoiceText: uiaFreshText.text || voiceChat.lastVoiceText } : voiceChat,
      hasStepError: dialogue.hasStepError,
      now,
    });

    const forceTokenRefresh = entry.lastEvent === 'Stop' && now - (Number(entry.doneAt) || 0) < 1200;

    return {
      conversationId: entry.conversationId || '',
      mood: analysis.mood,
      emotionMood: analysis.emotionMood,
      dialogueQuip: analysis.dialogueQuip,
      lastReplySpeech: buildSpeechSummaryFromModel(effectiveModelRaw),
      voiceActive: Boolean(voiceChat.voiceActive || uiaOpen),
      voiceSessionEnded: Boolean(voiceChat.voiceSessionEnded && !uiaOpen),
      lastVoiceText: voiceChat.lastVoiceText || '',
      lastVoiceTime: Number(voiceChat.lastVoiceTime) || 0,
      liveTalkerText,
      liveTalkerTime,
      liveTalkerComplete,
      hybridConnected,
      sidecarPort,
      workspaceUris: sidecarEndpoint.workspaceUris || [],
      recentConversations,
      butler: buildButlerSnapshotField(entry.conversationId || '', forceTokenRefresh),
      cwd: entry.cwd || '',
      lastPromptPreview: effectiveUserText,
      lastEvent: entry.lastEvent || '',
      modelName: entry.modelName || '',
      invocationCount: Number(entry.invocationCount) || 0,
      toolCount: Number(entry.toolCount) || 0,
      lastTool: entry.lastTool || '',
      lastToolError: entry.lastToolError || '',
      terminationReason: entry.terminationReason || '',
      sessionStartedAt: Number(entry.sessionStartedAt) || 0,
      doneAt: Number(entry.doneAt) || 0,
      updatedAt: Number(entry.updatedAt) || 0,
      source: entry.source || 'hook',
      serverTime: now,
    };
  }

function buildSpeechSummaryFromModel(raw) {
  const txt = String(raw || '').replace(/```[\s\S]*?```/g, ' ').trim();
  if (!txt) return '';
  const lines = txt.split(/\r?\n/);
  const leadLines = [];
  const headingItems = [];
  let inLead = true;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inLead && leadLines.length > 0) inLead = false;
      continue;
    }
    const isStruct = /^(?:#{1,6}\s+|\d+[.)]\s+|[-*•>]\s+|\|)/.test(trimmed);
    if (isStruct) {
      inLead = false;
      const h = trimmed.replace(/^#{1,6}\s*\d*[.)]?\s*/, '').replace(/^\d+[.)]\s*/, '');
      if (/^#{1,6}\s+/.test(line) && h) headingItems.push(h.replace(/[:*`]/g, '').trim());
      continue;
    }
    if (inLead) leadLines.push(trimmed);
  }
  const leadSpeech = leadLines.length ? cleanTextForSpeech(leadLines.join(' ')) : '';
  if (leadSpeech && leadSpeech.length >= 25) return leadSpeech;
  if (headingItems.length) {
    return cleanTextForSpeech(`Tôi đã hoàn tất các hạng mục: ${headingItems.slice(0, 3).join('; ')}.`);
  }
  return cleanTextForSpeech(txt);
}

function stripSpeechMarkdown(raw) {
  let s = String(raw || '');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/https?:\/\/\S+/gi, ' ');
  s = s.replace(/file:\/\/\/\S+/gi, ' ');
  s = s.replace(/[A-Za-z]:\\[^\s`'",)]+/g, ' ');
  s = s.replace(/`([^`]{1,40})`/g, '$1');
  s = s.replace(/`[^`]+`/g, ' ');
  s = s.replace(/^\s*—\s*Ting~\s*/i, '');
  s = s.replace(/\|[^\n]+\|/g, ' ');
  s = s.replace(/^\s*#{1,6}\s*\d*\.?\s*/gm, '');
  s = s.replace(/^\s*[-*•]\s+/gm, '');
  s = s.replace(/:\s*\r?\n+/g, '. ');
  s = s.replace(/\r?\n+/g, '. ');
  s = s.replace(/[*#_~>|`]/g, ' ');
  s = s.replace(/\.{2,}/g, '.');
  s = s.replace(/\s*\.\s*/g, '. ');
  return s.replace(/\s+/g, ' ').trim();
}

function cleanTextForSpeech(raw, maxLen = 360) {
  const s = stripSpeechMarkdown(raw);
  if (!s) return '';
  const parts = s.split(/(?<=[.!?…])\s+/).filter((p) => p.replace(/[^A-Za-zÀ-ỹ0-9]/g, '').length >= 3);
  let picked = '';
  const softFloor = Math.max(120, Math.round(maxLen * 0.78));
  for (const p of parts) {
    if (picked && picked.length + p.length + 1 > maxLen) break;
    picked = picked ? `${picked} ${p}` : p;
    if (picked.length >= softFloor) break;
  }
  return (picked || s.slice(0, maxLen)).trim();
}

function extractUnspokenSpeech(rawText, maxLen = 680) {
  const s = stripSpeechMarkdown(rawText);
  if (!s) return { text: '', sentences: [] };
  const parts = s.split(/(?<=[.!?…])\s+/).filter((p) => p.replace(/[^A-Za-zÀ-ỹ0-9]/g, '').length >= 4);
  if (!parts.length) {
    if (s.replace(/[^A-Za-zÀ-ỹ0-9]/g, '').length < 4) return { text: '', sentences: [] };
    if (isKnownUserSpeech(s) || isAlreadySpokenNorm(normalizeSpeechKey(s))) return { text: '', sentences: [] };
    return { text: s.slice(0, maxLen).trim(), sentences: [s.slice(0, maxLen).trim()] };
  }
  const kept = [];
  const seenLocal = new Set();
  let acc = '';
  for (const part of parts) {
    const cleanPart = part.trim();
    const norm = normalizeSpeechKey(cleanPart);
    if (!norm || norm.length < 4) continue;
    if (seenLocal.has(norm)) continue;
    if (isKnownUserSpeech(cleanPart) || isAlreadySpokenNorm(norm)) continue;
    if (acc && acc.length + cleanPart.length + 1 > maxLen) break;
    seenLocal.add(norm);
    kept.push(cleanPart);
    acc = acc ? `${acc} ${cleanPart}` : cleanPart;
  }
  return { text: acc.trim(), sentences: kept };
}

function pushStateToRenderer() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const snap = readSnapshot();
  const b = snap.butler || {};
  const tu = b.tokenUsage || {};
  const bSig = `${tu.todayUncached || 0}|${tu.budgetPct || 0}|${b.preferences?.assistantMode || ''}|${b.preferences?.clipboardWatch ? 1 : 0}|${b.preferences?.dailyTokenBudget || 0}|${b.pinnedNotes?.length || 0}|${b.pomodoro?.remainingSec || 0}|${b.activeApp?.appName || ''}|${b.activeApp?.aiBrand || ''}`;
  const key = `${snap.mood}|${snap.emotionMood}|${snap.updatedAt}|${snap.toolCount}|${snap.invocationCount}|${snap.conversationId}|${snap.lastToolError}|${snap.dialogueQuip}|${snap.lastReplySpeech}|${snap.liveTalkerText}|${snap.liveTalkerTime}|${snap.voiceActive}|${snap.voiceSessionEnded}|${snap.lastVoiceText}|${snap.lastVoiceTime}|${snap.sidecarPort}|${snap.recentConversations?.length || 0}|${bSig}`;
  if (key === lastStateKey) return;
  lastStateKey = key;
  mainWin.webContents.send('fairy:state', snap);
  scheduleSpeechFromSnapshot(snap);
}

function startTelemetryWatcher() {
  const dir = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz');
  let debounce = null;
  const schedulePush = () => {
    clearTimeout(debounce);
    debounce = setTimeout(pushStateToRenderer, 15);
  };
  const tryWatch = () => {
    if (!stateWatcher && existsSync(dir)) {
      try {
        stateWatcher = watch(dir, { persistent: false }, (_ev, file) => {
          if (file && file !== 'state.json' && !String(file).endsWith('.tmp')) return;
          schedulePush();
        });
        stateWatcher.on('error', () => {
          try { stateWatcher.close(); } catch {}
          stateWatcher = null;
        });
      } catch {
        stateWatcher = null;
      }
    }
    if (!voiceWatcher && existsSync(VOICE_CHATS_DIR)) {
      try {
        voiceWatcher = watch(VOICE_CHATS_DIR, { persistent: false }, (_ev, file) => {
          if (file && !String(file).endsWith('.json')) return;
          schedulePush();
        });
        voiceWatcher.on('error', () => {
          try { voiceWatcher.close(); } catch {}
          voiceWatcher = null;
        });
      } catch {
        voiceWatcher = null;
      }
    }
    const targetLogDir = lastObservedTranscriptDir;
    if (targetLogDir && targetLogDir !== watchedTranscriptDir && existsSync(targetLogDir)) {
      if (transcriptWatcher) {
        try { transcriptWatcher.close(); } catch {}
        transcriptWatcher = null;
      }
      try {
        watchedTranscriptDir = targetLogDir;
        transcriptWatcher = watch(targetLogDir, { persistent: false }, (_ev, file) => {
          if (file && file !== 'transcript.jsonl') return;
          schedulePush();
        });
        transcriptWatcher.on('error', () => {
          try { transcriptWatcher.close(); } catch {}
          transcriptWatcher = null;
          watchedTranscriptDir = '';
        });
      } catch {
        transcriptWatcher = null;
        watchedTranscriptDir = '';
      }
    }
  };

  tryWatch();
  pollTimer = setInterval(() => {
    tryWatch();
    pushStateToRenderer();
  }, 200);
}

function getStartupEnabled() {
  if (IS_WIN) {
    try {
      execFileSync('reg.exe', ['query', RUN_KEY, '/v', RUN_VALUE_NAME], {
        stdio: 'pipe',
        windowsHide: true,
      });
      return true;
    } catch {
      return false;
    }
  }
  return Boolean(app.getLoginItemSettings({ path: process.execPath, args: [ROOT_DIR] }).openAtLogin);
}

function setStartupEnabled(enabled) {
  const on = Boolean(enabled);
  if (IS_WIN) {
    try {
      if (on) {
        execFileSync(
          'reg.exe',
          [
            'add',
            RUN_KEY,
            '/v',
            RUN_VALUE_NAME,
            '/t',
            'REG_SZ',
            '/d',
            `"${process.execPath}" "${ROOT_DIR}"`,
            '/f',
          ],
          { stdio: 'pipe', windowsHide: true }
        );
        try {
          execFileSync('schtasks.exe', ['/Change', '/TN', 'FairyIII_HDD_BootIntro', '/ENABLE'], {
            stdio: 'pipe',
            windowsHide: true,
          });
        } catch {
          // Optional task may not exist.
        }
      } else {
        execFileSync('reg.exe', ['delete', RUN_KEY, '/v', RUN_VALUE_NAME, '/f'], {
          stdio: 'pipe',
          windowsHide: true,
        });
        try {
          execFileSync('schtasks.exe', ['/Change', '/TN', 'FairyIII_HDD_BootIntro', '/DISABLE'], {
            stdio: 'pipe',
            windowsHide: true,
          });
        } catch {
          // Optional task may not exist.
        }
      }
    } catch {
      // Ignore registry access error if missing on disable.
    }
    return getStartupEnabled();
  }
  app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: [ROOT_DIR] });
  return getStartupEnabled();
}

function applyAlwaysOnTop(win) {
  if (!win || win.isDestroyed()) return;
  if (IS_MAC) {
    win.setAlwaysOnTop(true, 'floating', 1);
    if (typeof win.setHiddenInMissionControl === 'function') {
      win.setHiddenInMissionControl(true);
    }
    return;
  }
  if (overlayPhase === 'boot' || overlayPhase === 'greet') {
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.moveTop();
  } else {
    win.setAlwaysOnTop(true, 'normal');
  }
}

let overlayPhase = 'boot';
let bootTopmostTimer = null;
let lastWindowRectKey = '';
let isFullscreenWindowMode = true;

function applyWindowRect(rect) {
  if (!mainWin || mainWin.isDestroyed() || IS_SMOKE_TEST) return;
  if (IS_WIN) {
    try {
      mainWin.setShape([]);
    } catch {}
  }
  const disp = screen.getPrimaryDisplay().bounds;
  if (!rect || rect.fullscreen) {
    isFullscreenWindowMode = true;
    const key = `full:${disp.x},${disp.y},${disp.width},${disp.height}`;
    if (key !== lastWindowRectKey) {
      lastWindowRectKey = key;
      mainWin.setBounds(disp);
    }
    applyAlwaysOnTop(mainWin);
    return;
  }
  isFullscreenWindowMode = false;
  const w = Math.max(80, Math.min(disp.width, Math.round(Number(rect.width) || 260)));
  const h = Math.max(80, Math.min(disp.height, Math.round(Number(rect.height) || 260)));
  const minX = disp.x;
  const maxX = disp.x + Math.max(0, disp.width - w);
  const minY = disp.y;
  const maxY = disp.y + Math.max(0, disp.height - h);
  const x = Math.round(Math.min(Math.max(Number(rect.x) || 0, minX), maxX));
  const y = Math.round(Math.min(Math.max(Number(rect.y) || 0, minY), maxY));
  const key = `${x},${y},${w},${h}`;
  if (key !== lastWindowRectKey) {
    lastWindowRectKey = key;
    mainWin.setBounds({ x, y, width: w, height: h });
  }
}

function updateBootTopmostLoop(nextPhase) {
  overlayPhase = nextPhase === 'boot' || nextPhase === 'greet' ? nextPhase : 'dock';
  if (bootTopmostTimer) {
    clearInterval(bootTopmostTimer);
    bootTopmostTimer = null;
  }
  if (!IS_WIN || IS_SMOKE_TEST || !mainWin || mainWin.isDestroyed()) return;
  if (overlayPhase === 'boot' || overlayPhase === 'greet') {
    applyWindowRect({ fullscreen: true });
    bootTopmostTimer = setInterval(() => {
      if (!mainWin || mainWin.isDestroyed()) {
        clearInterval(bootTopmostTimer);
        bootTopmostTimer = null;
        return;
      }
      if (overlayPhase === 'boot' || overlayPhase === 'greet') {
        try {
          mainWin.setAlwaysOnTop(true, 'screen-saver', 1);
          mainWin.moveTop();
        } catch {}
      }
    }, 250);
  } else {
    try {
      mainWin.setShape([]);
    } catch {}
    applyAlwaysOnTop(mainWin);
  }
}

function showOverlayWindow(win, focusWindow = false) {
  if (!win || win.isDestroyed() || IS_SMOKE_TEST) return;
  if (typeof win.showInactive === 'function' && !focusWindow) {
    win.showInactive();
  } else {
    win.show();
  }
  if (focusWindow && lastMainFocusable) {
    win.focus();
  }
  win.moveTop();
  applyAlwaysOnTop(win);
}

function createOverlayWindow(port) {
  const fullBounds = screen.getPrimaryDisplay().bounds;
  const icoPath = join(ROOT_DIR, 'fairy.ico');
  const iconFile = existsSync(icoPath) ? icoPath : join(ASSETS_DIR, 'icon-180.png');
  mainWin = new BrowserWindow({
    x: fullBounds.x,
    y: fullBounds.y,
    width: fullBounds.width,
    height: fullBounds.height,
    icon: iconFile,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: !IS_WIN,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: join(ROOT_DIR, 'preload-desktop.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  applyAlwaysOnTop(mainWin);
  // setVisibleOnAllWorkspaces cloaks frameless transparent HWNDs on Windows 10/11.
  if (IS_MAC) {
    mainWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  mainWin.once('ready-to-show', () => {
    showOverlayWindow(mainWin, !IS_WIN);
    updateBootTopmostLoop(overlayPhase);
  });

  mainWin.webContents.on('did-finish-load', () => {
    showOverlayWindow(mainWin, false);
  });

  screen.on('display-metrics-changed', () => {
    if (!mainWin || mainWin.isDestroyed()) return;
    lastWindowRectKey = '';
    if (isFullscreenWindowMode || overlayPhase === 'boot' || overlayPhase === 'greet') {
      applyWindowRect({ fullscreen: true });
    }
    mainWin.webContents.send('fairy:cmd', 'display-changed');
  });

  const startQuery = pendingControlCmd === 'replay-boot' || FORCE_BOOT ? '?boot=1' : '';
  mainWin.loadURL(`http://127.0.0.1:${port}/${startQuery}`);
}

function createTray() {
  const iconPath = join(ASSETS_DIR, 'icon-180.png');
  const iconSize = IS_MAC ? 18 : 20;
  const icon = nativeImage.createFromPath(iconPath).resize({ width: iconSize, height: iconSize });
  tray = new Tray(icon);
  tray.setToolTip('Fairy III · H.D.D Terminal (Antigravity)');

  const sendCmd = (cmd) => dispatchControlCommand(cmd);

  const shortcutHint = IS_MAC ? 'Cmd/Option+Shift+F' : 'Alt+Shift+F';
  const instantHint = IS_MAC ? 'Cmd/Option+Shift+A' : 'Alt+Shift+A';
  const readClipHint = IS_MAC ? 'Cmd/Option+Shift+R' : 'Alt+Shift+R';
  const contextMenu = Menu.buildFromTemplate([
    { label: '▶ Phát lại Boot + Âm thanh', click: () => sendCmd('replay-boot') },
    { label: '◈ Hiện lời chào H.D.D', click: () => sendCmd('replay-greet') },
    { label: `💬 Bật / Tắt bong bóng (${shortcutHint})`, click: () => sendCmd('toggle-bubble') },
    { label: `⚡ Mở Trợ lý Tức thì (${instantHint})`, click: () => sendCmd('open-instant') },
    { label: '📋 Báo cáo H.D.D ngay', click: () => sendCmd('briefing-now') },
    { label: `🔊 Đọc Clipboard ngay (${readClipHint})`, click: () => sendCmd('read-clipboard') },
    {
      label: '⏱ Pomodoro 25 phút',
      click: () => {
        executeButlerAction({ action: 'pomodoro-start', minutes: 25 }).then((res) => {
          if (res?.ok && mainWin && !mainWin.isDestroyed()) {
            mainWin.webContents.send('fairy:butler-event', res);
          }
        }).catch(() => {});
      },
    },
    { type: 'separator' },
    { label: '⚙ Cài đặt H.D.D & Biểu cảm', click: () => sendCmd('open-settings') },
    { label: '↺ Đặt lại vị trí mắt (25vw / 52vh)', click: () => sendCmd('reset-pos') },
    { label: '👁 Hiện / Ẩn mắt Fairy', click: () => sendCmd('toggle-eye') },
    { type: 'separator' },
    { label: '✕ Thoát Fairy Overlay', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => sendCmd('toggle-bubble'));
}

app.on('open-url', (event, rawUrl) => {
  event.preventDefault();
  handleFairyProtocolUrl(rawUrl);
});

app.on('second-instance', (_event, argv) => {
  const proto = findProtocolArg(argv);
  if (proto) {
    handleFairyProtocolUrl(proto);
    return;
  }
  if (!mainWin || mainWin.isDestroyed()) return;
  showOverlayWindow(mainWin, true);
  mainWin.webContents.send('fairy:cmd', 'replay-boot');
});

app.on('activate', () => {
  if (!mainWin || mainWin.isDestroyed()) return;
  showOverlayWindow(mainWin, false);
});

ipcMain.on('fairy:set-ignore-mouse', (_ev, ignore) => {
  if (!mainWin || mainWin.isDestroyed()) return;
  mainWin.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});

ipcMain.on('fairy:set-phase', (_ev, nextPhase) => {
  updateBootTopmostLoop(String(nextPhase || 'dock'));
});

ipcMain.on('fairy:set-window-rect', (_ev, rect) => {
  applyWindowRect(rect);
});

ipcMain.handle('fairy:get-display-bounds', () => screen.getPrimaryDisplay().bounds);

let lastMainFocusable = !IS_WIN;
ipcMain.on('fairy:set-focusable', (_ev, focusable) => {
  if (!mainWin || mainWin.isDestroyed() || !IS_WIN || IS_SMOKE_TEST) return;
  try {
    const on = Boolean(focusable);
    if (on === lastMainFocusable) return;
    lastMainFocusable = on;
    if (!on) mainWin.blur();
    mainWin.setFocusable(on);
    if (on) mainWin.focus();
  } catch {
    // Bỏ qua nếu hệ điều hành không hỗ trợ đổi focusable động.
  }
});

ipcMain.on('fairy:set-shape', () => {
  if (!mainWin || mainWin.isDestroyed() || !IS_WIN || IS_SMOKE_TEST) return;
  try {
    mainWin.setShape([]);
  } catch {
    // Không cần SetWindowRgn khi dùng cửa sổ OS nhỏ gọn trực tiếp.
  }
});

let voiceWorker = null;
let voiceWorkerReady = false;
let voiceWorkerBuf = '';
let voiceReqSeq = 0;
const voicePending = new Map();

function rejectPendingVoice(reason) {
  for (const [id, entry] of voicePending.entries()) {
    clearTimeout(entry.timer);
    entry.resolve({ ok: false, error: reason });
    voicePending.delete(id);
  }
}

function startVoiceWorker() {
  if (!IS_WIN || IS_SMOKE_TEST || voiceWorker || !existsSync(VOICE_WORKER_SCRIPT)) return;
  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', VOICE_WORKER_SCRIPT],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }
    );
    voiceWorker = child;
    voiceWorkerReady = false;
    voiceWorkerBuf = '';

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => {
      voiceWorkerBuf += chunk;
      const lines = voiceWorkerBuf.split(/\r?\n/);
      voiceWorkerBuf = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.ready) {
            voiceWorkerReady = true;
            syncAntigravityMuteState(true);
            continue;
          }
          if (typeof msg.id === 'number' && voicePending.has(msg.id)) {
            const p = voicePending.get(msg.id);
            clearTimeout(p.timer);
            voicePending.delete(msg.id);
            p.resolve(msg);
          }
        } catch {
          // Ignore non-JSON stdout line.
        }
      }
    });

    child.on('exit', () => {
      if (voiceWorker === child) {
        voiceWorker = null;
        voiceWorkerReady = false;
      }
      rejectPendingVoice('worker_exited');
    });
    child.on('error', () => {
      if (voiceWorker === child) {
        voiceWorker = null;
        voiceWorkerReady = false;
      }
      rejectPendingVoice('worker_error');
    });
  } catch {
    voiceWorker = null;
  }
}

let autoMuteAntigravity = true;
let lastMuteSyncAt = 0;

function syncAntigravityMuteState(force = false) {
  if (!IS_WIN || IS_SMOKE_TEST || !voiceWorkerReady) return;
  const now = Date.now();
  if (!force && now - lastMuteSyncAt < 3800) return;
  lastMuteSyncAt = now;
  const shouldMute = Boolean(ttsEnabled && autoMuteAntigravity);
  sendVoiceWorkerCommand(shouldMute ? 'MUTE_ANTIGRAVITY' : 'UNMUTE_ANTIGRAVITY', {}, 1500).catch(() => {});
}

function sendVoiceWorkerCommand(cmd, extra = {}, timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (!IS_WIN) {
      resolve({ ok: false, error: 'not_windows' });
      return;
    }
    if (!voiceWorker) startVoiceWorker();
    if (!voiceWorker || !voiceWorker.stdin || voiceWorker.killed) {
      resolve({ ok: false, error: 'worker_unavailable' });
      return;
    }
    const id = ++voiceReqSeq;
    const timer = setTimeout(() => {
      voicePending.delete(id);
      resolve({ ok: false, error: 'worker_timeout' });
    }, timeoutMs);
    voicePending.set(id, { resolve, timer });
    try {
      voiceWorker.stdin.write(`${JSON.stringify({ id, cmd, ...extra })}\n`);
    } catch {
      clearTimeout(timer);
      voicePending.delete(id);
      resolve({ ok: false, error: 'worker_write_failed' });
    }
  });
}

function triggerMacAntigravityAction(mode) {
  try {
    const script =
      mode === 'focus-chat'
        ? 'tell application "Antigravity" to activate'
        : `
          tell application "Antigravity" to activate
          delay 0.15
          tell application "System Events"
            tell process "Antigravity"
              if (count of windows) > 0 then
                set targetBtn to missing value
                try
                  set targetBtn to first button of entire contents of window 1 whose (name contains "Voice" or description contains "Voice" or name contains "Live" or name contains "Talk") and (name does not contain "Record")
                end try
                if targetBtn is not missing value then
                  click targetBtn
                else
                  set p to position of window 1
                  set s to size of window 1
                  set winRight to (item 1 of p) + (item 1 of s)
                  set winBottom to (item 2 of p) + (item 2 of s)
                  click at {winRight - 44, winBottom - 34}
                end if
              end if
            end tell
          end tell`;
    execFileSync('osascript', ['-e', script], { stdio: 'pipe', timeout: 3000 });
    return { ok: true, method: `mac-osascript:${mode}` };
  } catch (err) {
    return { ok: false, error: err?.message || 'mac_accessibility_permission_needed' };
  }
}

async function triggerAntigravityVoice(payload = {}) {
  const mode = String(payload?.mode || 'voice-mode');

  if (IS_MAC) {
    return triggerMacAntigravityAction(mode);
  }
  if (!IS_WIN) {
    return { ok: false, error: 'unsupported_platform' };
  }

  const cmd =
    mode === 'win-voice'
      ? 'WIN_VOICE'
      : mode === 'focus-chat'
        ? 'FOCUS_CHAT'
        : 'VOICE_MODE';
  return sendVoiceWorkerCommand(
    cmd,
    { muteAg: Boolean(ttsEnabled && autoMuteAntigravity) },
    voiceWorkerReady ? 4500 : 8000
  );
}

function postToSidecar(port, token, reqPath, bodyObj, timeoutMs = 2500) {
  return new Promise((resolve) => {
    if (!port) {
      resolve({ status: 0, data: null });
      return;
    }
    const payload = JSON.stringify(bodyObj || {});
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: reqPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...(token ? { 'X-Sidecar-Token': token } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let out = '';
        res.on('data', (chunk) => {
          out += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 0, data: out ? JSON.parse(out) : null });
          } catch {
            resolve({ status: res.statusCode || 0, data: null });
          }
        });
      }
    );
    req.on('timeout', () => {
      try { req.destroy(); } catch {}
      resolve({ status: 0, data: null });
    });
    req.on('error', () => resolve({ status: 0, data: null }));
    req.end(payload);
  });
}

async function executeHybridAction(req = {}) {
  const action = String(req?.action || '').trim();
  if (!action) return { ok: false, error: 'missing_action' };

  const snap = readSnapshot();
  const conversationId = String(req?.conversationId || snap.conversationId || '').trim();
  const message = String(req?.message || '').trim();
  const title = String(req?.title || '').trim();
  const cmdId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const cmdPayload = {
    id: cmdId,
    action,
    conversationId,
    message,
    title,
    ts: Date.now(),
  };

  try {
    mkdirSync(dirname(BRIDGE_INBOX_FILE), { recursive: true });
    writeFileSync(BRIDGE_INBOX_FILE, JSON.stringify(cmdPayload), 'utf-8');
  } catch {
    // Ignore inbox write error.
  }

  const endpoint = discoverSidecarEndpoint();
  let httpResult = { status: 0, data: null };
  if (endpoint.port > 0) {
    httpResult = await postToSidecar(endpoint.port, endpoint.token, '/api/bridge/action', cmdPayload, 2500);
    if (httpResult.status >= 200 && httpResult.status < 300 && httpResult.data?.ok) {
      if (httpResult.data.executedDirect) {
        try {
          writeFileSync(BRIDGE_INBOX_FILE, JSON.stringify({ ...cmdPayload, executed: true, executedAt: Date.now() }), 'utf-8');
        } catch {}
      }
      return { ...httpResult.data, sidecarPort: endpoint.port };
    }
  }

  if ((action === 'send-message' || action === 'new-conversation') && process.env.ANTIGRAVITY_LS_ADDRESS && process.env.ANTIGRAVITY_CSRF_TOKEN) {
    try {
      const lsCandidates = IS_MAC
        ? [
            '/Applications/Antigravity.app/Contents/Resources/bin/language_server',
            join(homedir(), 'Applications', 'Antigravity.app', 'Contents/Resources/bin/language_server'),
          ]
        : [join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe')];
      const defaultLsExe = lsCandidates.find((p) => existsSync(p)) || '';
      const lsExe = process.env.ANTIGRAVITY_AGENTAPI_EXE || defaultLsExe;
      if (lsExe) {
        const args =
          action === 'new-conversation'
            ? ['agentapi', 'new-conversation', '--model', String(req?.model || 'flash'), message || 'Xin chào Fairy.']
            : ['agentapi', 'send-message', conversationId, message];
        const out = execFileSync(lsExe, args, { encoding: 'utf-8', env: { ...process.env }, windowsHide: true, timeout: 8000 });
        writeFileSync(BRIDGE_INBOX_FILE, JSON.stringify({ ...cmdPayload, executed: true, executedAt: Date.now() }), 'utf-8');
        return { ok: true, executedDirect: true, via: 'direct-agentapi', result: out.trim() ? JSON.parse(out) : {} };
      }
    } catch {
      // Fall through to queued inbox result.
    }
  }

  return {
    ok: true,
    queued: true,
    via: 'bridge-inbox',
    sidecarPort: endpoint.port,
    needsReload: httpResult.status === 404,
  };
}

ipcMain.handle('fairy:get-state', () => readSnapshot());
ipcMain.handle('fairy:get-startup', () => getStartupEnabled());
ipcMain.handle('fairy:set-startup', (_ev, enabled) => setStartupEnabled(Boolean(enabled)));
ipcMain.handle('fairy:trigger-voice', (_ev, payload) => triggerAntigravityVoice(payload));
ipcMain.handle('fairy:hybrid-action', (_ev, req) => executeHybridAction(req));

let ttsWorker = null;
let ttsWorkerReady = false;
let ttsWorkerBuf = '';
let ttsReqSeq = 0;
const ttsPending = new Map();
let ttsEnabled = true;
let ttsBusy = false;
const ttsSpeechQueue = [];
let ttsBaselineReady = false;
const spokenStateByConv = new Map();
let voiceDebounceTimer = null;
let vcDebounceTimer = null;
let stopDebounceTimer = null;

const spokenVoiceKeys = new Set();
const spokenVoiceNorms = new Set();

function markSpokenVoiceKey(key) {
  if (!key) return;
  spokenVoiceKeys.add(key);
  if (spokenVoiceKeys.size > 120) {
    const oldest = spokenVoiceKeys.values().next().value;
    if (oldest !== undefined) spokenVoiceKeys.delete(oldest);
  }
}

function markSpokenVoiceNorm(text) {
  const norm = normalizeSpeechKey(text);
  if (!norm || norm.length < 4) return;
  spokenVoiceNorms.add(norm);
  if (spokenVoiceNorms.size > 150) {
    const oldest = spokenVoiceNorms.values().next().value;
    if (oldest !== undefined) spokenVoiceNorms.delete(oldest);
  }
}

function isAlreadySpokenNorm(norm) {
  if (!norm) return false;
  if (spokenVoiceNorms.has(norm)) return true;
  if (norm.length >= 14) {
    for (const prev of spokenVoiceNorms) {
      if (prev.length >= 14 && (prev.includes(norm) || prev.startsWith(norm))) {
        return true;
      }
    }
  }
  const curWords = norm.split(' ').filter(Boolean);
  if (curWords.length >= 5) {
    const curSet = new Set(curWords);
    const curHead = curWords.slice(0, 3);
    for (const prev of spokenVoiceNorms) {
      const prevWords = prev.split(' ').filter(Boolean);
      if (prevWords.length < 5) continue;
      const prevSet = new Set(prevWords);
      const smaller = curSet.size <= prevSet.size ? curSet : prevSet;
      const larger = curSet.size <= prevSet.size ? prevSet : curSet;
      let overlap = 0;
      for (const w of smaller) {
        if (larger.has(w)) overlap += 1;
      }
      const ratio = overlap / smaller.size;
      if (ratio >= 0.8) return true;
      if (ratio >= 0.72) {
        const prevHeadSet = new Set(prevWords.slice(0, 4));
        let headMatch = 0;
        for (const hw of curHead) {
          if (prevHeadSet.has(hw)) headMatch += 1;
        }
        if (headMatch >= 2) return true;
      }
    }
  }
  return false;
}

function getConvSpokenState(convId) {
  const key = convId || 'default';
  if (!spokenStateByConv.has(key)) {
    spokenStateByConv.set(key, {
      lastVoiceKey: '',
      lastVcKey: '',
      lastStopKey: '',
      lastText: '',
      incompletePrefix: '',
    });
  }
  return spokenStateByConv.get(key);
}

function rejectPendingTts(reason) {
  for (const [id, entry] of ttsPending.entries()) {
    clearTimeout(entry.timer);
    entry.resolve({ ok: false, error: reason });
    ttsPending.delete(id);
  }
}

function startTtsWorker() {
  if (IS_SMOKE_TEST || ttsWorker || !existsSync(TTS_PYTHON_EXE) || !existsSync(TTS_DAEMON_SCRIPT)) return;
  try {
    const childEnv = { ...process.env };
    if (IS_MAC) {
      childEnv.PATH = `/opt/homebrew/bin:/usr/local/bin:${childEnv.PATH || '/usr/bin:/bin'}`;
      childEnv.PYTORCH_ENABLE_MPS_FALLBACK = childEnv.PYTORCH_ENABLE_MPS_FALLBACK || '1';
    }
    const child = spawn(TTS_PYTHON_EXE, [TTS_DAEMON_SCRIPT], {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    ttsWorker = child;
    ttsWorkerReady = false;
    ttsWorkerBuf = '';

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => {
      ttsWorkerBuf += chunk;
      const lines = ttsWorkerBuf.split(/\r?\n/);
      ttsWorkerBuf = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (typeof msg.ready === 'boolean') {
            ttsWorkerReady = msg.ready;
            continue;
          }
          if (typeof msg.id === 'number' && ttsPending.has(msg.id)) {
            const p = ttsPending.get(msg.id);
            if (msg.chunk === true) {
              const fileName = String(msg.out || '').split(/[\\/]/).pop();
              if (fileName && typeof p.onChunk === 'function') {
                p.onChunk({
                  reqId: msg.id,
                  url: `/assets/voice/${fileName}?t=${Date.now()}`,
                  text: p.text,
                  clause: msg.clause || '',
                  chunkIndex: Number(msg.chunkIndex) || 0,
                  totalChunks: Number(msg.totalChunks) || 1,
                });
              }
              continue;
            }
            clearTimeout(p.timer);
            ttsPending.delete(msg.id);
            p.resolve(msg);
          }
        } catch {
          // Ignore non-JSON stdout line.
        }
      }
    });

    child.on('exit', () => {
      if (ttsWorker === child) {
        ttsWorker = null;
        ttsWorkerReady = false;
      }
      rejectPendingTts('tts_worker_exited');
    });
    child.on('error', () => {
      if (ttsWorker === child) {
        ttsWorker = null;
        ttsWorkerReady = false;
      }
      rejectPendingTts('tts_worker_error');
    });
  } catch {
    ttsWorker = null;
  }
}

function runTtsSynthesis(text, onChunk = null, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const cleaned = cleanTextForSpeech(text, 680);
    if (!cleaned || IS_SMOKE_TEST) {
      resolve({ ok: false, error: 'empty_or_smoke' });
      return;
    }
    if (!ttsWorker) startTtsWorker();
    if (!ttsWorker || !ttsWorker.stdin || ttsWorker.killed) {
      resolve({ ok: false, error: 'tts_unavailable' });
      return;
    }
    const id = ++ttsReqSeq;
    const fileName = `live-${id % 16}.wav`;
    const outPath = join(PLUGIN_ROOT, 'assets', 'voice', fileName);
    let sawChunk = false;
    const timer = setTimeout(() => {
      if (ttsPending.has(id)) {
        ttsPending.delete(id);
        resolve({ ok: false, error: 'tts_timeout' });
      }
    }, timeoutMs);
    ttsPending.set(id, {
      timer,
      text: cleaned,
      onChunk: (chunkPayload) => {
        sawChunk = true;
        if (typeof onChunk === 'function') onChunk(chunkPayload);
      },
      resolve: (res) => {
        const resName = String(res?.out || '').split(/[\\/]/).pop() || fileName;
        resolve({ ...res, reqId: id, sawChunk, url: `/assets/voice/${resName}?t=${Date.now()}`, text: cleaned });
      },
    });
    try {
      ttsWorker.stdin.write(`${JSON.stringify({ id, text: cleaned, out: outPath })}\n`, 'utf-8');
    } catch {
      clearTimeout(timer);
      ttsPending.delete(id);
      resolve({ ok: false, error: 'tts_write_failed' });
    }
  });
}

async function enqueueFairySpeech(text) {
  const cleaned = cleanTextForSpeech(text, 680);
  if (!cleaned || !ttsEnabled || IS_SMOKE_TEST) return { ok: false, skipped: true };
  if (ttsBusy) {
    const tail = ttsSpeechQueue[ttsSpeechQueue.length - 1] || '';
    if (tail !== cleaned) {
      ttsSpeechQueue.push(cleaned);
      if (ttsSpeechQueue.length > 6) ttsSpeechQueue.shift();
    }
    return { ok: true, queued: true };
  }
  ttsBusy = true;
  let current = cleaned;
  let lastRes = { ok: false };
  try {
    while (current) {
      const activeText = current;
      lastRes = await runTtsSynthesis(activeText, (chunkPayload) => {
        if (mainWin && !mainWin.isDestroyed() && ttsEnabled) {
          mainWin.webContents.send('fairy:speak', chunkPayload);
        }
      });
      if (lastRes.ok && !lastRes.sawChunk && mainWin && !mainWin.isDestroyed() && ttsEnabled) {
        mainWin.webContents.send('fairy:speak', {
          reqId: lastRes.reqId || 0,
          url: lastRes.url,
          text: lastRes.text || activeText,
          chunkIndex: 0,
          totalChunks: 1,
        });
      }
      current = ttsEnabled && ttsSpeechQueue.length > 0 ? ttsSpeechQueue.shift() : '';
    }
  } finally {
    ttsBusy = false;
    if (!ttsEnabled) ttsSpeechQueue.length = 0;
  }
  return lastRes;
}

function getVoiceCandidate(snap) {
  if (!snap || !snap.liveTalkerText) return { key: '', text: '', rawText: '', complete: true };
  const text = cleanTextForSpeech(snap.liveTalkerText, 680);
  if (!text) return { key: '', text: '', rawText: '', complete: true };
  return {
    key: `live:${snap.conversationId}:${snap.liveTalkerTime}:${text.slice(0, 80)}`,
    text,
    rawText: snap.liveTalkerText,
    complete: Boolean(snap.liveTalkerComplete),
  };
}

function getVcCandidate(snap) {
  if (!snap || snap.voiceSessionEnded || !snap.lastVoiceText) {
    return { key: '', text: '', rawText: '' };
  }
  const text = cleanTextForSpeech(snap.lastVoiceText, 680);
  if (!text) return { key: '', text: '', rawText: '' };
  const stamp = snap.lastVoiceTime || snap.updatedAt || '';
  return {
    key: `vc:${snap.conversationId}:${stamp}:${text.slice(0, 80)}`,
    text,
    rawText: snap.lastVoiceText,
  };
}

function getStopCandidate(snap) {
  if (!snap || (snap.lastEvent !== 'Stop' && snap.mood !== 'done')) return { key: '', text: '' };
  const quip = String(snap.dialogueQuip || '').trim();
  const safeQuip = quip.startsWith('🎙️') ? '' : cleanTextForSpeech(quip, 360);
  const text = snap.lastReplySpeech || safeQuip;
  if (!text) return { key: '', text: '' };
  const stamp = snap.doneAt || snap.updatedAt || '';
  return { key: `${snap.conversationId}:${stamp}:${text.slice(0, 60)}`, text };
}

function dispatchVoiceCandidate(cand, st) {
  if (!ttsEnabled || !cand || !cand.key || spokenVoiceKeys.has(cand.key)) return;
  markSpokenVoiceKey(cand.key);

  let rawSource = cand.rawText || cand.text;
  if (st.incompletePrefix && cand.rawText && cand.rawText.startsWith(st.incompletePrefix)) {
    const suffix = cand.rawText.slice(st.incompletePrefix.length).trim();
    if (suffix) rawSource = suffix;
  }
  if (typeof cand.complete === 'boolean') {
    st.incompletePrefix = cand.complete ? '' : (cand.rawText || '');
  }

  if (isKnownUserSpeech(rawSource) || isKnownUserSpeech(cand.rawText)) return;
  const { text: unspoken, sentences } = extractUnspokenSpeech(rawSource, 680);
  if (!unspoken || unspoken.replace(/[^A-Za-zÀ-ỹ0-9]/g, '').length < 4) return;
  if (unspoken === st.lastText) return;

  st.lastText = unspoken;
  for (const s of sentences) markSpokenVoiceNorm(s);
  markSpokenVoiceNorm(unspoken);
  enqueueFairySpeech(unspoken).catch(() => {});
}

function scheduleSpeechFromSnapshot(snap) {
  if (!snap || !snap.conversationId) return;
  const voiceInit = getVoiceCandidate(snap);
  const vcInit = getVcCandidate(snap);
  const stopInit = getStopCandidate(snap);
  const convState = getConvSpokenState(snap.conversationId);

  if (!ttsBaselineReady) {
    ttsBaselineReady = true;
    convState.lastVoiceKey = voiceInit.key;
    markSpokenVoiceKey(voiceInit.key);
    convState.lastVcKey = vcInit.key;
    markSpokenVoiceKey(vcInit.key);
    convState.lastStopKey = stopInit.key;
    convState.lastText = voiceInit.text || vcInit.text || stopInit.text || '';
    markSpokenVoiceNorm(voiceInit.text);
    markSpokenVoiceNorm(voiceInit.rawText);
    markSpokenVoiceNorm(vcInit.text);
    markSpokenVoiceNorm(vcInit.rawText);
    markSpokenVoiceNorm(snap.liveTalkerText);
    markSpokenVoiceNorm(snap.lastVoiceText);
    markSpokenVoiceNorm(stopInit.text);
    return;
  }
  if (!ttsEnabled || IS_SMOKE_TEST) return;

  // Luồng 1: Phụ đề trực tiếp (UIA / Hook)
  if (voiceInit.key && voiceInit.key !== convState.lastVoiceKey && !spokenVoiceKeys.has(voiceInit.key)) {
    convState.lastVoiceKey = voiceInit.key;
    if (voiceInit.complete) {
      clearTimeout(voiceDebounceTimer);
      voiceDebounceTimer = null;
      dispatchVoiceCandidate(voiceInit, convState);
    } else {
      clearTimeout(voiceDebounceTimer);
      const capturedVoice = { ...voiceInit };
      voiceDebounceTimer = setTimeout(() => {
        voiceDebounceTimer = null;
        dispatchVoiceCandidate(capturedVoice, convState);
      }, 320);
    }
  }

  // Luồng 2: Đối chiếu voice_chats/*.json (ROLE_VOICE xác thực 100% AI, phát bù mọi câu UIA lỡ bỏ sót)
  if (vcInit.key && vcInit.key !== convState.lastVcKey && !spokenVoiceKeys.has(vcInit.key)) {
    convState.lastVcKey = vcInit.key;
    clearTimeout(vcDebounceTimer);
    const capturedVc = { ...vcInit };
    vcDebounceTimer = setTimeout(() => {
      vcDebounceTimer = null;
      dispatchVoiceCandidate(capturedVc, convState);
    }, 160);
  }

  // Luồng 3: Tóm tắt câu mở đầu khi lượt agent kết thúc (Stop)
  if (stopInit.key && stopInit.key !== convState.lastStopKey) {
    const ageMs = Date.now() - Math.max(Number(snap.doneAt) || 0, Number(snap.updatedAt) || 0);
    if (ageMs > 25000 && !convState.lastStopKey) {
      convState.lastStopKey = stopInit.key;
      return;
    }
    clearTimeout(stopDebounceTimer);
    stopDebounceTimer = setTimeout(() => {
      const latest = readSnapshot();
      const cand = getStopCandidate(latest);
      const st = getConvSpokenState(latest?.conversationId);
      if (!ttsEnabled || !cand.key || cand.key === st.lastStopKey) return;
      st.lastStopKey = cand.key;
      st.incompletePrefix = '';
      const { text: unspoken, sentences } = extractUnspokenSpeech(cand.text, 360);
      if (unspoken && unspoken !== st.lastText) {
        st.lastText = unspoken;
        for (const s of sentences) markSpokenVoiceNorm(s);
        markSpokenVoiceNorm(unspoken);
        enqueueFairySpeech(unspoken).catch(() => {});
      }
    }, 30);
  }
}

function scheduleNextUiaPoll(delayMs = 350) {
  if (IS_SMOKE_TEST || (!IS_WIN && !IS_MAC)) return;
  clearTimeout(uiaPollTimer);
  uiaPollTimer = setTimeout(pollLiveVoiceSubtitle, delayMs);
}

function readMacVoiceSubtitle() {
  return new Promise((resolve) => {
    const script = `
      tell application "System Events"
        if not (exists process "Antigravity") then return "NO_PROC"
        tell process "Antigravity"
          if (count of windows) is 0 then return "NO_WIN"
          set endBtn to missing value
          try
            set endBtn to first button of entire contents of window 1 whose name is "End" or name is "End voice mode" or name is "Stop voice mode"
          end try
          if endBtn is missing value then return "CLOSED"
          set endPos to position of endBtn
          set endSize to size of endBtn
          set headerBottom to (item 2 of endPos) + (item 2 of endSize)
          set outText to ""
          try
            set txtElems to (every static text of entire contents of window 1)
            repeat with st in txtElems
              set p to position of st
              if (item 2 of p) >= (headerBottom - 4) and (item 2 of p) <= (headerBottom + 240) then
                set v to (value of st) as text
                if length of v > 0 then
                  if outText is "" then
                    set outText to v
                  else
                    set outText to outText & " " & v
                  end if
                end if
              end if
            end repeat
          end try
          return "OPEN:" & outText
        end tell
      end tell`;
    execFile('osascript', ['-e', script], { timeout: 900 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, error: 'mac_accessibility_or_timeout' });
        return;
      }
      const raw = String(stdout || '').trim();
      if (raw === 'NO_PROC' || raw === 'NO_WIN') {
        resolve({ ok: false, error: 'window_not_found' });
        return;
      }
      if (!raw.startsWith('OPEN:')) {
        resolve({ ok: true, voiceOpen: false, subtitle: '' });
        return;
      }
      resolve({ ok: true, voiceOpen: true, timer: '', subtitle: raw.slice(5).trim() });
    });
  });
}

async function pollLiveVoiceSubtitle() {
  if (IS_SMOKE_TEST || (!IS_WIN && !IS_MAC)) return;
  if (uiaPollInFlight) {
    scheduleNextUiaPoll(350);
    return;
  }
  if (IS_WIN && (!voiceWorkerReady || voicePending.size > 0)) {
    scheduleNextUiaPoll(voicePending.size > 0 ? 80 : 800);
    return;
  }

  uiaPollInFlight = true;
  let nextDelay = IS_MAC ? 1200 : 700;
  try {
    const res = IS_MAC
      ? await readMacVoiceSubtitle()
      : await sendVoiceWorkerCommand(
          'READ_VOICE_SUBTITLE',
          { muteAg: Boolean(ttsEnabled && autoMuteAntigravity) },
          900
        );
    const now = Date.now();
    if (!res || !res.ok) {
      nextDelay = res?.error === 'mac_accessibility_or_timeout' ? 3000 : res?.error === 'window_not_found' ? 2000 : 1000;
    } else if (!res.voiceOpen) {
      // Giữ nguyên uiaCommittedText khi đóng hộp Voice Mode để không đọc lặp lại câu cũ.
      const wasOpen = Boolean(liveUiaSubtitle?.voiceOpen);
      if (wasOpen) {
        liveUiaSubtitle = null;
        pushStateToRenderer();
      }
      nextDelay = IS_MAC ? 1200 : 700;
    } else {
      nextDelay = IS_MAC ? 500 : 350;
      const rawSub = String(res.subtitle || '').replace(/\s+/g, ' ').trim();
      if (liveUiaSubtitle) {
        liveUiaSubtitle.lastSeenAt = now;
        liveUiaSubtitle.voiceOpen = true;
      } else {
        liveUiaSubtitle = {
          seq: uiaSubSeq,
          voiceOpen: true,
          text: '',
          timer: String(res.timer || ''),
          updatedAt: 0,
          lastSeenAt: now,
          complete: false,
        };
      }

      if (rawSub && rawSub !== uiaCommittedText) {
        const endsSentence = /[.!?…]["”']?\s*$/.test(rawSub);
        if (endsSentence) {
          let deltaText = rawSub;
          if (uiaCommittedText.length >= 10 && rawSub.startsWith(uiaCommittedText)) {
            const suffix = rawSub.slice(uiaCommittedText.length).trim();
            if (suffix.replace(/[^A-Za-zÀ-ỹ0-9]/g, '').length >= 4) {
              deltaText = suffix;
            }
          }
          uiaCommittedText = rawSub;

          const isUserLine =
            isKnownUserSpeech(rawSub) ||
            isKnownUserSpeech(deltaText) ||
            USER_SPEECH_FILTER_RE.test(deltaText) && !MASTER_ADDRESS_RE.test(deltaText);
          const isAiLine =
            !isUserLine &&
            (isAssistantVoiceSubtitle(deltaText) || isAssistantVoiceSubtitle(rawSub));

          if (isAiLine) {
            uiaSubSeq += 1;
            liveUiaSubtitle = {
              seq: uiaSubSeq,
              voiceOpen: true,
              text: deltaText,
              fullText: rawSub,
              timer: String(res.timer || ''),
              updatedAt: now,
              lastSeenAt: now,
              complete: true,
            };
            pushStateToRenderer();
          }
        }
      }
    }
  } catch {
    nextDelay = 1000;
  } finally {
    uiaPollInFlight = false;
    scheduleNextUiaPoll(nextDelay);
  }
}

function stopPomodoro(silent = false) {
  if (pomodoroTimer) {
    clearInterval(pomodoroTimer);
    pomodoroTimer = null;
  }
  const wasActive = pomodoroState.active;
  pomodoroState = { ...pomodoroState, active: false, startedAt: 0, endsAt: 0, remainingSec: 0 };
  if (!silent) pushStateToRenderer();
  return wasActive;
}

function startPomodoro(minutes = 25) {
  stopPomodoro(true);
  const mins = Math.max(1, Math.min(120, Math.round(Number(minutes) || 25)));
  const now = Date.now();
  const endsAt = now + mins * 60_000;
  pomodoroState = { active: true, startedAt: now, endsAt, remainingSec: mins * 60, durationMin: mins };
  pushStateToRenderer();
  pomodoroTimer = setInterval(() => {
    const rem = Math.max(0, Math.ceil((pomodoroState.endsAt - Date.now()) / 1000));
    pomodoroState = { ...pomodoroState, remainingSec: rem };
    pushStateToRenderer();
    if (rem <= 0) {
      stopPomodoro(true);
      butler.recordPomodoroCompleted();
      const quip = `— Ting~ Hết ${mins} phút tập trung rồi, Master. Đề xuất: đứng dậy uống nước và thư giãn mắt hai phút nhé.`;
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('fairy:butler-event', {
          kind: 'pomodoro-done',
          mood: 'done',
          quip,
        });
      }
      if (ttsEnabled && !IS_SMOKE_TEST) enqueueFairySpeech(quip).catch(() => {});
      pushStateToRenderer();
    }
  }, 1000);
  return pomodoroState;
}

function readMacForegroundApp() {
  return new Promise((resolve) => {
    const script = `
      tell application "System Events"
        set p to first application process whose frontmost is true
        set pname to name of p
        set wtitle to ""
        try
          if (count of windows of p) > 0 then set wtitle to name of window 1 of p
        end try
        return pname & "\t" & wtitle
      end tell`;
    execFile('osascript', ['-e', script], { timeout: 800 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false });
        return;
      }
      const [processName = '', windowTitle = ''] = String(stdout || '').trim().split('\t');
      resolve({ ok: true, process: processName, title: windowTitle });
    });
  });
}

async function pollActiveApp() {
  if (IS_SMOKE_TEST || (!IS_WIN && !IS_MAC)) return;
  try {
    let raw = null;
    if (IS_WIN) {
      if (!voiceWorkerReady || voicePending.size > 0) return;
      raw = await sendVoiceWorkerCommand('GET_FOREGROUND_APP', {}, 1200);
    } else {
      raw = await readMacForegroundApp();
    }
    if (!raw || !raw.ok) return;
    const proc = String(raw.process || '').trim();
    const title = String(raw.title || '').trim();
    if (!proc || /fairy iii/i.test(title) || (/^electron$/i.test(proc) && (!title || /fairy/i.test(title)))) {
      return;
    }
    const info = classifyForegroundApp(proc, title);
    currentActiveApp = info;
    const now = Date.now();
    if (now - lastObservedAppAt >= 30_000) {
      lastObservedAppAt = now;
      butler.recordObservedApp(info.appName);
      butler.saveMemory();
    }
    const snap = readSnapshot();
    const prefs = butler.loadMemory().preferences;
    if (
      info.category === 'ai-web' &&
      !snap.voiceActive &&
      !prefs.clipboardWatch &&
      overlayPhase === 'dock' &&
      now - lastAiWebTipAt > 30 * 60_000
    ) {
      lastAiWebTipAt = now;
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('fairy:butler-event', {
          kind: 'ai-web',
          mood: 'smug',
          quip: pickQuip('aiWeb', now),
          aiBrand: info.aiBrand,
        });
      }
    }
    pushStateToRenderer();
  } catch {
    // Ignore transient foreground app probe error.
  }
}

function pollProactiveAlerts() {
  if (IS_SMOKE_TEST || overlayPhase !== 'dock') return;
  const snap = readSnapshot();
  if (snap.voiceActive) return;
  const tokenUsage = snap.butler?.tokenUsage || getCachedTokenUsage(snap.conversationId, false);
  const idleMs = Date.now() - lastUserActivityAt;
  const alert = butler.evaluateProactiveAlert({ tokenUsage, idleMs });
  if (!alert) return;
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('fairy:butler-event', { ...alert, source: 'proactive' });
  }
  if (ttsEnabled && alert.speakText && !IS_SMOKE_TEST) {
    enqueueFairySpeech(alert.speakText).catch(() => {});
  }
}

function isReadableClipboardCandidate(raw, cleaned) {
  const s = String(raw || '').trim();
  if (!cleaned || cleaned.replace(/[^A-Za-zÀ-ỹ0-9]/g, '').length < 18) return false;
  if (/^https?:\/\/\S+$/i.test(s)) return false;
  if (/^(?:[A-Za-z]:\\|\/)[^\r\n]+$/.test(s)) return false;
  return true;
}

function pollClipboardWatcher() {
  if (IS_SMOKE_TEST) return;
  const prefs = butler.loadMemory().preferences;
  if (!prefs.clipboardWatch) return;
  let txt = '';
  try {
    txt = clipboard.readText() || '';
  } catch {
    return;
  }
  if (!txt || txt === lastSeenClipboardText) return;
  lastSeenClipboardText = txt;
  const cleaned = cleanTextForSpeech(txt);
  if (!isReadableClipboardCandidate(txt, cleaned)) return;
  butler.recordClipboardRead();
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('fairy:butler-event', {
      kind: 'clipboard',
      mood: 'comforting',
      quip: `📋 Đọc Clipboard: ${cleaned}`,
    });
  }
  if (!IS_SMOKE_TEST) {
    enqueueFairySpeech(cleaned).catch(() => {});
  }
}

function startButlerMonitors() {
  if (IS_SMOKE_TEST) return;
  if (!activeAppTimer) {
    activeAppTimer = setInterval(pollActiveApp, 3000);
  }
  if (!alertTimer) {
    alertTimer = setInterval(pollProactiveAlerts, 30_000);
  }
  if (!clipboardTimer) {
    try { lastSeenClipboardText = clipboard.readText() || ''; } catch {}
    clipboardTimer = setInterval(pollClipboardWatcher, 650);
  }
}

function resolveBestWorkspacePath(snap) {
  const mem = butler.loadMemory();
  const candidates = [
    ...(Array.isArray(snap?.workspaceUris) ? snap.workspaceUris : []),
    snap?.cwd || '',
    ...(mem.knownWorkspaces || []).map((w) => w.path),
    join(APP_DATA_DIR, 'scratch'),
  ];
  for (const c of candidates) {
    let p = String(c || '').trim();
    if (!p) continue;
    if (/^file:\/\//i.test(p)) {
      try {
        p = require('node:url').fileURLToPath(p);
      } catch {
        continue;
      }
    }
    if (existsSync(p)) return p;
  }
  return '';
}

async function executeButlerAction(req = {}) {
  lastUserActivityAt = Date.now();
  const action = String(req?.action || '').trim();
  const snap = readSnapshot();

  if (action === 'run-command-text') {
    const parsed = parseButlerCommand(req?.text || '');
    if (parsed.type === 'noop') return { ok: false, error: 'empty_command' };
    if (parsed.type === 'send-antigravity') {
      const res = await executeHybridAction({
        action: 'send-message',
        conversationId: req?.conversationId || snap.conversationId || '',
        message: parsed.message,
      });
      return {
        ok: Boolean(res?.ok),
        kind: 'command',
        mood: 'working',
        quip: res?.executedDirect
          ? '— Ting~ Đã chuyển tiếp sang phiên Antigravity cho Master.'
          : '— Đã đẩy lệnh vào Antigravity Hybrid Bridge.',
        hybrid: res,
      };
    }
    if (parsed.type === 'help') {
      return {
        ok: true,
        kind: 'help',
        mood: 'smug',
        quip:
          'LỆNH TỨC THÌ H.D.D:\n' +
          '• "báo cáo" | "điện năng" | "git"\n' +
          '• "đọc clipboard" | "bật/tắt tự đọc"\n' +
          '• "pomodoro 25" | "dừng pomodoro"\n' +
          '• "ghi nhớ <nội dung>" | "bộ nhớ"\n' +
          '• "mở chatgpt/claude/gemini/github" | "tìm <từ khóa>"\n' +
          '• "antigravity: <câu hỏi>"',
      };
    }
    if (parsed.type === 'unknown') {
      return {
        ok: true,
        kind: 'hint',
        mood: 'idle',
        quip: '— Chế độ Tức thì chuyên lệnh hệ thống, đọc Clipboard và mở nhanh công cụ. Gõ "help" để xem lệnh, hoặc bấm badge chuyển về AGY để chat với Antigravity.',
      };
    }
    return executeButlerAction({ ...parsed, action: parsed.type, speak: req?.speak });
  }

  if (action === 'briefing-now') {
    const usage = getCachedTokenUsage(snap.conversationId, true);
    const briefing = butler.generateSessionBriefing({
      activeConvId: snap.conversationId,
      cwd: snap.cwd || '',
      workspaceUris: snap.workspaceUris || [],
      tokenUsage: usage,
    });
    const shouldSpeak = req?.speak !== false && ttsEnabled && !IS_SMOKE_TEST && !(req?.auto && snap.voiceActive);
    if (shouldSpeak && briefing.speechText) {
      enqueueFairySpeech(briefing.speechText).catch(() => {});
    }
    pushStateToRenderer();
    return {
      ok: true,
      kind: 'briefing',
      mood: usage.budgetPct >= 90 ? 'alert' : 'smug',
      quip: briefing.cardText,
      speechText: briefing.speechText,
      repos: briefing.repos,
    };
  }

  if (action === 'power-report') {
    const usage = getCachedTokenUsage(snap.conversationId, true);
    const modelsLine = usage.topModels.length
      ? usage.topModels.map((m) => `${m.label}: ${formatCompactTokens(m.uncached)}`).join(' · ')
      : 'Chưa có lượt gọi model nào hôm nay';
    const card =
      `ĐIỆN NĂNG H.D.D (${usage.billLabel})\n` +
      `• Hôm nay: ${formatCompactTokens(usage.todayUncached)} / ${formatCompactTokens(usage.budgetTokens)} (${usage.budgetPct}%)\n` +
      `• Cache đọc: ${formatCompactTokens(usage.todayCacheRead)} · Phiên này: ${formatCompactTokens(usage.sessionUncached)}\n` +
      `• Mô hình: ${modelsLine}\n` +
      `• Lưu ý: Số liệu token thực tế từ log cục bộ so với Định mức H.D.D tự đặt.`;
    const speechText = `Ghi nhận dữ liệu: Hôm nay hệ thống đã dùng ${formatCompactTokens(usage.todayUncached)} token mới, đạt ${usage.budgetPct}% định mức Điện năng H.D.D.`;
    if (req?.speak && ttsEnabled && !IS_SMOKE_TEST && !snap.voiceActive) {
      enqueueFairySpeech(speechText).catch(() => {});
    }
    return { ok: true, kind: 'power-report', mood: usage.budgetPct >= 90 ? 'alert' : 'smug', quip: card, tokenUsage: usage };
  }

  if (action === 'read-clipboard') {
    let rawClip = '';
    try { rawClip = clipboard.readText() || ''; } catch {}
    lastSeenClipboardText = rawClip;
    const cleaned = cleanTextForSpeech(rawClip);
    if (!cleaned) {
      return {
        ok: false,
        kind: 'clipboard',
        mood: 'idle',
        quip: 'Clipboard hiện đang trống hoặc không có văn bản đọc được, thưa Master.',
      };
    }
    butler.recordClipboardRead();
    if (!IS_SMOKE_TEST) {
      enqueueFairySpeech(cleaned).catch(() => {});
    }
    pushStateToRenderer();
    return {
      ok: true,
      kind: 'clipboard',
      mood: 'comforting',
      quip: `📋 Đang đọc Clipboard: ${cleaned}`,
      speechText: cleaned,
    };
  }

  if (action === 'toggle-clipboard-watch') {
    const cur = Boolean(butler.loadMemory().preferences.clipboardWatch);
    const next = typeof req?.enabled === 'boolean' ? req.enabled : !cur;
    try { lastSeenClipboardText = clipboard.readText() || ''; } catch {}
    butler.updatePrefs({ clipboardWatch: next });
    pushStateToRenderer();
    return {
      ok: true,
      kind: 'clipboard-watch',
      clipboardWatch: next,
      mood: next ? 'smug' : 'idle',
      quip: next
        ? '— Đã bật Tự đọc Clipboard. Bất cứ đoạn văn bản nào Master copy từ trình duyệt hay ChatGPT/Claude sẽ được tôi đọc ngay.'
        : '— Đã tắt chế độ Tự đọc Clipboard, Master.',
    };
  }

  if (action === 'open-workspace') {
    const targetPath = resolveBestWorkspacePath(snap);
    if (!targetPath) {
      return { ok: false, mood: 'alert', quip: 'Chưa tìm thấy thư mục dự án nào trong Bộ nhớ H.D.D.' };
    }
    const err = await shell.openPath(targetPath);
    if (err) {
      return { ok: false, mood: 'alert', quip: `Không mở được thư mục: ${err}` };
    }
    return { ok: true, kind: 'workspace', path: targetPath, mood: 'done', quip: `📂 Đã mở thư mục: ${targetPath}` };
  }

  if (action === 'git-status') {
    const repos = butler.collectGitStatus({ cwd: snap.cwd || '', workspaceUris: snap.workspaceUris || [] });
    if (!repos.length) {
      return { ok: true, kind: 'git', repos: [], mood: 'idle', quip: 'Chưa phát hiện kho Git nào trong danh sách H.D.D.' };
    }
    const text = repos
      .map((r) => `🌿 ${r.name} [${r.branch}]: ${r.dirtyCount === 0 ? 'sạch' : `${r.dirtyCount} thay đổi`}${r.ahead ? ` · ↑${r.ahead}` : ''}`)
      .join('\n');
    return { ok: true, kind: 'git', repos, mood: repos.some((r) => r.dirtyCount > 0) ? 'working' : 'done', quip: text };
  }

  if (action === 'pomodoro-start') {
    const mins = Math.max(1, Math.min(120, Math.round(Number(req?.minutes) || 25)));
    const pomo = startPomodoro(mins);
    const quip = `⏱ Đã đặt đồng hồ tập trung ${mins} phút. Mời Master làm việc — đừng để tôi bắt gặp ngài xao nhãng.`;
    if (ttsEnabled && !IS_SMOKE_TEST && !snap.voiceActive) enqueueFairySpeech(quip).catch(() => {});
    return { ok: true, kind: 'pomodoro', pomodoro: pomo, mood: 'working', quip };
  }

  if (action === 'pomodoro-stop') {
    const had = stopPomodoro(false);
    return {
      ok: true,
      kind: 'pomodoro',
      mood: 'idle',
      quip: had ? '⏱ Đã hủy đồng hồ Pomodoro, Master.' : 'Hiện không có bộ đếm Pomodoro nào đang chạy.',
    };
  }

  if (action === 'open-external') {
    let parsedUrl;
    try {
      parsedUrl = new URL(String(req?.url || ''));
    } catch {
      return { ok: false, mood: 'alert', quip: 'Đường dẫn không hợp lệ.' };
    }
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      return { ok: false, mood: 'alert', quip: 'Hệ thống H.D.D chỉ cho phép mở liên kết HTTP/HTTPS an toàn.' };
    }
    await shell.openExternal(parsedUrl.toString());
    return {
      ok: true,
      kind: 'external',
      url: parsedUrl.toString(),
      mood: 'done',
      quip: `🌐 Đã mở ${req?.label || parsedUrl.hostname} trên trình duyệt mặc định cho Master.`,
    };
  }

  if (action === 'focus-antigravity') {
    const res = await triggerAntigravityVoice({ mode: 'focus-chat' });
    return {
      ok: Boolean(res?.ok),
      kind: 'focus',
      mood: res?.ok ? 'done' : 'alert',
      quip: res?.ok ? '— Đã đưa Antigravity lên tiền cảnh cho Master.' : 'Không tìm thấy cửa sổ Antigravity đang mở.',
    };
  }

  if (action === 'replay-boot') {
    dispatchControlCommand('replay-boot');
    return { ok: true, kind: 'boot', mood: 'smug', quip: '— Khởi chạy lại trình tự H.D.D.' };
  }

  if (action === 'memory-add-note') {
    const note = butler.addPinnedNote(req?.text || '');
    if (!note) return { ok: false, mood: 'alert', quip: 'Nội dung ghi chú trống.' };
    pushStateToRenderer();
    return { ok: true, kind: 'memory', note, mood: 'done', quip: `📌 Đã lưu vào Bộ nhớ H.D.D: "${note.text}"` };
  }

  if (action === 'memory-remove-note') {
    butler.removePinnedNote(String(req?.id || ''));
    pushStateToRenderer();
    return { ok: true, kind: 'memory' };
  }

  if (action === 'memory-clear-notes') {
    butler.clearPinnedNotes();
    pushStateToRenderer();
    return { ok: true, kind: 'memory', mood: 'done', quip: '📌 Đã dọn sạch toàn bộ ghi chú H.D.D.' };
  }

  if (action === 'memory-list' || action === 'memory-get') {
    const mem = butler.loadMemory();
    const notes = mem.pinnedNotes || [];
    const lines = notes.length
      ? notes.map((n, i) => `${i + 1}. ${n.text}`).join('\n')
      : 'Chưa có ghi chú nào. Gõ "ghi nhớ <nội dung>" để lưu.';
    return {
      ok: true,
      kind: 'memory',
      mood: 'idle',
      quip: `BỘ NHỚ H.D.D (${mem.stats.totalSessions || 1} phiên · ${mem.stats.pomodorosCompleted || 0} Pomodoro)\n${lines}`,
      butler: buildButlerSnapshotField(snap.conversationId, false),
    };
  }

  if (action === 'set-assistant-mode') {
    const mode = req?.mode === 'instant' ? 'instant' : 'antigravity';
    butler.updatePrefs({ assistantMode: mode });
    pushStateToRenderer();
    return { ok: true, kind: 'mode', assistantMode: mode };
  }

  return { ok: false, error: 'unknown_butler_action' };
}

ipcMain.on('fairy:set-tts', (_ev, enabled) => {
  ttsEnabled = Boolean(enabled);
  if (ttsEnabled && !IS_SMOKE_TEST) startTtsWorker();
  syncAntigravityMuteState(true);
});

ipcMain.handle('fairy:get-auto-mute', () => autoMuteAntigravity);
ipcMain.on('fairy:set-auto-mute', (_ev, enabled) => {
  autoMuteAntigravity = Boolean(enabled);
  syncAntigravityMuteState(true);
});

ipcMain.handle('fairy:butler-action', (_ev, req) => executeButlerAction(req));
ipcMain.handle('fairy:set-butler-prefs', (_ev, patch) => {
  const prevClip = Boolean(butler.loadMemory().preferences.clipboardWatch);
  const prefs = butler.updatePrefs(patch || {});
  if (!prevClip && prefs.clipboardWatch) {
    try { lastSeenClipboardText = clipboard.readText() || ''; } catch {}
  }
  if (patch && patch.dailyTokenBudget !== undefined) {
    lastTokenScanAt = 0;
  }
  pushStateToRenderer();
  return prefs;
});

ipcMain.handle('fairy:speak-text', async (_ev, text) => {
  const prev = ttsEnabled;
  ttsEnabled = true;
  const res = await enqueueFairySpeech(text);
  ttsEnabled = prev;
  return res;
});

ipcMain.on('fairy:ready', () => {
  pushStateToRenderer();
  if (IS_SMOKE_TEST) {
    process.stdout.write('FAIRY_DESKTOP_READY_OK\n');
    setTimeout(() => app.quit(), 150);
  } else {
    showOverlayWindow(mainWin, false);
    setTimeout(() => showOverlayWindow(mainWin, false), 250);
    if (pendingControlCmd) {
      const cmd = pendingControlCmd;
      pendingControlCmd = '';
      if (cmd !== 'replay-boot') {
        setTimeout(() => dispatchControlCommand(cmd), 150);
      }
    }
  }
});

ipcMain.on('fairy:quit', () => app.quit());

app.whenReady().then(async () => {
  if (!IS_SMOKE_TEST) {
    butler.recordSessionStart();
  }
  const port = await startLocalMediaServer();
  createOverlayWindow(port);
  if (!IS_SMOKE_TEST) {
    createTray();
    const toggleBubble = () => dispatchControlCommand('toggle-bubble');
    const openInstant = () => dispatchControlCommand('open-instant');
    const readClipNow = () => dispatchControlCommand('read-clipboard');

    for (const accelerator of ['Alt+Shift+F', 'CommandOrControl+Shift+F']) {
      try {
        globalShortcut.register(accelerator, toggleBubble);
      } catch {
        // Ignore shortcut collision.
      }
    }
    const extraHotkeys = [
      ['Alt+Shift+A', openInstant],
      ['Alt+Shift+R', readClipNow],
      ...(IS_MAC ? [['CommandOrControl+Option+A', openInstant], ['CommandOrControl+Option+R', readClipNow]] : []),
    ];
    for (const [acc, fn] of extraHotkeys) {
      try {
        globalShortcut.register(acc, fn);
      } catch {
        // Ignore shortcut collision.
      }
    }
  }
  startTelemetryWatcher();
  startVoiceWorker();
  if (!IS_SMOKE_TEST) {
    startTtsWorker();
    scheduleNextUiaPoll(900);
    startButlerMonitors();
  }
});

let shutdownUnmuteDone = false;
app.on('will-quit', (e) => {
  if (!shutdownUnmuteDone && IS_WIN && !IS_SMOKE_TEST && voiceWorkerReady && voiceWorker && voiceWorker.stdin && !voiceWorker.killed) {
    shutdownUnmuteDone = true;
    e.preventDefault();
    Promise.race([
      sendVoiceWorkerCommand('UNMUTE_ANTIGRAVITY', {}, 350),
      new Promise((resolve) => setTimeout(resolve, 350)),
    ]).finally(() => {
      app.quit();
    });
    return;
  }
  globalShortcut.unregisterAll();
  clearInterval(pollTimer);
  clearInterval(activeAppTimer);
  clearInterval(alertTimer);
  clearInterval(clipboardTimer);
  clearInterval(pomodoroTimer);
  clearTimeout(uiaPollTimer);
  clearTimeout(voiceDebounceTimer);
  clearTimeout(vcDebounceTimer);
  clearTimeout(stopDebounceTimer);
  if (!IS_SMOKE_TEST && existsSync(DESKTOP_ENDPOINT_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(DESKTOP_ENDPOINT_FILE, 'utf-8'));
      if (Number(parsed?.pid) === process.pid) {
        unlinkSync(DESKTOP_ENDPOINT_FILE);
      }
    } catch {
      // Ignore cleanup error.
    }
  }
  if (ttsWorker) {
    try {
      ttsWorker.kill();
    } catch {
      // Ignore worker kill error.
    }
    ttsWorker = null;
  }
  if (voiceWorker) {
    try {
      voiceWorker.kill();
    } catch {
      // Ignore worker kill error.
    }
    voiceWorker = null;
  }
  if (stateWatcher) {
    try {
      stateWatcher.close();
    } catch {
      // Ignore.
    }
  }
  if (voiceWatcher) {
    try {
      voiceWatcher.close();
    } catch {
      // Ignore.
    }
  }
  if (transcriptWatcher) {
    try {
      transcriptWatcher.close();
    } catch {
      // Ignore.
    }
  }
  if (mediaServer) {
    try {
      mediaServer.close();
    } catch {
      // Ignore.
    }
  }
});
