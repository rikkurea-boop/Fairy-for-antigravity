/**
 * Fairy III · H.D.D AI Butler Core (Cross-platform Windows + macOS Apple Silicon).
 * - Long-term H.D.D memory (`hdd-memory.json`)
 * - Real local Antigravity token telemetry ("Tiêu thụ Điện năng H.D.D")
 * - Daily Session Briefing (`git` repos + tokens + notes)
 * - Fairy ZZZ persona quips, foreground app classification & Vietnamese command parser
 */
const { execFileSync } = require('node:child_process');
const {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require('node:fs');
const { basename, dirname, join } = require('node:path');
const { fileURLToPath } = require('node:url');

let rustButlerPure = null;
try {
  const rustEntry = join(__dirname, '..', 'rust', 'butler-pure-rs', 'index.cjs');
  if (existsSync(rustEntry)) {
    rustButlerPure = require(rustEntry);
  }
} catch {
  rustButlerPure = null;
}

const CONV_ID_RE = /^[0-9a-f-]{8,}$/i;
const DEFAULT_DAILY_BUDGET = 20_000_000;
const VALID_BUDGETS = [5_000_000, 10_000_000, 20_000_000, 50_000_000, 100_000_000];

const FAIRY_QUIPS = {
  idle: [
    '— Ting~ Mọi luồng H.D.D và Antigravity đang đồng bộ chuẩn xác, thưa Master.',
    'Hiệu năng của hệ thống này vẫn ở mức tối đa. Phản xạ 82 mili-giây luôn sẵn sàng phục vụ.',
    'Tôi giải quyết phần nặng nhọc, Master chỉ cần duyệt kết quả — giao kèo công bằng chứ?',
    'Đang chờ chỉ thị tiếp theo của ngài. Chế độ treo cũng chỉ tốn chút điện năng thôi.',
    'Ghi nhận dữ liệu: Truyện kinh dị ngắn mang tên "Hóa đơn tiền điện tháng này" vẫn đang chờ ngài viết tiếp.',
  ],
  electricity75: [
    '— Cảnh báo nhẹ: Mức tiêu thụ điện năng H.D.D hôm nay đã chạm 75% định mức rồi đấy, Master.',
    'Một AI Thế hệ III đang tuổi lớn cũng cần nạp điện, nhưng ngài tiêu tới 75% định mức hôm nay rồi.',
  ],
  electricity90: [
    '— Cảnh báo: Mức điện năng H.D.D đã đạt 90% định mức! Kiến nghị Master cân nhắc mô hình nhẹ hơn để tránh hóa đơn x5.',
  ],
  electricity100: [
    '— Cảnh báo đỏ: Vượt 100% định mức Điện năng H.D.D hôm nay! Master, câu chuyện kinh dị mang tên hóa đơn tiền điện đã thành sự thật.',
  ],
  spike: [
    '— Ghi nhận dữ liệu: Lượt vừa rồi ngốn hơn 500 nghìn token mới. Trí tuệ tối thượng của tôi quả thực đắt đỏ nhỉ, Master?',
  ],
  afk: [
    'Master, tôi phát hiện công suất lao động của ngài vừa chạm đáy suốt 45 phút qua. Hay ngài lại định bỏ mặc H.D.D chạy không tải?',
  ],
  night: [
    'Cảnh báo: Đã qua nửa đêm rồi, Master. Xong lượt này kiến nghị ngài tắt máy đi ngủ, ngay cả Fairy cũng không muốn trả hộ tiền điện ban đêm đâu.',
  ],
  aiWeb: [
    '— Phát hiện Master đang ghé thăm hệ thống AI ngoài. Đừng quên bật "Tự đọc" nếu ngài muốn tôi đọc to phản hồi ở đó với tốc độ 82 mili-giây.',
  ],
};

function pickQuip(category, seed = Math.floor(Math.random() * 100)) {
  if (rustButlerPure) {
    try { return rustButlerPure.pickQuip(category, seed); } catch {}
  }
  const list = FAIRY_QUIPS[category] || FAIRY_QUIPS.idle;
  return list[Math.abs(Number(seed) || 0) % list.length];
}

function getLocalDateKey(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatCompactTokens(num) {
  if (rustButlerPure) {
    try { return rustButlerPure.formatCompactTokens(num); } catch {}
  }
  const n = Math.max(0, Number(num) || 0);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.0+$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(n));
}

function formatModelLabel(rawModel) {
  if (rustButlerPure) {
    try { return rustButlerPure.formatModelLabel(rawModel); } catch {}
  }
  const s = String(rawModel || '').trim().toLowerCase();
  if (!s) return 'Chưa rõ';
  if (s.includes('hydrogen-high') || s.includes('pro-high')) return 'Gemini Pro High';
  if (s.includes('hydrogen') || s.includes('pro-orchestrator') || s.includes('gemini-pro')) return 'Gemini Pro';
  if (s.includes('flash-lite')) return 'Gemini Flash Lite';
  if (s.includes('flash')) return 'Gemini Flash';
  if (s.includes('claude-opus')) return 'Claude Opus';
  if (s.includes('claude-sonnet')) return 'Claude Sonnet';
  if (s.includes('claude-haiku')) return 'Claude Haiku';
  return String(rawModel).replace(/[_-]+/g, ' ').trim();
}

function normalizeWorkspacePath(raw) {
  if (rustButlerPure) {
    try { return rustButlerPure.normalizeWorkspacePath(raw); } catch {}
  }
  let s = String(raw || '').trim();
  if (!s) return '';
  if (/^file:\/\//i.test(s)) {
    try {
      s = fileURLToPath(s);
    } catch {
      s = decodeURIComponent(s.replace(/^file:\/\//i, ''));
      if (process.platform === 'win32' && /^\/[A-Za-z]:/.test(s)) s = s.slice(1);
    }
  }
  if (process.platform === 'win32') {
    s = s.replace(/\//g, '\\');
  }
  return s.replace(/[\\/]+$/, '') || s;
}

function writeAtomic(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, content, 'utf-8');
    renameSync(tmpPath, filePath);
  } catch {
    try { unlinkSync(tmpPath); } catch {}
    writeFileSync(filePath, content, 'utf-8');
  }
}

function createEmptyMemory(now = Date.now()) {
  const hourHistogram = {};
  for (let h = 0; h < 24; h += 1) {
    hourHistogram[String(h).padStart(2, '0')] = 0;
  }
  return {
    version: 1,
    masterName: 'Master',
    stats: {
      totalSessions: 0,
      lateNightSessions: 0,
      pomodorosCompleted: 0,
      briefingsDelivered: 0,
      clipboardReads: 0,
      firstSeenAt: now,
      lastSeenAt: now,
      activeHourHistogram: hourHistogram,
      favoriteApps: {},
    },
    knownWorkspaces: [],
    dailyTokenHistory: {},
    pinnedNotes: [],
    preferences: {
      dailyTokenBudget: DEFAULT_DAILY_BUDGET,
      autoBriefing: true,
      electricityAlerts: true,
      afkWatch: true,
      clipboardWatch: false,
      assistantMode: 'antigravity',
    },
  };
}

function normalizeMemoryShape(raw) {
  const base = createEmptyMemory();
  if (!raw || typeof raw !== 'object') return base;
  const stats = { ...base.stats, ...(raw.stats || {}) };
  stats.activeHourHistogram = { ...base.stats.activeHourHistogram, ...(stats.activeHourHistogram || {}) };
  stats.favoriteApps = stats.favoriteApps && typeof stats.favoriteApps === 'object' ? { ...stats.favoriteApps } : {};

  const prefsRaw = raw.preferences && typeof raw.preferences === 'object' ? raw.preferences : {};
  const budget = Number(prefsRaw.dailyTokenBudget) || DEFAULT_DAILY_BUDGET;
  const preferences = {
    dailyTokenBudget: Math.max(100_000, budget),
    autoBriefing: prefsRaw.autoBriefing !== undefined ? Boolean(prefsRaw.autoBriefing) : true,
    electricityAlerts: prefsRaw.electricityAlerts !== undefined ? Boolean(prefsRaw.electricityAlerts) : true,
    afkWatch: prefsRaw.afkWatch !== undefined ? Boolean(prefsRaw.afkWatch) : true,
    clipboardWatch: prefsRaw.clipboardWatch !== undefined ? Boolean(prefsRaw.clipboardWatch) : false,
    assistantMode: prefsRaw.assistantMode === 'instant' ? 'instant' : 'antigravity',
  };

  return {
    version: 1,
    masterName: String(raw.masterName || 'Master'),
    stats,
    knownWorkspaces: Array.isArray(raw.knownWorkspaces) ? raw.knownWorkspaces.slice(0, 10) : [],
    dailyTokenHistory: raw.dailyTokenHistory && typeof raw.dailyTokenHistory === 'object' ? { ...raw.dailyTokenHistory } : {},
    pinnedNotes: Array.isArray(raw.pinnedNotes) ? raw.pinnedNotes.slice(0, 12) : [],
    preferences,
  };
}

function classifyForegroundApp(processName, windowTitle) {
  if (rustButlerPure) {
    try { return rustButlerPure.classifyForegroundApp(processName, windowTitle); } catch {}
  }
  const proc = String(processName || '').trim();
  const title = String(windowTitle || '').trim();
  const hay = `${proc} ${title}`.toLowerCase();

  let aiBrand = '';
  if (/\bchatgpt\b|chat\.openai\.com/.test(hay)) aiBrand = 'ChatGPT';
  else if (/\bclaude\b|claude\.ai/.test(hay)) aiBrand = 'Claude';
  else if (/gemini\.google\.com|google gemini|\bgemini\b/.test(hay) && !/antigravity/.test(hay)) aiBrand = 'Gemini Web';
  else if (/perplexity/.test(hay)) aiBrand = 'Perplexity';
  else if (/grok\.com|\bgrok\b/.test(hay)) aiBrand = 'Grok';
  else if (/copilot/.test(hay)) aiBrand = 'Copilot';

  const isBrowser = /(chrome|msedge|brave|firefox|opera|arc|safari|vivaldi|coccoc|zen)/i.test(proc);
  const isAntigravity = /antigravity/i.test(proc) || (/antigravity/i.test(title) && !/fairy iii/i.test(title));
  const isIde = isAntigravity || /(code|cursor|windsurf|zed|idea|pycharm|webstorm|xcode|terminal|windowsterminal|pwsh|iterm)/i.test(proc);

  let category = 'other';
  if (isAntigravity) category = 'antigravity';
  else if (aiBrand) category = 'ai-web';
  else if (isBrowser) category = 'browser';
  else if (isIde) category = 'ide';

  return {
    appName: proc || 'Không rõ',
    title: title.slice(0, 120),
    category,
    aiBrand,
  };
}

function extractFirstUrl(text) {
  if (rustButlerPure) {
    try { return rustButlerPure.extractFirstUrl(text); } catch {}
  }
  const m = String(text || '').match(/https?:\/\/[^\s"'<>]+/i);
  return m ? m[0] : '';
}

function parseButlerCommand(rawText) {
  if (rustButlerPure) {
    try { return rustButlerPure.parseButlerCommand(rawText); } catch {}
  }
  const raw = String(rawText || '').trim();
  if (!raw) return { type: 'noop', raw };

  const agyDirect = raw.match(/^(?:antigravity|agy)\s*[:>]\s*([\s\S]+)$/i);
  if (agyDirect && agyDirect[1].trim()) {
    return { type: 'send-antigravity', message: agyDirect[1].trim() };
  }

  const normalized = raw.replace(/^\/+/, '').trim();
  const lower = normalized.toLowerCase();

  if (/^(?:trợ giúp|help|lệnh|\?)$/i.test(lower)) {
    return { type: 'help' };
  }
  if (/^(?:báo cáo|báo cáo đầu phiên|báo cáo h\.?d\.?d|briefing)(?:\s+(?:ngay|hôm nay|đi|nào))?$/i.test(lower)) {
    return { type: 'briefing-now' };
  }
  if (/(?:điện năng|tiền điện|hóa đơn|quota|token|định mức)/i.test(lower) && !/^ghi\s*(?:nhớ|chú)/i.test(lower)) {
    return { type: 'power-report' };
  }
  if (/^(?:bật|tắt)\s+(?:tự đọc|theo dõi)?\s*clipboard|^(?:bật|tắt)\s+tự đọc$/i.test(lower)) {
    return { type: 'toggle-clipboard-watch', enabled: /^bật/i.test(lower) };
  }
  if (/^(?:tự đọc|clipboard watch)$/i.test(lower)) {
    return { type: 'toggle-clipboard-watch', enabled: null };
  }
  if (/(?:đọc\s*(?:clipboard|bộ nhớ tạm|nội dung|giúp|văn bản|chữ)|tóm tắt\s*clipboard)/i.test(lower)) {
    return { type: 'read-clipboard' };
  }
  if (/^(?:git(?:\s+status)?|trạng thái git|kiểm tra git|repo)$/i.test(lower)) {
    return { type: 'git-status' };
  }
  if (/^(?:mở thư mục|mở workspace|mở repo|open workspace|open folder)$/i.test(lower)) {
    return { type: 'open-workspace' };
  }
  if (/(?:dừng|tắt|hủy)\s*(?:pomodoro|tập trung|hẹn giờ)/i.test(lower)) {
    return { type: 'pomodoro-stop' };
  }
  const pomoMatch = lower.match(/(?:pomodoro|tập trung|hẹn giờ)(?:\s+(\d{1,3})\s*(?:phút|p|m|min)?)?/i);
  if (pomoMatch && /^(?:pomodoro|tập trung|hẹn giờ|bắt đầu\s+pomodoro|bắt đầu\s+tập trung|đặt\s+hẹn giờ)/i.test(lower)) {
    const mins = Math.max(1, Math.min(120, Number(pomoMatch[1]) || 25));
    return { type: 'pomodoro-start', minutes: mins };
  }
  if (/^(?:xóa|xoá|dọn)\s*(?:hết\s*)?(?:ghi chú|ghi nhớ|nhắc nhở)/i.test(lower)) {
    return { type: 'memory-clear-notes' };
  }
  if (/^(?:xem\s*)?(?:bộ nhớ|trí nhớ|ghi chú|h\.?d\.?d\s*memory)$/i.test(lower)) {
    return { type: 'memory-list' };
  }
  const noteMatch = normalized.match(/^(?:ghi\s*(?:nhớ|chú)|nhắc(?:\s+tôi)?|note)\s*[:\-]?\s+([\s\S]+)$/i);
  if (noteMatch && noteMatch[1].trim()) {
    return { type: 'memory-add-note', text: noteMatch[1].trim() };
  }
  if (/^(?:mở|vào)\s+antigravity$/i.test(lower)) {
    return { type: 'focus-antigravity' };
  }
  if (/^(?:khởi động lại|boot|mở boot)$/i.test(lower)) {
    return { type: 'replay-boot' };
  }

  const directUrl = extractFirstUrl(normalized);
  if (directUrl && /^(?:mở|open)\b/i.test(lower)) {
    return { type: 'open-external', url: directUrl, label: directUrl };
  }

  const openTargetMap = [
    [/^(?:mở|vào|bật)\s+chatgpt$/i, 'https://chatgpt.com/', 'ChatGPT'],
    [/^(?:mở|vào|bật)\s+claude$/i, 'https://claude.ai/', 'Claude'],
    [/^(?:mở|vào|bật)\s+gemini$/i, 'https://gemini.google.com/', 'Gemini'],
    [/^(?:mở|vào|bật)\s+perplexity$/i, 'https://www.perplexity.ai/', 'Perplexity'],
    [/^(?:mở|vào|bật)\s+github$/i, 'https://github.com/', 'GitHub'],
    [/^(?:mở|vào|bật)\s+youtube$/i, 'https://www.youtube.com/', 'YouTube'],
  ];
  for (const [rx, url, label] of openTargetMap) {
    if (rx.test(lower)) return { type: 'open-external', url, label };
  }

  const searchMatch = normalized.match(/^(?:tìm|tra cứu|google|search)\s+([\s\S]+)$/i);
  if (searchMatch && searchMatch[1].trim()) {
    const q = searchMatch[1].trim();
    return {
      type: 'open-external',
      url: `https://www.google.com/search?q=${encodeURIComponent(q)}`,
      label: `Tìm "${q}"`,
    };
  }

  if (directUrl) {
    return { type: 'open-external', url: directUrl, label: directUrl };
  }

  return { type: 'unknown', raw };
}

function createButlerCore({ appDataDir, brainDir }) {
  const memoryFile = join(appDataDir, 'plugin_data', 'fairy-zzz', 'hdd-memory.json');
  const transcriptCache = new Map();
  let memory = loadMemoryFromDisk();
  let lastSavedUsageSig = '';
  let lastSpikeSample = null;
  let lastSpikeAlertAt = 0;
  let lastAfkAlertAt = 0;
  let lastNightAlertDate = '';

  function loadMemoryFromDisk() {
    try {
      if (existsSync(memoryFile)) {
        const parsed = JSON.parse(readFileSync(memoryFile, 'utf-8'));
        return normalizeMemoryShape(parsed);
      }
    } catch {
      // Corrupt or unreadable memory file; reset cleanly.
    }
    return createEmptyMemory();
  }

  function pruneDailyHistory() {
    const keys = Object.keys(memory.dailyTokenHistory || {}).sort();
    if (keys.length <= 14) return;
    for (const oldKey of keys.slice(0, keys.length - 14)) {
      delete memory.dailyTokenHistory[oldKey];
    }
  }

  function saveMemory() {
    pruneDailyHistory();
    try {
      writeAtomic(memoryFile, JSON.stringify(memory, null, 2));
    } catch {
      // Ignore write failures in read-only environments.
    }
    return memory;
  }

  function learnWorkspace(rawPath) {
    const normalized = normalizeWorkspacePath(rawPath);
    if (!normalized) return false;
    try {
      if (!existsSync(normalized)) return false;
    } catch {
      return false;
    }

    const now = Date.now();
    const cmpKey = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    const existingIdx = memory.knownWorkspaces.findIndex((w) => {
      const k = process.platform === 'win32' ? String(w.path || '').toLowerCase() : String(w.path || '');
      return k === cmpKey;
    });

    const entry = {
      path: normalized,
      name: basename(normalized) || normalized,
      lastSeenAt: now,
    };

    if (existingIdx >= 0) {
      memory.knownWorkspaces[existingIdx] = { ...memory.knownWorkspaces[existingIdx], ...entry };
    } else {
      memory.knownWorkspaces.unshift(entry);
    }

    memory.knownWorkspaces.sort((a, b) => (Number(b.lastSeenAt) || 0) - (Number(a.lastSeenAt) || 0));
    memory.knownWorkspaces = memory.knownWorkspaces.slice(0, 10);
    return true;
  }

  function discoverScratchRepos() {
    const scratchDir = join(appDataDir, 'scratch');
    const found = [];
    try {
      if (!existsSync(scratchDir)) return found;
      for (const name of readdirSync(scratchDir)) {
        const full = join(scratchDir, name);
        try {
          if (statSync(full).isDirectory() && existsSync(join(full, '.git'))) {
            found.push(full);
          }
        } catch {}
      }
    } catch {}
    return found;
  }

  function recordSessionStart() {
    const now = Date.now();
    const hourKey = String(new Date(now).getHours()).padStart(2, '0');
    memory.stats.totalSessions = (Number(memory.stats.totalSessions) || 0) + 1;
    memory.stats.lastSeenAt = now;
    if (!memory.stats.firstSeenAt) memory.stats.firstSeenAt = now;
    memory.stats.activeHourHistogram[hourKey] = (Number(memory.stats.activeHourHistogram[hourKey]) || 0) + 1;
    for (const repoPath of discoverScratchRepos()) {
      learnWorkspace(repoPath);
    }
    saveMemory();
  }

  function recordObservedApp(appName) {
    const clean = String(appName || '').trim();
    if (!clean || /^fairy/i.test(clean)) return;
    const fav = memory.stats.favoriteApps || {};
    fav[clean] = (Number(fav[clean]) || 0) + 1;
    const entries = Object.entries(fav)
      .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
      .slice(0, 12);
    memory.stats.favoriteApps = Object.fromEntries(entries);
  }

  function addPinnedNote(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 220);
    if (!clean) return null;
    const note = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      text: clean,
      createdAt: Date.now(),
    };
    memory.pinnedNotes = [note, ...(memory.pinnedNotes || [])].slice(0, 12);
    saveMemory();
    return note;
  }

  function removePinnedNote(id) {
    const prevLen = (memory.pinnedNotes || []).length;
    memory.pinnedNotes = (memory.pinnedNotes || []).filter((n) => n.id !== id);
    if (memory.pinnedNotes.length !== prevLen) saveMemory();
    return memory.pinnedNotes.length !== prevLen;
  }

  function clearPinnedNotes() {
    memory.pinnedNotes = [];
    saveMemory();
  }

  function updatePrefs(patch = {}) {
    if (!patch || typeof patch !== 'object') return memory.preferences;
    if (patch.dailyTokenBudget !== undefined) {
      const b = Number(patch.dailyTokenBudget);
      if (Number.isFinite(b) && b >= 100_000) memory.preferences.dailyTokenBudget = Math.round(b);
    }
    if (patch.autoBriefing !== undefined) memory.preferences.autoBriefing = Boolean(patch.autoBriefing);
    if (patch.electricityAlerts !== undefined) memory.preferences.electricityAlerts = Boolean(patch.electricityAlerts);
    if (patch.afkWatch !== undefined) memory.preferences.afkWatch = Boolean(patch.afkWatch);
    if (patch.clipboardWatch !== undefined) memory.preferences.clipboardWatch = Boolean(patch.clipboardWatch);
    if (patch.assistantMode === 'instant' || patch.assistantMode === 'antigravity') {
      memory.preferences.assistantMode = patch.assistantMode;
    }
    saveMemory();
    return memory.preferences;
  }

  function readChunkUtf8(filePath, start, end) {
    const len = Math.max(0, end - start);
    if (len <= 0) return '';
    const buf = Buffer.allocUnsafe(len);
    const fd = openSync(filePath, 'r');
    try {
      let off = 0;
      while (off < len) {
        const n = readSync(fd, buf, off, len - off, start + off);
        if (n <= 0) break;
        off += n;
      }
      return buf.subarray(0, off).toString('utf-8');
    } finally {
      try { closeSync(fd); } catch {}
    }
  }

  function parseTranscriptIncremental(logPath, todayKey, fileMtimeMs, fileSize) {
    let entry = transcriptCache.get(logPath);
    if (!entry || entry.todayKey !== todayKey || fileSize < entry.offset) {
      entry = {
        mtimeMs: 0,
        offset: 0,
        leftover: '',
        todayKey,
        today: { input: 0, output: 0, cacheRead: 0, steps: 0, byModel: {} },
        total: { input: 0, output: 0, cacheRead: 0, steps: 0, byModel: {} },
      };
    }

    if (fileSize > entry.offset) {
      const delta = readChunkUtf8(logPath, entry.offset, fileSize);
      const combined = entry.leftover + delta;
      const endsWithNewline = combined.endsWith('\n');
      const lines = combined.split('\n');
      entry.leftover = endsWithNewline ? '' : (lines.pop() || '');
      entry.offset = fileSize;
      entry.mtimeMs = fileMtimeMs;

      for (const line of lines) {
        if (!line || !line.includes('"PLANNER_RESPONSE"')) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type !== 'PLANNER_RESPONSE') continue;
          const inp = Math.max(0, Number(obj.input_tokens) || 0);
          const out = Math.max(0, Number(obj.output_tokens) || 0);
          const cache = Math.max(0, Number(obj.cache_read_tokens) || 0);
          const model = String(obj.model || 'unknown');
          if (inp === 0 && out === 0 && cache === 0) continue;

          const parsedAt = obj.created_at ? Date.parse(obj.created_at) : 0;
          const stepDate = getLocalDateKey(Number.isFinite(parsedAt) && parsedAt > 0 ? parsedAt : fileMtimeMs);

          entry.total.input += inp;
          entry.total.output += out;
          entry.total.cacheRead += cache;
          entry.total.steps += 1;
          const tm = entry.total.byModel[model] || { input: 0, output: 0, cacheRead: 0, steps: 0 };
          tm.input += inp;
          tm.output += out;
          tm.cacheRead += cache;
          tm.steps += 1;
          entry.total.byModel[model] = tm;

          if (stepDate === todayKey) {
            entry.today.input += inp;
            entry.today.output += out;
            entry.today.cacheRead += cache;
            entry.today.steps += 1;
            const dm = entry.today.byModel[model] || { input: 0, output: 0, cacheRead: 0, steps: 0 };
            dm.input += inp;
            dm.output += out;
            dm.cacheRead += cache;
            dm.steps += 1;
            entry.today.byModel[model] = dm;
          }
        } catch {
          // Ignore malformed line at log boundary.
        }
      }
      transcriptCache.set(logPath, entry);
    }
    return entry;
  }

  function scanAntigravityTokenUsage(activeConvId = '', now = Date.now()) {
    const todayKey = getLocalDateKey(now);
    const todayStartMs = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate()).getTime();
    let todayInput = 0;
    let todayOutput = 0;
    let todayCacheRead = 0;
    let todaySteps = 0;
    const byModelToday = {};

    let sessionInput = 0;
    let sessionOutput = 0;
    let sessionCacheRead = 0;
    let sessionSteps = 0;

    try {
      if (existsSync(brainDir)) {
        for (const name of readdirSync(brainDir)) {
          if (!CONV_ID_RE.test(name)) continue;
          const logPath = join(brainDir, name, '.system_generated', 'logs', 'transcript.jsonl');
          let st;
          try {
            st = statSync(logPath);
          } catch {
            continue;
          }
          const isActive = Boolean(activeConvId && name === activeConvId);
          // Quét mọi phiên sửa đổi hôm nay (cộng đệm 6h trước nửa đêm để an toàn) hoặc phiên hiện tại.
          if (!isActive && st.mtimeMs < todayStartMs - 6 * 3600_000) continue;

          const parsed = parseTranscriptIncremental(logPath, todayKey, st.mtimeMs, st.size);
          todayInput += parsed.today.input;
          todayOutput += parsed.today.output;
          todayCacheRead += parsed.today.cacheRead;
          todaySteps += parsed.today.steps;
          for (const [mId, mStat] of Object.entries(parsed.today.byModel)) {
            const cur = byModelToday[mId] || { input: 0, output: 0, cacheRead: 0, steps: 0 };
            cur.input += mStat.input;
            cur.output += mStat.output;
            cur.cacheRead += mStat.cacheRead;
            cur.steps += mStat.steps;
            byModelToday[mId] = cur;
          }

          if (isActive) {
            sessionInput = parsed.total.input;
            sessionOutput = parsed.total.output;
            sessionCacheRead = parsed.total.cacheRead;
            sessionSteps = parsed.total.steps;
          }
        }
      }
    } catch {
      // Ignore brain scan error.
    }

    const todayUncached = todayInput + todayOutput;
    const sessionUncached = sessionInput + sessionOutput;
    const budgetTokens = Math.max(100_000, Number(memory.preferences.dailyTokenBudget) || DEFAULT_DAILY_BUDGET);
    const budgetPct = Math.round((todayUncached / budgetTokens) * 100);

    let powerStatus = 'nominal';
    let billLabel = 'Ổn định';
    if (budgetPct >= 100) {
      powerStatus = 'overload';
      billLabel = 'Quá tải tiền điện!';
    } else if (budgetPct >= 90) {
      powerStatus = 'warning';
      billLabel = 'Sắp cháy công tơ';
    } else if (budgetPct >= 75) {
      powerStatus = 'elevated';
      billLabel = 'Đang ngốn điện';
    }

    const groupedByLabel = new Map();
    for (const [id, m] of Object.entries(byModelToday)) {
      const label = formatModelLabel(id);
      const cur = groupedByLabel.get(label) || { id, label, input: 0, output: 0, cacheRead: 0, uncached: 0, steps: 0 };
      cur.input += m.input;
      cur.output += m.output;
      cur.cacheRead += m.cacheRead;
      cur.uncached += m.input + m.output;
      cur.steps += m.steps;
      groupedByLabel.set(label, cur);
    }
    const topModels = Array.from(groupedByLabel.values())
      .sort((a, b) => b.uncached - a.uncached)
      .slice(0, 3);

    const prevHist = memory.dailyTokenHistory[todayKey] || { alertLevelsTriggered: [] };
    memory.dailyTokenHistory[todayKey] = {
      input: todayInput,
      output: todayOutput,
      cacheRead: todayCacheRead,
      uncached: todayUncached,
      steps: todaySteps,
      byModel: byModelToday,
      alertLevelsTriggered: Array.isArray(prevHist.alertLevelsTriggered) ? prevHist.alertLevelsTriggered : [],
    };

    const sig = `${todayKey}:${todayInput}:${todayOutput}:${todaySteps}`;
    if (sig !== lastSavedUsageSig) {
      lastSavedUsageSig = sig;
      saveMemory();
    }

    return {
      todayKey,
      todayInput,
      todayOutput,
      todayCacheRead,
      todayUncached,
      todaySteps,
      sessionInput,
      sessionOutput,
      sessionCacheRead,
      sessionUncached,
      sessionSteps,
      budgetTokens,
      budgetPct,
      powerStatus,
      billLabel,
      topModels,
      isLocalEstimateOnly: true,
    };
  }

  function evaluateProactiveAlert({ tokenUsage, idleMs = 0, now = Date.now() }) {
    if (!tokenUsage) return null;
    const todayKey = tokenUsage.todayKey || getLocalDateKey(now);
    const hist = memory.dailyTokenHistory[todayKey] || { alertLevelsTriggered: [] };
    const triggered = Array.isArray(hist.alertLevelsTriggered) ? hist.alertLevelsTriggered : [];

    // 1. Electricity Bill Thresholds (once per threshold per day)
    if (memory.preferences.electricityAlerts) {
      const pct = Number(tokenUsage.budgetPct) || 0;
      let hitLevel = 0;
      if (pct >= 100 && !triggered.includes(100)) hitLevel = 100;
      else if (pct >= 90 && !triggered.includes(90)) hitLevel = 90;
      else if (pct >= 75 && !triggered.includes(75)) hitLevel = 75;

      if (hitLevel > 0) {
        for (const lvl of [75, 90, 100]) {
          if (lvl <= hitLevel && !triggered.includes(lvl)) triggered.push(lvl);
        }
        hist.alertLevelsTriggered = triggered;
        memory.dailyTokenHistory[todayKey] = hist;
        saveMemory();
        const cat = hitLevel === 100 ? 'electricity100' : hitLevel === 90 ? 'electricity90' : 'electricity75';
        const line = pickQuip(cat, now);
        return { kind: 'electricity', level: hitLevel, mood: 'alert', quip: line, speakText: line };
      }

      // 2. Single-window spike >= 500K uncached tokens within 2 minutes (cooldown 20 min)
      const curUncached = Number(tokenUsage.todayUncached) || 0;
      if (!lastSpikeSample || lastSpikeSample.todayKey !== todayKey || now - lastSpikeSample.ts > 120_000) {
        lastSpikeSample = { ts: now, uncached: curUncached, todayKey };
      } else if (curUncached - lastSpikeSample.uncached >= 500_000 && now - lastSpikeAlertAt > 20 * 60_000) {
        lastSpikeAlertAt = now;
        lastSpikeSample = { ts: now, uncached: curUncached, todayKey };
        const line = pickQuip('spike', now);
        return { kind: 'spike', mood: 'alert', quip: line, speakText: line };
      }
    }

    // 3. Late-night watch (00:00..04:59, once per night)
    const hour = new Date(now).getHours();
    if (hour >= 0 && hour < 5 && lastNightAlertDate !== todayKey) {
      lastNightAlertDate = todayKey;
      memory.stats.lateNightSessions = (Number(memory.stats.lateNightSessions) || 0) + 1;
      saveMemory();
      const line = pickQuip('night', now);
      return { kind: 'night', mood: 'sleepy', quip: line, speakText: line };
    }

    // 4. AFK scolding (idle >= 45 min, cooldown 60 min)
    if (memory.preferences.afkWatch && idleMs >= 45 * 60_000 && now - lastAfkAlertAt > 60 * 60_000) {
      lastAfkAlertAt = now;
      const line = pickQuip('afk', now);
      return { kind: 'afk', mood: 'smug', quip: line, speakText: line };
    }

    return null;
  }

  function inspectGitRepo(dirPath) {
    try {
      if (!dirPath || !existsSync(dirPath)) return null;
      const out = execFileSync(
        'git',
        ['-C', dirPath, 'status', '--porcelain', '--branch'],
        { encoding: 'utf-8', timeout: 1500, windowsHide: true }
      );
      const lines = out.split(/\r?\n/).filter(Boolean);
      const header = lines[0] || '';
      const branchMatch = header.match(/^##\s+([^\s.]+)/);
      const aheadMatch = header.match(/ahead\s+(\d+)/i);
      const behindMatch = header.match(/behind\s+(\d+)/i);
      const dirtyCount = Math.max(0, lines.length - 1);
      return {
        name: basename(dirPath) || dirPath,
        path: dirPath,
        branch: branchMatch ? branchMatch[1] : 'HEAD',
        dirtyCount,
        ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
        behind: behindMatch ? Number(behindMatch[1]) : 0,
      };
    } catch {
      return null;
    }
  }

  function collectGitStatus({ cwd = '', workspaceUris = [] } = {}) {
    const candidates = [];
    const seen = new Set();
    const pushCandidate = (p) => {
      const norm = normalizeWorkspacePath(p);
      if (!norm) return;
      const key = process.platform === 'win32' ? norm.toLowerCase() : norm;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push(norm);
    };

    pushCandidate(cwd);
    if (Array.isArray(workspaceUris)) workspaceUris.forEach(pushCandidate);
    (memory.knownWorkspaces || []).forEach((w) => pushCandidate(w.path));
    discoverScratchRepos().forEach(pushCandidate);

    const repos = [];
    for (const dir of candidates) {
      if (repos.length >= 4) break;
      const info = inspectGitRepo(dir);
      if (info) {
        learnWorkspace(dir);
        repos.push(info);
      }
    }
    return repos;
  }

  function generateSessionBriefing({ activeConvId = '', cwd = '', workspaceUris = [], tokenUsage = null } = {}) {
    const usage = tokenUsage || scanAntigravityTokenUsage(activeConvId);
    const repos = collectGitStatus({ cwd, workspaceUris });
    const h = new Date().getHours();
    const greetPrefix =
      h >= 5 && h < 11
        ? 'Chào buổi sáng, Master.'
        : h >= 11 && h < 14
          ? 'Đã đến trưa rồi, Master.'
          : h >= 14 && h < 18
            ? 'Chào buổi chiều, Master.'
            : h >= 18 && h < 23
              ? 'Buổi tối tốt lành, Master.'
              : 'Đã quá nửa đêm rồi, Master.';

    const primary = repos[0] || null;
    const repoPart = primary
      ? primary.dirtyCount > 0
        ? `Repo ${primary.name} (${primary.branch}) có ${primary.dirtyCount} tệp chưa commit`
        : `Repo ${primary.name} (${primary.branch}) đang sạch sẽ`
      : 'Chưa phát hiện kho Git cục bộ đang mở';

    const noteCount = (memory.pinnedNotes || []).length;
    const notePart = noteCount > 0 ? ` và ${noteCount} ghi chú H.D.D` : '';
    const extraJoke = usage.budgetPct >= 75
      ? ' Cảnh báo: hóa đơn tiền điện hôm nay có dấu hiệu tăng vọt đấy.'
      : '';

    const speechText =
      `${greetPrefix} Khẳng định: ${repoPart}. ` +
      `Điện năng hôm nay: ${formatCompactTokens(usage.todayUncached)} token (${usage.budgetPct}% định mức)${notePart}.${extraJoke}`;

    const repoLines = repos.length
      ? repos.map((r) => `• ${r.name} [${r.branch}]: ${r.dirtyCount === 0 ? 'sạch' : `${r.dirtyCount} thay đổi`}${r.ahead ? ` · ↑${r.ahead}` : ''}`).join('\n')
      : '• Chưa gắn kho Git (sẽ tự học từ workspace của ngài).';

    const cardText =
      `BÁO CÁO H.D.D // ĐẦU PHIÊN\n` +
      `${repoLines}\n` +
      `• Điện năng hôm nay: ${formatCompactTokens(usage.todayUncached)} / ${formatCompactTokens(usage.budgetTokens)} (${usage.budgetPct}% · Cache ${formatCompactTokens(usage.todayCacheRead)})\n` +
      `• Ghi chú ghim: ${noteCount} mục · Phiên tích lũy: ${memory.stats.totalSessions || 1}`;

    memory.stats.briefingsDelivered = (Number(memory.stats.briefingsDelivered) || 0) + 1;
    saveMemory();

    return {
      repos,
      cardText,
      speechText,
      generatedAt: Date.now(),
    };
  }

  function getButlerSnapshot({ activeConvId = '', activeApp = null, pomodoro = null } = {}) {
    const tokenUsage = scanAntigravityTokenUsage(activeConvId);
    return {
      memoryFile,
      tokenUsage,
      preferences: { ...memory.preferences },
      stats: { ...memory.stats },
      pinnedNotes: [...(memory.pinnedNotes || [])],
      knownWorkspaces: [...(memory.knownWorkspaces || [])],
      activeApp: activeApp || null,
      pomodoro: pomodoro || { active: false, remainingSec: 0, durationMin: 25 },
    };
  }

  return {
    memoryFile,
    loadMemory: () => memory,
    saveMemory,
    recordSessionStart,
    learnWorkspace,
    recordObservedApp,
    addPinnedNote,
    removePinnedNote,
    clearPinnedNotes,
    updatePrefs,
    recordPomodoroCompleted: () => {
      memory.stats.pomodorosCompleted = (Number(memory.stats.pomodorosCompleted) || 0) + 1;
      saveMemory();
    },
    recordClipboardRead: () => {
      memory.stats.clipboardReads = (Number(memory.stats.clipboardReads) || 0) + 1;
      saveMemory();
    },
    scanAntigravityTokenUsage,
    evaluateProactiveAlert,
    collectGitStatus,
    generateSessionBriefing,
    getButlerSnapshot,
  };
}

module.exports = {
  VALID_BUDGETS,
  FAIRY_QUIPS,
  pickQuip,
  getLocalDateKey,
  formatCompactTokens,
  formatModelLabel,
  normalizeWorkspacePath,
  classifyForegroundApp,
  parseButlerCommand,
  createButlerCore,
};
