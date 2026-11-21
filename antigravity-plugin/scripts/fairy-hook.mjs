#!/usr/bin/env node
/**
 * Antigravity lifecycle hook telemetry writer for Fairy III H.D.D HUD.
 * Runs synchronously in the agent loop: MUST be fast, never log to stdout,
 * never fail (fail-open), and always conform to the hooks stdout JSON contract.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_CONVERSATIONS = 12;
const MAX_RECENT_TOOLS = 15;
const MAX_RECENT_TALKER = 10;
const STDIN_SAFETY_MS = 800;
const HOOK_PUSH_TIMEOUT_MS = 100;

function readStdinSafe() {
  return new Promise((resolve) => {
    let settled = false;
    const chunks = [];
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        process.stdin.pause();
      } catch {
        // Ignore stream pause issues.
      }
      resolve(Buffer.concat(chunks).toString('utf-8'));
    };

    const timer = setTimeout(finish, STDIN_SAFETY_MS);
    try {
      process.stdin.on('data', (chunk) => chunks.push(chunk));
      process.stdin.on('end', finish);
      process.stdin.on('error', finish);
      process.stdin.resume();
    } catch {
      finish();
    }
  });
}

function resolveStateFile() {
  const baseDir = process.env.PLUGIN_DATA && process.env.PLUGIN_DATA.trim()
    ? process.env.PLUGIN_DATA.trim()
    : join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'fairy-zzz');
  return join(baseDir, 'state.json');
}

function resolveDesktopEndpointFile() {
  return join(dirname(resolveStateFile()), 'desktop-endpoint.json');
}

function stripSystemWrappers(raw) {
  return String(raw || '')
    .replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, ' ')
    .replace(/<voice_instructions>[\s\S]*?<\/voice_instructions>/gi, ' ')
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, ' ');
}

function cleanUserInputPreview(raw) {
  const stripped = stripSystemWrappers(raw);
  const userMatches = Array.from(stripped.matchAll(/^\[[^\]]+\]\s*user:\s*"([^"]+)"/gm))
    .map((m) => String(m[1] || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (userMatches.length > 0) {
    return compactPreview(userMatches[userMatches.length - 1], 160);
  }
  const plain = stripped
    .replace(/<talker_agent_context>[\s\S]*?<\/talker_agent_context>/gi, ' ')
    .replace(/<\/?USER_REQUEST>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return compactPreview(plain || raw, 160);
}

function extractUserContextEntries(raw) {
  const stripped = stripSystemWrappers(raw);
  const blocks = Array.from(stripped.matchAll(/<talker_agent_context>([\s\S]*?)<\/talker_agent_context>/gi));
  const users = [];
  for (const block of blocks) {
    const body = block[1] || '';
    for (const hit of body.matchAll(/^\[[^\]]+\]\s*user:\s*"([^"]+)"/gm)) {
      const text = String(hit[1] || '').replace(/\s+/g, ' ').trim();
      if (text) users.push(text.slice(0, 340));
    }
  }
  const tailPlain = cleanUserInputPreview(raw);
  if (tailPlain) users.push(tailPlain.slice(0, 340));
  return users;
}

function extractTalkerContextEntries(raw) {
  const stripped = stripSystemWrappers(raw);
  const blocks = Array.from(stripped.matchAll(/<talker_agent_context>([\s\S]*?)<\/talker_agent_context>/gi));
  const items = [];
  for (const block of blocks) {
    const body = block[1] || '';
    const lineRe = /^\[([^\]]+)\]\s*(talker|user):\s*"([^"]+)"/gm;
    for (const hit of body.matchAll(lineRe)) {
      const role = String(hit[2] || '').toLowerCase();
      const ts = String(hit[1] || '').trim();
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

function mergeTalkerEntries(entries) {
  const chrono = Array.isArray(entries) ? entries : [];
  if (!chrono.length) {
    return { liveTalkerTime: '', liveTalkerText: '', liveTalkerComplete: false };
  }
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
      const cleanDone = accText.replace(/-\s*$/, '').trim();
      mergedItems.push({ ts: accTs || item.ts || '', text: cleanDone, complete: true });
      accText = '';
      accTs = '';
    }
  }

  if (accText) {
    mergedItems.push({ ts: accTs, text: accText.replace(/-\s*$/, '').trim(), complete: false });
  }
  if (!mergedItems.length) {
    return { liveTalkerTime: '', liveTalkerText: '', liveTalkerComplete: false };
  }

  // Luôn lấy lượt talker mới nhất, tuyệt đối không lùi về lượt cũ khi câu mới bị cắt ngang.
  const chosen = mergedItems[mergedItems.length - 1];
  return {
    liveTalkerTime: chosen.ts,
    liveTalkerText: chosen.text.slice(0, 340),
    liveTalkerComplete: Boolean(chosen.complete),
  };
}

function extractAssistantText(payload) {
  const rawCandidates = [
    payload?.response,
    payload?.assistantResponse,
    payload?.modelOutput,
    payload?.content,
    payload?.output,
    payload?.message,
    payload?.text,
  ];
  for (const c of rawCandidates) {
    if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 1400);
    if (c && typeof c === 'object') {
      const nested = c.text || c.content;
      if (typeof nested === 'string' && nested.trim()) return nested.trim().slice(0, 1400);
    }
  }
  return '';
}

function compactPreview(raw, maxLen = 160) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

function readExistingState(filePath) {
  try {
    const text = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.conversations && typeof parsed.conversations === 'object') {
      return parsed;
    }
  } catch {
    // Missing or corrupt state file; start fresh.
  }
  return { version: 1, updatedAt: 0, latestConversationId: '', conversations: {} };
}

function pruneConversations(conversations) {
  const entries = Object.entries(conversations || {});
  if (entries.length <= MAX_CONVERSATIONS) return conversations;
  entries.sort((a, b) => (Number(b[1]?.updatedAt) || 0) - (Number(a[1]?.updatedAt) || 0));
  const kept = {};
  for (const [id, val] of entries.slice(0, MAX_CONVERSATIONS)) {
    kept[id] = val;
  }
  return kept;
}

function writeAtomic(filePath, content) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, content, 'utf-8');
    renameSync(tmpPath, filePath);
  } catch {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors.
    }
    writeFileSync(filePath, content, 'utf-8');
  }
}

function updateState(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const eventName = String(payload.hookEventName || '');
  if (!eventName) return null;

  const now = Date.now();
  const convId = String(payload.conversationId || 'default');
  const stateFile = resolveStateFile();
  const state = readExistingState(stateFile);

  const prev = state.conversations[convId] || {
    conversationId: convId,
    mood: 'idle',
    lastEvent: '',
    modelName: '',
    cwd: '',
    transcriptPath: '',
    invocationCount: 0,
    toolCount: 0,
    lastTool: '',
    lastToolError: '',
    lastPromptPreview: '',
    lastAssistantText: '',
    lastAssistantUpdatedAt: 0,
    liveTalkerText: '',
    liveTalkerTime: '',
    liveTalkerComplete: false,
    liveTalkerUpdatedAt: 0,
    recentTalkerEntries: [],
    recentUserTexts: [],
    terminationReason: '',
    fullyIdle: true,
    sessionStartedAt: now,
    doneAt: 0,
    updatedAt: now,
    recentTools: [],
  };

  const next = {
    ...prev,
    conversationId: convId,
    lastEvent: eventName,
    modelName: typeof payload.modelName === 'string' && payload.modelName ? payload.modelName : prev.modelName,
    cwd: typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : prev.cwd,
    transcriptPath: typeof payload.transcriptPath === 'string' && payload.transcriptPath ? payload.transcriptPath : prev.transcriptPath,
    updatedAt: now,
  };

  if (typeof payload.lastUserInput === 'string' && payload.lastUserInput.trim()) {
    next.lastPromptPreview = cleanUserInputPreview(payload.lastUserInput).slice(0, 240);
    const incomingUsers = extractUserContextEntries(payload.lastUserInput);
    if (incomingUsers.length > 0) {
      const mergedUsers = Array.isArray(prev.recentUserTexts) ? [...prev.recentUserTexts] : [];
      for (const u of incomingUsers) {
        if (u && !mergedUsers.includes(u)) mergedUsers.push(u);
      }
      next.recentUserTexts = mergedUsers.slice(-10);
    }
    const incomingTalker = extractTalkerContextEntries(payload.lastUserInput);
    if (incomingTalker.length > 0) {
      const mergedList = Array.isArray(prev.recentTalkerEntries) ? [...prev.recentTalkerEntries] : [];
      const seen = new Map();
      mergedList.forEach((it, idx) => {
        if (it && it.text) seen.set(`${it.ts || ''}|${it.text}`, idx);
      });
      for (const item of incomingTalker) {
        const k = `${item.ts || ''}|${item.text}`;
        if (seen.has(k)) {
          const idx = seen.get(k);
          if (item.endedByUser) mergedList[idx] = { ...mergedList[idx], endedByUser: true };
        } else {
          seen.set(k, mergedList.length);
          mergedList.push(item);
        }
      }
      next.recentTalkerEntries = mergedList.slice(-MAX_RECENT_TALKER);
      const talkerSummary = mergeTalkerEntries(next.recentTalkerEntries);
      if (talkerSummary.liveTalkerText) {
        const isNewStamp = talkerSummary.liveTalkerTime && talkerSummary.liveTalkerTime !== prev.liveTalkerTime;
        const isSameStampLonger =
          talkerSummary.liveTalkerTime === prev.liveTalkerTime &&
          talkerSummary.liveTalkerText.length > String(prev.liveTalkerText || '').length;
        next.liveTalkerText = talkerSummary.liveTalkerText;
        next.liveTalkerTime = talkerSummary.liveTalkerTime;
        next.liveTalkerComplete = Boolean(talkerSummary.liveTalkerComplete);
        if (isNewStamp || isSameStampLonger || !prev.liveTalkerUpdatedAt) {
          next.liveTalkerUpdatedAt = now;
        }
      }
    }
  }

  const assistantText = extractAssistantText(payload);
  if (assistantText) {
    next.lastAssistantText = assistantText;
    next.lastAssistantUpdatedAt = now;
  }

  switch (eventName) {
    case 'SessionStart':
      next.mood = 'boot';
      next.sessionStartedAt = prev.sessionStartedAt || now;
      next.fullyIdle = true;
      break;
    case 'PreInvocation':
      next.mood = 'thinking';
      next.invocationCount = (Number(prev.invocationCount) || 0) + 1;
      next.fullyIdle = false;
      break;
    case 'PostToolUse': {
      const toolName = String(payload.toolCall?.name || 'tool');
      const errStr = payload.error ? String(payload.error).replace(/\s+/g, ' ').slice(0, 160) : '';
      next.mood = 'working';
      next.toolCount = (Number(prev.toolCount) || 0) + 1;
      next.lastTool = toolName;
      next.lastToolError = errStr;
      next.fullyIdle = false;
      const list = Array.isArray(prev.recentTools) ? prev.recentTools.slice(-(MAX_RECENT_TOOLS - 1)) : [];
      list.push({ ts: now, tool: toolName, ok: !errStr, error: errStr });
      next.recentTools = list;
      break;
    }
    case 'PostInvocation':
      next.mood = prev.lastEvent === 'PostToolUse' || prev.mood === 'working' ? 'working' : (prev.mood || 'thinking');
      break;
    case 'Stop':
      next.mood = 'done';
      next.doneAt = now;
      next.terminationReason = String(payload.terminationReason || 'NO_TOOL_CALL');
      next.fullyIdle = payload.fullyIdle === undefined ? true : Boolean(payload.fullyIdle);
      break;
    default:
      break;
  }

  state.version = 1;
  state.updatedAt = now;
  state.latestConversationId = convId;
  state.conversations[convId] = next;
  state.conversations = pruneConversations(state.conversations);

  writeAtomic(stateFile, JSON.stringify(state));
  return { conversationId: convId, entry: next, ts: now };
}

function notifyDesktopApp(pushPayload) {
  if (!pushPayload) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const endpointRaw = readFileSync(resolveDesktopEndpointFile(), 'utf-8');
      const endpoint = JSON.parse(endpointRaw);
      const port = Number(endpoint?.port) || 0;
      if (!port) {
        resolve();
        return;
      }
      const body = JSON.stringify(pushPayload);
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/hook-push',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: HOOK_PUSH_TIMEOUT_MS,
        },
        (res) => {
          res.resume();
          resolve();
        }
      );
      req.on('timeout', () => {
        try { req.destroy(); } catch {}
        resolve();
      });
      req.on('error', () => resolve());
      req.end(body);
    } catch {
      resolve();
    }
  });
}

async function main() {
  let eventName = '';
  try {
    const raw = await readStdinSafe();
    if (raw && raw.trim()) {
      const payload = JSON.parse(raw);
      eventName = String(payload?.hookEventName || '');
      const pushed = updateState(payload);
      if (pushed) {
        await notifyDesktopApp(pushed);
      }
    }
  } catch {
    // Fail-open: never disrupt Antigravity execution on hook errors.
  }

  if (eventName === 'Stop') {
    process.stdout.write('{"decision":"stop"}\n');
  } else {
    process.stdout.write('{}\n');
  }
}

main().catch(() => {
  process.stdout.write('{}\n');
});
