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
const RUNNING_FRESH_MS = 120000;

/** Live execution signal from the v2 SSE stream (session.execution.*). The bridge
 *  starts the watcher; observe() only reads this set. */
const runningSessions = new Set();
let watcher = null;
let watcherLive = false;

/** Pure-ish: apply one v2 execution event. started => running; terminal => not running. */
export function applyExecutionEvent(evt) {
  const sid = evt?.data?.sessionID;
  if (!sid) return;
  if (evt.type === 'session.execution.started') runningSessions.add(sid);
  else if (
    evt.type === 'session.execution.succeeded' ||
    evt.type === 'session.execution.failed' ||
    evt.type === 'session.execution.interrupted'
  ) runningSessions.delete(sid);
}

/** Stop only the long-lived watcher; observed execution state is retained for tests
 *  that intentionally inspect it after disconnect. */
export function stopEventWatcher() {
  watcherLive = false;
  if (watcher) watcher.stop();
}

/** Test/lifecycle helper: clear runtime state and stop the watcher. */
export function resetOpenCodeRuntime() {
  runningSessions.clear();
  stopEventWatcher();
}

/** Pure: map a serve/API session row to a normalized status.
 *  Priority: explicit status/outcome > live SSE execution set > fresh-update fallback
 *  > unknown (never fabricate running/done). */
export function mapServeStatus(s = {}, now = Date.now()) {
  const signal = s.status ?? s.outcome;
  if (typeof signal === 'string' && SERVE_STATUS[signal]) return SERVE_STATUS[signal];
  if (s.id && runningSessions.has(s.id)) return 'running';
  if (s.time?.completed || s.completed) return 'done';
  // Fallback only when the SSE watcher is unavailable: a null-outcome row updated
  // recently is *probably* running. With a live watcher, absence from the execution
  // set means not running (no freshness guessing).
  if (!watcherLive && s.outcome == null && typeof s.time?.updated === 'number' && now - s.time.updated < RUNNING_FRESH_MS) return 'running';
  return 'unknown';
}

/** Pure: v2 returns `{data:[...]}`; older versions return a bare array. */
export function parseServePayload(payload) {
  const rows = Array.isArray(payload) ? payload : payload?.data;
  if (!Array.isArray(rows)) throw new Error('opencode serve: non-array session payload');
  return rows;
}

/** v2 rows nest the working directory under location.directory (real payload:
 *  {"location":{"directory":"F:\\…\\Workflow"}}); older serve rows put it flat.
 *  Reading only s.directory left every opencode session with an empty cwd. */
export function directoryOf(s = {}) {
  const d = s.location?.directory ?? s.directory ?? s.path ?? '';
  return typeof d === 'string' ? d : '';
}

const toRow = (source, now) => (s) => ({
  agent: id, source, session: s.id ?? '', status: mapServeStatus(s, now),
  title: (s.title ?? '').slice(0, 200), lastMessage: '', cwd: directoryOf(s) || undefined,
});

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** Discover the CLI-managed v2 service (dynamic port + password). */
async function discoverService(run) {
  const url = await run('opencode', ['service', 'status'], { timeout: 5000 });
  if (url.status !== 0) return null;
  const base = (String(url.stdout).match(/https?:\/\/\S+/) || [])[0];
  const pw = await run('opencode', ['service', 'get', 'password'], { timeout: 5000 });
  if (!base || pw.status !== 0) return null;
  const password = String(pw.stdout).trim();
  return password ? { base, password } : null;
}

async function consumeSse(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      try { onEvent(JSON.parse(raw)); } catch { /* skip malformed event */ }
    }
  }
}

/** Start a reconnecting SSE watcher for v2 execution events. Returns a stop function.
 *  The bridge calls this; tests and verify-local don't, so short-lived scripts still exit. */
export function startEventWatcher({ run = runCli, fetchImpl = fetch, retryMs = 5000 } = {}) {
  if (watcher) return watcher.stop;
  const state = {
    stopped: false,
    controller: new AbortController(),
  };
  state.stop = () => {
    state.stopped = true;
    state.controller.abort();
    if (watcher === state) watcher = null;
  };
  watcher = state;
  (async () => {
    while (!state.stopped) {
      try {
        const svc = await discoverService(run);
        if (!svc) throw new Error('service discovery failed');
        const auth = 'Basic ' + Buffer.from(`opencode:${svc.password}`).toString('base64');
        const res = await fetchImpl(`${svc.base}/api/event`, {
          headers: { Authorization: auth, Accept: 'text/event-stream' },
          signal: state.controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`event stream ${res.status}`);
        watcherLive = true;
        await consumeSse(res.body, applyExecutionEvent);
      } catch (e) {
        if (state.stopped || e?.name === 'AbortError') break;
      }
      watcherLive = false;
      runningSessions.clear(); // disconnect => don't keep stale "running" until reconnect
      await delay(retryMs, state.controller.signal);
    }
    watcherLive = false;
  })();
  return state.stop;
}

export async function observe({ run = runCli, now = Date.now() } = {}) {
  // v2: the background service uses a dynamic port and a CLI-managed password, so
  // let the CLI perform discovery + auth. ~165ms on a real machine (50 sessions).
  const r = await run('opencode', ['api', 'session.list'], { timeout: 5000 });
  if (r.status === 0) {
    let payload;
    try { payload = JSON.parse(r.stdout); } catch { throw new Error('opencode api: invalid JSON'); }
    return parseServePayload(payload).slice(0, 5).map(toRow('serve-api', now));
  }
  // v1 fallback: explicit serve on the historical default port, no auth.
  const res = await fetch('http://127.0.0.1:4096/session', { signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error(`opencode serve responded ${res.status}`);
  return parseServePayload(await res.json()).slice(0, 5).map(toRow('serve-http', now));
}

export async function inject(payload, { run = runCli } = {}) {
  const prompt = `${handoffPackage(payload)}\nDo not use any tools.`;
  // No shell: prompt goes through stdin, never argv/shell.
  const r = await run('opencode', ['run', '--format', 'json'], { input: prompt, timeout: 120000 });
  const p = parseRun(r.stdout || '');
  if (r.status === 0 && p.response) return { ok: true, response: p.response.slice(0, 400), sessionID: p.sessionID };
  return { ok: false, response: '', summary: r.summary ?? '' };
}

export default { id, name, tier, observe, inject, startEventWatcher, stopEventWatcher };