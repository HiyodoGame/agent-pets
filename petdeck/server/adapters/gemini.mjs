// Gemini CLI adapter — observe: ~/.gemini/tmp/<projectShortId>/chats/session-*.jsonl
// (read-only, plus legacy single-object .json sessions).
// Format verified against google-gemini/gemini-cli source (chatRecordingTypes.ts /
// chatRecordingService.ts / storage.ts, 2026-11-16):
//   - metadata line: {sessionId, projectHash, startTime, lastUpdated, kind?, summary?}
//   - message line:  {id, timestamp, content, type: user|gemini|info|error|warning, tokens?}
//   - patch/rewind records: {$set|$patch|$rewindTo}
// There is no explicit turn-end record => infer from the last conversational message
// (user => running, gemini => done, error => stuck), ignoring info/warning.
// inject: no verified headless syntax => tier observe-only (clipboard).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { latestFiles, safeJson } from './shared.mjs';

export const id = 'gemini';
export const name = 'Gemini CLI';
export const tier = 'observe-only';

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && typeof p === 'object' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
  }
  return '';
}

/** Legacy sessions are one JSON object with a `messages` array; JSONL is one record
 *  per line. Accept both. */
function readRecords(text) {
  try {
    const whole = JSON.parse(text);
    if (whole && typeof whole === 'object' && Array.isArray(whole.messages)) return [whole, ...whole.messages];
  } catch { /* not a single JSON document */ }
  return text.split('\n').map(safeJson).filter(Boolean);
}

/** Pure: parse a Gemini CLI session file. Returns status/title/lastMessage/tokens. */
export function parseGeminiSession(text) {
  const meta = {};
  const messages = [];
  for (const j of readRecords(text)) {
    if (j.$set && typeof j.$set === 'object') { Object.assign(meta, j.$set); continue; }
    if (j.$patch || j.$rewindTo) continue;
    if (j.id && !j.$patch) messages.push(j);
    else if (j.sessionId) Object.assign(meta, j); // initial metadata line
  }

  let status = 'unknown';
  let lastMessage = '';
  let firstUser = '';
  let tokens = null;
  for (const m of messages) {
    const text = extractText(m.content);
    if (m.type === 'user') {
      status = 'running';
      if (text && !firstUser) firstUser = text;
    } else if (m.type === 'gemini') {
      status = 'done';
      if (text) lastMessage = text;
      if (m.tokens) tokens = {
        input: m.tokens.input ?? 0,
        output: m.tokens.output ?? 0,
        cacheRead: m.tokens.cached ?? 0,
        total: m.tokens.total ?? 0,
      };
    } else if (m.type === 'error') {
      status = 'stuck';
    }
    // info / warning don't change the conversational state.
  }

  const title = (typeof meta.summary === 'string' && meta.summary.trim()) || firstUser;
  return { status, title, lastMessage, tokens, session: meta.sessionId ?? '', kind: meta.kind ?? '' };
}

/** Observe the newest main-agent sessions (cap 5). Missing root => [] (source absent). */
export async function observe({ home = process.env.PETDECK_OBSERVE_HOME || os.homedir() } = {}) {
  const root = path.join(home, '.gemini', 'tmp');
  const files = latestFiles(root, (n) => n.startsWith('session-') && (n.endsWith('.jsonl') || n.endsWith('.json')), 500);
  const out = [];
  for (const f of files) {
    if (path.basename(path.dirname(f)) !== 'chats') continue; // only <project>/chats/<file>
    let text, st;
    try { text = fs.readFileSync(f, 'utf8'); st = fs.statSync(f); } catch { continue; }
    const r = parseGeminiSession(text);
    if (r.kind === 'subagent') continue;
    if (r.status === 'unknown' && !r.lastMessage && !r.title) continue;
    const project = path.basename(path.dirname(path.dirname(f)));
    const row = {
      agent: id, source: 'gemini-session-jsonl',
      session: r.session || path.basename(f).replace(/\.jsonl?$/, ''),
      title: r.title.slice(0, 200), projectId: project, projectName: project,
      status: r.status, lastMessage: r.lastMessage.slice(0, 200), turn: '',
      path: f, updatedAt: st.mtimeMs,
    };
    if (r.tokens) row.tokens = r.tokens;
    out.push(row);
    if (out.length >= 5) break;
  }
  return out;
}

export function inject() {
  // No verified headless inject syntax for Gemini CLI => never pretend; always clipboard.
  return { ok: false, response: '' };
}

export default { id, name, tier, observe, inject };
