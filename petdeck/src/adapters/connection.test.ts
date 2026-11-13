// RED tests for connection state machine (live / reconnecting / offline).
// Run: node --test src/adapters/connection.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextConnState, FAILS_TO_OFFLINE, type ConnSnapshot } from './connection.ts';

const init: ConnSnapshot = { state: 'reconnecting', fails: 0 };

test('conn: health ok -> live, fails reset', () => {
  assert.deepEqual(nextConnState(init, { type: 'health', ok: true }), { state: 'live', fails: 0 });
});

test('conn: first health fail -> reconnecting', () => {
  const live: ConnSnapshot = { state: 'live', fails: 0 };
  assert.deepEqual(nextConnState(live, { type: 'health', ok: false }), { state: 'reconnecting', fails: 1 });
});

test('conn: second consecutive health fail -> offline', () => {
  const r: ConnSnapshot = { state: 'reconnecting', fails: 1 };
  assert.deepEqual(nextConnState(r, { type: 'health', ok: false }), { state: 'offline', fails: 2 });
});

test('conn: offline fails capped, stays offline', () => {
  const o: ConnSnapshot = { state: 'offline', fails: 2 };
  assert.deepEqual(nextConnState(o, { type: 'health', ok: false }), { state: 'offline', fails: FAILS_TO_OFFLINE });
});

test('conn: offline + health ok -> live', () => {
  const o: ConnSnapshot = { state: 'offline', fails: 2 };
  assert.deepEqual(nextConnState(o, { type: 'health', ok: true }), { state: 'live', fails: 0 });
});

test('conn: live + sse error -> reconnecting', () => {
  const live: ConnSnapshot = { state: 'live', fails: 0 };
  assert.deepEqual(nextConnState(live, { type: 'sse', open: false }), { state: 'reconnecting', fails: 0 });
});

test('conn: offline + sse error stays offline', () => {
  const o: ConnSnapshot = { state: 'offline', fails: 2 };
  assert.deepEqual(nextConnState(o, { type: 'sse', open: false }), o);
});

test('conn: reconnecting + sse open -> live', () => {
  const r: ConnSnapshot = { state: 'reconnecting', fails: 1 };
  assert.deepEqual(nextConnState(r, { type: 'sse', open: true }), { state: 'live', fails: 0 });
});