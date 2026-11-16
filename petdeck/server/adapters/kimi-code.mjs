// Kimi Code CLI adapter — observe: ~/.kimi/sessions/<projHash>/<uuid>/context.jsonl (read-only).
// inject: kimi.exe exists but headless syntax is UNVERIFIED => tier observe-only (clipboard).
// 存储事实见 docs/agent-会话存储勘察.md：role ∈ _system_prompt/_checkpoint/_usage/user/assistant；
// 无显式回合终止信号，按最后一条非下划线 role 推断：user => running，assistant => done。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { latestFiles, safeJson } from './shared.mjs';

export const id = 'kimi-code';
export const name = 'Kimi Code';
export const tier = 'observe-only';

/** Pure: parse context.jsonl lines -> {status,lastMessage,tokens}. */
export function parseKimi(lines, _now = Date.now()) {
  let status = 'unknown', lastMessage = '', tokens = 0, lastRole = '';
  for (const ln of lines) {
    const j = safeJson(ln);
    if (!j) continue;
    const role = j.role;
    if (role === '_usage') { if (typeof j.token_count === 'number') tokens = j.token_count; continue; }
    if (role === '_system_prompt' || role === '_checkpoint') continue;
    if (role === 'user' || role === 'assistant') {
      lastRole = role;
      const text = extractText(j.content);
      if (text) lastMessage = text;
    }
  }
  if (lastRole === 'user') status = 'running';
  else if (lastRole === 'assistant') status = 'done';
  return { status, lastMessage, tokens };
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const t = content.find((x) => x.type === 'text');
    return t?.text ?? '';
  }
  return '';
}

/** Observe newest context.jsonl files (cap 5). Injectable home for tests. */
export async function observe({ home = process.env.PETDECK_OBSERVE_HOME || os.homedir(), now = Date.now() } = {}) {
  const dir = path.join(home, '.kimi', 'sessions');
  const files = latestFiles(dir, (n) => n === 'context.jsonl', 5);
  const out = [];
  for (const f of files) {
    const r = parseKimi(fs.readFileSync(f, 'utf8').split('\n'), now);
    if (r.status === 'unknown' && !r.lastMessage) continue;
    out.push({ agent: id, source: 'kimi-jsonl', session: path.basename(path.dirname(f)), status: r.status, lastMessage: r.lastMessage.slice(0, 200), turn: '', tokens: { total: r.tokens } });
  }
  return out;
}

export function inject() {
  // Headless inject syntax unverified on real CLI => never pretend; always clipboard.
  return { ok: false, response: '' };
}

export default { id, name, tier, observe, inject };
