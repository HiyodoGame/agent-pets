// DevEco Code adapter — sqlite schema copied from a real installation
// (~/.local/share/deveco/deveco.db, 2026-11-25). Observe-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { observe, mapDevecoStatus, devecoDbPath } from './adapters/deveco.mjs';

const NOW = Date.parse('2026-11-25T12:00:00.000Z');

function makeDb(home, { sessions = [], messages = [], parts = [] } = {}) {
  const dir = path.join(home, '.local', 'share', 'deveco');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'deveco.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE session (
    id TEXT PRIMARY KEY, project_id TEXT, workspace_id TEXT, parent_id TEXT, slug TEXT,
    directory TEXT, path TEXT, title TEXT, version TEXT, share_url TEXT,
    summary_additions INTEGER, summary_deletions INTEGER, summary_files INTEGER, summary_diffs TEXT,
    metadata TEXT, cost REAL, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER,
    tokens_cache_read INTEGER, tokens_cache_write INTEGER, revert TEXT, permission TEXT, agent TEXT,
    model TEXT, time_created INTEGER, time_updated INTEGER, time_compacting INTEGER, time_archived INTEGER)`);
  db.exec(`CREATE TABLE message (
    id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)`);
  db.exec(`CREATE TABLE part (
    id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)`);
  const insS = db.prepare(`INSERT INTO session (id, parent_id, directory, title, tokens_input, tokens_output, tokens_cache_read, time_created, time_updated, time_archived)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const s of sessions) {
    insS.run(s.id, s.parent_id ?? null, s.directory ?? '', s.title ?? '', s.tokens_input ?? 0,
      s.tokens_output ?? 0, s.tokens_cache_read ?? 0, s.time_created ?? NOW, s.time_updated ?? NOW,
      s.time_archived ?? null);
  }
  const insM = db.prepare('INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)');
  for (const m of messages) insM.run(m.id, m.session_id, m.time_created ?? NOW, JSON.stringify(m.data));
  const insP = db.prepare('INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?, ?, ?, ?, ?)');
  for (const p of parts) insP.run(p.id, p.message_id, p.session_id, p.time_created ?? NOW, JSON.stringify(p.data));
  db.close();
  return file;
}

test('deveco: not installed => legitimately empty (no fault)', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-deveco-none-'));
  assert.deepEqual(await observe({ home, now: NOW }), []);
  assert.equal(devecoDbPath(home), path.join(home, '.local', 'share', 'deveco', 'deveco.db'));
});

test('deveco: unfinished assistant + recent write => running, completed => done, stale => unknown', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-deveco-'));
  makeDb(home, {
    sessions: [
      { id: 's-live', directory: 'F:/Work', title: '正在跑', time_updated: NOW - 5_000 },
      { id: 's-done', directory: 'F:/Work', title: '已完成', time_updated: NOW - 60_000 },
      { id: 's-stale', directory: 'F:/Work', title: '旧会话', time_updated: NOW - 4 * 24 * 3600_000 },
      { id: 's-arch', title: '已归档', time_updated: NOW, time_archived: NOW },
      { id: 's-child', parent_id: 's-live', title: '子会话', time_updated: NOW },
    ],
    messages: [
      { id: 'm-live', session_id: 's-live', data: { role: 'assistant', time: { created: NOW - 5_000 } } },
      { id: 'm-done', session_id: 's-done', data: { role: 'assistant', time: { created: NOW - 90_000, completed: NOW - 60_000 } } },
      { id: 'm-stale', session_id: 's-stale', data: { role: 'assistant', time: { created: NOW - 4 * 24 * 3600_000 } } },
      { id: 'm-arch', session_id: 's-arch', data: { role: 'assistant', time: { created: NOW } } },
    ],
    parts: [
      { id: 'p-live', message_id: 'm-live', session_id: 's-live', data: { type: 'text', text: '正在改 ArkTS 页面' } },
      { id: 'p-done', message_id: 'm-done', session_id: 's-done', data: { type: 'text', text: '构建通过' } },
      { id: 'p-done-sf', message_id: 'm-done', session_id: 's-done', data: { type: 'step-finish', reason: 'stop' } },
    ],
  });

  const rows = await observe({ home, now: NOW });
  assert.equal(rows.length, 3, 'archived and subagent sessions are not live work');
  const byId = new Map(rows.map((r) => [r.session, r]));
  assert.equal(byId.get('s-live').status, 'running');
  assert.equal(byId.get('s-live').lastMessage, '正在改 ArkTS 页面');
  assert.equal(byId.get('s-done').status, 'done');
  assert.equal(byId.get('s-done').lastMessage, '构建通过', 'non-text parts are skipped');
  assert.equal(byId.get('s-stale').status, 'unknown', 'a four-day-old unfinished turn is not running');
  assert.equal(rows[0].agent, 'deveco');
  assert.equal(rows[0].source, 'deveco-sqlite');
  assert.equal(byId.get('s-live').updatedAt, NOW - 5_000);
});

test('deveco: mapDevecoStatus treats a missing completed timestamp as unfinished', () => {
  assert.equal(mapDevecoStatus({ time: { created: 1 } }, NOW - 1000, NOW), 'running');
  assert.equal(mapDevecoStatus({ time: { completed: 1 } }, NOW - 1000, NOW), 'done');
  assert.equal(mapDevecoStatus(null, NOW - 4 * 24 * 3600_000, NOW), 'unknown', 'a stale unfinished turn is not running');
});
