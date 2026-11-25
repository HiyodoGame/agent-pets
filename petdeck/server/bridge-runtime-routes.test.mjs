// Runtime API routes on the bridge: auth, method guards, payload handling and
// RuntimeError mapping. The runtime is a fake — this covers the HTTP wiring that
// the service-level and lifecycle tests do not touch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './bridge.mjs';
import { RuntimeError } from './runtime/service.mjs';

const AUTH = { 'X-Petdeck-Token': 'sekret' };

function fakeAdapters() {
  return [
    { id: 'opencode', name: 'opencode', tier: 'full', observe: async () => [], inject: async () => ({ ok: true }) },
  ];
}

const probe = {
  list: async (entries) => entries.map((entry) => ({ ...entry, detected: false, version: null })),
};

function fakeRuntime(overrides = {}) {
  const calls = [];
  return {
    calls,
    statusSnapshot: () => null,
    listAgents: () => [{ id: 'opencode', name: 'opencode', tier: 'full' }],
    getSettings: () => ({ maxConcurrent: 2 }),
    updateSettings: (payload) => { calls.push(['updateSettings', payload]); return { maxConcurrent: payload.maxConcurrent }; },
    getManagerSettings: () => ({ provider: 'openai', apiKeySet: true }),
    updateManagerSettings: (payload) => { calls.push(['updateManagerSettings', payload]); return { provider: payload.provider }; },
    testManager: async () => { calls.push(['testManager']); return { model: 'test-model' }; },
    listManagerMessages: ({ limit }) => { calls.push(['listManagerMessages', limit]); return [{ id: 'm1' }]; },
    sendManagerMessage: async ({ content, projectId }) => { calls.push(['sendManagerMessage', content, projectId]); return { message: { id: 'm2' } }; },
    listProposals: (status) => { calls.push(['listProposals', status]); return [{ id: 'p1', status }]; },
    confirmProposal: async (id, options) => { calls.push(['confirmProposal', id, options]); return { tasks: [{ id: 't1' }] }; },
    rejectProposal: (id, options) => { calls.push(['rejectProposal', id, options]); return { id, status: 'rejected' }; },
    updateProposal: (id, payload) => { calls.push(['updateProposal', id, payload]); return { id, title: payload.title }; },
    generateDailyReport: async (options) => { calls.push(['generateDailyReport', options]); return { id: 'r1' }; },
    listReports: ({ projectId, limit }) => { calls.push(['listReports', projectId, limit]); return [{ id: 'r1' }]; },
    getReport: (id) => { calls.push(['getReport', id]); return { id, body: 'report' }; },
    listDecisions: () => [{ id: 'd1' }],
    answerDecision: async (id, payload) => { calls.push(['answerDecision', id, payload]); return { accepted: true }; },
    mergePreviewForTask: async (taskId) => { calls.push(['mergePreviewForTask', taskId]); return { taskId, ready: true }; },
    ...overrides,
  };
}

async function withApp(t, runtime = fakeRuntime()) {
  const app = createApp({
    adapters: fakeAdapters(),
    security: { token: 'sekret' },
    runtime,
    probe,
    logger: { error: () => {} },
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = 'http://127.0.0.1:' + app.address().port;
  t.after(() => { app.closeAllConnections?.(); app.close(); });
  return { base, runtime };
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...AUTH },
  body: JSON.stringify(body),
});

test('runtime routes: every read endpoint requires the token', async (t) => {
  const { base } = await withApp(t);
  const reads = [
    '/api/runtime/agents',
    '/api/runtime/settings',
    '/api/runtime/manager/settings',
    '/api/runtime/manager/messages',
    '/api/runtime/proposals',
    '/api/runtime/reports',
    '/api/runtime/reports/r1',
    '/api/runtime/decisions',
    '/api/runtime/tasks/t1/merge-preview',
  ];
  for (const path of reads) {
    const res = await fetch(base + path);
    assert.equal(res.status, 401, `${path} must be guarded`);
  }
});

test('runtime routes: missing runtime degrades to 503 instead of throwing', async (t) => {
  const { base } = await withApp(t, null);
  assert.equal((await fetch(base + '/api/runtime/agents', { headers: AUTH })).status, 503);
  assert.equal((await fetch(base + '/api/runtime/settings', { headers: AUTH })).status, 503);
  const report = await fetch(base + '/api/runtime/reports/generate', json('POST', {}));
  assert.equal(report.status, 503);
});

