// Event window route: ?before= must reach the runtime so the task page can page
// backwards without re-fetching the whole transcript.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './bridge.mjs';

async function withApp(t, token, runtimeOverrides = {}) {
  const calls = [];
  const runtime = {
    listEvents: (taskId, opts) => {
      calls.push({ taskId, opts });
      return [{ id: 7, taskId, runId: null, type: 'message.assistant', ts: 1, payload: { text: 'hi' } }];
    },
    ...runtimeOverrides,
  };
  const security = token ? { token } : {};
  const app = createApp({ adapters: [], security, runtime, probe: { list: async (entries) => entries } });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => { app.closeEventStreams?.(); app.closeAllConnections?.(); app.close(); });
  return { base: 'http://127.0.0.1:' + app.address().port, calls, app };
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

async function readEventsUntil(response, predicate) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').find((line) => line.startsWith('data: '));
        if (!data) continue;
        events.push(JSON.parse(data.slice(6)));
      }
      if (events.some(predicate)) return events;
    }
    return events;
  } finally {
    try { await reader.cancel(); } catch { /* already closed */ }
  }
}

const streamEvent = (id, taskId = 't1') => ({ id, taskId, runId: null, type: 'test', ts: id, payload: {} });

test('task stream: replays every 5000-event page in order', async (t) => {
  const all = Array.from({ length: 10002 }, (_, index) => streamEvent(index + 1));
  const calls = [];
  const { base } = await withApp(t, null, {
    subscribe: () => () => {},
    listEvents: (_taskId, { after, limit }) => {
      calls.push({ after, limit });
      return all.filter((event) => event.id > after).slice(0, limit);
    },
  });
  const response = await fetch(base + '/api/runtime/tasks/t1/stream?after=0');
  const events = await readEventsUntil(response, (event) => event.id === 10002);
  assert.equal(events.length, 10002);
  assert.equal(events[0].id, 1);
  assert.equal(events.at(-1).id, 10002);
  assert.deepEqual(calls, [
    { after: 0, limit: 5000 },
    { after: 5000, limit: 5000 },
    { after: 10000, limit: 5000 },
  ]);
});

test('task stream: Last-Event-ID resumes after the acknowledged event', async (t) => {
  const all = [streamEvent(1), streamEvent(2), streamEvent(3)];
  const calls = [];
  const { base } = await withApp(t, null, {
    subscribe: () => () => {},
    listEvents: (_taskId, { after }) => { calls.push(after); return all.filter((event) => event.id > after); },
  });
  const response = await fetch(base + '/api/runtime/tasks/t1/stream?after=0', { headers: { 'Last-Event-ID': '2' } });
  const events = await readEventsUntil(response, (event) => event.id === 3);
  assert.deepEqual(events.map((event) => event.id), [3]);
  assert.deepEqual(calls, [2]);
});

test('task stream: replay deduplicates an event delivered by the early subscription', async (t) => {
  let publish;
  const { base } = await withApp(t, null, {
    subscribe: (fn) => { publish = fn; return () => {}; },
    listEvents: () => {
      publish(streamEvent(1));
      return [streamEvent(1)];
    },
  });
  const response = await fetch(base + '/api/runtime/tasks/t1/stream');
  const events = await readEventsUntil(response, (event) => event.id === 1);
  assert.deepEqual(events.map((event) => event.id), [1]);
});

test('closeEventStreams: ends an active task SSE and removes its subscription/timer', async (t) => {
  let subscribed = false;
  const { base, app } = await withApp(t, null, {
    subscribe: () => { subscribed = true; return () => { subscribed = false; }; },
    listEvents: () => [],
  });
  const response = await fetch(base + '/api/runtime/tasks/t1/stream');
  assert.equal(response.status, 200);
  assert.equal(subscribed, true);
  app.closeEventStreams();
  const reader = response.body.getReader();
  while (!(await reader.read()).done) { /* drain */ }
  assert.equal(subscribed, false);
});
