// RED tests: polling lifecycle — no overlapping server ticks, pruned lastStatus,
// and oversized bodies are drained so the keep-alive connection survives the 413.
// Run: node --test server/bridge-lifecycle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from './bridge.mjs';
import { createBus } from './bus.mjs';

function row(agent, session, status = 'running', lastMessage = 'm') {
  return { agent, session, status, lastMessage, turn: '' };
}

async function withApp(opts, fn) {
  const app = createApp(opts);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const port = app.address().port;
  try { await fn({ port, base: `http://127.0.0.1:${port}`, app }); }
  finally { app.closeAllConnections?.(); app.close(); }
}

// --- poll() must not overlap with itself (slow observe => second tick skipped) ---

test('poll: a second tick while the first is still observing is skipped', async () => {
  let observeCalls = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const adapters = [{
    id: 'codex', name: 'Codex',
    observe: () => { observeCalls++; return gate.then(() => [row('codex', 's1')]); },
    inject: () => Promise.resolve({ ok: true, response: 'R', sessionID: 's' }),
  }];
  const app = createApp({ adapters, bus: createBus(100) });
  const p1 = app.poll();
  const p2 = app.poll(); // must be skipped while p1 is in flight
  release([row('codex', 's1')]);
  await Promise.all([p1, p2]);
  assert.equal(observeCalls, 1, 'overlapping tick must not run observe twice');
  app.closeAllConnections?.(); app.close();
});

test('poll: after the in-flight tick finishes, the next tick runs again', async () => {
  let observeCalls = 0;
  const adapters = [{
    id: 'codex', name: 'Codex',
    observe: () => { observeCalls++; return Promise.resolve([row('codex', 's1')]); },
    inject: () => Promise.resolve({ ok: true, response: 'R', sessionID: 's' }),
  }];
  const app = createApp({ adapters, bus: createBus(100) });
  await app.poll();
  await app.poll();
  assert.equal(observeCalls, 2);
  app.closeAllConnections?.(); app.close();
});

test('poll: cold start seeds existing statuses without emitting notification events', async () => {
  const bus = createBus(100);
  const rows = [
    row('claude', 'running.jsonl', 'running'),
    row('claude', 'done.jsonl', 'done'),
    row('claude', 'waiting.jsonl', 'waiting'),
  ];
  const adapters = [{ id: 'claude', name: 'Claude', observe: () => Promise.resolve(rows), inject: () => Promise.resolve({ ok: true }) }];
  const app = createApp({ adapters, bus });
  await app.poll();
  assert.deepEqual(bus.snapshot().filter((e) => e.agentId === 'claude'), [], 'initial observations are baselines, not transitions');
  rows[0].status = 'done';
  await app.poll();
  const transitions = bus.snapshot().filter((e) => e.agentId === 'claude');
  assert.equal(transitions.length, 1, 'only the real post-start transition is emitted');
  assert.equal(transitions[0].sessionId, 'running.jsonl');
  assert.equal(transitions[0].petType, 'done');
  app.closeAllConnections?.(); app.close();
});

// --- lastStatus pruning: a session that vanished and reappears re-emits its status event ---

test('poll: lastStatus drops vanished sessions, so a returning session re-emits its event', async () => {
  const events = [];
  const bus = createBus(100);
  bus.subscribe((e) => events.push(e));
  let rows = [row('codex', 's1')];
  const adapters = [{ id: 'codex', name: 'Codex', observe: () => Promise.resolve(rows), inject: () => Promise.resolve({ ok: true }) }];
  const app = createApp({ adapters, bus });
  await app.poll();
  assert.equal(events.some((e) => e.agentId === 'codex'), false, 'cold start only seeds lastStatus');
  events.length = 0;
  rows = []; // session vanishes (live empty, no last-good)
  await app.poll();
  assert.equal(events.filter((e) => e.type === 'task_started').length, 0, 'vanish must not emit');
  events.length = 0;
  rows = [row('codex', 's1')]; // same status returns
  await app.poll();
  assert.ok(events.some((e) => e.type === 'task_started' && e.sessionId === 's1'),
    'returning session must re-emit task_started (lastStatus was pruned)');
  app.closeAllConnections?.(); app.close();
});

