// RED tests for live-session overlay merge (Flow3 real-time list).
// Run: node --test src/adapters/live-sessions.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPanelViewState, mergeSessions, savePanelViewState } from './live-sessions.ts';
import type { Session } from '../flows/shared/types';

const base = (id: string, over: Partial<Session> = {}): Session => ({
  id, projectId: 'live', agentId: 'codex', title: `t-${id}`, status: 'active',
  messages: [], artifactIds: [], updatedAt: '2026-01-01T00:00:00Z', ...over,
});

test('merge: no overlays returns base unchanged', () => {
  const b = [base('a'), base('b')];
  assert.deepEqual(mergeSessions(b, {}, []), b);
});

test('merge: rename overlay applies title', () => {
  const r = mergeSessions([base('a')], { a: { title: 'renamed' } }, []);
  assert.equal(r[0].title, 'renamed');
});

test('merge: archive overlay applies status', () => {
  const r = mergeSessions([base('a')], { a: { status: 'archived' } }, []);
  assert.equal(r[0].status, 'archived');
});

test('merge: deleted ids removed', () => {
  const r = mergeSessions([base('a'), base('b')], {}, ['a']);
  assert.deepEqual(r.map((s) => s.id), ['b']);
});

test('merge: followUp extraMessages appended after base messages', () => {
  const b = [base('a', { messages: [{ id: 'm1', role: 'agent', content: 'x', timestamp: '', artifactIds: [] }] })];
  const r = mergeSessions(b, { a: { extraMessages: [{ id: 'm2', role: 'user', content: 'y', timestamp: '', artifactIds: [] }] } }, []);
  assert.deepEqual(r[0].messages.map((m) => m.id), ['m1', 'm2']);
});

test('merge: live base refresh surfaces new sessions and keeps overlays', () => {
  const overlays = { a: { title: 'keep' } };
  const r1 = mergeSessions([base('a')], overlays, []);
  const r2 = mergeSessions([base('a'), base('c')], overlays, []);
  assert.equal(r1.length, 1);
  assert.deepEqual(r2.map((s) => s.id), ['a', 'c']);
  assert.equal(r2[0].title, 'keep');
});

test('panel view state persists rename/archive/hide across remounts, not transient messages', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  savePanelViewState(storage, {
    overlays: {
      a: { title: 'renamed', status: 'archived', extraMessages: [{ id: 'temporary', role: 'user', content: 'not persisted', timestamp: '', artifactIds: [] }] },
    },
    deleted: ['b'],
  });
  const restored = loadPanelViewState(storage);
  assert.deepEqual(restored.deleted, ['b']);
  assert.equal(restored.overlays.a.title, 'renamed');
  assert.equal(restored.overlays.a.status, 'archived');
  assert.equal(restored.overlays.a.extraMessages, undefined);
  const merged = mergeSessions([base('a'), base('b')], restored.overlays, restored.deleted);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'renamed');
  assert.equal(merged[0].status, 'archived');
});

test('panel view state recovers from corrupt or unavailable storage', () => {
  const corrupt = { getItem: () => '{bad', setItem: () => {} };
  assert.deepEqual(loadPanelViewState(corrupt), { overlays: {}, deleted: [] });
  assert.deepEqual(loadPanelViewState(null), { overlays: {}, deleted: [] });
  savePanelViewState(null, { overlays: {}, deleted: [] });
});
