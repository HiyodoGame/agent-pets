// opencode adapter — observe: local serve HTTP; throws when unreachable (freshness contract).
// inject: opencode run --format json (validated in spike; stable).
import { spawnSync } from 'node:child_process';
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

export async function observe() {
  // 契约：fetch 失败/非 ok 抛错 = 源不可达（bridge 保留 stale）；ok 且空列表 = 合法为空。
  const r = await fetch('http://127.0.0.1:4096/session', { signal: AbortSignal.timeout(1500) });
  if (!r.ok) throw new Error(`opencode serve responded ${r.status}`);
  const list = await r.json();
  return (Array.isArray(list) ? list : []).slice(0, 5).map((s) => ({
    agent: id, source: 'serve-http', session: s.id ?? '', status: 'running', lastMessage: (s.title ?? '').slice(0, 200),
  }));
}

export function inject(payload) {
  const prompt = `Relay handoff from ${payload.from ?? 'petdeck'}: ${payload.context ?? ''}\nInstruction: ${payload.instruction ?? ''}\nDo not use any tools.`;
  try {
    const r = spawnSync('opencode', ['run', '--format', 'json'], { input: prompt, encoding: 'utf8', timeout: 120000, shell: true });
    const p = parseRun(r.stdout || '');
    if (r.status === 0 && p.response) return { ok: true, response: p.response.slice(0, 400), sessionID: p.sessionID };
    return { ok: false, response: '' };
  } catch {
    return { ok: false, response: '' };
  }
}

export default { id, name, tier, observe, inject };