// RED tests for frontend adapter pure logic (bus / registry).
// Run: node --test src/adapters/logic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from './bus.ts';
import { selectSource, gateInject } from './registry.ts';

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

test('registry: selectSource live only when bridge healthy', () => {
  assert.equal(selectSource(true), 'live');
  assert.equal(selectSource(false), 'mock');
});

test('registry: gateInject mirrors capability tiers', () => {
  assert.equal(gateInject('full'), true);
  assert.equal(gateInject('observe-only'), false);
  assert.equal(gateInject('manual'), false);
});