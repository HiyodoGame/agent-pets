// RED tests for SSE replay dedup (bus re-subscribe replays recent events with same id).
// Run: node --test src/adapters/event-dedup.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeduper } from './event-dedup.ts';

test('dedup: first sighting true, repeat false', () => {
  const d = createDeduper();
  assert.equal(d.seen('a'), true);
  assert.equal(d.seen('a'), false);
});

test('dedup: distinct ids independent', () => {
  const d = createDeduper();
  assert.equal(d.seen('a'), true);
  assert.equal(d.seen('b'), true);
  assert.equal(d.seen('a'), false);
});

test('dedup: FIFO eviction beyond cap', () => {
  const d = createDeduper(2);
  d.seen('a'); d.seen('b'); d.seen('c'); // a evicted
  assert.equal(d.seen('a'), true);
  assert.equal(d.seen('c'), false);
});