/**
 * Fairy III · H.D.D Sidecar HTTP Server.
 * Zero external dependencies: serves the Vietnamese H.D.D Web UI, Range-enabled
 * boot video + audio, /preload.js host bridge, /api/state, and SSE /api/events.
 */
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..', '..');
const PUBLIC_DIR = join(__dirname, 'public');
const ASSETS_DIR = join(PLUGIN_ROOT, 'assets');

const BIND_HOST = '127.0.0.1';
const PORT = parseInt(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || process.env.PORT || '4193', 10);
const UI_TOKEN = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '';
const CONV_ID_RE = /^[0-9a-f-]{8,}$/i;
const APP_SESSION_ID = String(Date.now());
let bootPlayedThisSession = false;

const STATIC_PUBLIC = {
  '/': { file: join(PUBLIC_DIR, 'index.html'), type: 'text/html; charset=utf-8' },
  '/index.html': { file: join(PUBLIC_DIR, 'index.html'), type: 'text/html; charset=utf-8' },
  '/fairy.css': { file: join(PUBLIC_DIR, 'fairy.css'), type: 'text/css; charset=utf-8' },
  '/fairy.js': { file: join(PUBLIC_DIR, 'fairy.js'), type: 'application/javascript; charset=utf-8' },
};

const ASSET_ALLOWLIST = {
  '/assets/boot.webm': { file: join(ASSETS_DIR, 'boot.webm'), type: 'video/webm' },
  '/assets/boot.mp4': { file: join(ASSETS_DIR, 'boot.mp4'), type: 'video/mp4' },
  '/assets/hero.png': { file: join(ASSETS_DIR, 'hero.png'), type: 'image/png' },
  '/assets/icon-180.png': { file: join(ASSETS_DIR, 'icon-180.png'), type: 'image/png' },
  '/assets/poster.jpg': { file: join(ASSETS_DIR, 'poster.jpg'), type: 'image/jpeg' },
  '/assets/icon.svg': { file: join(PLUGIN_ROOT, 'icon.svg'), type: 'image/svg+xml; charset=utf-8' },
};

function findAppDataDir() {
  const execData = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (execData) {
    for (let dir = execData; dir !== dirname(dir); dir = dirname(dir)) {
      if (basename(dir) === 'sidecar_data') {
        return dirname(dir);
      }
    }
  }
  return join(homedir(), '.gemini', 'antigravity');
}

const APP_DATA_DIR = findAppDataDir();
const STATE_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'state.json');
const SIDECAR_INFO_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'sidecar.json');
const BRIDGE_INBOX_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'bridge-inbox.json');
const VOICE_CHATS_DIR = join(APP_DATA_DIR, 'voice_chats');

let actualListenPort = PORT;
const hostSyncState = {
  conversationId: process.env.ANTIGRAVITY_CONVERSATION_ID || '',
  workspaceUris: [],
  projectId: process.env.ANTIGRAVITY_PROJECT_ID || '',
  lastExecutedCmdId: '',
  updatedAt: 0,
};
const pendingBridgeCommands = [];

function persistSidecarInfo(port = actualListenPort) {
  try {
    mkdirSync(dirname(SIDECAR_INFO_FILE), { recursive: true });
    writeFileSync(
      SIDECAR_INFO_FILE,
      JSON.stringify({
        port: Number(port) || actualListenPort,
        pid: process.pid,
        token: UI_TOKEN || '',
        conversationId: hostSyncState.conversationId || process.env.ANTIGRAVITY_CONVERSATION_ID || '',
        workspaceUris: hostSyncState.workspaceUris,
        projectId: hostSyncState.projectId || process.env.ANTIGRAVITY_PROJECT_ID || '',
        updatedAt: Date.now(),
      }),
      { encoding: 'utf-8', mode: 0o600 }
    );
  } catch {
    // Ignore runtime port info write error.
  }
}

