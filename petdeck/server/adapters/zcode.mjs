// zcode adapter — observe: ~/.zcode/cli/db/db.sqlite via temp copy (read-only; the live DB
// has WAL and must never be opened in place). inject: CLI inject syntax UNVERIFIED =>
// tier observe-only (clipboard). See docs/agent-会话存储勘察.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { safeJson } from './shared.mjs';

export const id = 'zcode';
export const name = 'zcode';
export const tier = 'observe-only';

const RUNNING_FRESH_MS = 120000;

/** zcode 自己的工作区沙箱目录（实测 E:\ZCodeData\.zcode\workspace\<ts>-<uuid>）。
 *  它是 zcode 复制/隔离开的私有目录，不是用户项目；当成 cwd 会把会话挂到
 *  一个用户根本不认识的路径下（真机 5 条里 1 条如此）。 */
const SANDBOX_DIR_RE = /[\\/]\.zcode[\\/]workspace[\\/]/;

export function isSandboxDirectory(dir) {
  return SANDBOX_DIR_RE.test(String(dir ?? ''));
}

/** Pure: map a session row (+optional extras) to an observed-session row.
 *  last_outcome completed => done；interrupted => stuck；null + 近期更新 => running；
 *  null + 陈旧 => unknown（绝不编造）。 */
export function mapZcodeSession(s, now = Date.now()) {
  let status = 'unknown';
  if (s.last_outcome === 'completed') status = 'done';
  else if (s.last_outcome === 'interrupted') status = 'stuck';
  else if (s.last_outcome == null && typeof s.time_updated === 'number' && now - s.time_updated < RUNNING_FRESH_MS) status = 'running';
  return status;
}

async function copyDbToTemp(srcDir, tmpBase = os.tmpdir()) {
  const dst = fs.mkdtempSync(path.join(tmpBase, 'petdeck-zcode-'));
  for (const suffix of ['', '-wal', '-shm']) {
    const src = path.join(srcDir, `db.sqlite${suffix}`);
    try { fs.copyFileSync(src, path.join(dst, `db.sqlite${suffix}`)); } catch { /* wal/shm may not exist */ }
  }
  return path.join(dst, 'db.sqlite');
}

/** Observe top-level (non-subagent, not deleted) sessions, newest first, cap 5. */
export async function observe({ home = process.env.PETDECK_OBSERVE_HOME || os.homedir(), now = Date.now(), opener = (f) => new DatabaseSync(f) } = {}) {
  const dbDir = path.join(home, '.zcode', 'cli', 'db');
  fs.accessSync(dbDir); // throws ENOENT = real fault (freshness keeps stale)
  const copy = await copyDbToTemp(dbDir);
  let rows = [];
  let db;
  try {
    db = opener(copy);
    const sessions = db.prepare(`SELECT id, title, directory, time_updated, last_outcome FROM session
      WHERE time_deleted IS NULL AND parent_id IS NULL ORDER BY time_updated DESC LIMIT 5`).all();
    const usageStmt = db.prepare(`SELECT
      COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(output_tokens),0) AS output,
      COALESCE(SUM(cache_read_input_tokens),0) AS cacheRead
      FROM turn_usage WHERE session_id = ?`);
    const lastMsgStmt = db.prepare(`SELECT p.data FROM part p
      JOIN message m ON m.id = p.message_id AND m.session_id = p.session_id
      WHERE p.session_id = ? AND m.time_created = (
        SELECT MAX(time_created) FROM message WHERE session_id = ? AND data LIKE '%"role":"assistant"%')
      ORDER BY p.sequence DESC`);
    for (const s of sessions) {
      const usage = usageStmt.get(s.id) ?? { input: 0, output: 0, cacheRead: 0 };
      let lastMessage = '';
      for (const p of lastMsgStmt.all(s.id, s.id)) {
        const j = safeJson(typeof p === 'object' ? p.data : p);
        if (j?.type === 'text' && j.text) { lastMessage = j.text; break; }
      }
      // 沙箱会话的目录不是用户项目 => 留空（前端归到「未识别项目」），不编造归属。
      const cwd = isSandboxDirectory(s.directory) ? '' : (s.directory ?? '');
      rows.push({
        agent: id, source: 'zcode-sqlite', session: s.id, title: s.title ?? '', cwd,
        status: mapZcodeSession(s, now), lastMessage: String(lastMessage).slice(0, 200), turn: '',
        tokens: { input: usage.input, output: usage.output, cacheRead: usage.cacheRead },
        path: path.join(dbDir, 'db.sqlite'), updatedAt: Number(s.time_updated) || null,
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
  // Headless inject syntax unverified on real CLI => never pretend; always clipboard.
  return { ok: false, response: '' };
}

export default { id, name, tier, observe, inject };