// --- lifecycle pet events: running starts once, unknown stays silent, payload retains identity ---

test('poll: running emits one attributed started event and unknown never poses as started', async () => {
  const bus = createBus(100);
  let rows = [];
  const adapters = [{ id: 'codex', name: 'Codex', observe: () => Promise.resolve(rows), inject: () => Promise.resolve({ ok: true }) }];
  const app = createApp({ adapters, bus });
  await app.poll();
  rows = [{
    ...row('codex', 's1', 'running', 'working'),
    title: 'Fix login', cwd: 'F:/project', projectId: 'F:/project', projectName: 'project', host: 'build-box',
  }];
  await app.poll();
  const started = bus.snapshot().find((e) => e.agentId === 'codex');
  assert.equal(started.type, 'task_started');
  assert.equal(started.petType, 'started');
  assert.equal(started.payload.session.agent, 'codex');
  assert.equal(started.payload.session.session, 's1');
  assert.equal(started.payload.session.title, 'Fix login');
  assert.equal(started.payload.session.cwd, 'F:/project');
  assert.equal(started.payload.session.projectId, 'F:/project');
  assert.equal(started.payload.session.projectName, 'project');
  assert.equal(started.payload.session.host, 'build-box');
  assert.equal(started.payload.session.lastMessage, 'working');
  assert.equal(started.payload.session.stale, false);
  assert.equal(typeof started.payload.session.lastSeen, 'number');
  const count = bus.snapshot().length;
  await app.poll();
  assert.equal(bus.snapshot().length, count, 'steady running must not notify again');
  rows = [row('codex', 's1', 'unknown', '')];
  await app.poll();
  const unknown = bus.snapshot().filter((e) => e.agentId === 'codex').at(-1);
  assert.equal(unknown.type, 'status_unknown');
  assert.equal(unknown.petType, null);
  app.closeAllConnections?.(); app.close();
});

test('poll: each lifecycle transition emits exactly one pet event', async () => {
  const bus = createBus(100);
  let status = 'unknown';
  const adapters = [{
    id: 'claude', name: 'Claude',
    observe: () => Promise.resolve([row('claude', 's1', status)]),
    inject: () => Promise.resolve({ ok: true }),
  }];
  const app = createApp({ adapters, bus });
  await app.poll();
  const seen = [];
  for (const next of ['running', 'waiting', 'running', 'done', 'stuck']) {
    status = next;
    await app.poll();
    seen.push(bus.snapshot().filter((e) => e.agentId === 'claude').at(-1)?.petType ?? null);
  }
  assert.deepEqual(seen, ['started', 'decision', 'started', 'done', 'stuck']);
  app.closeAllConnections?.(); app.close();
});

// --- oversized body: rejected fast AND the rest of the body is drained (keep-alive reusable) ---

