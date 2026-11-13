// RED tests for pollOnce freshness merge (bridge-authoritative partial sync).
// Run: node --test server/freshness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollOnce } from './freshness.mjs';

const ok = (id, rows) => ({ id, observe: () => rows });
const down = (id) => ({ id, observe: () => { throw new Error('source down'); } });
const row = (agent, session, status = 'running') => ({ agent, source: 'test', session, status, lastMessage: 'm' });

test('pollOnce: success marks rows fresh and records lastGood', async () => {
  const r = await pollOnce([ok('codex', [row('codex', 's1')])], new Map(), 1000);
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].stale, false);
  assert.equal(r.sessions[0].lastSeen, 1000);
  assert.deepEqual(r.sources.codex, { ok: true, lastSeen: 1000 });
  assert.deepEqual(r.lastGood.get('codex'), { at: 1000, rows: [row('codex', 's1')] });
});

test('pollOnce: failure after success keeps last rows as stale', async () => {
  const first = await pollOnce([ok('opencode', [row('opencode', 's1', 'done')])], new Map(), 1000);
  const second = await pollOnce([down('opencode')], first.lastGood, 6000);
  assert.equal(second.sessions.length, 1);
  assert.equal(second.sessions[0].stale, true);
  assert.equal(second.sessions[0].lastSeen, 1000);
  assert.equal(second.sessions[0].status, 'done');
  assert.deepEqual(second.sources.opencode, { ok: false, lastSeen: 1000 });
});

test('pollOnce: failure without prior success yields no rows', async () => {
  const r = await pollOnce([down('kimi')], new Map(), 1000);
  assert.equal(r.sessions.length, 0);
  assert.deepEqual(r.sources.kimi, { ok: false, lastSeen: null });
});

test('pollOnce: partial failure keeps healthy source fresh', async () => {
  const first = await pollOnce([ok('codex', [row('codex', 's1')]), ok('opencode', [row('opencode', 's2')])], new Map(), 1000);
  const second = await pollOnce([ok('codex', [row('codex', 's1')]), down('opencode')], first.lastGood, 6000);
  const byAgent = Object.fromEntries(second.sessions.map((r) => [r.agent, r]));
  assert.equal(byAgent.codex.stale, false);
  assert.equal(byAgent.codex.lastSeen, 6000);
  assert.equal(byAgent.opencode.stale, true);
  assert.equal(byAgent.opencode.lastSeen, 1000);
});

test('pollOnce: key includes stale flag but not lastSeen timestamp', async () => {
  const a = await pollOnce([ok('codex', [row('codex', 's1')])], new Map(), 1000);
  const b = await pollOnce([ok('codex', [row('codex', 's1')])], a.lastGood, 9000);
  assert.equal(a.key, b.key); // fresh->fresh, only lastSeen differs => no emit
  const c = await pollOnce([down('codex')], b.lastGood, 14000);
  assert.notEqual(b.key, c.key); // fresh->stale => must emit
});

test('pollOnce: recovery flips stale back to fresh', async () => {
  const first = await pollOnce([ok('opencode', [row('opencode', 's1')])], new Map(), 1000);
  const second = await pollOnce([down('opencode')], first.lastGood, 6000);
  const third = await pollOnce([ok('opencode', [row('opencode', 's1')])], second.lastGood, 11000);
  assert.equal(third.sessions[0].stale, false);
  assert.equal(third.sources.opencode.ok, true);
  assert.notEqual(second.key, third.key);
});

test('pollOnce: async observe is awaited', async () => {
  const a = { id: 'x', observe: async () => [row('x', 's1')] };
  const r = await pollOnce([a], new Map(), 1000);
  assert.equal(r.sessions.length, 1);
});