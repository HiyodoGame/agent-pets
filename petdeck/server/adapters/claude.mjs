// Claude adapter — observe: ~/.claude/projects/<slug>/*.jsonl (read-only).
// inject: claude -p --output-format stream-json (headless).
import os from 'node:os';
import path from 'node:path';
import { runCli, guardDash } from './exec.mjs';
import { tailLines, latestFiles, safeJson } from './shared.mjs';
import { handoffPackage } from '../tiers.mjs';
import { computeUsageWindow } from '../usage-window.mjs';

export const id = 'claude';
export const name = 'Claude';
export const tier = 'full';

/** Pure: parse claude project jsonl lines -> {status,lastMessage,cwd,tokens,usageMarks}.
 *  Status is derived from an explicit terminal signal; absence never claims 'done'.
 *  tokens = 观察窗口内 assistant usage 的聚合（input/output/cacheRead），非会话全历史。
 *  usageMarks = 带时间戳的逐条 usage（供账户级 5h 窗口计算）；缺 timestamp 的 usage 不产生 mark。 */
export function parseClaude(lines) {
  let status = 'unknown', lastMessage = '', cwd = '';
  const tokens = { input: 0, output: 0, cacheRead: 0 };
  const usageMarks = [];
  for (const ln of lines) {
    const j = safeJson(ln);
    if (!j) continue;
    cwd = j.cwd ?? cwd;
    if (j.type === 'assistant') {
      const stop = j.message?.stop_reason;
      status = (stop === 'end_turn' || stop === 'stop_sequence') ? 'done' : 'running';
      const c = j.message?.content;
      if (Array.isArray(c)) { const txt = c.find((x) => x.type === 'text'); if (txt) lastMessage = txt.text; }
      const u = j.message?.usage;
      if (u) {
        tokens.input += u.input_tokens ?? 0;
        tokens.output += u.output_tokens ?? 0;
        tokens.cacheRead += u.cache_read_input_tokens ?? 0;
        if (typeof j.timestamp === 'string' && !Number.isNaN(Date.parse(j.timestamp))) {
          usageMarks.push({ ts: j.timestamp, tokens: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 } });
        }
      }
    } else if (j.type === 'user') {
      // 只有 string content 才是真实用户输入；tool_result 等数组内容不改变状态。
      if (typeof j.message?.content === 'string') status = 'waiting';
    } else if (j.type === 'result') {
      status = j.is_error ? 'stuck' : 'done';
    }
  }
  return { status, lastMessage, cwd, tokens, usageMarks };
}

export function observe(now = Date.now()) {
  const home = process.env.PETDECK_OBSERVE_HOME || os.homedir();
  const dir = path.join(home, '.claude', 'projects');
  const files = latestFiles(dir, (n) => n.endsWith('.jsonl'), 5);
  const out = [];
  const marks = [];
  for (const f of files) {
    // 用量为观察窗口（尾部 N 行）内的聚合值，不是会话全历史——UI 需据此标注。
    const r = parseClaude(tailLines(f, 400));
    marks.push(...r.usageMarks);
    if (r.status === 'unknown' && !r.lastMessage) continue;
    out.push({ agent: id, source: 'projects-jsonl', session: path.basename(f), status: r.status, lastMessage: r.lastMessage.slice(0, 200), cwd: r.cwd, tokens: r.tokens });
  }
  // 5h 窗口是账户级的（订阅限额不分会话）：跨全部扫描文件聚合，同一份结果挂到每行 claude 会话。
  const usageWindow = computeUsageWindow(marks, now);
  for (const row of out) row.usageWindow = usageWindow;
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