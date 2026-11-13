// opencode adapter — observe: local serve HTTP; throws when unreachable (freshness contract).
// inject: opencode run --format json (validated in spike; stable).
import { runCli } from './exec.mjs';
import { safeJson } from './shared.mjs';

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

const SERVE_STATUS = { running: 'running', busy: 'running', idle: 'unknown', done: 'done', completed: 'done', waiting: 'waiting' };
/** Pure: map an opencode serve session row to a normalized status; unknown field => 'unknown' (never fabricate running/done). */
export function mapServeStatus(s = {}) {
  if (typeof s.status === 'string' && SERVE_STATUS[s.status]) return SERVE_STATUS[s.status];
  if (s.time?.completed || s.completed) return 'done';
  return 'unknown';
}

export async function observe() {
  // 契约：fetch 失败/非 ok/协议错误 抛错 = 源不可达或故障（bridge 保留 stale）；ok 且空列表 = 合法为空。
  const r = await fetch('http://127.0.0.1:4096/session', { signal: AbortSignal.timeout(1500) });
  if (!r.ok) throw new Error(`opencode serve responded ${r.status}`);
  const list = await r.json();
  if (!Array.isArray(list)) throw new Error('opencode serve: non-array session payload');
  return list.slice(0, 5).map((s) => ({
    agent: id, source: 'serve-http', session: s.id ?? '', status: mapServeStatus(s), lastMessage: (s.title ?? '').slice(0, 200),
  }));
}

export async function inject(payload, { run = runCli } = {}) {
  const prompt = `Relay handoff from ${payload.from ?? 'petdeck'}: ${payload.context ?? ''}\nInstruction: ${payload.instruction ?? ''}\nDo not use any tools.`;
  // No shell: prompt goes through stdin, never argv/shell.
  const r = await run('opencode', ['run', '--format', 'json'], { input: prompt, timeout: 120000 });
  const p = parseRun(r.stdout || '');
  if (r.status === 0 && p.response) return { ok: true, response: p.response.slice(0, 400), sessionID: p.sessionID };
  return { ok: false, response: '' };
}

export default { id, name, tier, observe, inject };