test('agents: list and method guard', async (t) => {
  const { base } = await withApp(t);
  const res = await fetch(base + '/api/runtime/agents', { headers: AUTH });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.agents[0].id, 'opencode');
  assert.equal((await fetch(base + '/api/runtime/agents', { method: 'POST', headers: AUTH })).status, 405);
  assert.equal((await fetch(base + '/api/runtime/not-a-route', { headers: AUTH })).status, 404);
  assert.equal((await fetch(base + '/api/runtime/tasks', { method: 'PUT', headers: AUTH })).status, 405);
});

test('settings: GET, PUT and payload validation', async (t) => {
  const { base, runtime } = await withApp(t);
  const get = await fetch(base + '/api/runtime/settings', { headers: AUTH });
  assert.equal(get.status, 200);
  assert.equal((await get.json()).settings.maxConcurrent, 2);

  const put = await fetch(base + '/api/runtime/settings', json('PUT', { maxConcurrent: 4 }));
  assert.equal(put.status, 200);
  assert.equal((await put.json()).settings.maxConcurrent, 4);
  assert.deepEqual(runtime.calls.at(-1), ['updateSettings', { maxConcurrent: 4 }]);

  const wrongType = await fetch(base + '/api/runtime/settings', {
    method: 'PUT', headers: { 'Content-Type': 'text/plain', ...AUTH }, body: 'x',
  });
  assert.equal(wrongType.status, 415);

  const badJson = await fetch(base + '/api/runtime/settings', {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...AUTH }, body: '{oops',
  });
  assert.equal(badJson.status, 400);

  const arrayBody = await fetch(base + '/api/runtime/settings', json('PUT', [1, 2]));
  assert.equal(arrayBody.status, 400);
  assert.equal((await fetch(base + '/api/runtime/settings', { method: 'DELETE', headers: AUTH })).status, 405);
});

test('settings: RuntimeError keeps its code/status, unknown errors stay generic', async (t) => {
  const failing = new RuntimeError('TASK_RUNNING', 'task already running', 409);
  const { base } = await withApp(t, fakeRuntime({ updateSettings: () => { throw failing; } }));
  const res = await fetch(base + '/api/runtime/settings', json('PUT', { maxConcurrent: 9 }));
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error, 'TASK_RUNNING');
  assert.equal(body.message, 'task already running');

  const { base: base2 } = await withApp(t, fakeRuntime({ updateSettings: () => { throw new Error('boom'); } }));
  const res2 = await fetch(base2 + '/api/runtime/settings', json('PUT', { maxConcurrent: 9 }));
  assert.equal(res2.status, 500);
  assert.deepEqual(await res2.json(), { ok: false, error: 'runtime error' });
});

test('manager: settings, connection test and messages', async (t) => {
  const { base, runtime } = await withApp(t);
  const settings = await fetch(base + '/api/runtime/manager/settings', { headers: AUTH });
  assert.equal((await settings.json()).manager.provider, 'openai');

  const put = await fetch(base + '/api/runtime/manager/settings', json('PUT', { provider: 'ollama' }));
  assert.equal(put.status, 200);
  assert.equal((await put.json()).manager.provider, 'ollama');

  const testRes = await fetch(base + '/api/runtime/manager/test', json('POST', {}));
  assert.equal(testRes.status, 200);
  assert.equal((await testRes.json()).model, 'test-model');

  const list = await fetch(base + '/api/runtime/manager/messages?limit=9999', { headers: AUTH });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).messages.length, 1);
  assert.deepEqual(runtime.calls.find((c) => c[0] === 'listManagerMessages'), ['listManagerMessages', 500]);

  await fetch(base + '/api/runtime/manager/messages?limit=nope', { headers: AUTH });
  assert.deepEqual(runtime.calls.filter((c) => c[0] === 'listManagerMessages').at(-1), ['listManagerMessages', 100]);

  const send = await fetch(base + '/api/runtime/manager/messages', json('POST', { content: 'hi', projectId: 'proj-1' }));
  assert.equal(send.status, 200);
  assert.deepEqual(runtime.calls.at(-1), ['sendManagerMessage', 'hi', 'proj-1']);
});

