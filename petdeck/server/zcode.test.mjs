// RED tests: zcode adapter — ~/.zcode/cli/db/db.sqlite (read-only via temp copy).
// Run: node --test server/zcode.test.mjs
// 存储事实（docs/agent-会话存储勘察.md）：session(title/last_outcome/time_updated/time_deleted/
// parent_id) + message(data JSON) + turn_usage(input/output tokens, status)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { mapZcodeSession, observe, isSandboxDirectory } from './adapters/zcode.mjs';

const NOW = Date.now();

function fixtureDb(file) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE session (id TEXT, title TEXT, directory TEXT, parent_id TEXT,
    time_created INTEGER, time_updated INTEGER, time_deleted INTEGER, last_outcome TEXT);
    CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT, sequence INTEGER);
    CREATE TABLE turn_usage (session_id TEXT, turn_id TEXT, completed_at INTEGER, status TEXT,
      input_tokens INTEGER, output_tokens INTEGER, cache_read_input_tokens INTEGER);`);
  return db;
}

const insSession = (db, { id, title = 'T', outcome = null, updated, deleted = null, parent = null }) =>
  db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?)').run(id, title, 'F:\\p', parent, updated - 600000, updated, deleted, outcome);
const insMsg = (db, sid, role, text, at) =>
  db.prepare('INSERT INTO message VALUES (?,?,?,?)').run(`m-${Math.random()}`, sid, at,
    JSON.stringify({ role, time: { created: at } }));

test('mapZcodeSession: last_outcome mapping + running via fresh update', () => {
  assert.equal(mapZcodeSession({ last_outcome: 'completed', time_updated: NOW - 600000 }, NOW), 'done');
  assert.equal(mapZcodeSession({ last_outcome: 'interrupted', time_updated: NOW - 600000 }, NOW), 'stuck');
  assert.equal(mapZcodeSession({ last_outcome: null, time_updated: NOW - 30000 }, NOW), 'running',
    'null outcome + recently updated => running (turn in progress)');
  assert.equal(mapZcodeSession({ last_outcome: null, time_updated: NOW - 3600000 }, NOW), 'unknown');
});

test('observe: reads fixture db via temp-copy opener, top-level only, usage summed, cap 5', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-zcode-'));
  const zdir = path.join(home, '.zcode', 'cli', 'db');
  fs.mkdirSync(zdir, { recursive: true });
  const db = fixtureDb(path.join(zdir, 'db.sqlite'));
  insSession(db, { id: 's1', title: 'A', outcome: 'completed', updated: NOW - 600000 });
  insMsg(db, 's1', 'user', '/init 检查', NOW - 610000);
  insMsg(db, 's1', 'assistant', '检查完成', NOW - 600000);
  db.prepare('INSERT INTO turn_usage VALUES (?,?,?,?,?,?,?)').run('s1', 't1', NOW, 'completed', 1000, 200, 500);
  db.prepare('INSERT INTO turn_usage VALUES (?,?,?,?,?,?,?)').run('s1', 't2', NOW, 'completed', 300, 50, 0);
  insSession(db, { id: 's2', title: 'B', outcome: null, updated: NOW - 10000 });
  insSession(db, { id: 's3', title: 'child', outcome: null, updated: NOW, parent: 's1' });
  insSession(db, { id: 's4', title: 'deleted', outcome: 'completed', updated: NOW, deleted: 1 });
  const rows = await observe({ home, now: NOW, opener: (src) => new DatabaseSync(src) });
  assert.equal(rows.length, 2, 'subagents (parent_id) and deleted sessions excluded');
  const a = rows.find((r) => r.session === 's1');
  assert.equal(a.status, 'done');
  assert.equal(a.title, 'A');
  assert.equal(a.cwd, 'F:\\p');
  assert.equal(a.tokens.input, 1300);
  assert.equal(a.tokens.output, 250);
  assert.equal(a.tokens.cacheRead, 500);
  assert.equal(rows[0].agent, 'zcode');
});

test('observe: missing db dir => throws (source fault, freshness keeps stale)', async () => {
  await assert.rejects(observe({ home: os.tmpdir() + '/nope-zcode', now: NOW }));
});

// zcode 会把部分会话复制进自己的沙箱工作区（实测 E:\ZCodeData\.zcode\workspace\<ts>-<uuid>）。
// 那是 zcode 的私有目录，当成用户项目会把会话挂到一个用户不认识的路径下。
test('observe: closes an opened DB when a query throws and still removes the temp copy', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-zcode-close-'));
  const zdir = path.join(home, '.zcode', 'cli', 'db');
  fs.mkdirSync(zdir, { recursive: true });
  fs.writeFileSync(path.join(zdir, 'db.sqlite'), 'fixture');
  let closed = false;
  const opener = () => ({
    prepare() { throw new Error('query failed'); },
    close() { closed = true; },
  });
  try {
    await assert.rejects(observe({ home, now: NOW, opener }), /query failed/);
    assert.equal(closed, true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('isSandboxDirectory: only zcode workspace paths count as sandbox', () => {
  assert.equal(isSandboxDirectory('E:\\ZCodeData\\.zcode\\workspace\\1794927028429-1aab'), true);
  assert.equal(isSandboxDirectory('/home/u/.zcode/workspace/123-x'), true);
  assert.equal(isSandboxDirectory('F:\\WorkSpace\\WebProjects\\DevBox'), false);
  assert.equal(isSandboxDirectory(''), false);
});

test('observe: a sandbox session gets no cwd (unidentified project, not a fake one)', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-zcode-sandbox-'));
  const zdir = path.join(home, '.zcode', 'cli', 'db');
  fs.mkdirSync(zdir, { recursive: true });
  const db = fixtureDb(path.join(zdir, 'db.sqlite'));
  db.prepare('INSERT INTO session VALUES (?,?,?,?,?,?,?,?)').run(
    's-sbx', '沙箱会话', 'E:\\ZCodeData\\.zcode\\workspace\\1794927028429-1aab', null, NOW - 600000, NOW - 600000, null, 'completed');
  db.close();
  const rows = await observe({ home, now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cwd, '');
  assert.equal(rows[0].title, '沙箱会话');
});
