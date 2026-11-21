/**
 * Electron-free background engine for Fairy III · H.D.D Desktop Overlay.
 * Communicates with the Tauri/Rust shell via NDJSON over stdin/stdout and
 * lazy-loads heavy child processes (VieNeu-TTS Python daemon, UIA PowerShell worker,
 * brain transcript scan) so cold boot finishes as fast as possible.
 */
const { execFile, execFileSync, spawn } = require('node:child_process');
const {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  watch,
  writeFileSync,
} = require('node:fs');
const { request: httpRequest } = require('node:http');
const { homedir } = require('node:os');
const { dirname, join } = require('node:path');
const readline = require('node:readline');
const { fileURLToPath } = require('node:url');
const {
  classifyForegroundApp,
  createButlerCore,
  formatCompactTokens,
  getLocalDateKey,
  parseButlerCommand,
  pickQuip,
} = require('./butler-core.cjs');

const IS_SMOKE_TEST = process.env.FAIRY_SMOKE_TEST === '1';
const IS_SELF_TEST = process.argv.includes('--self-test');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const USE_RUST_CLIPBOARD = process.env.FAIRY_RUST_CLIPBOARD === '1';

const ROOT_DIR = __dirname;
const PLUGIN_ROOT = join(ROOT_DIR, '..', 'antigravity-plugin');
const APP_DATA_DIR = join(homedir(), '.gemini', 'antigravity');
const STATE_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'state.json');
const SIDECAR_INFO_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'sidecar.json');
const BRIDGE_INBOX_FILE = join(APP_DATA_DIR, 'plugin_data', 'fairy-zzz', 'bridge-inbox.json');
const SIDECAR_LOG_FILE = join(APP_DATA_DIR, 'sidecar_data', 'fairy-zzz', 'fairy-hud', 'logs', 'sidecar.log');
const BRAIN_DIR = join(APP_DATA_DIR, 'brain');
const VOICE_CHATS_DIR = join(APP_DATA_DIR, 'voice_chats');
const CONV_ID_RE = /^[0-9a-f-]{8,}$/i;
const VOICE_WORKER_SCRIPT = join(ROOT_DIR, '..', 'scripts', 'antigravity-voice-worker.ps1');
const TTS_DAEMON_SCRIPT = join(ROOT_DIR, '..', 'voice-lab', 'fairy_tts_daemon.py');

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

function emitEvent(event, payload) {
  if (IS_SELF_TEST) return;
  try {
    process.stdout.write(`${JSON.stringify({ event, payload })}\n`);
  } catch {
    // Ignore stdout write error during teardown.
  }
}

function readClipboardText(overrideText) {
  if (typeof overrideText === 'string') return overrideText;
  if (USE_RUST_CLIPBOARD) return '';
  if (IS_WIN) {
    try {
      return execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command', '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Clipboard -Raw'],
        { encoding: 'utf-8', timeout: 1200, windowsHide: true }
      ).replace(/\r?\n$/, '');
    } catch {
      return '';
    }
  }
  if (IS_MAC) {
    try {
      return execFileSync('pbpaste', [], { encoding: 'utf-8', timeout: 1000 });
    } catch {
      return '';
    }
  }
  return '';
}

