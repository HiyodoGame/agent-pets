// Codex adapter — observe: ~/.codex/sessions rollout jsonl (read-only).
// inject: codex exec (experimental; transport unstable => bridge falls back to clipboard).
import os from 'node:os';
import path from 'node:path';
import { runCli, guardDash } from './exec.mjs';
import { tailLines, latestFiles, safeJson } from './shared.mjs';

export const id = 'codex';
export const name = 'Codex';
export const tier = 'full';

/** Pure: parse rollout jsonl lines -> {status,lastMessage,turn}. */
export function parseRollout(lines) {
  let status = 'unknown', lastMessage = '', turn = '';
  for (const ln of lines) {
    const j = safeJson(ln);
    if (!j) continue;
    const t = j.payload?.type;
    if (t === 'task_complete') { status = 'done'; lastMessage = j.payload.last_agent_message ?? lastMessage; }
    else if (t === 'task_started') status = 'running';
    else if (t === 'turn_aborted') status = 'stuck';
    else if (t === 'agent_message') lastMessage = j.payload.message ?? lastMessage;
    if (j.payload?.turn_id) turn = j.payload.turn_id;
  }
  return { status, lastMessage, turn };
}

export function observe() {
  const home = process.env.PETDECK_OBSERVE_HOME || os.homedir();
  const dir = path.join(home, '.codex', 'sessions');
  const files = latestFiles(dir, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), 5);
  const out = [];
  for (const f of files) {
    const r = parseRollout(tailLines(f, 400));
    if (r.status === 'unknown' && !r.lastMessage) continue;
    out.push({ agent: id, source: 'rollout-jsonl', session: path.basename(f), status: r.status, lastMessage: r.lastMessage.slice(0, 200), turn: r.turn });
  }
  return out;
}

export async function inject(payload, { run = runCli } = {}) {
  const prompt = `Relay handoff from ${payload.from ?? 'petdeck'}: ${payload.context ?? ''}\nInstruction: ${payload.instruction ?? ''}\nDo not use any tools.`;
  // No shell: prompt rides as a literal argv element (leading-dash guarded).
  const r = await run('codex', ['exec', '--skip-git-repo-check', guardDash(prompt)], { timeout: 60000 });
  if (r.status === 0 && r.stdout) return { ok: true, response: r.stdout.trim().slice(0, 400), sessionID: '' };
  return { ok: false, response: '' };
}

export default { id, name, tier, observe, inject };