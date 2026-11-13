// Spike PoC — observe-side adapter (READ-ONLY)
// 实证：从真实本机会话存储提取统一 {agent, session, status, lastMessage, cwd}
// 覆盖 codex(rollout jsonl) + claude(projects jsonl)。opencode 走 serve API（另证）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const home = os.homedir();
const out = [];

function latest(dir, pred) {
  let best = null;
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (pred(e.name)) {
        const st = fs.statSync(p);
        if (!best || st.mtimeMs > best.mtime) best = { p, mtime: st.mtimeMs };
      }
    }
  };
  walk(dir);
  return best?.p ?? null;
}

// ── Codex: rollout-*.jsonl event_msg ──
const codexFile = latest(path.join(home, '.codex', 'sessions'), (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'));
if (codexFile) {
  const lines = fs.readFileSync(codexFile, 'utf8').trim().split('\n');
  let status = 'unknown', lastMessage = '', turn = '';
  for (const ln of lines.slice(-400)) {
    try {
      const j = JSON.parse(ln);
      const t = j.payload?.type;
      if (t === 'task_complete') { status = 'done'; lastMessage = j.payload.last_agent_message ?? lastMessage; }
      else if (t === 'task_started') status = 'running';
      else if (t === 'turn_aborted') status = 'stuck';
      else if (t === 'agent_message') lastMessage = j.payload.message ?? lastMessage;
      if (j.payload?.turn_id) turn = j.payload.turn_id;
    } catch {}
  }
  out.push({ agent: 'codex', source: 'rollout-jsonl', session: path.basename(codexFile), status, lastMessage: lastMessage.slice(0, 120), turn });
}

// ── Claude: projects/<slug>/<session>.jsonl ──
const claudeFile = latest(path.join(home, '.claude', 'projects'), (n) => n.endsWith('.jsonl'));
if (claudeFile) {
  const lines = fs.readFileSync(claudeFile, 'utf8').trim().split('\n');
  let status = 'unknown', lastMessage = '', cwd = '';
  for (const ln of lines.slice(-200)) {
    try {
      const j = JSON.parse(ln);
      cwd = j.cwd ?? cwd;
      if (j.type === 'assistant') { status = 'running'; const c = j.message?.content; if (Array.isArray(c)) { const txt = c.find((x) => x.type === 'text'); if (txt) lastMessage = txt.text; } }
      else if (j.type === 'user') status = 'waiting';
      if (j.message?.content && typeof j.message.content === 'string') lastMessage = j.message.content;
    } catch {}
  }
  out.push({ agent: 'claude', source: 'projects-jsonl', session: path.basename(claudeFile), status, lastMessage: lastMessage.slice(0, 120), cwd });
}

console.log(JSON.stringify(out, null, 2));