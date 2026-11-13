// RED tests for frontend adapter pure logic (bus / registry).
// Run: node --test src/adapters/logic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from './bus.ts';
import { selectSource, gateInject, injectOrClipboard } from './registry.ts';

test('event bus: emit -> subscriber, replay capped, unsubscribe', () => {
  const bus = createEventBus(2);
  const seen: string[] = [];
  const un = bus.subscribe((e) => seen.push(e.id));
  bus.emit({ id: '1', type: 'done', text: 'a' });
  bus.emit({ id: '2', type: 'done', text: 'b' });
  bus.emit({ id: '3', type: 'done', text: 'c' });
  assert.deepEqual(seen, ['1', '2', '3']);
  un();
  bus.emit({ id: '4', type: 'done', text: 'd' });
  assert.equal(seen.length, 3);
  const late: string[] = [];
  bus.subscribe((e) => late.push(e.id));
  assert.deepEqual(late, ['3', '4']); // replay cap 2
});

test('registry: selectSource mock only on explicit demo', () => {
  assert.equal(selectSource(true), 'mock');
  assert.equal(selectSource(false), 'live');
});

test('registry: injectOrClipboard clipboard when not live', async () => {
  const d = await injectOrClipboard({ to: 'kimi', context: 'c', instruction: 'i' }, false, async () => { throw new Error('must not be called'); });
  assert.equal(d.mode, 'clipboard');
  assert.match(d.package ?? '', /Relay handoff package/);
});

test('registry: injectOrClipboard clipboard when bridge throws', async () => {
  const d = await injectOrClipboard({ to: 'codex' }, true, async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(d.mode, 'clipboard');
});

test('registry: injectOrClipboard passes through bridge decision', async () => {
  const d = await injectOrClipboard({ to: 'codex' }, true, async () => ({ mode: 'inject', response: 'ok' }));
  assert.equal(d.mode, 'inject');
  assert.equal(d.response, 'ok');
});

test('registry: gateInject mirrors capability tiers', () => {
  assert.equal(gateInject('full'), true);
  assert.equal(gateInject('observe-only'), false);
  assert.equal(gateInject('manual'), false);
});