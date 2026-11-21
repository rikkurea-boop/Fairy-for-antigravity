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
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
} = require('electron');
const { execFileSync, spawn } = require('node:child_process');
const {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  watch,
  writeFileSync,
} = require('node:fs');
const { createServer, request: httpRequest } = require('node:http');
const { homedir } = require('node:os');
const { dirname, extname, join } = require('node:path');

const IS_SMOKE_TEST = process.env.FAIRY_SMOKE_TEST === '1';
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE_NAME = 'FairyIII_HDD_Intro';

if (!IS_SMOKE_TEST) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  }
}

if (IS_MAC && app.dock) {
  app.dock.hide();
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Bật kết xuất GPU mặc định để cửa sổ trong suốt khử viền alpha mịn; chỉ tắt khi cần chẩn đoán.
if (process.env.FAIRY_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration();
}

const ROOT_DIR = __dirname;
const RENDERER_DIR = join(ROOT_DIR, 'renderer');
const PLUGIN_ROOT = join(ROOT_DIR, '..', 'antigravity-plugin');
const ASSETS_DIR = join(PLUGIN_ROOT, 'assets');
const APP_DATA_DIR = join(homedir(), '.gemini', 'antigravity');
const STATE_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'state.json');
const SIDECAR_INFO_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'sidecar.json');
const BRIDGE_INBOX_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'bridge-inbox.json');
const SIDECAR_LOG_FILE = join(APP_DATA_DIR, 'sidecar_data', 'fairy-zzz', 'fairy-hud', 'logs', 'sidecar.log');
const BRAIN_DIR = join(APP_DATA_DIR, 'brain');
const VOICE_CHATS_DIR = join(APP_DATA_DIR, 'voice_chats');
const CONV_ID_RE = /^[0-9a-f-]{8,}$/i;
const VOICE_WORKER_SCRIPT = join(ROOT_DIR, '..', 'scripts', 'antigravity-voice-worker.ps1');
const TTS_PYTHON_EXE = join(ROOT_DIR, '..', 'voice-lab', 'VieNeu-TTS', '.venv', 'Scripts', 'python.exe');
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
let pollTimer = null;
let lastStateKey = '';

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

function startLocalMediaServer() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      const reqPath = url.pathname;

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

