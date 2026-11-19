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
/** 非用户提问的 user 行（实测出现的噪声来源）：图片占位、hook 反馈、命令回显。 */
const NON_PROMPT_PREFIXES = ['[Image:', 'Stop hook feedback:', '<command-', '<local-command', '<system-reminder', 'Caveat:', 'API Error'];

function looksLikePrompt(text) {
  const t = String(text ?? '').trimStart();
  return t.length > 0 && !NON_PROMPT_PREFIXES.some((p) => t.startsWith(p));
}

export function parseClaude(lines) {
  let status = 'unknown', lastMessage = '', cwd = '', title = '';
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
    } else if (j.type === 'ai-title') {
      // CLI 自己生成的会话标题（真机 2.1.312 存在，实测每会话数条、后者更准）。
      if (typeof j.aiTitle === 'string' && j.aiTitle.trim()) title = j.aiTitle.trim();
    } else if (j.type === 'user') {
      // 只有 string content 才是真实用户输入；tool_result 等数组内容不改变状态。
      if (typeof j.message?.content === 'string') {
        status = 'waiting';
        // 首个像样的用户提问才是兜底标题（图片占位/hook 反馈不是提问）。
        if (!title && looksLikePrompt(j.message.content)) title = j.message.content;
      }
    } else if (j.type === 'result') {
      status = j.is_error ? 'stuck' : 'done';
    }
  }
  return { status, lastMessage, cwd, title, tokens, usageMarks };
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
    out.push({ agent: id, source: 'projects-jsonl', session: path.basename(f), status: r.status, title: r.title.slice(0, 200), lastMessage: r.lastMessage.slice(0, 200), cwd: r.cwd, tokens: r.tokens });
  }
  // 5h 窗口是账户级的（订阅限额不分会话）：跨全部扫描文件聚合，同一份结果挂到每行 claude 会话。
  const usageWindow = computeUsageWindow(marks, now);
  for (const row of out) row.usageWindow = usageWindow;
  return out;
}

/** Pure: extract the final assistant text from `claude -p --verbose --output-format stream-json`
 *  stdout (system init / assistant / result events). Falls back to `result.result`. */
export function parseStreamResponse(stdout) {
  let text = '';
  for (const ln of (stdout || '').split('\n')) {
    const j = safeJson(ln);
    if (!j) continue;
    if (j.type === 'assistant') {
      const c = j.message?.content;
      if (Array.isArray(c)) { const t = c.find((x) => x.type === 'text'); if (t?.text) text = t.text; }
    } else if (j.type === 'result' && typeof j.result === 'string' && j.result) {
      text = j.result;
    }
  }
  return text;
}

export async function inject(payload, { run = runCli } = {}) {
  const prompt = `${handoffPackage(payload)}\nDo not use any tools.`;
  // No shell: prompt rides as a literal argv element (leading-dash guarded).
  // Claude CLI ≥2.1 要求 --print 与 --output-format stream-json 同时显式带 --verbose，
  // 否则直接 exit 1（真机 2.1.312 实测）。
  const r = await run('claude', ['-p', '--verbose', '--output-format', 'stream-json', guardDash(prompt)], { timeout: 60000 });
  const response = parseStreamResponse(r.stdout);
  if (r.status === 0 && response) return { ok: true, response: response.slice(0, 400), sessionID: '' };
  return { ok: false, response: '', summary: r.summary ?? '' };
}

export default { id, name, tier, observe, inject };