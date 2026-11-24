// Kimi Code CLI adapter — observe (read-only). inject: kimi.exe exists but headless
// syntax is UNVERIFIED => tier observe-only (clipboard).
//
// 存储事实（2026-11-20 本机复测）：CLI 早已迁移到 v2 存储，旧库只留历史。
//   v2: <home>/.kimi-code/
//         session_index.jsonl  每行 {sessionId, sessionDir, workDir}
//         sessions/<wd_slug_hash>/<sessionId>/state.json
//             {id, version, cwd, archived, title, titleKind, lastPrompt, createdAt, updatedAt}
//         sessions/<wd_slug_hash>/<sessionId>/agents/main/wire.jsonl
//             协议 1.5 事件流：turn.prompt / context.append_message / usage.record /
//             turn.ended{reason} / prompt.completed / task.started / subagent.*
//         （sessionDir 根目录没有 context.jsonl —— 那是迁移前旧库的布局）
//   v1（迁移前，仍作兜底）: <home>/.kimi/sessions/<md5(workdir)>/<uuid>/context.jsonl，
//         role ∈ _system_prompt/_checkpoint/_usage/user/assistant。
// 旧实现只读 v1，于是面板上显示的是几个月前的历史会话，且首个 user 记录是
// "<system>Previous context has been compacted…" 压缩提示 => 标题全被污染。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { basenameAny, latestFiles, rethrowReadFault, tailLines, safeJson } from './shared.mjs';

export const id = 'kimi-code';
export const name = 'Kimi Code';
export const tier = 'observe-only';

