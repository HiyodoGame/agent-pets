// RED tests: bridge access guard — only a well-formed, authorised POST reaches inject.
// Run: node --test server/bridge-security.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from './bridge.mjs';

function fakeAdapters() {
  const injectCalls = [];
  const adapters = [{
    id: 'codex', name: 'Codex', tier: 'full',
    observe: () => [],
    inject: (p) => { injectCalls.push(p); return Promise.resolve({ ok: true, response: 'R', sessionID: 's' }); },
  }];
  return { adapters, injectCalls };
}

async function withApp(security, fn) {
  const { adapters, injectCalls } = fakeAdapters();
  const app = createApp({ adapters, security });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const port = app.address().port;
  try { await fn({ port, injectCalls, base: `http://127.0.0.1:${port}` }); }
  finally { app.closeAllConnections?.(); app.close(); }
}

const jsonBody = JSON.stringify({ to: 'codex', context: 'c', instruction: 'i' });
const okPost = (base, over = {}) => fetch(`${base}/api/inject`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173', ...(over.headers || {}) },
  body: over.body ?? jsonBody,
});

test('inject: allowed host+origin+json+token reaches adapter once', async () => {
  await withApp({ token: 'sekret' }, async ({ base, injectCalls }) => {
    const res = await okPost(base, { headers: { 'X-Petdeck-Token': 'sekret' } });
    assert.equal(res.status, 200);
    assert.equal(injectCalls.length, 1);
  });
});

test('inject: wrong token => 401, adapter not called', async () => {
  await withApp({ token: 'sekret' }, async ({ base, injectCalls }) => {
    const res = await okPost(base, { headers: { 'X-Petdeck-Token': 'nope' } });
    assert.equal(res.status, 401);
    assert.equal(injectCalls.length, 0);
  });
});

test('inject: disallowed Origin => 403, adapter not called', async () => {
  await withApp({}, async ({ base, injectCalls }) => {
    const res = await okPost(base, { headers: { Origin: 'http://evil.example' } });
    assert.equal(res.status, 403);
    assert.equal(injectCalls.length, 0);
  });
});

test('inject: non-json content-type (simple request) => 415, adapter not called', async () => {
  await withApp({}, async ({ base, injectCalls }) => {
    const res = await fetch(`${base}/api/inject`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: jsonBody });
    assert.equal(res.status, 415);
    assert.equal(injectCalls.length, 0);
  });
});

test('inject: oversized body => 413', async () => {
  await withApp({ maxBodyBytes: 16 }, async ({ base, injectCalls }) => {
    const res = await okPost(base, { body: 'x'.repeat(200) });
    assert.equal(res.status, 413);
    assert.equal(injectCalls.length, 0);
  });
});

test('host header with external hostname => 403 (DNS-rebinding guard)', async () => {
  await withApp({}, async ({ port, injectCalls }) => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method: 'POST', path: '/api/inject', headers: { 'Content-Type': 'application/json', Host: 'attacker.example' } },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); },
      );
      req.on('error', reject);
      req.end(jsonBody);
    });
    assert.equal(status, 403);
    assert.equal(injectCalls.length, 0);
  });
});

test('health GET remains reachable from the frontend', async () => {
  await withApp({ token: 'sekret' }, async ({ base }) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.ok, true);
  });
});
