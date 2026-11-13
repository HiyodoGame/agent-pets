// RED tests for Flow4 tracking status derived from the SSE agent-event stream.
// Run: node --test src/adapters/relay-tracking.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTracking } from './relay-tracking.ts';
import type { RawAgentEvent } from './types.ts';

const ev = (agentId: string, type: string, id = 'x'): RawAgentEvent => ({ id, agentId, type, ts: 0 });

test('tracking: no events => sending', () => {
  assert.equal(deriveTracking([], 'opencode'), 'sending');
});

test('tracking: task_started => running', () => {
  assert.equal(deriveTracking([ev('opencode', 'task_started')], 'opencode'), 'running');
});

test('tracking: task_complete => done', () => {
  assert.equal(deriveTracking([ev('opencode', 'task_complete')], 'opencode'), 'done');
});

test('tracking: turn_aborted => stuck', () => {
  assert.equal(deriveTracking([ev('opencode', 'turn_aborted')], 'opencode'), 'stuck');
});

test('tracking: ignores other agents', () => {
  assert.equal(deriveTracking([ev('codex', 'task_complete')], 'opencode'), 'sending');
});

test('tracking: newest event wins', () => {
  const events = [ev('opencode', 'task_started', 'new'), ev('opencode', 'task_complete', 'old')];
  assert.equal(deriveTracking(events, 'opencode'), 'running');
});