test('inject: oversized body => 413 and the connection survives for the next request', async () => {
  await withApp({ security: { maxBodyBytes: 16 } }, async ({ base }) => {
    const agent = new http.Agent({ keepAlive: true });
    const post = () => new Promise((resolve, reject) => {
      const req = http.request(`${base}/api/inject`, {
        method: 'POST', agent,
        headers: { 'Content-Type': 'application/json', 'Content-Length': 200 },
      }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      req.end('x'.repeat(200));
    });
    const first = await post();
    assert.equal(first, 413);
    // Same keep-alive connection must still answer the next request — the leftover
    // body bytes were drained, not left to corrupt the pipelined follow-up.
    const second = await new Promise((resolve, reject) => {
      const req = http.request(`${base}/api/health`, { agent }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(second, 200);
    agent.destroy();
  });
});

// --- slow observe must not stack up under startPolling's interval ---

test('startPolling: slow tick is not re-entered by the interval', async (t) => {
  const { startPolling } = await import('./bridge.mjs');
  let active = 0;
  let maxActive = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const adapters = [{
    id: 'codex', name: 'Codex',
    observe: () => {
      active++;
      maxActive = Math.max(maxActive, active);
      return gate.then(() => { active--; return []; });
    },
    inject: () => Promise.resolve({ ok: true }),
  }];
  const app = createApp({ adapters, bus: createBus(100) });
  const origError = console.error;
  console.error = () => {};
  t.after(() => { console.error = origError; });
  const timer = startPolling(app, 5);
  await new Promise((r) => setTimeout(r, 30));
  release([]);
  await new Promise((r) => setTimeout(r, 20));
  clearInterval(timer);
  assert.equal(maxActive, 1, 'interval ticks must never overlap an in-flight observe');
  app.closeAllConnections?.(); app.close();
});

// --- Task 7: inject 故障显式化 —— 500 带 reason；日志只含 adapter id / allowlist name/code / 结构化类别码 ---
// review 修复：thrown e.message 与 stderr 摘要都可能回显 payload —— 单行化/截断不是脱敏。
// 日志绝不携带任意文本（消息/摘要），name/code 仅白名单结构化值可入日志，其余一律 'unknown'
// （adapter 抛出的 name/code 是自由文本，可能回显 payload），只保留结构化类别（timeout/spawn/exit）。

test('inject: adapter throw => 500 with explicit ok:false + reason bridge-error', async () => {
  await withApp({ adapters: [{ id: 'codex', name: 'Codex', observe: () => [], inject: () => Promise.reject(new Error('boom')) }] }, async ({ base }) => {
    const res = await fetch(`${base}/api/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'codex', context: 'TOP_SECRET_CTX', instruction: 'TOP_SECRET_INS' }),
    });
    assert.equal(res.status, 500);
    const j = await res.json();
    assert.equal(j.ok, false);
    assert.equal(j.reason, 'bridge-error');
  });
});

test('inject: failure log keeps adapter id + allowlisted error name/code, but never free text', async () => {
  const lines = [];
  const logger = { error: (...a) => lines.push(a.join(' ')) };
  // 消息体与 code 均回显 payload —— 这是真实风险场景：CLI 把 prompt 写进抛错文本/code
  const boom = new Error('failed to run prompt TOP_SECRET_INS with context TOP_SECRET_CTX');
  boom.code = 'FAKE_ENOENT';
  const adapters = [{ id: 'codex', name: 'Codex', observe: () => [], inject: () => Promise.reject(boom) }];
  await withApp({ adapters, bus: createBus(10), logger }, async ({ base }) => {
    await fetch(`${base}/api/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'codex', context: 'TOP_SECRET_CTX', instruction: 'TOP_SECRET_INS' }),
    });
  });
  const line = lines.join('\n');
  assert.ok(line.includes('codex'), 'log must name the adapter');
  assert.ok(line.includes('Error'), 'log must name the (allowlisted) error name');
  assert.ok(!line.includes('FAKE_ENOENT'), 'non-allowlisted free-text code must collapse to the unknown constant');
  assert.ok(line.includes('code=unknown'), 'non-allowlisted code logged as unknown');
  assert.ok(!line.includes('failed to run prompt'), 'log must never carry the raw error message');
  assert.ok(!line.includes('TOP_SECRET_CTX'), 'log must never contain context');
  assert.ok(!line.includes('TOP_SECRET_INS'), 'log must never contain instruction');
});

test('inject: CLI refusal => clipboard decision with fallbackReason cli + structured code in log', async () => {
  const lines = [];
  const logger = { error: (...a) => lines.push(a.join(' ')) };
  const adapters = [{
    id: 'codex', name: 'Codex', tier: 'full',
    observe: () => [],
    inject: () => Promise.resolve({ ok: false, response: '', summary: 'exit:1' }),
  }];
  await withApp({ adapters, bus: createBus(10), logger }, async ({ base }) => {
    const res = await fetch(`${base}/api/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'codex', context: 'TOP_SECRET_CTX', instruction: 'TOP_SECRET_INS' }),
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.mode, 'clipboard');
    assert.equal(j.fallbackReason, 'cli');
  });
  const line = lines.join('\n');
  assert.ok(line.includes('codex'), 'log must name the adapter');
  assert.ok(line.includes('cli'), 'log must name the cli category');
  assert.ok(line.includes('exit:1'), 'log may carry the structured outcome code');
  assert.ok(!line.includes('TOP_SECRET_CTX'));
  assert.ok(!line.includes('TOP_SECRET_INS'));
});

test('inject: a free-text summary echoing the payload is never logged (not content-sanitized — excluded)', async () => {
  const lines = [];
  const logger = { error: (...a) => lines.push(a.join(' ')) };
  const adapters = [{
    id: 'codex', name: 'Codex', tier: 'full',
    observe: () => [],
    // 恶意/异常 adapter：summary 里塞了自由文本（含 payload 回显）
    inject: () => Promise.resolve({ ok: false, response: '', summary: 'usage: codex exec TOP_SECRET_INS [--ctx TOP_SECRET_CTX]' }),
  }];
  await withApp({ adapters, bus: createBus(10), logger }, async ({ base }) => {
    await fetch(`${base}/api/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'codex', context: 'TOP_SECRET_CTX', instruction: 'TOP_SECRET_INS' }),
    });
  });
  const line = lines.join('\n');
  assert.ok(line.includes('codex'));
  assert.ok(line.includes('cli'), 'the diagnostic category is preserved');
  assert.ok(!line.includes('TOP_SECRET_CTX'), 'free-text summary must not be logged at all');
  assert.ok(!line.includes('TOP_SECRET_INS'));
  assert.ok(!line.includes('usage: codex exec'), 'arbitrary summary text is dropped, not truncated');
});