/** 把 message.content（字符串或 [{type:'text',text}]）压成纯文本。 */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((p) => p && typeof p === 'object' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

/** 旧库（v1）用的 noise 前缀：压缩提示不是用户提问。 */
function looksCompactionNotice(text) {
  const t = String(text ?? '').trimStart();
  return t.startsWith('<system>') || t.startsWith('<current_focus>') || t.startsWith('<checkpoint');
}

/** Pure: parse a v2 wire.jsonl tail -> {status,lastMessage,tokens}. */
export function parseKimiWire(lines) {
  let status = 'unknown', lastMessage = '';
  const tokens = { input: 0, output: 0, cacheRead: 0 };
  for (const ln of lines) {
    const j = safeJson(ln);
    if (!j) continue;
    const t = j.type;
    if (t === 'turn.prompt') status = 'running';
    else if (t === 'prompt.completed') status = j.reason === 'completed' ? 'done' : 'stuck';
    else if (t === 'turn.ended') {
      // reason: completed | interrupted | cancelled | failed
      status = j.reason === 'completed' ? 'done' : 'stuck';
    } else if (t === 'context.append_message') {
      const msg = j.message ?? {};
      if (msg.role === 'assistant') {
        const text = textOf(msg.content);
        if (text.trim()) lastMessage = text;
      }
    } else if (t === 'usage.record') {
      const u = j.usage ?? {};
      tokens.input += Number(u.inputOther ?? 0) + Number(u.inputCacheCreation ?? 0);
      tokens.output += Number(u.output ?? 0);
      tokens.cacheRead += Number(u.inputCacheRead ?? 0);
    }
  }
  return { status, lastMessage, tokens };
}

/** Pure: parse a legacy v1 context.jsonl tail -> {status,lastMessage,tokens,title}. */
export function parseKimi(lines, _now = Date.now()) {
  let status = 'unknown', lastMessage = '', tokens = 0, lastRole = '', title = '';
  for (const ln of lines) {
    const j = safeJson(ln);
    if (!j) continue;
    const role = j.role;
    if (role === '_usage') { if (typeof j.token_count === 'number') tokens = j.token_count; continue; }
    if (role === '_system_prompt' || role === '_checkpoint') continue;
    if (role === 'user' || role === 'assistant') {
      lastRole = role;
      const text = textOf(j.content);
      if (role === 'user' && !title && !looksCompactionNotice(text)) title = text;
      if (text) lastMessage = text;
    }
  }
  if (lastRole === 'user') status = 'running';
  else if (lastRole === 'assistant') status = 'done';
  return { status, lastMessage, tokens, title };
}

/** v2 store: read the newest state.json files, then each session's wire tail. */
function observeV2(root) {
  const files = latestFiles(path.join(root, 'sessions'), (n) => n === 'state.json', 5);
  const out = [];
  for (const f of files) {
    let state;
    try { state = JSON.parse(fs.readFileSync(f, 'utf8')); }
    catch (error) { rethrowReadFault(error); continue; }
    if (!state || state.archived === true) continue;
    const dir = path.dirname(f);
    const wire = path.join(dir, 'agents', 'main', 'wire.jsonl');
    let r = { status: 'unknown', lastMessage: '', tokens: { input: 0, output: 0, cacheRead: 0 } };
    if (fs.existsSync(wire)) {
      try { r = parseKimiWire(tailLines(wire, 600)); }
      catch (error) { rethrowReadFault(error); /* malformed session content keeps its state.json fallback */ }
    }
    const title = String(state.title ?? '').trim() || String(state.lastPrompt ?? '').trim();
    if (r.status === 'unknown' && !r.lastMessage && !title) continue;
    const cwd = typeof state.cwd === 'string' ? state.cwd : '';
    // projectDir 形如 wd_<slug>_<hash>：去掉前缀与哈希后缀即人类可读的项目名。
    const projectDir = path.basename(path.dirname(dir));
    const slug = projectDir.replace(/^wd_/, '').replace(/_[0-9a-f]{12}$/, '');
    let updatedAt = Number(state.updatedAt) || 0;
    if (!updatedAt) { try { updatedAt = fs.statSync(f).mtimeMs; } catch { updatedAt = 0; } }
    out.push({
      agent: id, source: 'kimi-code-wire', session: state.id || path.basename(dir),
      title: title.slice(0, 200), status: r.status,
      lastMessage: r.lastMessage.slice(0, 200), turn: '',
      cwd, projectId: projectDir, projectName: cwd ? basenameAny(cwd) : slug,
      tokens: r.tokens, path: fs.existsSync(wire) ? wire : f, updatedAt: updatedAt || null,
    });
    if (out.length >= 5) break;
  }
  return out;
}

/** v1 store (pre-migration): ~/.kimi/sessions/<hash>/<uuid>/context.jsonl. */
function observeLegacy(home, now) {
  const dir = path.join(home, '.kimi', 'sessions');
  const files = latestFiles(dir, (n) => n === 'context.jsonl', 5);
  const out = [];
  for (const f of files) {
    let text, st;
    try { text = fs.readFileSync(f, 'utf8'); st = fs.statSync(f); } catch { continue; }
    const r = parseKimi(text.split('\n'), now);
    if (r.status === 'unknown' && !r.lastMessage) continue;
    const project = path.basename(path.dirname(path.dirname(f)));
    out.push({ agent: id, source: 'kimi-jsonl', session: path.basename(path.dirname(f)), title: r.title.slice(0, 200), projectId: project, projectName: project, status: r.status, lastMessage: r.lastMessage.slice(0, 200), turn: '', tokens: { total: r.tokens }, path: f, updatedAt: st.mtimeMs });
  }
  return out;
}

/** Observe newest sessions (cap 5). v2 store first, legacy v1 store as fallback. */
export async function observe({ home = process.env.PETDECK_OBSERVE_HOME || os.homedir(), now = Date.now() } = {}) {
  const v2 = path.join(home, '.kimi-code');
  if (fs.existsSync(path.join(v2, 'session_index.jsonl')) || fs.existsSync(path.join(v2, 'sessions'))) {
    return observeV2(v2);
  }
  return observeLegacy(home, now);
}

export function inject() {
  // Headless inject syntax unverified on real CLI => never pretend; always clipboard.
  return { ok: false, response: '' };
}

export default { id, name, tier, observe, inject };
