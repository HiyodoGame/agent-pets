// RED tests for server adapter pure logic (parsers / tiers / bus).
// Run: node --test server/pure.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRollout } from './adapters/codex.mjs';
import { parseClaude } from './adapters/claude.mjs';
import { parseRun, mapServeStatus } from './adapters/opencode.mjs';
import { TIER, canInject, injectDecision, handoffPackage } from './tiers.mjs';
import { createBus, toPetEventType } from './bus.mjs';

const J = (o) => JSON.stringify(o);

test('codex parseRollout: task_complete wins status + lastMessage', () => {
  const lines = [
    J({ payload: { type: 'task_started', turn_id: 't1' } }),
    J({ payload: { type: 'agent_message', message: 'working' } }),
    J({ payload: { type: 'task_complete', last_agent_message: 'done pack', turn_id: 't1' } }),
  ];
  const r = parseRollout(lines);
  assert.equal(r.status, 'done');
  assert.equal(r.lastMessage, 'done pack');
  assert.equal(r.turn, 't1');
});

test('codex parseRollout: turn_aborted => stuck', () => {
  const r = parseRollout([J({ payload: { type: 'turn_aborted' } })]);
  assert.equal(r.status, 'stuck');
});

test('codex parseRollout: empty => unknown', () => {
  const r = parseRollout([]);
  assert.equal(r.status, 'unknown');
  assert.equal(r.lastMessage, '');
});

test('claude parseClaude: assistant text + cwd', () => {
  const lines = [
    J({ type: 'user', cwd: 'F:/proj', message: { content: 'hi' } }),
    J({ type: 'assistant', message: { content: [{ type: 'text', text: 'reply' }] } }),
  ];
  const r = parseClaude(lines);
  assert.equal(r.status, 'running');
  assert.equal(r.lastMessage, 'reply');
  assert.equal(r.cwd, 'F:/proj');
});

test('claude parseClaude: trailing user => waiting', () => {
  const r = parseClaude([J({ type: 'user', message: { content: 'q' } })]);
  assert.equal(r.status, 'waiting');
});

test('opencode parseRun: extracts text + sessionID', () => {
  const stdout = [J({ type: 'step' }), J({ type: 'text', part: { text: 'ok' }, sessionID: 'ses_1' })].join('\n');
  const r = parseRun(stdout);
  assert.equal(r.response, 'ok');
  assert.equal(r.sessionID, 'ses_1');
});

test('claude parseClaude: end_turn stop_reason => done', () => {
  const r = parseClaude([J({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'final' }] } })]);
  assert.equal(r.status, 'done');
});

test('claude parseClaude: result is_error => stuck', () => {
  const r = parseClaude([J({ type: 'result', is_error: true })]);
  assert.equal(r.status, 'stuck');
});

test('claude parseClaude: mid-turn tool_use stays running', () => {
  const r = parseClaude([J({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'hmm' }] } })]);
  assert.equal(r.status, 'running');
});

test('opencode mapServeStatus: only real signals, else unknown', () => {
  assert.equal(mapServeStatus({ status: 'busy' }), 'running');
  assert.equal(mapServeStatus({ status: 'idle' }), 'unknown');
  assert.equal(mapServeStatus({}), 'unknown');
});

test('tiers: capability gating', () => {
  assert.equal(TIER.codex, 'full');
  assert.equal(TIER.kimi, 'observe-only');
  assert.equal(canInject('full'), true);
  assert.equal(canInject('observe-only'), false);
  assert.equal(canInject('manual'), false);
});

test('tiers: injectDecision falls back to clipboard when not full', () => {
  const d = injectDecision('observe-only', { ok: true, response: 'x' }, { context: 'c', instruction: 'do it' });
  assert.equal(d.mode, 'clipboard');
  assert.ok(d.package.includes('c'));
  assert.ok(d.package.includes('do it'), 'clipboard handoff must preserve the instruction');
});

test('tiers: injectDecision uses inject when full + ok', () => {
  const d = injectDecision('full', { ok: true, response: 'x', sessionID: 'ses_1' });
  assert.equal(d.mode, 'inject');
  assert.equal(d.sessionID, 'ses_1');
});

test('tiers: injectDecision falls back when full but failed', () => {
  const d = injectDecision('full', { ok: false, response: '' }, { context: 'c', instruction: 'keep me' });
  assert.equal(d.mode, 'clipboard');
  assert.ok(d.package.includes('keep me'));
});

test('tiers: handoffPackage includes every provided field', () => {
  const p = handoffPackage({ from: 'codex', context: 'CTX', instruction: 'INS', artifacts: ['a.png', 'b.md'] });
  for (const needle of ['codex', 'CTX', 'INS', 'a.png', 'b.md']) assert.ok(p.includes(needle));
});

test('bus: normalize + replay + unsubscribe', () => {
  const bus = createBus();
  const seen = [];
  const un = bus.subscribe((e) => seen.push(e));
  bus.emit({ agentId: 'codex', type: 'task_complete', payload: { lastMessage: 'a' } });
  bus.emit({ agentId: 'codex', type: 'turn_aborted', payload: {} });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].agentId, 'codex');
  assert.ok(seen[0].id);
  un();
  bus.emit({ agentId: 'codex', type: 'task_started', payload: {} });
  assert.equal(seen.length, 2);
  // late subscriber gets replay
  const late = [];
  bus.subscribe((e) => late.push(e));
  assert.equal(late.length, 3);
});

test('bus: toPetEventType mapping', () => {
  assert.equal(toPetEventType('task_complete'), 'done');
  assert.equal(toPetEventType('turn_aborted'), 'stuck');
  assert.equal(toPetEventType('decision'), 'decision');
  assert.equal(toPetEventType('relay-ready'), 'relay-ready');
});