test('inject: JSON null and other non-object bodies return 400 without hanging or injecting', async () => {
  let injections = 0;
  const adapters = [{ id: 'codex', name: 'Codex', observe: () => [], inject: () => { injections++; return { ok: true }; } }];
  await withApp({ adapters, logger: { error() {} } }, async ({ base }) => {
    for (const body of ['null', '[]', '"text"', '42', 'true']) {
      const res = await fetch(`${base}/api/inject`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      assert.equal(res.status, 400, body);
      assert.deepEqual(await res.json(), { ok: false, error: 'json object required' });
    }
    assert.equal(injections, 0);
  });
});

test('runtime writes: JSON null is a completed 400 response, not an error sentinel', async () => {
  await withApp({ runtime: { registerProject() { throw new Error('must not run'); } }, logger: { error() {} } }, async ({ base }) => {
    const res = await fetch(`${base}/api/runtime/projects`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null',
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'json object required');
  });
});

test('request boundary: an unexpected async route failure resolves as 500', async () => {
  await withApp({ probe: { list: async () => { throw new Error('probe exploded'); } }, logger: { error() {} } }, async ({ base }) => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { ok: false, error: 'request failed' });
  });
});

test('inject: tier fallback decision carries fallbackReason tier and logs nothing sensitive', async () => {
  const adapters = [{
    id: 'kimi', name: 'kimi work', tier: 'observe-only',
    observe: () => [],
    inject: () => Promise.resolve({ ok: false, response: '' }),
  }];
  await withApp({ adapters, security: {}, bus: createBus(10) }, async ({ base }) => {
    const res = await fetch(`${base}/api/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'kimi', context: 'c', instruction: 'i' }),
    });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.mode, 'clipboard');
    assert.equal(j.fallbackReason, 'tier');
  });
});