function runAgentApi(args, { projectId } = {}) {
  const defaultLsExe = join(process.env.LOCALAPPDATA || '', 'Programs', 'antigravity', 'resources', 'bin', 'language_server.exe');
  const lsExe = process.env.ANTIGRAVITY_AGENTAPI_EXE || (existsSync(defaultLsExe) ? defaultLsExe : '');
  const exe = lsExe || 'agentapi';
  const execArgs = lsExe ? ['agentapi', ...args] : args;
  const env = { ...process.env };
  if (projectId) env.ANTIGRAVITY_PROJECT_ID = projectId;
  const out = execFileSync(exe, execArgs, {
    encoding: 'utf-8',
    env,
    windowsHide: true,
    timeout: 8000,
  });
  return out.trim() ? JSON.parse(out) : {};
}

function listRecentConversations(store, now) {
  const conversations = store?.conversations || {};
  return Object.values(conversations)
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
}

function readNextBridgeCommand(now = Date.now()) {
  if (pendingBridgeCommands.length > 0) {
    return pendingBridgeCommands[0];
  }
  try {
    if (!existsSync(BRIDGE_INBOX_FILE)) return null;
    const raw = JSON.parse(readFileSync(BRIDGE_INBOX_FILE, 'utf-8'));
    if (!raw || !raw.id || raw.executed || raw.id === hostSyncState.lastExecutedCmdId) return null;
    if (now - (Number(raw.ts) || 0) > 20000) return null;
    return raw;
  } catch {
    return null;
  }
}

function markBridgeCommandExecuted(cmdId) {
  if (!cmdId) return;
  hostSyncState.lastExecutedCmdId = cmdId;
  while (pendingBridgeCommands.length > 0 && pendingBridgeCommands[0].id === cmdId) {
    pendingBridgeCommands.shift();
  }
  try {
    if (existsSync(BRIDGE_INBOX_FILE)) {
      const cur = JSON.parse(readFileSync(BRIDGE_INBOX_FILE, 'utf-8'));
      if (cur && cur.id === cmdId && !cur.executed) {
        writeFileSync(BRIDGE_INBOX_FILE, JSON.stringify({ ...cur, executed: true, executedAt: Date.now() }), 'utf-8');
      }
    }
  } catch {
    // Ignore cleanup error.
  }
}

function enqueueBridgeCommand(cmdObj) {
  pendingBridgeCommands.push(cmdObj);
  if (pendingBridgeCommands.length > 8) pendingBridgeCommands.shift();
  pushSseUpdates();
}

const STANDALONE_PRELOAD_SHIM = `(() => {
  const params = new URLSearchParams(window.location.search);
  window.sidecar = window.sidecar || {
    conversationId: params.get('conversationId') || '',
    fetch: (url, opts) => window.fetch(url, opts),
  };
})();\n`;

let cachedPreload = null;
async function resolvePreloadJs() {
  if (cachedPreload !== null) return cachedPreload;
  const candidates = [];
  try {
    const resolved = import.meta.resolve('sidecar_sdk');
    const sdkFile = fileURLToPath(resolved);
    candidates.push(join(dirname(sdkFile), 'preload.js'));
  } catch {
    // Fallback below when run without sidecar_sdk ESM loader.
  }
  candidates.push(
    join(APP_DATA_DIR, 'lib', 'node_modules', 'sidecar_sdk', 'preload.js'),
    join(homedir(), '.gemini', 'antigravity', 'lib', 'node_modules', 'sidecar_sdk', 'preload.js'),
    join(homedir(), '.gemini', 'config', 'node_modules', 'sidecar_sdk', 'preload.js'),
  );
  for (const path of candidates) {
    try {
      if (existsSync(path)) {
        cachedPreload = readFileSync(path, 'utf-8');
        return cachedPreload;
      }
    } catch {
      // Try next candidate.
    }
  }
  cachedPreload = STANDALONE_PRELOAD_SHIM;
  return cachedPreload;
}

function readStateFile() {
  try {
    const raw = readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // Hook has not written state yet or is mid-write.
  }
  return { version: 1, updatedAt: 0, latestConversationId: '', conversations: {} };
}

