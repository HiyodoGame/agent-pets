// M5 W1 — bridge observability: health shape, guarded deep status, diagnostics export.
// Run: node --test server/bridge-health.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { inflateRawSync } from 'node:zlib';
import { createApp } from './bridge.mjs';

function fakeAdapters() {
  return [
    { id: 'opencode', name: 'opencode', tier: 'full', observe: async () => [], inject: async () => ({ ok: true }) },
    { id: 'cursor', name: 'Cursor', tier: 'observe-only', observe: async () => [], inject: async () => ({ ok: false }) },
  ];
}

function fakeProbe() {
  const calls = [];
  return {
    calls,
    list: async (entries, { deep } = {}) => {
      calls.push({ deep, ids: entries.map((e) => e.id) });
      return entries.map((e) => ({ ...e, detected: deep ? true : null, version: deep ? '1.2.3' : null }));
    },
  };
}

function fakeRuntime(dir) {
  return {
    statusSnapshot: () => ({
      startedAt: '2026-11-21T00:00:00.000Z', uptimeSec: 12, dataDir: dir, dbVersion: 4,
      maxConcurrent: 2, active: 0,
      counts: { total: 1, running: 0, queued: 1, review: 0, pending_merge: 0, needs_decision: 0 },
    }),
    getSettings: () => ({ maxConcurrent: 2, decisionTimeoutMinutes: 10, decisionSound: true }),
    getManagerSettings: () => ({ provider: 'openai', baseUrl: 'https://x', model: 'm', apiKeySet: true, apiKeySource: 'settings' }),
  };
}

async function withApp(t, { security = {}, runtime = fakeRuntime(os.tmpdir()) } = {}) {
  const probe = fakeProbe();
  const app = createApp({ adapters: fakeAdapters(), security, runtime, probe });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = 'http://127.0.0.1:' + app.address().port;
  t.after(() => { app.closeAllConnections?.(); app.close(); });
  return { base, probe };
}

const AUTH = { 'X-Petdeck-Token': 'sekret' };

test('health: version/node/adapters/status snapshot without deep probes', async (t) => {
  const { base, probe } = await withApp(t, { security: { token: 'sekret' } });
  const res = await fetch(base + '/api/health');
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.match(j.version, /^\d+\.\d+\.\d+$/);
  assert.match(j.node, /^v\d+/);
  assert.ok(j.startedAt);
  assert.equal(j.port, Number(new URL(base).port));
  assert.equal(j.authRequired, true);
  assert.equal(j.runtime.counts.queued, 1);
  assert.equal(j.dbVersion, 4);
  assert.equal(j.logDir, path.join(os.tmpdir(), 'logs'));
  const adapter = j.adapters.find((a) => a.id === 'opencode');
  assert.equal(adapter.tier, 'full');
  assert.equal(adapter.command, 'opencode');
  assert.equal(adapter.detected, null, 'non-deep health must not spawn probes');
  assert.equal(j.adapters.find((a) => a.id === 'cursor').command, null);
  assert.equal(probe.calls.every((c) => c.deep === false), true);
  assert.equal(JSON.stringify(j).includes('sekret'), false);
});

test('health survives a missing runtime (bridge before service init)', async (t) => {
  const { base } = await withApp(t, { runtime: null });
  const j = await (await fetch(base + '/api/health')).json();
  assert.equal(j.ok, true);
  assert.equal(j.runtime, null);
  assert.equal(j.dbVersion, null);
});

test('runtime status: token required, deep probes cached by the probe layer', async (t) => {
  const { base, probe } = await withApp(t, { security: { token: 'sekret' } });
  assert.equal((await fetch(base + '/api/runtime/status')).status, 401);
  const res = await fetch(base + '/api/runtime/status', { headers: AUTH });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.runtime.counts.total, 1);
  assert.equal(j.adapters.find((a) => a.id === 'opencode').detected, true);
  assert.equal(j.adapters.find((a) => a.id === 'opencode').version, '1.2.3');
  assert.equal(probe.calls.filter((c) => c.deep).length, 1);
});

test('diagnostics export: guarded POST returns a readable zip that leaks no token', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-bridge-diag-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { base } = await withApp(t, { security: { token: 'sekret' }, runtime: fakeRuntime(dir) });
  const url = base + '/api/diagnostics/export';
  const noToken = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(noToken.status, 401);
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH }, body: '{}' });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.ok(j.path && fs.existsSync(j.path), 'zip written to a real path');
  assert.ok(j.files.includes('summary.json'));
  assert.equal(j.files.some((f) => f.startsWith('logs/')), false, 'no log dir yet => no log entries');
  // Walk entries and inflate: the token must not appear anywhere in the package.
  const buf = fs.readFileSync(j.path);
  const eocd = buf.length - 22;
  let off = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  const texts = [];
  for (let i = 0; i < count; i += 1) {
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + csize);
    texts.push((method === 8 ? inflateRawSync(body) : body).toString('utf8'));
    off += 46 + nameLen + extraLen + commentLen;
  }
  const whole = texts.join('\n');
  assert.equal(whole.includes('sekret'), false, 'bridge token never written');
  assert.equal(whole.includes('"apiKey"'), false, 'api key field never written');
  t.after(() => fs.rmSync(path.dirname(j.path), { recursive: true, force: true }));
});

test('storage: guarded usage snapshot reports the runtime directories', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-bridge-storage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'runs', 'a'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'runs', 'a', 'events.jsonl'), 'x'.repeat(128));
  const { base } = await withApp(t, { security: { token: 'sekret' }, runtime: fakeRuntime(dir) });
  assert.equal((await fetch(base + '/api/storage')).status, 401);
  const res = await fetch(base + '/api/storage', { headers: AUTH });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.storage.dataDir, dir);
  assert.ok(j.storage.runsBytes >= 128);
  assert.equal(j.storage.runCount, 1);
  assert.equal(j.storage.runKeepDays, 30);
  assert.equal(JSON.stringify(j).includes('sekret'), false);
});

test('storage cleanup: guarded POST prunes transcripts and reports the outcome', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-bridge-clean-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const runs = path.join(dir, 'runs');
  fs.mkdirSync(path.join(runs, 'old-run'), { recursive: true });
  const oldFile = path.join(runs, 'old-run', 'events.jsonl');
  fs.writeFileSync(oldFile, '{"type":"x"}\n');
  const stale = new Date(Date.now() - 40 * 86_400_000);
  fs.utimesSync(oldFile, stale, stale);
  const fresh = path.join(runs, 'fresh-run');
  fs.mkdirSync(fresh, { recursive: true });
  fs.writeFileSync(path.join(fresh, 'events.jsonl'), '{"type":"y"}\n');
  const { base } = await withApp(t, { security: { token: 'sekret' }, runtime: fakeRuntime(dir) });
  const post = (body, headers = {}) => fetch(base + '/api/storage/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  assert.equal((await post({ days: 30 })).status, 401);
  const res = await post({ days: 30 }, AUTH);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.ok, true);
  assert.equal(j.days, 30);
  assert.equal(j.removed, 1);
  assert.equal(fs.existsSync(path.join(runs, 'old-run')), false);
  assert.equal(fs.existsSync(fresh), true);
});

test('storage: missing runtime degrades to 503 instead of throwing', async (t) => {
  const { base } = await withApp(t, { runtime: null });
  const res = await fetch(base + '/api/storage');
  assert.equal(res.status, 503);
});
