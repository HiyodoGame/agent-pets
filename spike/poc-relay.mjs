// Spike PoC — relay closed loop (observe -> package -> inject), READ-ONLY observe + minimal inject
// 实证跨 Agent 接力：codex(observe via rollout jsonl) -> opencode(inject via run)
// 用法：node spike/poc-relay.mjs
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const home = os.homedir();
const cwd = path.join(process.cwd(), 'spike', 'tmp-relay');
fs.mkdirSync(cwd, { recursive: true });

// 1) observe: codex rollouts (newest first) -> first non-empty last_agent_message
function rolloutsNewestFirst() {
  const found = [];
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) found.push({ p, mtime: fs.statSync(p).mtimeMs });
    }
  };
  walk(path.join(home, '.codex', 'sessions'));
  return found.sort((a, b) => b.mtime - a.mtime).map((x) => x.p);
}
let file = null;
let context = '';
for (const f of rolloutsNewestFirst()) {
  let msg = '';
  for (const ln of fs.readFileSync(f, 'utf8').trim().split('\n').slice(-400)) {
    try {
      const j = JSON.parse(ln);
      if (j.payload?.type === 'task_complete' && j.payload.last_agent_message) msg = j.payload.last_agent_message;
    } catch {}
  }
  if (msg) { file = f; context = msg; break; }
}
context = context.slice(0, 200) || '(no prior context)';

// 2) package + 3) inject into opencode (cross-agent), prompt via stdin to avoid quoting
const prompt = `Relay handoff: agent A (codex) reported: '${context}'. In one short sentence, state what agent A completed. Do not use any tools.`;
const r = spawnSync('opencode', ['run', '--format', 'json'], { input: prompt, cwd, shell: true, encoding: 'utf8', timeout: 120000 });
let response = '', sessionID = '';
for (const ln of (r.stdout || '').split('\n')) {
  try {
    const j = JSON.parse(ln);
    if (j.type === 'text' && j.part?.text) { response = j.part.text; sessionID = j.sessionID; }
  } catch {}
}
console.log(JSON.stringify({ from: 'codex', to: 'opencode', observe_source: file ? path.basename(file) : null, context, injected_session: sessionID, response, exit: r.status }, null, 2));