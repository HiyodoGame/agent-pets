// Codex adapter — observe: ~/.codex/sessions rollout jsonl (read-only).
// inject: codex exec (experimental; transport unstable => bridge falls back to clipboard).
//
// 真实 rollout 结构（2026-11-20 本机实测，见 docs/agent-会话存储勘察.md）：
//   第 1 行 {"type":"session_meta","payload":{... "id","cwd"}} —— 只在首行出现，长会话的
//   尾部窗口里没有它，所以 cwd 必须从 head 读；用户提问在
//   {"type":"event_msg","payload":{"type":"item_completed","item":{"type":"UserMessage",
//   "content":[{"type":"text","text":"..."}]}}}；回复在 item_completed/AgentMessage 或
//   payload.type=task_complete 的 last_agent_message；response_item/message role=user 是
//   AGENTS.md 注入内容，不是用户提问（曾把它当标题来源，线上标题全空）。
import os from 'node:os';
import path from 'node:path';
import { runCli, guardDash } from './exec.mjs';
import { tailLines, headLines, latestFiles, safeJson } from './shared.mjs';
import { handoffPackage } from '../tiers.mjs';

export const id = 'codex';
export const name = 'Codex';
export const tier = 'full';

/** 注入型 user 内容的前缀：出现即不是用户真实提问（不应作为标题）。 */
const INJECTED_PREFIXES = ['# AGENTS.md', '<environment_context', '<user_instructions', '<turn_aborted', '<permissions', '<user_shell_command'];

/** 把 message.content（字符串或 content block 数组）压成纯文本。 */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((p) => p && typeof p === 'object' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

function looksInjected(text) {
  const t = String(text ?? '').trimStart();
  return !t || INJECTED_PREFIXES.some((p) => t.startsWith(p));
}

/** Pure: parse rollout jsonl lines -> {status,lastMessage,turn,cwd,title}. */
export function parseRollout(lines) {
  let status = 'unknown', lastMessage = '', turn = '', cwd = '', title = '';
  for (const ln of lines) {
    const j = safeJson(ln);
    if (!j) continue;
    if (j.type === 'session_meta') { cwd = j.payload?.cwd ?? cwd; continue; }
    if (j.type === 'turn_context') { cwd = cwd || (j.payload?.cwd ?? ''); continue; }
    const p = j.payload;
    const t = p?.type;
    if (t === 'task_started') { status = 'running'; turn = p.turn_id ?? turn; }
    else if (t === 'task_complete') { status = 'done'; lastMessage = p.last_agent_message ?? lastMessage; turn = p.turn_id ?? turn; }
    else if (t === 'turn_aborted') status = 'stuck';
    else if (t === 'agent_message') lastMessage = p.message ?? lastMessage;
    else if (t === 'item_completed') {
      const item = p.item ?? {};
      const text = textOf(item.content);
      if (item.type === 'UserMessage') {
        if (!title && !looksInjected(text)) title = text.trim();
      } else if (item.type === 'AgentMessage' && text.trim()) {
        lastMessage = text;
      }
    }
    if (p?.turn_id) turn = p.turn_id;
  }
  return { status, lastMessage, turn, cwd, title };
}

export function observe() {
  const home = process.env.PETDECK_OBSERVE_HOME || os.homedir();
  const dir = path.join(home, '.codex', 'sessions');
  const files = latestFiles(dir, (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'), 5);
  const out = [];
  for (const f of files) {
    // head 取 session_meta（cwd/id 只在首行），tail 取当前回合状态。
    // head 必须够长：session_meta 在第 1 行，而首个 UserMessage（标题来源）实测固定
    // 落在第 9–13 行；只读 8 行时标题会空。长会话的用户提问也在前 60 行内。
    const r = parseRollout([...headLines(f, 60), ...tailLines(f, 400)]);
    if (r.status === 'unknown' && !r.lastMessage && !r.title) continue;
    out.push({ agent: id, source: 'rollout-jsonl', session: path.basename(f), status: r.status, title: r.title.slice(0, 200), lastMessage: r.lastMessage.slice(0, 200), turn: r.turn, cwd: r.cwd });
  }
  return out;
}

export async function inject(payload, { run = runCli } = {}) {
  // Prompt = the same unified handoff package the clipboard fallback uses
  // (from/context/instruction/artifacts), plus a no-tools guard.
  const prompt = `${handoffPackage(payload)}\nDo not use any tools.`;
  // No shell: prompt rides as a literal argv element (leading-dash guarded).
  const r = await run('codex', ['exec', '--skip-git-repo-check', guardDash(prompt)], { timeout: 60000 });
  if (r.status === 0 && r.stdout) return { ok: true, response: r.stdout.trim().slice(0, 400), sessionID: '' };
  return { ok: false, response: '', summary: r.summary ?? '' };
}

export default { id, name, tier, observe, inject };
