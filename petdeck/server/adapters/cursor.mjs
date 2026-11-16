// Cursor adapter — observe: ~/.cursor/projects/<project>/agent-transcripts/<id>/<id>.jsonl
// (read-only). Each line is {role:'user'|'assistant', message:{content:[...]}} and the last
// line of a turn is {type:'turn_ended', status:'success'|'error'}. inject: Cursor 3.29.15
// exposes no wired headless subcommand (agent/desktop are not dispatched to the CLI entry
// and no standalone cursor-agent binary is installed) => tier observe-only (clipboard).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { latestFiles, safeJson } from './shared.mjs';

export const id = 'cursor';
export const name = 'Cursor';
export const tier = 'observe-only';

/** A transcript without a terminal line is only "running" while it is freshly written;
 *  older incomplete files stay unknown (a crashed session must not look active). */
const RUNNING_FRESH_MS = 120000;

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
  }
  return '';
}

/** Pure: parse a Cursor agent transcript JSONL.
 *  Rules (verified on real files): turn_ended.status=success => done; error/aborted/
 *  interrupted => stuck; a new user message starts a new turn (clears the previous
 *  terminal); no terminal + fresh mtime => running; otherwise unknown. */
export function parseCursorTranscript(lines, { mtimeMs = Date.now(), now = Date.now() } = {}) {
  let terminal = null;
  let lastRole = '';
  let firstUser = '';
  let lastAssistant = '';
  for (const ln of lines) {
    const j = safeJson(ln);
    if (!j) continue;
    if (j.type === 'turn_ended') { terminal = j.status ?? 'unknown'; continue; }
    if (j.role === 'user') {
      terminal = null; // a new turn is in progress
      lastRole = 'user';
      const text = extractText(j.message?.content ?? j.message);
      if (text && !firstUser) firstUser = text;
    } else if (j.role === 'assistant') {
      lastRole = 'assistant';
      const text = extractText(j.message?.content ?? j.message);
      if (text) lastAssistant = text;
    }
  }
  let status = 'unknown';
  if (terminal === 'success') status = 'done';
  else if (terminal === 'error' || terminal === 'aborted' || terminal === 'interrupted') status = 'stuck';
  else if (terminal == null && lastRole && now - mtimeMs < RUNNING_FRESH_MS) status = 'running';
  return { status, lastMessage: lastAssistant, firstUserMessage: firstUser };
}

/** Observe the newest top-level agent transcripts (cap 5). Subagent transcripts are
 *  implementation details and are skipped. Missing root => [] (source simply absent). */
export async function observe({ home = process.env.PETDECK_OBSERVE_HOME || os.homedir(), now = Date.now() } = {}) {
  const root = path.join(home, '.cursor', 'projects');
  const files = latestFiles(root, (n) => n.endsWith('.jsonl'), 500);
  const out = [];
  for (const f of files) {
    const parts = f.split(path.sep);
    const at = parts.lastIndexOf('agent-transcripts');
    // Keep only <project>/agent-transcripts/<id>/<id>.jsonl (excludes .../subagents/...).
    if (at === -1 || at !== parts.length - 3) continue;
    const session = parts[at + 1];
    if (session !== path.basename(f, '.jsonl')) continue;
    let lines, st;
    try {
      st = fs.statSync(f);
      lines = fs.readFileSync(f, 'utf8').split('\n');
    } catch { continue; }
    const r = parseCursorTranscript(lines, { mtimeMs: st.mtimeMs, now });
    if (r.status === 'unknown' && !r.lastMessage) continue;
    out.push({
      agent: id, source: 'cursor-transcript-jsonl', session,
      title: parts[at - 1] ?? '', status: r.status, lastMessage: r.lastMessage.slice(0, 200), turn: '',
    });
    if (out.length >= 5) break;
  }
  return out;
}

export function inject() {
  // No verified headless inject syntax for Cursor => never pretend; always clipboard.
  return { ok: false, response: '' };
}

export default { id, name, tier, observe, inject };
