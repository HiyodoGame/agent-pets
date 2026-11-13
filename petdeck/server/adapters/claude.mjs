// Claude adapter — observe: ~/.claude/projects/<slug>/*.jsonl (read-only).
// inject: claude -p --output-format stream-json (headless).
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tailLines, latestFiles, safeJson } from './shared.mjs';

export const id = 'claude';
export const name = 'Claude';
export const tier = 'full';

/** Pure: parse claude project jsonl lines -> {status,lastMessage,cwd}. */
export function parseClaude(lines) {
  let status = 'unknown', lastMessage = '', cwd = '';
  for (const ln of lines) {
    const j = safeJson(ln);
    if (!j) continue;
    cwd = j.cwd ?? cwd;
    if (j.type === 'assistant') {
      status = 'running';
      const c = j.message?.content;
      if (Array.isArray(c)) { const txt = c.find((x) => x.type === 'text'); if (txt) lastMessage = txt.text; }
    } else if (j.type === 'user') status = 'waiting';
    if (j.message?.content && typeof j.message.content === 'string') lastMessage = j.message.content;
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

export function inject(payload) {
  const prompt = `Relay handoff from ${payload.from ?? 'petdeck'}: ${payload.context ?? ''}\nInstruction: ${payload.instruction ?? ''}\nDo not use any tools.`;
  try {
    const r = spawnSync('claude', ['-p', '--output-format', 'stream-json', prompt], { encoding: 'utf8', timeout: 60000, shell: true });
    if (r.status === 0 && r.stdout) return { ok: true, response: r.stdout.trim().slice(0, 400), sessionID: '' };
    return { ok: false, response: '' };
  } catch {
    return { ok: false, response: '' };
  }
}

export default { id, name, tier, observe, inject };