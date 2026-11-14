// Claude adapter — observe: ~/.claude/projects/<slug>/*.jsonl (read-only).
// inject: claude -p --output-format stream-json (headless).
import os from 'node:os';
import path from 'node:path';
import { runCli, guardDash } from './exec.mjs';
import { tailLines, latestFiles, safeJson } from './shared.mjs';
import { handoffPackage } from '../tiers.mjs';

export const id = 'claude';
export const name = 'Claude';
export const tier = 'full';

/** Pure: parse claude project jsonl lines -> {status,lastMessage,cwd}.
 *  Status is derived from an explicit terminal signal; absence never claims 'done'. */
export function parseClaude(lines) {
  let status = 'unknown', lastMessage = '', cwd = '';
  for (const ln of lines) {
    const j = safeJson(ln);
    if (!j) continue;
    cwd = j.cwd ?? cwd;
    if (j.type === 'assistant') {
      const stop = j.message?.stop_reason;
      status = (stop === 'end_turn' || stop === 'stop_sequence') ? 'done' : 'running';
      const c = j.message?.content;
      if (Array.isArray(c)) { const txt = c.find((x) => x.type === 'text'); if (txt) lastMessage = txt.text; }
    } else if (j.type === 'user') {
      // 只有 string content 才是真实用户输入；tool_result 等数组内容不改变状态。
      if (typeof j.message?.content === 'string') status = 'waiting';
    } else if (j.type === 'result') {
      status = j.is_error ? 'stuck' : 'done';
    }
  }
  return { status, lastMessage, cwd };
}

export function observe() {
  const home = process.env.PETDECK_OBSERVE_HOME || os.homedir();
  const dir = path.join(home, '.claude', 'projects');
  const files = latestFiles(dir, (n) => n.endsWith('.jsonl'), 5);
  const out = [];
  for (const f of files) {
    const r = parseClaude(tailLines(f, 200));
    if (r.status === 'unknown' && !r.lastMessage) continue;
    out.push({ agent: id, source: 'projects-jsonl', session: path.basename(f), status: r.status, lastMessage: r.lastMessage.slice(0, 200), cwd: r.cwd });
  }
  return out;
}

export async function inject(payload, { run = runCli } = {}) {
  const prompt = `${handoffPackage(payload)}\nDo not use any tools.`;
  // No shell: prompt rides as a literal argv element (leading-dash guarded).
  const r = await run('claude', ['-p', '--output-format', 'stream-json', guardDash(prompt)], { timeout: 60000 });
  if (r.status === 0 && r.stdout) return { ok: true, response: r.stdout.trim().slice(0, 400), sessionID: '' };
  return { ok: false, response: '', summary: r.summary ?? '' };
}

export default { id, name, tier, observe, inject };