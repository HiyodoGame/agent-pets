// Event window route: ?before= must reach the runtime so the task page can page
// backwards without re-fetching the whole transcript.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './bridge.mjs';

async function withApp(t, token) {
  const calls = [];
  const runtime = {
    listEvents: (taskId, opts) => {
      calls.push({ taskId, opts });
      return [{ id: 7, taskId, runId: null, type: 'message.assistant', ts: 1, payload: { text: 'hi' } }];
    },
  };
  const security = token ? { token } : {};
  const app = createApp({ adapters: [], security, runtime, probe: { list: async (entries) => entries } });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => { app.closeAllConnections?.(); app.close(); });
  return { base: 'http://127.0.0.1:' + app.address().port, calls };
}

test('events route forwards after, before and limit', async (t) => {
  const { base, calls } = await withApp(t, 'sekret');
  const response = await fetch(base + '/api/runtime/tasks/t1/events?after=3&before=9&limit=20', { headers: { 'X-Petdeck-Token': 'sekret' } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.events.length, 1);
  assert.deepEqual(calls, [{ taskId: 't1', opts: { after: 3, before: 9, limit: 20 } }]);
});

test('events route is guarded and defaults the window', async (t) => {
  const guarded = await withApp(t, 'sekret');
  const denied = await fetch(guarded.base + '/api/runtime/tasks/t1/events');
  assert.equal(denied.status, 401);

  const open = await withApp(t, null);
  const response = await fetch(open.base + '/api/runtime/tasks/t1/events?before=not-a-number');
  assert.equal(response.status, 200);
  assert.deepEqual(open.calls[0].opts, { after: 0, before: 0, limit: 500 });
});
