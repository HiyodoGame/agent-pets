// RED tests: bridge access guard — only a well-formed, authorised POST reaches inject.
// Run: node --test server/bridge-security.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createApp, main } from './bridge.mjs';

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

// --- Task 2: default auth fails safe, configurable Origins, IPv6 Host, health flag ---

function withEnv(t, patch) {
  const saved = {};
  for (const k of Object.keys(patch)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  t.after(() => {
    for (const k of Object.keys(patch)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

function connectRefused(port) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1');
    sock.once('connect', () => { sock.destroy(); reject(new Error(`port ${port} is listening, but main() must not listen without a token`)); });
    sock.once('error', (e) => (e.code === 'ECONNREFUSED' ? resolve() : reject(e)));
  });
}

test('inject: token configured but header missing (no Origin) => 401, adapter not called', async () => {
  await withApp({ token: 'sekret' }, async ({ base, injectCalls }) => {
    const res = await fetch(`${base}/api/inject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: jsonBody });
    assert.equal(res.status, 401);
    assert.equal(injectCalls.length, 0);
  });
});

test('host header [::1]:port (bracketed IPv6 with port) is accepted', async () => {
  await withApp({}, async ({ port }) => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port, method: 'GET', path: '/api/health', headers: { Host: `[::1]:${port}` } },
        (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 200);
  });
});

test('health: authRequired true when token configured, and the token is never leaked', async () => {
  await withApp({ token: 'sekret' }, async ({ base }) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.authRequired, true);
    assert.equal(j.token, undefined);
    assert.equal(JSON.stringify(j).includes('sekret'), false, 'health body must not contain the token');
  });
});

test('health: authRequired false when token empty (createApp no-token security remains possible)', async () => {
  await withApp({}, async ({ base }) => {
    const j = await (await fetch(`${base}/api/health`)).json();
    assert.equal(j.authRequired, false);
  });
});

test('main: empty PETDECK_BRIDGE_TOKEN prints a config error and does not listen', async (t) => {
  const PORT = 45991;
  withEnv(t, { PETDECK_BRIDGE_TOKEN: undefined, PETDECK_BRIDGE_PORT: String(PORT) });
  delete process.env.PETDECK_BRIDGE_TOKEN;
  const errors = [];
  const origError = console.error;
  console.error = (msg) => errors.push(String(msg));
  let server = null;
  try { server = main(); }
  finally { console.error = origError; }
  if (server) { server.closeAllConnections?.(); server.close(); } // RED-phase cleanup only
  assert.equal(server, null, 'main() must return without a server when the token is missing');
  assert.ok(errors.some((m) => m.includes('PETDECK_BRIDGE_TOKEN')), 'config error must name PETDECK_BRIDGE_TOKEN');
  await connectRefused(PORT);
});

test('main: PETDECK_BRIDGE_ORIGINS merged with defaults (extra origin passes the origin guard)', async (t) => {
  withEnv(t, {
    PETDECK_BRIDGE_TOKEN: 'sekret',
    PETDECK_BRIDGE_ORIGINS: 'http://localhost:4173, https://petdeck.example ,',
    PETDECK_BRIDGE_PORT: '0',
  });
  // Hermetic: no real adapters (no home-dir observation) and no polling — the origin
  // decision is read from the 401/403 status before any adapter could run.
  const server = main({ adapters: [], startPoll: false });
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  await once(server, 'listening');
  const port = server.address().port;
  const post = (origin) => fetch(`http://127.0.0.1:${port}/api/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: jsonBody,
  });
  // No inject token on purpose: an accepted origin falls through to the 401 token check,
  // a rejected origin stops at 403 — so the status code distinguishes the origin decision
  // without ever reaching a real adapter.
  assert.equal((await post('http://localhost:4173')).status, 401, 'env-configured origin must be accepted');
  assert.equal((await post('http://localhost:5173')).status, 401, 'default origin must still be accepted');
  assert.equal((await post('http://evil.example')).status, 403, 'unknown origin must still be rejected');
});

// --- GET read endpoints: same Host+Origin discipline, token when configured ---
// 会话标题与最后消息只应暴露给受信任的前端 Origin；本机其它进程无 Origin 可伪造白名单。

test('GET /api/sessions: disallowed Origin => 403', async () => {
  await withApp({}, async ({ base }) => {
    const res = await fetch(`${base}/api/sessions`, { headers: { Origin: 'http://evil.example' } });
    assert.equal(res.status, 403);
  });
});

test('GET /api/sessions: allowed Origin, no token configured => 200', async () => {
  await withApp({}, async ({ base }) => {
    const res = await fetch(`${base}/api/sessions`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(res.status, 200);
  });
});

test('GET /api/sessions: token configured, header missing => 401 (local scripts must not read sessions)', async () => {
  await withApp({ token: 'sekret' }, async ({ base }) => {
    const res = await fetch(`${base}/api/sessions`, { headers: { Origin: 'http://localhost:5173' } });
    assert.equal(res.status, 401);
  });
});

test('GET /api/sessions: token configured, wrong token => 401, correct => 200', async () => {
  await withApp({ token: 'sekret' }, async ({ base }) => {
    const wrong = await fetch(`${base}/api/sessions`, { headers: { Origin: 'http://localhost:5173', 'X-Petdeck-Token': 'nope' } });
    assert.equal(wrong.status, 401);
    const ok = await fetch(`${base}/api/sessions`, { headers: { Origin: 'http://tauri.localhost', 'X-Petdeck-Token': 'sekret' } });
    assert.equal(ok.status, 200);
  });
});

test('GET /api/agents: same guard (correct token => 200, missing => 401)', async () => {
  await withApp({ token: 'sekret' }, async ({ base }) => {
    assert.equal((await fetch(`${base}/api/agents`, { headers: { Origin: 'http://tauri.localhost' } })).status, 401);
    assert.equal((await fetch(`${base}/api/agents`, { headers: { Origin: 'http://tauri.localhost', 'X-Petdeck-Token': 'sekret' } })).status, 200);
  });
});

test('GET /api/events (SSE): wrong token => 401, correct token via ?token= query => 200 stream', async () => {
  await withApp({ token: 'sekret' }, async ({ base }) => {
    const wrong = await fetch(`${base}/api/events`, { headers: { Origin: 'http://tauri.localhost' } });
    assert.equal(wrong.status, 401);
    const ok = await fetch(`${base}/api/events?token=sekret`, { headers: { Origin: 'http://tauri.localhost' } });
    assert.equal(ok.status, 200);
    await ok.body?.cancel();
  });
});

test('GET /api/health stays reachable without token (pre-auth connectivity probe only)', async () => {
  await withApp({ token: 'sekret' }, async ({ base }) => {
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
  });
});

test('main: desktop WebView origins accept correct token and reject wrong token', async (t) => {
  withEnv(t, {
    PETDECK_BRIDGE_TOKEN: 'sekret',
    PETDECK_BRIDGE_ORIGINS: undefined,
    PETDECK_BRIDGE_PORT: '0',
  });
  const { adapters, injectCalls } = fakeAdapters();
  const server = main({ adapters, startPoll: false });
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (token) => fetch(`${base}/api/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://tauri.localhost', 'X-Petdeck-Token': token },
    body: jsonBody,
  });
  assert.equal((await post('sekret')).status, 200);
  assert.equal(injectCalls.length, 1);
  assert.equal((await post('wrong')).status, 401);
  assert.equal(injectCalls.length, 1);
});
