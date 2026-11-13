// RED tests for local-first telemetry core (privacy + ring + persistence).
// Run: node --test src/telemetry/core.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetryCore, attachPersistence, EVENT } from './core.ts';

test('core: track returns event with user/page/action/ts', () => {
  const t = createTelemetryCore({ user: 'u1' });
  const e = t.track('relay', 'relay_done', { ok: true });
  assert.equal(e.user, 'u1');
  assert.equal(e.page, 'relay');
  assert.equal(e.action, 'relay_done');
  assert.equal(typeof e.ts, 'number');
  assert.deepEqual(e.extra, { ok: true });
});

test('core: track strips forbidden content fields (privacy)', () => {
  const t = createTelemetryCore({ user: 'u1' });
  const e = t.track('relay', 'relay_inject_result', { mode: 'inject', context: 'SECRET', instruction: 'SECRET', lastMessage: 'SECRET', ok: true });
  assert.deepEqual(e.extra, { mode: 'inject', ok: true });
});

test('core: ring cap drops oldest', () => {
  const t = createTelemetryCore({ user: 'u1', cap: 2 });
  t.track('p', 'a'); t.track('p', 'b'); t.track('p', 'c');
  assert.deepEqual(t.events().map((e) => e.action), ['b', 'c']);
});

test('core: exportJSON parses to events array', () => {
  const t = createTelemetryCore({ user: 'u1' });
  t.track('p', 'a');
  const arr = JSON.parse(t.exportJSON());
  assert.equal(arr.length, 1);
});

test('core: EVENT names include NSM-critical events', () => {
  assert.equal(EVENT.relayDone, 'relay_done');
  assert.equal(EVENT.relayInjectResult, 'relay_inject_result');
});

test('persistence: reload restores events, track persists', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  const t1 = createTelemetryCore({ user: 'u1' });
  attachPersistence(t1, storage, 'k');
  t1.track('p', 'a');
  const t2 = createTelemetryCore({ user: 'u1' });
  attachPersistence(t2, storage, 'k');
  assert.deepEqual(t2.events().map((e) => e.action), ['a']);
});

test('EVENT: offline connection events exist', () => {
  assert.equal(EVENT.offlineEntered, 'offline_entered');
  assert.equal(EVENT.connectionRecovered, 'connection_recovered');
});

test('core: strips forbidden keys at any depth', () => {
  const t = createTelemetryCore({ user: 'u1' });
  const e = t.track('p', 'a', { ok: true, nested: { content: 'SECRET', keep: 1 }, arr: [{ instruction: 'X' }, { fine: 2 }] });
  const json = JSON.stringify(e.extra);
  assert.equal(json.includes('SECRET'), false);
  assert.equal(json.includes('instruction'), false);
  assert.equal(json.includes('keep'), true);
});

test('core: mutating caller object after track cannot leak content', () => {
  const t = createTelemetryCore({ user: 'u1' });
  const payload = { meta: { content: '' } };
  const e = t.track('p', 'a', { payload });
  payload.meta.content = 'LATE_SECRET';
  assert.equal(JSON.stringify(e.extra).includes('LATE_SECRET'), false);
});

test('core: _load with malformed data recovers and keeps tracking', () => {
  const t = createTelemetryCore({ user: 'u1' });
  // JSON.parse('"text"') => a string; must not turn buf into a non-array.
  (t as unknown as { _load(v: unknown): void })._load('not-an-array');
  assert.equal(t.events().length, 0);
  assert.equal(t.track('p', 'a').action, 'a'); // would throw before the fix
  // array with junk entries => only well-formed events survive
  const t2 = createTelemetryCore({ user: 'u1' });
  (t2 as unknown as { _load(v: unknown): void })._load([{ id: 'a', action: 'x' }, null, 5, { nope: true }]);
  assert.equal(t2.events().length, 1);
});