function openPathNative(targetPath) {
  return new Promise((resolve) => {
    if (!targetPath || !existsSync(targetPath)) {
      resolve('Đường dẫn không tồn tại');
      return;
    }
    try {
      if (IS_WIN) {
        const child = spawn('cmd.exe', ['/c', 'start', '', targetPath], {
          windowsHide: true,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      } else if (IS_MAC) {
        const child = spawn('open', [targetPath], { detached: true, stdio: 'ignore' });
        child.unref();
      } else {
        const child = spawn('xdg-open', [targetPath], { detached: true, stdio: 'ignore' });
        child.unref();
      }
      resolve('');
    } catch (err) {
      resolve(err?.message || 'open_failed');
    }
  });
}

function openExternalNative(urlStr) {
  return new Promise((resolve, reject) => {
    try {
      if (IS_WIN) {
        const child = spawn('cmd.exe', ['/c', 'start', '', urlStr], {
          windowsHide: true,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      } else if (IS_MAC) {
        const child = spawn('open', [urlStr], { detached: true, stdio: 'ignore' });
        child.unref();
      } else {
        const child = spawn('xdg-open', [urlStr], { detached: true, stdio: 'ignore' });
        child.unref();
      }
      resolve();
    } catch (err) {
      reject(err);
    }
  });
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
  } catch {
    // Ignore invalid URL.
  }
  return '';
}

let stateWatcher = null;
let voiceWatcher = null;
let transcriptWatcher = null;
let watchedTranscriptDir = '';
let lastObservedTranscriptDir = '';
let pollTimer = null;
let lastStateKey = '';
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
let overlayPhase = 'boot';
let backgroundActivated = false;
let backgroundFallbackTimer = null;
let lazyTtsTimer = null;

function dispatchControlCommand(cmd) {
  const clean = String(cmd || '').trim();
  if (!clean || clean === 'ping') {
    return { ok: true, pong: true, pid: process.pid };
  }
  if (clean === 'read-clipboard') {
    executeButlerAction({ action: 'read-clipboard' })
      .then((res) => {
        if (res && res.ok) emitEvent('fairy:butler-event', res);
      })
      .catch(() => {});
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
  emitEvent('fairy:cmd', clean);
  return { ok: true, dispatched: clean };
}

function handleHookPushPayload(parsed) {
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
  return { ok: true };
}

function handleLocalCmdPayload(parsed) {
  if (parsed?.url) {
    const cmd = protocolUrlToControlCmd(parsed.url);
    if (!cmd) return { ok: false, error: 'unknown_protocol_route' };
    if (cmd === 'read-clipboard' && typeof parsed?.clipboardText === 'string') {
      executeButlerAction({ action: 'read-clipboard', clipboardText: parsed.clipboardText })
        .then((res) => {
          if (res && res.ok) emitEvent('fairy:butler-event', res);
        })
        .catch(() => {});
      return { ok: true, executed: 'read-clipboard' };
    }
    return dispatchControlCommand(cmd);
  }
  if (parsed?.cmd === 'read-clipboard' && typeof parsed?.clipboardText === 'string') {
    executeButlerAction({ action: 'read-clipboard', clipboardText: parsed.clipboardText })
      .then((res) => {
        if (res && res.ok) emitEvent('fairy:butler-event', res);
      })
      .catch(() => {});
    return { ok: true, executed: 'read-clipboard' };
  }
  return dispatchControlCommand(parsed?.cmd);
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

const B_L = '(?:^|[\\s,.;:!?("“-])';
const B_R = '(?=$|[\\s,.;:!?)”"-])';
const USER_SPEECH_FILTER_RE = new RegExp(
  '(\\?\\s*$|' +
  B_L + '(?:' +
    'giúp\\s+tôi|cho\\s+tôi|của\\s+tôi|của\\s+mình|ý\\s+tôi|nhưng\\s+mà|nếu\\s+mà|với\\s+cả|à\\s+trước|trước\\s+tôi|' +
    'gửi\\s+bạn|gửi\\s+cho\\s+bạn|hãy\\s+kiểm\\s+tra|cho\\s+thấy\\s+(?:fairy|ferry)|ferry\\s+vẫn|khá\\s+là\\s+ngắt|kiểu\\s+nó\\s+bị|' +
    'tôi\\s+(?:muốn|thấy|cảm\\s+giác|nghĩ|đang\\s+nghĩ|đang\\s+thử|đang\\s+test|đang\\s+thắc\\s+mắc|đang\\s+bị|không\\s+thấy|không\\s+nghĩ|không\\s+nghe|có\\s+gửi|vừa\\s+gửi|chỉ\\s+cần|nhớ\\s+là|bảo\\s+là|cam\\s+kết|test\\s+thử)|' +
    'bạn\\s+(?:thử|hãy|làm|xóa|tìm|kiểm\\s+tra|đã\\s+tìm|đã\\s+có)|' +
    'fairy\\s+(?:nó|bị|chưa|còn|mới\\s+chỉ|vừa\\s+mới|nãy|vẫn\\s+(?:bị|không|chưa|đang\\s+bị))|' +
    'được\\s+không|đúng\\s+không|phải\\s+không|có\\s+thể\\s+dùng\\s+cái\\s+này\\s+không|nhé|nhỉ' +
  ')' + B_R + ')',
  'i'
);
const AI_SPEECH_FILTER_RE = new RegExp(
  B_L + '(?:' +
    'ngài|master|' +
    'tôi\\s+(?:sẽ|đang|đã|xác\\s+nhận\\s+(?:chưa|không)|hiểu|rất\\s+vui|ghi\\s+nhận|tìm\\s+thấy|không\\s+thể|không\\s+hỗ\\s+trợ|cần\\s+đính\\s+chính|cần\\s+hướng\\s+dẫn|đề\\s+xuất|dự\\s+định|khuyến\\s+nghị|can\\s+thiệp)|' +
    'để\\s+(?:tôi|fairy|giúp|giấu|xử\\s+lý|đổi|ưu\\s+tiên|đảm\\s+bảo|giữ|bỏ|chặn|kiểm\\s+tra)|' +
    'chính\\s+xác|chắc\\s+chắn\\s+rồi|hệ\\s+thống\\s+(?:đã|hiện|sẽ)|luồng\\s+ipc|toàn\\s+bộ\\s+(?:dự\\s+án|cấu\\s+hình|luồng|đường\\s+ống)|với\\s+cấu\\s+hình|' +
    'bạn\\s+hoàn\\s+toàn\\s+có\\s+thể|bạn\\s+có\\s+thể\\s+sử\\s+dụng\\s+các\\s+công\\s+cụ|' +
    'việc\\s+(?:tra\\s+cứu|tắt\\s+tiếng)|không\\s+(?:thể\\s+can\\s+thiệp|phải\\s+lọc)|antigravity\\s+vẫn\\s+phát|dùng\\s+giọng\\s+antigravity' +
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

  const chosen = mergedItems[mergedItems.length - 1];
  return {
    liveTalkerTime: chosen.ts,
    liveTalkerText: chosen.text.slice(0, 340),
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
    const lastVoiceText = String(lastVoiceLine?.text || '').replace(/\s+/g, ' ').trim().slice(0, 260);
    const ownerStartMs = ownerChat?.startedAt ? Date.parse(ownerChat.startedAt) || 0 : 0;
    const lastVoiceTime = (lastVoiceLine?.time ? Date.parse(lastVoiceLine.time) : 0) || ownerStartMs || startedAtMs || st.mtimeMs;
    const voiceSessionEnded = Boolean(stoppedAtMs > 0 && stoppedAtMs >= lastVoiceTime);
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

const learnedPathSet = new Set();
const maybeLearnWorkspace = (raw) => {
  const k = String(raw || '').trim();
  if (!k || learnedPathSet.has(k)) return;
  learnedPathSet.add(k);
  if (butler.learnWorkspace(k)) butler.saveMemory();
};

function getEmptyTokenUsage(now = Date.now()) {
  const mem = butler.loadMemory();
  const budgetTokens = Math.max(100_000, Number(mem.preferences?.dailyTokenBudget) || 20_000_000);
  return {
    todayKey: getLocalDateKey(now),
    todayInput: 0,
    todayOutput: 0,
    todayCacheRead: 0,
    todayUncached: 0,
    todaySteps: 0,
    sessionInput: 0,
    sessionOutput: 0,
    sessionCacheRead: 0,
    sessionUncached: 0,
    sessionSteps: 0,
    budgetTokens,
    budgetPct: 0,
    powerStatus: 'nominal',
    billLabel: 'Đang nạp...',
    topModels: [],
    isLocalEstimateOnly: true,
  };
}

function getCachedTokenUsage(activeConvId = '', force = false) {
  const now = Date.now();
  // Trì hoãn quét toàn bộ thư mục brain lúc mới boot cho đến khi kích hoạt nền hoặc có yêu cầu trực tiếp.
  if (!force && !backgroundActivated) {
    return cachedTokenUsage || getEmptyTokenUsage(now);
  }
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
  if (backgroundActivated && Array.isArray(sidecarEndpoint.workspaceUris)) {
    sidecarEndpoint.workspaceUris.forEach(maybeLearnWorkspace);
  }

  if (!entry && backgroundActivated) {
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

  if (backgroundActivated && entry.cwd) maybeLearnWorkspace(entry.cwd);
  if (entry.mood === 'thinking' || entry.mood === 'working' || entry.lastEvent === 'Stop') {
    lastUserActivityAt = Math.max(lastUserActivityAt, Number(entry.updatedAt) || now);
  }

  const dialogue = backgroundActivated
    ? extractRecentDialogueFromTranscript(entry.transcriptPath, entry.conversationId)
    : { userText: '', modelText: '', modelRawText: '', liveTalkerText: '', liveTalkerTime: '', liveTalkerComplete: false, recentUserTexts: [], hasStepError: false, mtimeMs: 0 };
  const voiceChat = backgroundActivated
    ? readLatestVoiceChatState(entry.conversationId, now)
    : { voiceActive: false, lastVoiceText: '', lastVoiceTime: 0 };
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

  const forceTokenRefresh = backgroundActivated && entry.lastEvent === 'Stop' && now - (Number(entry.doneAt) || 0) < 1200;

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

function cleanTextForSpeech(raw) {
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
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const parts = s.split(/(?<=[.!?])\s+/).filter((p) => p.replace(/[^A-Za-zÀ-ỹ0-9]/g, '').length >= 3);
  let picked = '';
  for (const p of parts) {
    if (picked && picked.length + p.length + 1 > 320) break;
    picked = picked ? `${picked} ${p}` : p;
    if (picked.length >= 250) break;
  }
  return (picked || s.slice(0, 320)).trim();
}

function pushStateToRenderer() {
  if (IS_SELF_TEST) return;
  const snap = readSnapshot();
  const b = snap.butler || {};
  const tu = b.tokenUsage || {};
  const bSig = `${tu.todayUncached || 0}|${tu.budgetPct || 0}|${b.preferences?.assistantMode || ''}|${b.preferences?.clipboardWatch ? 1 : 0}|${b.preferences?.dailyTokenBudget || 0}|${b.pinnedNotes?.length || 0}|${b.pomodoro?.remainingSec || 0}|${b.activeApp?.appName || ''}|${b.activeApp?.aiBrand || ''}`;
  const key = `${snap.mood}|${snap.emotionMood}|${snap.updatedAt}|${snap.toolCount}|${snap.invocationCount}|${snap.conversationId}|${snap.lastToolError}|${snap.dialogueQuip}|${snap.lastReplySpeech}|${snap.liveTalkerText}|${snap.liveTalkerTime}|${snap.voiceActive}|${snap.voiceSessionEnded}|${snap.lastVoiceText}|${snap.sidecarPort}|${snap.recentConversations?.length || 0}|${bSig}`;
  if (key === lastStateKey) return;
  lastStateKey = key;
  emitEvent('fairy:state', snap);
  scheduleSpeechFromSnapshot(snap);
}

function startTelemetryWatcher() {
  if (pollTimer) return;
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
  if (!IS_WIN || IS_SMOKE_TEST || IS_SELF_TEST || voiceWorker || !existsSync(VOICE_WORKER_SCRIPT)) return;
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
  if (!IS_WIN || IS_SMOKE_TEST || IS_SELF_TEST || !voiceWorkerReady) return;
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
  if (IS_MAC) return triggerMacAntigravityAction(mode);
  if (!IS_WIN) return { ok: false, error: 'unsupported_platform' };

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

let ttsWorker = null;
let ttsWorkerReady = false;
let ttsWorkerBuf = '';
let ttsReqSeq = 0;
const ttsPending = new Map();
let ttsEnabled = true;
let ttsBusy = false;
let ttsQueuedText = '';
let ttsBaselineReady = false;
const spokenStateByConv = new Map();
let voiceDebounceTimer = null;
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
  if (IS_SMOKE_TEST || IS_SELF_TEST || ttsWorker || !existsSync(TTS_PYTHON_EXE) || !existsSync(TTS_DAEMON_SCRIPT)) return;
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
    const cleaned = cleanTextForSpeech(text);
    if (!cleaned || IS_SMOKE_TEST || IS_SELF_TEST) {
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
  const cleaned = cleanTextForSpeech(text);
  if (!cleaned || !ttsEnabled || IS_SMOKE_TEST || IS_SELF_TEST) return { ok: false, skipped: true };
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
      const activeText = current;
      lastRes = await runTtsSynthesis(activeText, (chunkPayload) => {
        if (ttsEnabled) emitEvent('fairy:speak', chunkPayload);
      });
      if (lastRes.ok && !lastRes.sawChunk && ttsEnabled) {
        emitEvent('fairy:speak', {
          reqId: lastRes.reqId || 0,
          url: lastRes.url,
          text: lastRes.text || activeText,
          chunkIndex: 0,
          totalChunks: 1,
        });
      }
      current = ttsEnabled ? ttsQueuedText : '';
    }
  } finally {
    ttsBusy = false;
  }
  return lastRes;
}

function getVoiceCandidate(snap) {
  if (!snap) return { key: '', text: '', rawText: '', complete: true };
  if (snap.liveTalkerText) {
    const text = cleanTextForSpeech(snap.liveTalkerText);
    if (!text) return { key: '', text: '', rawText: '', complete: true };
    return {
      key: `live:${snap.conversationId}:${snap.liveTalkerTime}:${text.slice(0, 80)}`,
      text,
      rawText: snap.liveTalkerText,
      complete: Boolean(snap.liveTalkerComplete),
    };
  }
  if (snap.voiceSessionEnded || !snap.lastVoiceText) return { key: '', text: '', rawText: '', complete: true };
  const text = cleanTextForSpeech(snap.lastVoiceText);
  if (!text) return { key: '', text: '', rawText: '', complete: true };
  const stamp = snap.lastVoiceTime || snap.updatedAt || '';
  return { key: `vc:${snap.conversationId}:${stamp}:${text.slice(0, 80)}`, text, rawText: snap.lastVoiceText, complete: true };
}

function getStopCandidate(snap) {
  if (!snap || (snap.lastEvent !== 'Stop' && snap.mood !== 'done')) return { key: '', text: '' };
  const quip = String(snap.dialogueQuip || '').trim();
  const safeQuip = quip.startsWith('🎙️') ? '' : cleanTextForSpeech(quip);
  const text = snap.lastReplySpeech || safeQuip;
  if (!text) return { key: '', text: '' };
  const stamp = snap.doneAt || snap.updatedAt || '';
  return { key: `${snap.conversationId}:${stamp}:${text.slice(0, 60)}`, text };
}

function scheduleSpeechFromSnapshot(snap) {
  if (!snap || !snap.conversationId) return;
  const voiceInit = getVoiceCandidate(snap);
  const stopInit = getStopCandidate(snap);
  const convState = getConvSpokenState(snap.conversationId);

  if (!ttsBaselineReady) {
    ttsBaselineReady = true;
    convState.lastVoiceKey = voiceInit.key;
    markSpokenVoiceKey(voiceInit.key);
    convState.lastStopKey = stopInit.key;
    convState.lastText = voiceInit.text || stopInit.text || '';
    markSpokenVoiceNorm(voiceInit.text);
    markSpokenVoiceNorm(voiceInit.rawText);
    markSpokenVoiceNorm(snap.liveTalkerText);
    markSpokenVoiceNorm(snap.lastVoiceText);
    markSpokenVoiceNorm(stopInit.text);
    return;
  }
  if (!ttsEnabled || IS_SMOKE_TEST || IS_SELF_TEST) return;

  if (voiceInit.key && voiceInit.key !== convState.lastVoiceKey && !spokenVoiceKeys.has(voiceInit.key)) {
    clearTimeout(voiceDebounceTimer);
    const delayMs = voiceInit.complete ? 15 : 650;
    voiceDebounceTimer = setTimeout(() => {
      const latest = readSnapshot();
      const cand = getVoiceCandidate(latest);
      const st = getConvSpokenState(latest?.conversationId);
      if (!ttsEnabled || !cand.key || cand.key === st.lastVoiceKey || spokenVoiceKeys.has(cand.key)) return;
      st.lastVoiceKey = cand.key;
      markSpokenVoiceKey(cand.key);

      let toSpeak = cand.text;
      if (st.incompletePrefix && cand.rawText && cand.rawText.startsWith(st.incompletePrefix)) {
        toSpeak = cleanTextForSpeech(cand.rawText.slice(st.incompletePrefix.length));
      }
      st.incompletePrefix = cand.complete ? '' : cand.rawText;

      if (isKnownUserSpeech(toSpeak) || isKnownUserSpeech(cand.rawText)) return;

      const norm = normalizeSpeechKey(toSpeak);
      const rawNorm = normalizeSpeechKey(cand.rawText);
      const alreadySpoken = Boolean(isAlreadySpokenNorm(norm) || (toSpeak === cand.text && isAlreadySpokenNorm(rawNorm)));
      if (
        toSpeak &&
        toSpeak.replace(/[^A-Za-zÀ-ỹ0-9]/g, '').length >= 4 &&
        toSpeak !== st.lastText &&
        !alreadySpoken
      ) {
        st.lastText = toSpeak;
        markSpokenVoiceNorm(toSpeak);
        markSpokenVoiceNorm(cand.rawText);
        enqueueFairySpeech(toSpeak).catch(() => {});
      }
    }, delayMs);
  }

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
      if (cand.text && cand.text !== st.lastText) {
        st.lastText = cand.text;
        enqueueFairySpeech(cand.text).catch(() => {});
      }
    }, 30);
  }
}

function scheduleNextUiaPoll(delayMs = 350) {
  if (IS_SMOKE_TEST || IS_SELF_TEST || (!IS_WIN && !IS_MAC)) return;
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
  if (IS_SMOKE_TEST || IS_SELF_TEST || (!IS_WIN && !IS_MAC)) return;
  if (uiaPollInFlight) {
    scheduleNextUiaPoll(350);
    return;
  }
  if (IS_WIN && (!voiceWorkerReady || voicePending.size > 0)) {
    scheduleNextUiaPoll(voicePending.size > 0 ? 500 : 800);
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
            (USER_SPEECH_FILTER_RE.test(deltaText) && !MASTER_ADDRESS_RE.test(deltaText));
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
      emitEvent('fairy:butler-event', {
        kind: 'pomodoro-done',
        mood: 'done',
        quip,
      });
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
  if (IS_SMOKE_TEST || IS_SELF_TEST || (!IS_WIN && !IS_MAC)) return;
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
    if (!proc || /fairy iii/i.test(title) || (/^(electron|fairy-desktop)$/i.test(proc) && (!title || /fairy/i.test(title)))) {
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
      emitEvent('fairy:butler-event', {
        kind: 'ai-web',
        mood: 'smug',
        quip: pickQuip('aiWeb', now),
        aiBrand: info.aiBrand,
      });
    }
    pushStateToRenderer();
  } catch {
    // Ignore transient foreground app probe error.
  }
}

function pollProactiveAlerts() {
  if (IS_SMOKE_TEST || IS_SELF_TEST || overlayPhase !== 'dock') return;
  const snap = readSnapshot();
  if (snap.voiceActive) return;
  const tokenUsage = snap.butler?.tokenUsage || getCachedTokenUsage(snap.conversationId, false);
  const idleMs = Date.now() - lastUserActivityAt;
  const alert = butler.evaluateProactiveAlert({ tokenUsage, idleMs });
  if (!alert) return;
  emitEvent('fairy:butler-event', { ...alert, source: 'proactive' });
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

function handleClipboardTextChange(txt) {
  const prefs = butler.loadMemory().preferences;
  if (!prefs.clipboardWatch) return;
  if (!txt || txt === lastSeenClipboardText) return;
  lastSeenClipboardText = txt;
  const cleaned = cleanTextForSpeech(txt);
  if (!isReadableClipboardCandidate(txt, cleaned)) return;
  butler.recordClipboardRead();
  emitEvent('fairy:butler-event', {
    kind: 'clipboard',
    mood: 'comforting',
    quip: `📋 Đọc Clipboard: ${cleaned}`,
  });
  if (!IS_SMOKE_TEST && !IS_SELF_TEST) {
    enqueueFairySpeech(cleaned).catch(() => {});
  }
}

function pollClipboardWatcher() {
  if (IS_SMOKE_TEST || IS_SELF_TEST || USE_RUST_CLIPBOARD) return;
  const prefs = butler.loadMemory().preferences;
  if (!prefs.clipboardWatch) return;
  const txt = readClipboardText();
  handleClipboardTextChange(txt);
}

function startButlerMonitors() {
  if (IS_SMOKE_TEST || IS_SELF_TEST) return;
  if (!activeAppTimer) {
    activeAppTimer = setInterval(pollActiveApp, 3000);
  }
  if (!alertTimer) {
    alertTimer = setInterval(pollProactiveAlerts, 30_000);
  }
  if (!clipboardTimer && !USE_RUST_CLIPBOARD) {
    lastSeenClipboardText = readClipboardText();
    clipboardTimer = setInterval(pollClipboardWatcher, 650);
  }
}

function scheduleLazyTtsWarmup() {
  if (IS_SMOKE_TEST || IS_SELF_TEST || ttsWorker || lazyTtsTimer || !ttsEnabled) return;
  lazyTtsTimer = setTimeout(() => {
    lazyTtsTimer = null;
    if (ttsEnabled && !ttsWorker && !IS_SMOKE_TEST && !IS_SELF_TEST) {
      startTtsWorker();
    }
  }, 8000);
}

function activateBackgroundWorkers() {
  if (backgroundActivated || IS_SMOKE_TEST || IS_SELF_TEST) return;
  backgroundActivated = true;
  if (backgroundFallbackTimer) {
    clearTimeout(backgroundFallbackTimer);
    backgroundFallbackTimer = null;
  }
  butler.recordSessionStart();
  startTelemetryWatcher();
  startVoiceWorker();
  scheduleNextUiaPoll(900);
  startButlerMonitors();
  pushStateToRenderer();
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
        p = fileURLToPath(p);
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
    return executeButlerAction({ ...parsed, action: parsed.type, speak: req?.speak, clipboardText: req?.clipboardText });
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
    const rawClip = readClipboardText(req?.clipboardText);
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
    if (typeof req?.clipboardText === 'string') {
      lastSeenClipboardText = req.clipboardText;
    } else if (!USE_RUST_CLIPBOARD) {
      lastSeenClipboardText = readClipboardText();
    }
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
    const err = await openPathNative(targetPath);
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
    await openExternalNative(parsedUrl.toString());
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

async function shutdownEngine() {
  if (IS_WIN && !IS_SMOKE_TEST && voiceWorkerReady && voiceWorker && voiceWorker.stdin && !voiceWorker.killed) {
    await Promise.race([
      sendVoiceWorkerCommand('UNMUTE_ANTIGRAVITY', {}, 350),
      new Promise((resolve) => setTimeout(resolve, 350)),
    ]);
  }
  clearInterval(pollTimer);
  clearInterval(activeAppTimer);
  clearInterval(alertTimer);
  clearInterval(clipboardTimer);
  clearInterval(pomodoroTimer);
  clearTimeout(uiaPollTimer);
  clearTimeout(voiceDebounceTimer);
  clearTimeout(stopDebounceTimer);
  clearTimeout(backgroundFallbackTimer);
  clearTimeout(lazyTtsTimer);

  if (ttsWorker) {
    try { ttsWorker.kill(); } catch {}
    ttsWorker = null;
  }
  if (voiceWorker) {
    try { voiceWorker.kill(); } catch {}
    voiceWorker = null;
  }
  if (stateWatcher) {
    try { stateWatcher.close(); } catch {}
    stateWatcher = null;
  }
  if (voiceWatcher) {
    try { voiceWatcher.close(); } catch {}
    voiceWatcher = null;
  }
  if (transcriptWatcher) {
    try { transcriptWatcher.close(); } catch {}
    transcriptWatcher = null;
  }
  return { ok: true };
}

async function dispatchRpcMethod(method, params = {}) {
  switch (method) {
    case 'getState':
      return readSnapshot();
    case 'setTtsEnabled': {
      ttsEnabled = Boolean(params?.enabled);
      if (ttsEnabled && overlayPhase === 'dock' && !IS_SMOKE_TEST) {
        scheduleLazyTtsWarmup();
      }
      syncAntigravityMuteState(true);
      return { ok: true, ttsEnabled };
    }
    case 'setAutoMute': {
      autoMuteAntigravity = Boolean(params?.enabled);
      syncAntigravityMuteState(true);
      return { ok: true, autoMuteAntigravity };
    }
    case 'speakText': {
      const prev = ttsEnabled;
      ttsEnabled = true;
      const res = await enqueueFairySpeech(String(params?.text || ''));
      ttsEnabled = prev;
      return res;
    }
    case 'triggerVoice':
      return triggerAntigravityVoice(params || {});
    case 'hybridAction':
      return executeHybridAction(params || {});
    case 'butlerAction':
      return executeButlerAction(params || {});
    case 'setButlerPrefs': {
      const prevClip = Boolean(butler.loadMemory().preferences.clipboardWatch);
      const prefs = butler.updatePrefs(params || {});
      if (!prevClip && prefs.clipboardWatch) {
        lastSeenClipboardText = typeof params?.clipboardText === 'string'
          ? params.clipboardText
          : readClipboardText();
      }
      if (params && params.dailyTokenBudget !== undefined) {
        lastTokenScanAt = 0;
      }
      pushStateToRenderer();
      return prefs;
    }
    case 'hookPush':
      return handleHookPushPayload(params || {});
    case 'localCmd':
      return handleLocalCmdPayload(params || {});
    case 'uiPhase': {
      const nextPhase = String(params?.phase || 'dock');
      overlayPhase = nextPhase === 'boot' || nextPhase === 'greet' ? nextPhase : 'dock';
      if (overlayPhase === 'dock') {
        activateBackgroundWorkers();
        scheduleLazyTtsWarmup();
      }
      return { ok: true, phase: overlayPhase, backgroundActivated };
    }
    case 'clipboardUpdate': {
      if (typeof params?.text === 'string') {
        handleClipboardTextChange(params.text);
      }
      return { ok: true };
    }
    case 'shutdown':
      return shutdownEngine();
    default:
      throw new Error(`unknown_method:${method}`);
  }
}

if (IS_SELF_TEST) {
  const snap = readSnapshot();
  const report = {
    ok: Boolean(snap && typeof snap === 'object' && snap.butler && snap.butler.tokenUsage),
    mood: snap?.mood || '',
    ttsWorkerSpawned: Boolean(ttsWorker),
    voiceWorkerSpawned: Boolean(voiceWorker),
    backgroundActivated,
  };
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok || report.ttsWorkerSpawned || report.voiceWorkerSpawned) {
    process.exit(1);
  }
  process.stdout.write('FAIRY_ENGINE_SELF_TEST_OK\n');
  process.exit(0);
} else {
  if (!IS_SMOKE_TEST) {
    // Fallback kích hoạt nền sau 2s phòng trường hợp UI bỏ qua giai đoạn boot hoặc cần đọc telemetry sớm.
    backgroundFallbackTimer = setTimeout(() => {
      activateBackgroundWorkers();
    }, 2000);
  }

  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req;
    try {
      req = JSON.parse(trimmed);
    } catch {
      return;
    }
    const id = req?.id;
    const method = String(req?.method || '');
    const params = req?.params || {};
    try {
      const result = await dispatchRpcMethod(method, params);
      if (id !== undefined && id !== null) {
        process.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
      }
      if (method === 'shutdown') {
        setTimeout(() => process.exit(0), 20);
      }
    } catch (err) {
      if (id !== undefined && id !== null) {
        process.stdout.write(`${JSON.stringify({ id, ok: false, error: err?.message || 'engine_error' })}\n`);
      }
    }
  });
  rl.on('close', () => {
    shutdownEngine().finally(() => process.exit(0));
  });
  process.stdout.write(`${JSON.stringify({ event: 'engine:ready', payload: { pid: process.pid } })}\n`);
}