test('proposals: status filter, confirm/reject/update and malformed ids', async (t) => {
  const { base, runtime } = await withApp(t);
  const list = await fetch(base + '/api/runtime/proposals', { headers: AUTH });
  assert.equal((await list.json()).proposals[0].status, 'pending');
  await fetch(base + '/api/runtime/proposals?status=accepted', { headers: AUTH });
  assert.deepEqual(runtime.calls.filter((c) => c[0] === 'listProposals').at(-1), ['listProposals', 'accepted']);

  const confirm = await fetch(base + '/api/runtime/proposals/p1/confirm', json('POST', { start: false }));
  assert.equal(confirm.status, 200);
  assert.equal((await confirm.json()).tasks[0].id, 't1');
  assert.deepEqual(runtime.calls.at(-1), ['confirmProposal', 'p1', { start: false }]);

  const reject = await fetch(base + '/api/runtime/proposals/p1/reject', json('POST', { reason: 'not now' }));
  assert.equal(reject.status, 200);
  assert.deepEqual(runtime.calls.at(-1), ['rejectProposal', 'p1', { reason: 'not now' }]);

  const update = await fetch(base + '/api/runtime/proposals/p1/update', json('POST', { title: 'edited' }));
  assert.equal(update.status, 200);
  assert.equal((await update.json()).proposal.title, 'edited');

  const malformed = await fetch(base + '/api/runtime/proposals/%E0%A4%A/confirm', json('POST', {}));
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, 'invalid proposal id');

  const wrongMethod = await fetch(base + '/api/runtime/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH }, body: '{}' });
  assert.equal(wrongMethod.status, 405);
});

test('reports: generate, list with clamped limit and one report', async (t) => {
  const { base, runtime } = await withApp(t);
  const generated = await fetch(base + '/api/runtime/reports/generate', json('POST', { date: '2026-11-25', projectId: 'proj-1' }));
  assert.equal(generated.status, 200);
  assert.equal((await generated.json()).report.id, 'r1');
  assert.deepEqual(runtime.calls.at(-1), ['generateDailyReport', { date: '2026-11-25', projectId: 'proj-1' }]);

  const list = await fetch(base + '/api/runtime/reports?limit=9999&projectId=proj-1', { headers: AUTH });
  assert.equal(list.status, 200);
  assert.deepEqual(runtime.calls.find((c) => c[0] === 'listReports'), ['listReports', 'proj-1', 100]);
  await fetch(base + '/api/runtime/reports', { headers: AUTH });
  assert.deepEqual(runtime.calls.filter((c) => c[0] === 'listReports').at(-1), ['listReports', null, 30]);

  const one = await fetch(base + '/api/runtime/reports/r1', { headers: AUTH });
  assert.equal((await one.json()).report.body, 'report');

  const malformed = await fetch(base + '/api/runtime/reports/%E0%A4%A', { headers: AUTH });
  assert.equal(malformed.status, 400);

  const wrongMethod = await fetch(base + '/api/runtime/reports', { method: 'POST', headers: { 'Content-Type': 'application/json', ...AUTH }, body: '{}' });
  assert.equal(wrongMethod.status, 405);
});

test('decisions: list and answer', async (t) => {
  const { base, runtime } = await withApp(t);
  const list = await fetch(base + '/api/runtime/decisions', { headers: AUTH });
  assert.equal((await list.json()).decisions[0].id, 'd1');

  const answer = await fetch(base + '/api/runtime/decisions/d1/answer', json('POST', { answer: 'yes', optionIndex: 0 }));
  assert.equal(answer.status, 200);
  assert.equal((await answer.json()).accepted, true);
  assert.deepEqual(runtime.calls.at(-1), ['answerDecision', 'd1', { answer: 'yes', optionIndex: 0 }]);

  const emptyAnswer = await fetch(base + '/api/runtime/decisions/d1/answer', json('POST', {}));
  assert.equal(emptyAnswer.status, 200);
  assert.deepEqual(runtime.calls.at(-1), ['answerDecision', 'd1', { answer: null, optionIndex: null }]);
});

test('merge preview: guarded GET reaches the runtime, other methods do not', async (t) => {
  const { base, runtime } = await withApp(t);
  const res = await fetch(base + '/api/runtime/tasks/t1/merge-preview', { headers: AUTH });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.preview.ready, true);
  assert.equal(body.preview.taskId, 't1');
  assert.deepEqual(runtime.calls.at(-1), ['mergePreviewForTask', 't1']);
  assert.equal((await fetch(base + '/api/runtime/tasks/t1/merge-preview', { method: 'POST', headers: AUTH })).status, 405);
});
