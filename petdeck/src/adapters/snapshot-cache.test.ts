// RED tests for real-snapshot local cache (never caches demo data by contract of callers).
// Run: node --test src/adapters/snapshot-cache.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveSnapshot, loadSnapshot, SNAPSHOT_KEY, SNAPSHOT_CAP, type SnapshotStorage } from './snapshot-cache.ts';
import type { ObservedSession } from './types.ts';
import type { Agent } from '../flows/shared/types.ts';

function memStorage(): SnapshotStorage & { dump: Map<string, string> } {
  const m = new Map<string, string>();
  return { dump: m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

const row = (i: number): ObservedSession => ({ agent: 'codex', source: 't', session: `s${i}`, status: 'running', lastMessage: 'm' });
const agent: Agent = { id: 'codex', name: 'Codex', form: 'cli', capability: 'full', status: 'idle', projectIds: [] };

test('cache: round-trip preserves savedAt/sessions/agents', () => {
  const s = memStorage();
  saveSnapshot(s, { sessions: [row(1)], agents: [agent] }, 1234);
  assert.deepEqual(loadSnapshot(s), { savedAt: 1234, sessions: [row(1)], agents: [agent] });
});

test('cache: corrupt JSON discarded and key removed', () => {
  const s = memStorage();
  s.setItem(SNAPSHOT_KEY, '{bad json');
  assert.equal(loadSnapshot(s), null);
  assert.equal(s.dump.has(SNAPSHOT_KEY), false);
});

test('cache: wrong shape discarded', () => {
  const s = memStorage();
  s.setItem(SNAPSHOT_KEY, JSON.stringify({ savedAt: 'not-a-number', sessions: [], agents: [] }));
  assert.equal(loadSnapshot(s), null);
});

test('cache: sessions capped at 200', () => {
  const s = memStorage();
  const many = Array.from({ length: 250 }, (_, i) => row(i));
  saveSnapshot(s, { sessions: many, agents: [agent] }, 1);
  assert.equal(loadSnapshot(s)?.sessions.length, SNAPSHOT_CAP);
});

test('cache: null storage degrades gracefully', () => {
  saveSnapshot(null, { sessions: [row(1)], agents: [agent] }, 1);
  assert.equal(loadSnapshot(null), null);
});

test('cache: missing key returns null', () => {
  assert.equal(loadSnapshot(memStorage()), null);
});