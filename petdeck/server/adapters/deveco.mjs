// DevEco Code adapter — observe: ~/.local/share/deveco/deveco.db via temp copy
// (read-only; the live DB has WAL and must never be opened in place).
//
// DevEco Code 是华为基于 OpenCode 扩展的 HarmonyOS AI CLI（npm @deveco/deveco-code），
// 数据目录与 opencode 不同：<home>/.local/share/deveco/deveco.db。
// 表结构与 opencode 同源：session(id,title,directory,parent_id,time_created,time_updated,
// time_archived,tokens_*) + message + part。与 opencode HTTP API 不同，这里没有
// outcome/busy/idle 字段，只能从「最后一条 assistant message 是否 completed」推断：
// completed 存在 => done；缺失且最近仍有写入 => running；长期无写入 => unknown。
// inject 语法未在真机验证 => observe-only（诚实约定，沿用 zcode/kimi-code 的分级）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { safeJson, settleRunningStatus } from './shared.mjs';

export const id = 'deveco';
export const name = 'DevEco Code';
export const tier = 'observe-only';

/** v2 row 的最后一条 assistant message 决定这一轮是否结束。 */
export function mapDevecoStatus(lastAssistant, timeUpdated, now = Date.now()) {
  const completed = lastAssistant?.time?.completed;
  if (typeof completed === 'number') return 'done';
  return settleRunningStatus('running', timeUpdated, now);
}

export function devecoDbPath(home = os.homedir()) {
  return path.join(home, '.local', 'share', 'deveco', 'deveco.db');
}

async function copyDbToTemp(src, tmpBase = os.tmpdir()) {
  const dst = fs.mkdtempSync(path.join(tmpBase, 'petdeck-deveco-'));
  const dir = path.dirname(src);
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.copyFileSync(path.join(dir, `deveco.db${suffix}`), path.join(dst, `deveco.db${suffix}`)); }
    catch { /* wal/shm may not exist */ }
  }
  return path.join(dst, 'deveco.db');
}

/** 最近一条 assistant message 的纯文本（part.type === 'text'）。 */
function lastAssistantText(db, sessionId, messageId) {
  const rows = db.prepare(`SELECT data FROM part
    WHERE session_id = ? AND message_id = ? ORDER BY time_created DESC`).all(sessionId, messageId);
  for (const p of rows) {
    const j = safeJson(typeof p === 'object' ? p.data : p);
    if (j?.type === 'text' && typeof j.text === 'string' && j.text.trim()) return j.text;
  }
  return '';
}

/** Observe top-level (non-archived) sessions, newest first, cap 5. */
export async function observe({
  home = process.env.PETDECK_OBSERVE_HOME || os.homedir(),
  now = Date.now(),
  opener = (f) => new DatabaseSync(f),
} = {}) {
  const src = devecoDbPath(home);
  if (!fs.existsSync(src)) return []; // not installed: legitimately empty
  const copy = await copyDbToTemp(src);
  const rows = [];
  let db;
  try {
    db = opener(copy);
    const sessions = db.prepare(`SELECT id, title, directory, time_created, time_updated,
      tokens_input, tokens_output, tokens_cache_read FROM session
      WHERE parent_id IS NULL AND time_archived IS NULL ORDER BY time_updated DESC LIMIT 5`).all();
    const lastAssistant = db.prepare(`SELECT id, data FROM message
      WHERE session_id = ? AND data LIKE '%"role":"assistant"%'
      ORDER BY time_created DESC LIMIT 1`);
    for (const s of sessions) {
      const m = lastAssistant.get(s.id);
      const msg = m ? safeJson(m.data) : null;
      rows.push({
        agent: id,
        source: 'deveco-sqlite',
        session: s.id,
        title: String(s.title ?? '').slice(0, 200),
        status: mapDevecoStatus(msg, Number(s.time_updated) || null, now),
        lastMessage: m ? lastAssistantText(db, s.id, m.id).slice(0, 200) : '',
        cwd: typeof s.directory === 'string' ? s.directory : '',
        turn: '',
        tokens: {
          input: Number(s.tokens_input) || 0,
          output: Number(s.tokens_output) || 0,
          cacheRead: Number(s.tokens_cache_read) || 0,
        },
        path: src,
        updatedAt: Number(s.time_updated) || null,
      });
    }
  } finally {
    try { db?.close?.(); } finally {
      fs.rmSync(path.dirname(copy), { recursive: true, force: true });
    }
  }
  return rows;
}

export function inject() {
  // Headless inject syntax unverified on the real CLI => never pretend; always clipboard.
  return { ok: false, response: '' };
}

export default { id, name, tier, observe, inject };