// Lightweight read-only transcript fallback cache keyed by mtime/size.
const transcriptCache = new Map();
function readTranscriptFallback(convId) {
  if (!convId || !CONV_ID_RE.test(convId)) return null;
  const logPath = join(APP_DATA_DIR, 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl');
  try {
    const st = statSync(logPath);
    const cacheKey = `${st.mtimeMs}:${st.size}`;
    const hit = transcriptCache.get(convId);
    if (hit && hit.key === cacheKey) return hit.data;

    // Read only the trailing 16 KB to stay fast and memory-safe.
    const readSize = Math.min(16 * 1024, st.size);
    const start = Math.max(0, st.size - readSize);
    const buf = readFileSync(logPath);
    const slice = buf.subarray(start).toString('utf-8');
    const lines = slice.split('\n').filter((line) => line.trim());
    let lastEntry = null;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        lastEntry = JSON.parse(lines[i]);
        break;
      } catch {
        // Skip truncated first line from tail slice.
      }
    }
    const ageMs = Date.now() - st.mtimeMs;
    const isRunning = lastEntry && (lastEntry.status === 'RUNNING' || (lastEntry.type === 'PLANNER_RESPONSE' && Array.isArray(lastEntry.tool_calls) && lastEntry.tool_calls.length > 0));
    const mood = ageMs < 20000 && isRunning ? 'working' : 'idle';
    const data = {
      conversationId: convId,
      mood,
      rawMood: mood,
      lastEvent: 'TranscriptFallback',
      modelName: '',
      invocationCount: 0,
      toolCount: lastEntry?.step_index || 0,
      lastTool: Array.isArray(lastEntry?.tool_calls) && lastEntry.tool_calls.length ? String(lastEntry.tool_calls.at(-1)?.name || '') : '',
      lastToolError: lastEntry?.status === 'ERROR' ? 'Lỗi bước thực thi' : '',
      lastPromptPreview: '',
      terminationReason: '',
      fullyIdle: mood === 'idle',
      sessionStartedAt: st.birthtimeMs || st.mtimeMs,
      doneAt: 0,
      updatedAt: st.mtimeMs,
      recentTools: [],
      source: 'transcript',
    };
    transcriptCache.set(convId, { key: cacheKey, data });
    return data;
  } catch {
    return null;
  }
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
    candidates.push(join(APP_DATA_DIR, 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl'));
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
      const lines = buf.subarray(start).toString('utf-8').split('\n').filter((line) => line.trim());
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

    const lines = Array.isArray(lastChat.lines) ? lastChat.lines : [];
    let lastVoiceLine = null;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const item = lines[i];
      if (item && item.role === 'ROLE_VOICE' && typeof item.text === 'string' && item.text.trim()) {
        lastVoiceLine = item;
        break;
      }
    }
    if (!lastVoiceLine && lines.length > 0) {
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (lines[i] && typeof lines[i].text === 'string' && lines[i].text.trim()) {
          lastVoiceLine = lines[i];
          break;
        }
      }
    }

    const startedAtMs = lastChat.startedAt ? Date.parse(lastChat.startedAt) || 0 : 0;
    const stoppedAtMs = lastChat.stoppedAt ? Date.parse(lastChat.stoppedAt) || 0 : 0;
    const lastVoiceText = String(lastVoiceLine?.text || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    const lastVoiceTime = (lastVoiceLine?.time ? Date.parse(lastVoiceLine.time) : 0) || startedAtMs || st.mtimeMs;
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
    } else if (new Date(now).getHours() >= 0 && new Date(now).getHours() < 5) {
      emotionMood = 'sleepy';
      dialogueQuip = 'Đã qua nửa đêm rồi, Master. Xong việc nhớ nghỉ ngơi sớm đấy nhé.';
    }
  }

  const doneAt = Number(entry.doneAt) || updatedAt;
  let effectiveMood = baseMood;
  if (voiceFresh && (baseMood === 'idle' || baseMood === 'done')) {
    effectiveMood = emotionMood;
  } else if (baseMood === 'idle' && emotionMood !== 'idle' && now - Math.max(doneAt, updatedAt) < 35000) {
    effectiveMood = emotionMood;
  } else if (freshError && now - updatedAt < 15000) {
    effectiveMood = 'alert';
  }

  return { mood: effectiveMood, emotionMood, dialogueQuip, voiceActive: Boolean(voiceChat?.voiceActive) };
}

