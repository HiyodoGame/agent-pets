// opencode adapter — observe: v2 via `opencode api session.list` (CLI discovers the
// background service port + password); v1 fallback: local serve HTTP on 4096.
// Throws when unreachable (freshness contract).
// inject: opencode run --format json (validated in spike; stable).
import { runCli } from './exec.mjs';
import { safeJson } from './shared.mjs';
import { handoffPackage } from '../tiers.mjs';

export const id = 'opencode';
export const name = 'opencode';
export const tier = 'full';

/** Pure: parse `opencode run --format json` stdout -> {response,sessionID}. */
export function parseRun(stdout) {
  let response = '', sessionID = '';
  for (const ln of (stdout || '').split('\n')) {
    const j = safeJson(ln);
    if (j && j.type === 'text' && j.part?.text) { response = j.part.text; sessionID = j.sessionID ?? sessionID; }
  }
  return { response, sessionID };
}

const SERVE_STATUS = {
  // v1 serve session.status
  running: 'running', busy: 'running', idle: 'unknown', done: 'done', completed: 'done', waiting: 'waiting',
  // v2 list rows use idle_outcome instead of status
  succeeded: 'done', interrupted: 'stuck', failed: 'stuck',
};
/** Pure: map a serve/API session row to a normalized status; unknown field => 'unknown'
 *  (never fabricate running/done). v2 rows expose `outcome` (succeeded/interrupted/failed). */
export function mapServeStatus(s = {}) {
  const signal = s.status ?? s.outcome;
  if (typeof signal === 'string' && SERVE_STATUS[signal]) return SERVE_STATUS[signal];
  if (s.time?.completed || s.completed) return 'done';
  return 'unknown';
}

/** Pure: v2 returns `{data:[...]}`; older versions return a bare array. */
export function parseServePayload(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(rows)) throw new Error('opencode serve: non-array session payload');
  return rows;
}

const toRow = (source) => (s) => ({
  agent: id, source, session: s.id ?? '', status: mapServeStatus(s), lastMessage: (s.title ?? '').slice(0, 200),
});

export async function observe({ run = runCli } = {}) {
  // v2: the background service uses a dynamic port and a CLI-managed password, so
  // let the CLI perform discovery + auth. ~165ms on a real machine (50 sessions).
  const r = await run('opencode', ['api', 'session.list'], { timeout: 5000 });
  if (r.status === 0) {
    let payload;
    try { payload = JSON.parse(r.stdout); } catch { throw new Error('opencode api: invalid JSON'); }
    return parseServePayload(payload).slice(0, 5).map(toRow('serve-api'));
  }
  // v1 fallback: explicit serve on the historical default port, no auth.
  const res = await fetch('http://127.0.0.1:4096/session', { signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error(`opencode serve responded ${res.status}`);
  return parseServePayload(await res.json()).slice(0, 5).map(toRow('serve-http'));
}

export async function inject(payload, { run = runCli } = {}) {
  const prompt = `${handoffPackage(payload)}\nDo not use any tools.`;
  // No shell: prompt goes through stdin, never argv/shell.
  const r = await run('opencode', ['run', '--format', 'json'], { input: prompt, timeout: 120000 });
  const p = parseRun(r.stdout || '');
  if (r.status === 0 && p.response) return { ok: true, response: p.response.slice(0, 400), sessionID: p.sessionID };
  return { ok: false, response: '', summary: r.summary ?? '' };
}

export default { id, name, tier, observe, inject };