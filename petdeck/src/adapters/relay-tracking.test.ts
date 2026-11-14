// Flow4 tracking: attempt-scoped (agent + session + start time), never false 'done'.
// Run: node --test src/adapters/relay-tracking.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveTracking } from './relay-tracking.ts';
import type { RawAgentEvent } from './types.ts';

const ev = (agentId: string, type: string, id = 'x', extra: Partial<RawAgentEvent> = {}): RawAgentEvent =>
  ({ id, agentId, type, ts: 0, sessionId: '', ...extra });

test('tracking: no events => sending', () => {
  assert.equal(deriveTracking([], 'opencode'), 'sending');
});

test('tracking: attempt with empty sessionID is unconfirmed from the start (never a fake done)', () => {
  assert.equal(deriveTracking([], 'codex', { sessionId: '', startedAt: 200 }), 'unconfirmed');
});

test('tracking: attempt without session still reports running while executing', () => {
  const events = [ev('codex', 'task_started', 'n1', { ts: 300, sessionId: '' })];
  assert.equal(deriveTracking(events, 'codex', { sessionId: '', startedAt: 200 }), 'running');
});

test('tracking: task_started => running', () => {
  assert.equal(deriveTracking([ev('opencode', 'task_started')], 'opencode'), 'running');
});

test('tracking: correlatable task_complete => done', () => {
  const events = [ev('opencode', 'task_complete', 'c1', { sessionId: 'ses_1' })];
  assert.equal(deriveTracking(events, 'opencode', { sessionId: 'ses_1' }), 'done');
});

test('tracking: correlatable turn_aborted => stuck', () => {
  const events = [ev('opencode', 'turn_aborted', 'c1', { sessionId: 'ses_1' })];
  assert.equal(deriveTracking(events, 'opencode', { sessionId: 'ses_1' }), 'stuck');
});

test('tracking: completion without a session id => unconfirmed (never claim done)', () => {
  const events = [ev('codex', 'task_complete', 'c1', { sessionId: '' })];
  assert.equal(deriveTracking(events, 'codex'), 'unconfirmed');
});

test('tracking: ignores other agents', () => {
  assert.equal(deriveTracking([ev('codex', 'task_complete', 'x', { sessionId: 'ses_1' })], 'opencode', { sessionId: 'ses_1' }), 'sending');
});

test('tracking: history before send is excluded by startedAt', () => {
  const events = [ev('codex', 'task_complete', 'old', { ts: 100, sessionId: 'ses_1' })];
  assert.equal(deriveTracking(events, 'codex', { sessionId: 'ses_1', startedAt: 200 }), 'sending');
});

test('tracking: another session of the same agent cannot finish this attempt', () => {
  const events = [ev('codex', 'task_complete', 'other', { ts: 300, sessionId: 'ses_OTHER' })];
  assert.equal(deriveTracking(events, 'codex', { sessionId: 'ses_1', startedAt: 200 }), 'sending');
});

test('tracking: replayed completion for the target session still counts (ts at/after start)', () => {
  const events = [ev('opencode', 'task_complete', 're', { ts: 250, sessionId: 'ses_1' })];
  assert.equal(deriveTracking(events, 'opencode', { sessionId: 'ses_1', startedAt: 200 }), 'done');
});

test('tracking: newest scoped event wins (started after complete)', () => {
  const events = [ev('opencode', 'task_started', 'new', { ts: 300, sessionId: 'ses_1' }), ev('opencode', 'task_complete', 'old', { ts: 250, sessionId: 'ses_1' })];
  assert.equal(deriveTracking(events, 'opencode', { sessionId: 'ses_1', startedAt: 200 }), 'running');
});
