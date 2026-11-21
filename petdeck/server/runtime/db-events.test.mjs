// Event paging: the task page keeps a 2000-event window and walks backwards
// with ?before=<id>&limit=200, so paging must be exact and ordered ascending.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openRuntimeDb } from './db.mjs';

function tempDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-' + tag + '-')); }

function seeded(count) {
  const dir = tempDir('events');
  const store = openRuntimeDb({ dataDir: dir });
  for (let i = 1; i <= count; i += 1) {
    store.appendEvent({ taskId: 't-events', type: 'message.assistant', payload: { text: 'line ' + i }, ts: i });
  }
  return store;
}

test('after paging returns the oldest window in ascending order', () => {
  const store = seeded(250);
  const first = store.listEvents('t-events', { limit: 100 });
  assert.deepEqual(first.map((e) => e.id), Array.from({ length: 100 }, (_, i) => i + 1));
  const next = store.listEvents('t-events', { after: 100, limit: 100 });
  assert.deepEqual(next.map((e) => e.id), Array.from({ length: 100 }, (_, i) => i + 101));
});

test('before paging returns the previous window in ascending order', () => {
  const store = seeded(250);
  const older = store.listEvents('t-events', { before: 101, limit: 50 });
  assert.deepEqual(older.map((e) => e.id), Array.from({ length: 50 }, (_, i) => i + 51));
  const edge = store.listEvents('t-events', { before: 51, limit: 200 });
  assert.deepEqual(edge.map((e) => e.id), Array.from({ length: 50 }, (_, i) => i + 1));
});

test('bulk append keeps insertion order and ids', () => {
  const dir = tempDir('bulk');
  const store = openRuntimeDb({ dataDir: dir });
  const written = store.appendEvents([1, 2, 3].map((i) => ({ taskId: 't-bulk', type: 'message.assistant', payload: { text: 'x' + i } })));
  assert.deepEqual(written.map((e) => e.id), [1, 2, 3]);
  assert.deepEqual(store.listEvents('t-bulk').map((e) => e.payload.text), ['x1', 'x2', 'x3']);
});

test('before at the oldest id returns nothing and limits are clamped', () => {
  const store = seeded(30);
  assert.deepEqual(store.listEvents('t-events', { before: 1, limit: 20 }), []);
  assert.equal(store.listEvents('t-events', { limit: 0 }).length, 1);
  assert.equal(store.listEvents('t-events', { limit: 9999 }).length, 30);
  assert.deepEqual(store.listEvents('other-task'), []);
});
