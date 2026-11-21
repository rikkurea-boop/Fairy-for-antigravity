#!/usr/bin/env node
/**
 * Antigravity lifecycle hook telemetry writer for Fairy III H.D.D HUD.
 * Runs synchronously in the agent loop: MUST be fast, never log to stdout,
 * never fail (fail-open), and always conform to the hooks stdout JSON contract.
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const MAX_CONVERSATIONS = 12;
const MAX_RECENT_TOOLS = 15;
const STDIN_SAFETY_MS = 800;

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

function compactPreview(raw, maxLen = 100) {
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
  if (!payload || typeof payload !== 'object') return;
  const eventName = String(payload.hookEventName || '');
  if (!eventName) return;

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
    next.lastPromptPreview = compactPreview(payload.lastUserInput, 100);
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
}

async function main() {
  let eventName = '';
  try {
    const raw = await readStdinSafe();
    if (raw && raw.trim()) {
      const payload = JSON.parse(raw);
      eventName = String(payload?.hookEventName || '');
      updateState(payload);
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