function buildSnapshot(requestedConvId = '') {
  const now = Date.now();
  const store = readStateFile();
  const conversations = store.conversations || {};

  let targetConvId = '';
  if (requestedConvId) {
    targetConvId = requestedConvId;
  } else if (process.env.ANTIGRAVITY_CONVERSATION_ID) {
    targetConvId = process.env.ANTIGRAVITY_CONVERSATION_ID;
  } else if (store.latestConversationId) {
    targetConvId = store.latestConversationId;
  }

  let entry = targetConvId && conversations[targetConvId] ? { ...conversations[targetConvId], source: 'hook' } : null;
  if (!entry && targetConvId) {
    entry = readTranscriptFallback(targetConvId);
  }
  if (!entry && !requestedConvId && store.latestConversationId && conversations[store.latestConversationId]) {
    entry = { ...conversations[store.latestConversationId], source: 'hook-latest' };
  }

  const recentConversations = listRecentConversations(store, now);
  const pendingBridgeCommand = readNextBridgeCommand(now);

  if (!entry) {
    return {
      conversationId: targetConvId || '',
      mood: 'idle',
      emotionMood: 'idle',
      dialogueQuip: '',
      voiceActive: false,
      lastVoiceText: '',
      workspaceUris: hostSyncState.workspaceUris,
      recentConversations,
      pendingBridgeCommand,
      rawMood: 'idle',
      lastEvent: '',
      modelName: '',
      invocationCount: 0,
      toolCount: 0,
      lastTool: '',
      lastToolError: '',
      lastPromptPreview: '',
      terminationReason: '',
      fullyIdle: true,
      sessionStartedAt: 0,
      doneAt: 0,
      updatedAt: 0,
      recentTools: [],
      source: 'none',
      tts: 'deferred',
      appSessionId: APP_SESSION_ID,
      bootPlayedThisSession,
      serverTime: now,
    };
  }

  const resolvedConvId = entry.conversationId || targetConvId || '';
  const dialogue = extractRecentDialogueFromTranscript(entry.transcriptPath, resolvedConvId);
  const voiceChat = readLatestVoiceChatState(resolvedConvId, now);
  const analysis = analyzeDialogueContext({
    entry,
    userText: dialogue.userText,
    modelText: dialogue.modelText,
    voiceChat,
    hasStepError: dialogue.hasStepError,
    now,
  });
  const effectiveMood = analysis.mood;
  return {
    conversationId: resolvedConvId,
    mood: effectiveMood,
    emotionMood: analysis.emotionMood,
    dialogueQuip: analysis.dialogueQuip,
    voiceActive: Boolean(voiceChat.voiceActive),
    lastVoiceText: voiceChat.lastVoiceText || '',
    workspaceUris: hostSyncState.workspaceUris,
    recentConversations,
    pendingBridgeCommand,
    rawMood: entry.mood || effectiveMood,
    lastEvent: entry.lastEvent || '',
    modelName: entry.modelName || '',
    invocationCount: Number(entry.invocationCount) || 0,
    toolCount: Number(entry.toolCount) || 0,
    lastTool: entry.lastTool || '',
    lastToolError: entry.lastToolError || '',
    lastPromptPreview: dialogue.userText || entry.lastPromptPreview || '',
    terminationReason: entry.terminationReason || '',
    fullyIdle: effectiveMood === 'idle' ? true : Boolean(entry.fullyIdle),
    sessionStartedAt: Number(entry.sessionStartedAt) || 0,
    doneAt: Number(entry.doneAt) || 0,
    updatedAt: Number(entry.updatedAt) || 0,
    recentTools: Array.isArray(entry.recentTools) ? entry.recentTools.slice(-15) : [],
    source: entry.source || 'hook',
    tts: 'deferred',
    appSessionId: APP_SESSION_ID,
    bootPlayedThisSession,
    serverTime: now,
  };
}