const dialogueCache = new Map();
function cleanUserTranscriptText(raw) {
  let s = String(raw || '');
  s = s.replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, ' ');
  s = s.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, ' ');
  s = s.replace(/<\/?USER_REQUEST>/gi, ' ');
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
      const st = statSync(logPath);
      const cacheKey = `${st.mtimeMs}:${st.size}`;
      const cached = dialogueCache.get(logPath);
      if (cached && cached.key === cacheKey) return cached.data;

      const readSize = Math.min(24 * 1024, st.size);
      const start = Math.max(0, st.size - readSize);
      const buf = readFileSync(logPath);
      const lines = buf.subarray(start).toString('utf-8').split('\n').filter((l) => l.trim());
      let userText = '';
      let modelText = '';
      let hasStepError = false;
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          const item = JSON.parse(lines[i]);
          if (!modelText && item.type === 'PLANNER_RESPONSE' && typeof item.content === 'string' && item.content.trim()) {
            modelText = item.content.replace(/\s+/g, ' ').trim().slice(0, 500);
          }
          if (!userText && item.type === 'USER_INPUT' && typeof item.content === 'string' && item.content.trim()) {
            userText = cleanUserTranscriptText(item.content).slice(0, 500);
          }
          if (!hasStepError && i >= lines.length - 4 && item.status === 'ERROR') {
            hasStepError = true;
          }
          if (userText && modelText) break;
        } catch {
          // Skip partial boundary line.
        }
      }
      const data = { userText, modelText, hasStepError, mtimeMs: st.mtimeMs };
      dialogueCache.set(logPath, { key: cacheKey, data });
      return data;
    } catch {
      // Try next candidate.
    }
  }
  return { userText: '', modelText: '', hasStepError: false, mtimeMs: 0 };
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
    for (let c = chats.length - 1; c >= 0 && !lastVoiceLine; c -= 1) {
      const chat = chats[c];
      const lines = Array.isArray(chat?.lines) ? chat.lines : [];
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        const item = lines[i];
        if (item && item.role === 'ROLE_VOICE' && typeof item.text === 'string' && item.text.trim()) {
          lastVoiceLine = item;
          ownerChat = chat;
          break;
        }
      }
    }
    if (!lastVoiceLine) {
      for (let c = chats.length - 1; c >= 0 && !lastVoiceLine; c -= 1) {
        const chat = chats[c];
        const lines = Array.isArray(chat?.lines) ? chat.lines : [];
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          if (lines[i] && typeof lines[i].text === 'string' && lines[i].text.trim()) {
            lastVoiceLine = lines[i];
            ownerChat = chat;
            break;
          }
        }
      }
    }

    const startedAtMs = lastChat.startedAt ? Date.parse(lastChat.startedAt) || 0 : 0;
    const stoppedAtMs = lastChat.stoppedAt ? Date.parse(lastChat.stoppedAt) || 0 : 0;
    const lastVoiceText = String(lastVoiceLine?.text || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    const ownerStartMs = ownerChat?.startedAt ? Date.parse(ownerChat.startedAt) || 0 : 0;
    const lastVoiceTime = (lastVoiceLine?.time ? Date.parse(lastVoiceLine.time) : 0) || ownerStartMs || startedAtMs || st.mtimeMs;
    const isRunning = Boolean(startedAtMs > 0 && !stoppedAtMs && now - Math.max(startedAtMs, lastVoiceTime, st.mtimeMs) < 120000);
    const isRecentLine = Boolean(lastVoiceText) && lastVoiceTime > 0 && now - lastVoiceTime < 25000 && (!stoppedAtMs || stoppedAtMs < lastVoiceTime);

    return {
      voiceActive: isRunning || isRecentLine,
      lastVoiceText,
      lastVoiceTime,
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

function readSnapshot() {
  const now = Date.now();
  let entry = null;
  let store = { conversations: {} };

  try {
    if (existsSync(STATE_FILE)) {
      store = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
      const conversations = store?.conversations || {};
      const preferred = store?.latestConversationId && conversations[store.latestConversationId]
        ? conversations[store.latestConversationId]
        : Object.values(conversations).sort((a, b) => (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0))[0];
      if (preferred) {
        entry = { ...preferred, source: 'hook' };
      }
    }
  } catch {
    // Ignore transient file read error.
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

  if (!entry) {
    entry = readLatestTranscriptFallback();
  }

  if (!entry) {
    return {
      conversationId: '',
      mood: 'idle',
      emotionMood: 'idle',
      dialogueQuip: '',
      lastReplySpeech: '',
      voiceActive: false,
      lastVoiceText: '',
      lastVoiceTime: 0,
      hybridConnected,
      sidecarPort,
      workspaceUris: sidecarEndpoint.workspaceUris || [],
      recentConversations,
      lastPromptPreview: '',
      lastEvent: '',
      modelName: '',
      invocationCount: 0,
      toolCount: 0,
      lastTool: '',
      lastToolError: '',
      terminationReason: '',
      sessionStartedAt: 0,
      updatedAt: 0,
      source: 'none',
      serverTime: now,
    };
  }

  const dialogue = extractRecentDialogueFromTranscript(entry.transcriptPath, entry.conversationId);
  const voiceChat = readLatestVoiceChatState(entry.conversationId, now);
  const analysis = analyzeDialogueContext({
    entry,
    userText: dialogue.userText,
    modelText: dialogue.modelText,
    voiceChat,
    hasStepError: dialogue.hasStepError,
    now,
  });

  return {
    conversationId: entry.conversationId || '',
    mood: analysis.mood,
    emotionMood: analysis.emotionMood,
    dialogueQuip: analysis.dialogueQuip,
    lastReplySpeech: cleanTextForSpeech(dialogue.modelText || ''),
    voiceActive: Boolean(voiceChat.voiceActive),
    lastVoiceText: voiceChat.lastVoiceText || '',
    lastVoiceTime: Number(voiceChat.lastVoiceTime) || 0,
    hybridConnected,
    sidecarPort,
    workspaceUris: sidecarEndpoint.workspaceUris || [],
    recentConversations,
    lastPromptPreview: dialogue.userText || entry.lastPromptPreview || '',
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

function cleanTextForSpeech(raw) {
  let s = String(raw || '');
  s = s.replace(/```[\s\S]*?```/g, ' ');
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  s = s.replace(/https?:\/\/\S+/gi, ' ');
  s = s.replace(/file:\/\/\/\S+/gi, ' ');
  s = s.replace(/[A-Za-z]:\\[^\s`'",)]+/g, ' ');
  s = s.replace(/`([^`]{1,40})`/g, '$1');
  s = s.replace(/`[^`]+`/g, ' ');
  s = s.replace(/^\s*—\s*Ting~\s*/i, 'Ting. ');
  s = s.replace(/[*#_~>|`]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const parts = s.split(/(?<=[.!?])\s+/).filter((p) => p.trim().length > 2);
  let picked = '';
  for (const p of parts) {
    if (picked && picked.length + p.length + 1 > 210) break;
    picked = picked ? `${picked} ${p}` : p;
    if (picked.length >= 130) break;
  }
  return (picked || s.slice(0, 210)).trim();
}

function pushStateToRenderer() {
  if (!mainWin || mainWin.isDestroyed()) return;
  const snap = readSnapshot();
  const key = `${snap.mood}|${snap.emotionMood}|${snap.updatedAt}|${snap.toolCount}|${snap.invocationCount}|${snap.conversationId}|${snap.lastToolError}|${snap.dialogueQuip}|${snap.lastReplySpeech}|${snap.voiceActive}|${snap.lastVoiceText}|${snap.sidecarPort}|${snap.recentConversations?.length || 0}`;
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
    debounce = setTimeout(pushStateToRenderer, 80);
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
  };

  tryWatch();
  pollTimer = setInterval(() => {
    tryWatch();
    pushStateToRenderer();
  }, 1000);
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

  mainWin.loadURL(`http://127.0.0.1:${port}/`);
}

function createTray() {
  const iconPath = join(ASSETS_DIR, 'icon-180.png');
  const iconSize = IS_MAC ? 18 : 20;
  const icon = nativeImage.createFromPath(iconPath).resize({ width: iconSize, height: iconSize });
  tray = new Tray(icon);
  tray.setToolTip('Fairy III · H.D.D Terminal (Antigravity)');

  const sendCmd = (cmd) => {
    if (!mainWin || mainWin.isDestroyed()) return;
    showOverlayWindow(mainWin, false);
    mainWin.webContents.send('fairy:cmd', cmd);
  };

  const shortcutHint = IS_MAC ? 'Cmd/Option+Shift+F' : 'Alt+Shift+F';
  const contextMenu = Menu.buildFromTemplate([
    { label: '▶ Phát lại Boot + Âm thanh', click: () => sendCmd('replay-boot') },
    { label: '◈ Hiện lời chào H.D.D', click: () => sendCmd('replay-greet') },
    { label: `💬 Bật / Tắt bong bóng (${shortcutHint})`, click: () => sendCmd('toggle-bubble') },
    { label: '⚙ Cài đặt H.D.D & Biểu cảm', click: () => sendCmd('open-settings') },
    { label: '↺ Đặt lại vị trí mắt (25vw / 52vh)', click: () => sendCmd('reset-pos') },
    { label: '👁 Hiện / Ẩn mắt Fairy', click: () => sendCmd('toggle-eye') },
    { type: 'separator' },
    { label: '✕ Thoát Fairy Overlay', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => sendCmd('toggle-bubble'));
}

app.on('second-instance', () => {
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
  return sendVoiceWorkerCommand(cmd, {}, voiceWorkerReady ? 4500 : 8000);
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
      const defaultLsExe = join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe');
      const lsExe = process.env.ANTIGRAVITY_AGENTAPI_EXE || (existsSync(defaultLsExe) ? defaultLsExe : '');
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
let ttsQueuedText = '';
let ttsBaselineReady = false;
let lastSpokenVoiceKey = '';
let lastSpokenStopKey = '';
let lastSpokenText = '';
let voiceDebounceTimer = null;
let stopDebounceTimer = null;

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
    const child = spawn(TTS_PYTHON_EXE, [TTS_DAEMON_SCRIPT], {
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

function runTtsSynthesis(text, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const cleaned = cleanTextForSpeech(text);
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
    const fileName = `live-${id % 4}.wav`;
    const outPath = join(PLUGIN_ROOT, 'assets', 'voice', fileName);
    const timer = setTimeout(() => {
      if (ttsPending.has(id)) {
        ttsPending.delete(id);
        resolve({ ok: false, error: 'tts_timeout' });
      }
    }, timeoutMs);
    ttsPending.set(id, {
      timer,
      resolve: (res) => resolve({ ...res, url: `/assets/voice/${fileName}?t=${Date.now()}`, text: cleaned }),
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
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned || !ttsEnabled || IS_SMOKE_TEST) return { ok: false, skipped: true };
  if (ttsBusy) {
    ttsQueuedText = cleaned;
    return { ok: true, queued: true };
  }
  ttsBusy = true;
  let current = cleaned;
  let lastRes = { ok: false };
  try {
    while (current) {
      ttsQueuedText = '';
      lastRes = await runTtsSynthesis(current);
      if (lastRes.ok && mainWin && !mainWin.isDestroyed() && ttsEnabled) {
        mainWin.webContents.send('fairy:speak', { url: lastRes.url, text: lastRes.text || current });
      }
      current = ttsEnabled ? ttsQueuedText : '';
    }
  } finally {
    ttsBusy = false;
  }
  return lastRes;
}

function getVoiceCandidate(snap) {
  if (!snap || !snap.lastVoiceText) return { key: '', text: '' };
  const text = cleanTextForSpeech(snap.lastVoiceText);
  if (!text) return { key: '', text: '' };
  const stamp = snap.lastVoiceTime || snap.updatedAt || '';
  return { key: `${snap.conversationId}:${stamp}:${text.slice(0, 80)}`, text };
}

function getStopCandidate(snap) {
  if (!snap || (snap.lastEvent !== 'Stop' && snap.mood !== 'done')) return { key: '', text: '' };
  const text = snap.lastReplySpeech || cleanTextForSpeech(snap.dialogueQuip || '');
  if (!text) return { key: '', text: '' };
  const stamp = snap.doneAt || snap.updatedAt || '';
  return { key: `${snap.conversationId}:${stamp}:${text.slice(0, 60)}`, text };
}

function scheduleSpeechFromSnapshot(snap) {
  const voiceInit = getVoiceCandidate(snap);
  const stopInit = getStopCandidate(snap);
  if (!ttsBaselineReady) {
    ttsBaselineReady = true;
    lastSpokenVoiceKey = voiceInit.key;
    lastSpokenStopKey = stopInit.key;
    lastSpokenText = voiceInit.text || stopInit.text || '';
    return;
  }
  if (!ttsEnabled || IS_SMOKE_TEST) return;

  if (voiceInit.key && voiceInit.key !== lastSpokenVoiceKey) {
    clearTimeout(voiceDebounceTimer);
    voiceDebounceTimer = setTimeout(() => {
      const latest = readSnapshot();
      const cand = getVoiceCandidate(latest);
      if (!ttsEnabled || !cand.key || cand.key === lastSpokenVoiceKey) return;
      lastSpokenVoiceKey = cand.key;
      if (cand.text && cand.text !== lastSpokenText) {
        lastSpokenText = cand.text;
        enqueueFairySpeech(cand.text).catch(() => {});
      }
    }, 60);
  }

  if (stopInit.key && stopInit.key !== lastSpokenStopKey) {
    clearTimeout(stopDebounceTimer);
    stopDebounceTimer = setTimeout(() => {
      const latest = readSnapshot();
      const cand = getStopCandidate(latest);
      if (!ttsEnabled || !cand.key || cand.key === lastSpokenStopKey) return;
      lastSpokenStopKey = cand.key;
      if (cand.text && cand.text !== lastSpokenText) {
        lastSpokenText = cand.text;
        enqueueFairySpeech(cand.text).catch(() => {});
      }
    }, 120);
  }
}

ipcMain.on('fairy:set-tts', (_ev, enabled) => {
  ttsEnabled = Boolean(enabled);
  if (ttsEnabled && !IS_SMOKE_TEST) startTtsWorker();
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
  }
});

ipcMain.on('fairy:quit', () => app.quit());

app.whenReady().then(async () => {
  const port = await startLocalMediaServer();
  createOverlayWindow(port);
  if (!IS_SMOKE_TEST) {
    createTray();
    const toggleBubble = () => {
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('fairy:cmd', 'toggle-bubble');
      }
    };
    for (const accelerator of ['Alt+Shift+F', 'CommandOrControl+Shift+F']) {
      try {
        globalShortcut.register(accelerator, toggleBubble);
      } catch {
        // Ignore shortcut collision.
      }
    }
  }
  startTelemetryWatcher();
  startVoiceWorker();
  if (!IS_SMOKE_TEST) startTtsWorker();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearInterval(pollTimer);
  clearTimeout(voiceDebounceTimer);
  clearTimeout(stopDebounceTimer);
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
  if (mediaServer) {
    try {
      mediaServer.close();
    } catch {
      // Ignore.
    }
  }
});
