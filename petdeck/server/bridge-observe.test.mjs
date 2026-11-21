// M5 W6 — observation endpoints: aggregated sessions, adapter health, transcript
// preview, and the hard boundary that observed sessions never enter runtime tasks.
// Run: node --test server/bridge-observe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from './bridge.mjs';

const AUTH = { 'X-Petdeck-Token': 'sekret' };
const silent = { info() {}, warn() {}, error() {}, debug() {} };

function fakeRuntime() {
  return {
    statusSnapshot: () => ({ dataDir: os.tmpdir(), dbVersion: 4, counts: {} }),
    listTasks: () => [],
    listAgents: () => [],
  };
}

function fakeProbe() {
  return { list: async (entries, { deep } = {}) => entries.map((e) => ({ ...e, detected: deep ? true : null, version: null })) };
}

function observeAdapters(transcriptFile) {
  const row = {
    agent: 'cursor', source: 'cursor-transcript-jsonl', session: 's1', title: '修复登录',
    projectId: 'proj', projectName: 'Proj', status: 'done', lastMessage: '完成',
    turn: '', path: transcriptFile, updatedAt: 1700000000000,
  };
  return [
    { id: 'claude', name: 'Claude Code', tier: 'full', observe: async () => [{ agent: 'claude', source: 'x', session: 'full-session', status: 'running', cwd: '' }], inject: async () => ({ ok: true }) },
    { id: 'cursor', name: 'Cursor', tier: 'observe-only', observe: async () => [row], inject: async () => ({ ok: false }) },
    { id: 'dsh', name: 'DeepSeek Harness', tier: 'observe-only', observe: async () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); }, inject: async () => ({ ok: false }) },
  ];
}

async function withApp(t, adapters) {
  const app = createApp({ adapters, security: { token: 'sekret' }, runtime: fakeRuntime(), probe: fakeProbe(), logger: silent });
  await app.poll();
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = 'http://127.0.0.1:' + app.address().port;
  t.after(() => { app.closeAllConnections?.(); app.close(); });
  return { base, app };
}

function makeTranscript() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-bridge-observe-'));
  const file = path.join(dir, 's1.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: '<timestamp>x</timestamp><user_query>修登录</user_query>' }] } }),
    JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: '**已修复** [详情](https://x)' }] } }),
  ].join('\n'));
  return { dir, file };
}

test('observe sessions: observe-only rows with mapped state, project and adapter health', async (t) => {
  const { dir, file } = makeTranscript();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { base } = await withApp(t, observeAdapters(file));
  const res = await fetch(base + '/api/observe/sessions', { headers: AUTH });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.limit, 20);
  assert.equal(typeof body.generatedAt, 'number');
  assert.equal(body.sessions.length, 1, 'full-tier sessions must not leak into the observe surface');
  const session = body.sessions[0];
  assert.equal(session.agent, 'cursor');
  assert.equal(session.agentName, 'Cursor');
  assert.equal(session.session, 's1');
  assert.equal(session.title, '修复登录');
  assert.equal(session.project, 'Proj');
  assert.equal(session.state, 'idle');
  assert.equal(session.status, 'done');
  assert.equal(session.path, file);
  assert.equal(session.stale, false);

  const cursor = body.agents.find((a) => a.id === 'cursor');
  assert.equal(cursor.tier, 'observe-only');
  assert.equal(cursor.ok, true);
  assert.equal(cursor.okCount, 1);
  assert.equal(cursor.failCount, 0);
  assert.equal(cursor.rowCount, 1);
  assert.equal(cursor.lastWriteAt, 1700000000000);
  const dsh = body.agents.find((a) => a.id === 'dsh');
  assert.equal(dsh.ok, false);
  assert.equal(dsh.failCount, 1);
  assert.equal(dsh.lastError.code, 'EACCES');
  assert.match(dsh.lastError.message, /permission denied/);
  assert.equal(body.agents.some((a) => a.id === 'claude'), false, 'full adapters are not observe sources');
  assert.equal(JSON.stringify(body).includes('full-session'), false);
});

test('observe sessions: token is required and limit is clamped', async (t) => {
  const { dir, file } = makeTranscript();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { base } = await withApp(t, observeAdapters(file));
  assert.equal((await fetch(base + '/api/observe/sessions')).status, 401);
  const body = await (await fetch(base + '/api/observe/sessions?limit=999', { headers: AUTH })).json();
  assert.equal(body.limit, 50);
  const junk = await (await fetch(base + '/api/observe/sessions?limit=nope', { headers: AUTH })).json();
  assert.equal(junk.limit, 20);
});

test('observe transcript: sanitized plain text for registered session only', async (t) => {
  const { dir, file } = makeTranscript();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { base } = await withApp(t, observeAdapters(file));
  assert.equal((await fetch(base + '/api/observe/sessions/cursor/s1/transcript')).status, 401);
  const res = await fetch(base + '/api/observe/sessions/cursor/s1/transcript?limit=10', { headers: AUTH });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.agent, 'cursor');
  assert.equal(body.session, 's1');
  assert.equal(body.path, file);
  assert.deepEqual(body.lines, [
    { role: 'user', text: '修登录' },
    { role: 'assistant', text: '已修复 详情' },
  ]);
  assert.equal(JSON.stringify(body).includes('<timestamp>'), false);

  const missing = await fetch(base + '/api/observe/sessions/cursor/nope/transcript', { headers: AUTH });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'session not found');
});

test('observed sessions never appear in runtime tasks (board/accept/merge/report source)', async (t) => {
  const { dir, file } = makeTranscript();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { base } = await withApp(t, observeAdapters(file));
  const tasks = await (await fetch(base + '/api/runtime/tasks', { headers: AUTH })).json();
  assert.deepEqual(tasks.tasks, [], 'runtime tasks come from the DB only');
  const observed = await (await fetch(base + '/api/observe/sessions', { headers: AUTH })).json();
  assert.equal(observed.sessions.length, 1);
  assert.equal(JSON.stringify(tasks).includes('s1'), false);
});