function validateToken(req, url) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  if (!UI_TOKEN) return true;
  const provided = req.headers['x-sidecar-token'] || url.searchParams.get('token');
  return provided === UI_TOKEN;
}

function serveMediaWithRange(req, res, filePath, contentType) {
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const total = stat.size;
  const commonHeaders = {
    'Content-Type': contentType,
    'Accept-Ranges': 'bytes',
    'Cache-Control': contentType.startsWith('video/') ? 'no-cache' : 'private, max-age=3600',
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
      res.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${total}` });
      res.end();
      return;
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      ...commonHeaders,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(chunkSize),
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const stream = createReadStream(filePath, { start, end });
    stream.on('error', () => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
    return;
  }

  res.writeHead(200, {
    ...commonHeaders,
    'Content-Length': String(total),
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
}

// SSE client registry + file watcher.
const sseClients = new Set(); // { res, convId, lastKey }
function pushSseUpdates() {
  for (const client of sseClients) {
    try {
      const snap = buildSnapshot(client.convId);
      const key = `${snap.mood}|${snap.emotionMood}|${snap.updatedAt}|${snap.toolCount}|${snap.invocationCount}|${snap.conversationId}|${snap.dialogueQuip}|${snap.voiceActive}|${snap.lastVoiceText}|${snap.pendingBridgeCommand?.id || ''}`;
      if (key === client.lastKey) continue;
      client.lastKey = key;
      client.res.write(`data: ${JSON.stringify(snap)}\n\n`);
    } catch {
      sseClients.delete(client);
    }
  }
}

let stateWatcher = null;
let voiceWatcher = null;
let watchDebounce = null;
function ensureStateWatcher() {
  const scheduleSse = () => {
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(pushSseUpdates, 80);
  };
  if (!stateWatcher) {
    const watchDir = dirname(STATE_FILE);
    if (existsSync(watchDir)) {
      try {
        stateWatcher = watch(watchDir, { persistent: false }, (_eventType, filename) => {
          if (filename && filename !== 'state.json' && filename !== 'bridge-inbox.json' && !String(filename).endsWith('.tmp')) return;
          scheduleSse();
        });
        stateWatcher.on('error', () => {
          try { stateWatcher.close(); } catch {}
          stateWatcher = null;
        });
      } catch {
        stateWatcher = null;
      }
    }
  }
  if (!voiceWatcher && existsSync(VOICE_CHATS_DIR)) {
    try {
      voiceWatcher = watch(VOICE_CHATS_DIR, { persistent: false }, (_eventType, filename) => {
        if (filename && !String(filename).endsWith('.json')) return;
        scheduleSse();
      });
      voiceWatcher.on('error', () => {
        try { voiceWatcher.close(); } catch {}
        voiceWatcher = null;
      });
    } catch {
      voiceWatcher = null;
    }
  }
}

const pollTimer = setInterval(() => {
  ensureStateWatcher();
  if (sseClients.size > 0) pushSseUpdates();
}, 1500);
pollTimer.unref();

const pingTimer = setInterval(() => {
  for (const client of sseClients) {
    try {
      client.res.write(': ping\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}, 20000);
pingTimer.unref();

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      if (body.length < 65536) body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (!validateToken(req, url)) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  if (req.method === 'GET' && path === '/preload.js') {
    const js = await resolvePreloadJs();
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(js);
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && STATIC_PUBLIC[path]) {
    const target = STATIC_PUBLIC[path];
    try {
      const content = readFileSync(target.file);
      res.writeHead(200, {
        'Content-Type': target.type,
        'Content-Length': String(content.byteLength),
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && ASSET_ALLOWLIST[path]) {
    const asset = ASSET_ALLOWLIST[path];
    serveMediaWithRange(req, res, asset.file, asset.type);
    return;
  }

  if (req.method === 'GET' && path === '/api/state') {
    if (url.searchParams.get('markBootPlayed') === '1') {
      bootPlayedThisSession = true;
    }
    const requestedConv = url.searchParams.get('conversationId') || '';
    const snap = buildSnapshot(requestedConv);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(snap));
    return;
  }

  if (req.method === 'GET' && path === '/api/events') {
    const requestedConv = url.searchParams.get('conversationId') || '';
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    ensureStateWatcher();
    const initial = buildSnapshot(requestedConv);
    const client = {
      res,
      convId: requestedConv,
      lastKey: `${initial.mood}|${initial.emotionMood}|${initial.updatedAt}|${initial.toolCount}|${initial.invocationCount}|${initial.conversationId}|${initial.dialogueQuip}|${initial.voiceActive}|${initial.lastVoiceText}|${initial.pendingBridgeCommand?.id || ''}`,
    };
    sseClients.add(client);
    res.write(`data: ${JSON.stringify(initial)}\n\n`);
    req.on('close', () => {
      sseClients.delete(client);
    });
    return;
  }

  if (req.method === 'POST' && path === '/_sidecar/send-message') {
    try {
      const data = await readJsonBody(req);
      const convId = String(data?.conversationId || hostSyncState.conversationId || readStateFile().latestConversationId || '').trim();
      const args = ['send-message'];
      if (data?.title) args.push('--title', String(data.title));
      args.push(convId, String(data?.message || ''));
      const result = runAgentApi(args, { projectId: data?.projectId });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err?.message || 'send_message_failed' });
    }
    return;
  }

  if (req.method === 'POST' && path === '/_sidecar/new-conversation') {
    try {
      const data = await readJsonBody(req);
      const args = ['new-conversation', '--model', String(data?.model || 'flash'), String(data?.message || '')];
      const result = runAgentApi(args, { projectId: data?.projectId });
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err?.message || 'new_conversation_failed' });
    }
    return;
  }

  if (req.method === 'POST' && path === '/_sidecar/get-conversation-metadata') {
    try {
      const data = await readJsonBody(req);
      const result = runAgentApi(['get-conversation-metadata', String(data?.conversationId || '')]);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 500, { error: err?.message || 'get_metadata_failed' });
    }
    return;
  }

  if (req.method === 'GET' && path === '/api/bridge/status') {
    const store = readStateFile();
    sendJson(res, 200, {
      ok: true,
      port: actualListenPort,
      activeConversationId: hostSyncState.conversationId || store.latestConversationId || '',
      workspaceUris: hostSyncState.workspaceUris,
      recentConversations: listRecentConversations(store, Date.now()),
    });
    return;
  }

  if (req.method === 'POST' && path === '/api/bridge/host-sync') {
    try {
      const data = await readJsonBody(req);
      if (typeof data?.conversationId === 'string' && data.conversationId.trim()) {
        hostSyncState.conversationId = data.conversationId.trim();
      }
      if (Array.isArray(data?.workspaceUris)) {
        hostSyncState.workspaceUris = data.workspaceUris.map(String);
      }
      if (typeof data?.projectId === 'string' && data.projectId.trim()) {
        hostSyncState.projectId = data.projectId.trim();
      }
      if (typeof data?.executedCmdId === 'string' && data.executedCmdId.trim()) {
        markBridgeCommandExecuted(data.executedCmdId.trim());
      }
      hostSyncState.updatedAt = Date.now();
      persistSidecarInfo(actualListenPort);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: err?.message || 'bad_host_sync' });
    }
    return;
  }

  if (req.method === 'POST' && path === '/api/bridge/action') {
    try {
      const data = await readJsonBody(req);
      const action = String(data?.action || '').trim();
      const convId = String(
        data?.conversationId || hostSyncState.conversationId || readStateFile().latestConversationId || ''
      ).trim();
      const message = String(data?.message || '').trim();
      const title = String(data?.title || '').trim();
      const cmdId = String(data?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

      if (action === 'send-message') {
        if (!message || !convId) {
          sendJson(res, 400, { ok: false, error: !message ? 'missing_message' : 'missing_conversation_id' });
          return;
        }
        try {
          const result = runAgentApi(['send-message', convId, message], { projectId: hostSyncState.projectId });
          markBridgeCommandExecuted(cmdId);
          sendJson(res, 200, { ok: true, executedDirect: true, conversationId: convId, result });
          return;
        } catch {
          enqueueBridgeCommand({ id: cmdId, action, conversationId: convId, message, ts: Date.now() });
          sendJson(res, 200, { ok: true, queued: true, via: 'webview-sse', id: cmdId });
          return;
        }
      }

      if (action === 'new-conversation') {
        const promptText = message || 'Xin chào Fairy, bắt đầu phiên làm việc mới.';
        try {
          const result = runAgentApi(
            ['new-conversation', '--model', String(data?.model || 'flash'), promptText],
            { projectId: hostSyncState.projectId }
          );
          markBridgeCommandExecuted(cmdId);
          sendJson(res, 200, { ok: true, executedDirect: true, result });
          return;
        } catch {
          enqueueBridgeCommand({ id: cmdId, action, message: promptText, title, ts: Date.now() });
          sendJson(res, 200, { ok: true, queued: true, via: 'webview-sse', id: cmdId });
          return;
        }
      }

      if (action === 'switch-conversation' || action === 'toggle-aux-pane') {
        enqueueBridgeCommand({ id: cmdId, action, conversationId: convId, ts: Date.now() });
        sendJson(res, 200, { ok: true, queued: true, via: 'webview-sse', id: cmdId });
        return;
      }

      sendJson(res, 400, { ok: false, error: 'unknown_bridge_action' });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err?.message || 'bridge_action_failed' });
    }
    return;
  }

  if (req.method === 'POST' && path === '/api/send-message') {
    try {
      const data = await readJsonBody(req);
      const message = String(data?.message || '').trim();
      const convId = String(
        data?.conversationId || process.env.ANTIGRAVITY_CONVERSATION_ID || hostSyncState.conversationId || readStateFile().latestConversationId || ''
      ).trim();
      if (!message) {
        sendJson(res, 400, { ok: false, error: 'missing_message' });
        return;
      }
      if (!convId) {
        sendJson(res, 400, { ok: false, error: 'missing_conversation_id' });
        return;
      }
      const parsed = runAgentApi(['send-message', convId, message], { projectId: hostSyncState.projectId });
      sendJson(res, 200, { ok: true, conversationId: convId, result: parsed });
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err?.message || 'send_message_failed' });
    }
    return;
  }

  if (req.method === 'GET' && path === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      version: '0.1.0',
      mode: process.env.ANTIGRAVITY_SIDECAR_WEB_PORT ? 'sidecar' : 'standalone',
      tts: 'deferred',
      appSessionId: APP_SESSION_ID,
      bootPlayedThisSession,
      stateFile: STATE_FILE,
    });
    return;
  }

  sendJson(res, 404, { error: 'not_found' });
});

server.listen(PORT, BIND_HOST, () => {
  const addr = server.address();
  actualListenPort = addr && typeof addr === 'object' ? addr.port : PORT;
  persistSidecarInfo(actualListenPort);
  console.log(`[sidecar] listening on ${BIND_HOST}:${actualListenPort}`);
});

function shutdown() {
  clearInterval(pollTimer);
  clearInterval(pingTimer);
  if (stateWatcher) {
    try {
      stateWatcher.close();
    } catch {
      // Ignore error.
    }
  }
  if (voiceWatcher) {
    try {
      voiceWatcher.close();
    } catch {
      // Ignore error.
    }
  }
  for (const client of sseClients) {
    try {
      client.res.end();
    } catch {
      // Ignore error.
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
