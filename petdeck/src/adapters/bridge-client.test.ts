// Bridge inject contract: HTTP/auth/rate-limit/server/malformed failures must
// REJECT with a `status`-carrying error, never resolve into a fake success decision.
// Run: node --test src/adapters/bridge-client.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inject, BridgeInjectError, BRIDGE_URL, fetchAgents, fetchSessions } from './bridge-client.ts';
import type { InjectPayload } from './types.ts';

const payload: InjectPayload = { from: 'kimi', to: 'codex', context: 'ctx', instruction: 'deploy it' };
const origFetch = globalThis.fetch;

function fakeFetch(impl: (url: string, init: RequestInit) => Promise<Response>): void {
  globalThis.fetch = impl as unknown as typeof fetch;
}

test('inject: 401 rejects with status 401', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  fakeFetch(async () => new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), { status: 401 }));
  const err: unknown = await inject(payload).then(() => null, (e) => e);
  assert.ok(err instanceof BridgeInjectError, 'must reject with BridgeInjectError');
  assert.equal((err as BridgeInjectError).status, 401);
});

test('inject: 429 rejects with status 429 (rate limit is not a success)', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  fakeFetch(async () => new Response(JSON.stringify({ ok: false, error: 'rate limited' }), { status: 429 }));
  const err: unknown = await inject(payload).then(() => null, (e) => e);
  assert.ok(err instanceof BridgeInjectError);
  assert.equal((err as BridgeInjectError).status, 429);
});

test('inject: 500 rejects with status 500', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  fakeFetch(async () => new Response(JSON.stringify({ ok: false, error: 'boom' }), { status: 500 }));
  const err: unknown = await inject(payload).then(() => null, (e) => e);
  assert.ok(err instanceof BridgeInjectError);
  assert.equal((err as BridgeInjectError).status, 500);
});

test('inject: 500 with non-JSON body still rejects carrying the HTTP status', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  fakeFetch(async () => new Response('Internal Server Error', { status: 500 }));
  const err: unknown = await inject(payload).then(() => null, (e) => e);
  assert.ok(err instanceof BridgeInjectError);
  assert.equal((err as BridgeInjectError).status, 500);
});

test('inject: 200 with {ok:false} rejects (application-level failure is not a success)', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  fakeFetch(async () => new Response(JSON.stringify({ ok: false, status: 503 }), { status: 200 }));
  const err: unknown = await inject(payload).then(() => null, (e) => e);
  assert.ok(err instanceof BridgeInjectError);
  assert.equal((err as BridgeInjectError).status, 503);
});

test('inject: 200 with {ok:false} and no body status falls back to the HTTP status', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  fakeFetch(async () => new Response(JSON.stringify({ ok: false }), { status: 200 }));
  const err: unknown = await inject(payload).then(() => null, (e) => e);
  assert.ok(err instanceof BridgeInjectError);
  assert.equal((err as BridgeInjectError).status, 200);
});

test('inject: 200 with non-JSON body rejects (malformed contract)', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  fakeFetch(async () => new Response('<html>oops</html>', { status: 200 }));
  const err: unknown = await inject(payload).then(() => null, (e) => e);
  assert.ok(err instanceof BridgeInjectError);
  assert.equal((err as BridgeInjectError).status, 200);
});

test('inject: network error rejects with status 0', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  fakeFetch(async () => { throw new TypeError('fetch failed'); });
  const err: unknown = await inject(payload).then(() => null, (e) => e);
  assert.ok(err instanceof BridgeInjectError);
  assert.equal((err as BridgeInjectError).status, 0);
});

test('inject: sends payload to the inject endpoint as JSON POST with a timeout signal', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  let seenUrl = '';
  let seenMethod = '';
  let seenBody = '';
  let seenContentType = '';
  let seenSignal: AbortSignal | null | undefined;
  fakeFetch(async (url, init) => {
    seenUrl = url;
    seenMethod = init.method ?? '';
    seenBody = String(init.body);
    seenContentType = (init.headers as Record<string, string>)['Content-Type'] ?? '';
    seenSignal = init.signal as AbortSignal | null | undefined;
    return new Response(JSON.stringify({ ok: true, mode: 'inject' }), { status: 200 });
  });
  await inject(payload);
  assert.equal(seenUrl, `${BRIDGE_URL}/api/inject`);
  assert.equal(seenMethod, 'POST');
  assert.equal(seenContentType, 'application/json');
  assert.deepEqual(JSON.parse(seenBody), { from: 'kimi', to: 'codex', context: 'ctx', instruction: 'deploy it' });
  assert.ok(seenSignal instanceof AbortSignal, 'inject must not wait forever');
  assert.equal((seenSignal as AbortSignal).aborted, false);
});

test('inject: valid {ok:true,mode:"inject"} decision passes through unchanged', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  const decision = { ok: true, mode: 'inject', response: 'done', sessionID: 'codex:s9' };
  fakeFetch(async () => new Response(JSON.stringify(decision), { status: 200 }));
  const d = await inject(payload);
  assert.deepEqual(d, decision);
});

test('inject: valid {ok:true,mode:"clipboard"} decision passes through unchanged', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  const decision = { ok: true, mode: 'clipboard', package: 'Relay handoff package: ...' };
  fakeFetch(async () => new Response(JSON.stringify(decision), { status: 200 }));
  const d = await inject(payload);
  assert.deepEqual(d, decision);
});

// --- Task 6: fetchAgents/fetchSessions carry a 3s abort timeout ---

test('fetchAgents: attaches an AbortSignal that is live but not yet fired', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  let seenSignal: AbortSignal | null | undefined;
  fakeFetch(async (url, init) => {
    seenSignal = init.signal as AbortSignal | null | undefined;
    return new Response(JSON.stringify([{ id: 'codex' }]), { status: 200 });
  });
  const agents = await fetchAgents();
  assert.equal(Array.isArray(agents), true);
  assert.ok(seenSignal instanceof AbortSignal, 'fetchAgents must attach an abort signal');
  assert.equal((seenSignal as AbortSignal).aborted, false);
});

test('fetchSessions: attaches an abort signal too', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  let seenSignal: AbortSignal | null | undefined;
  fakeFetch(async (url, init) => {
    seenSignal = init.signal as AbortSignal | null | undefined;
    return new Response(JSON.stringify([]), { status: 200 });
  });
  await fetchSessions();
  assert.ok(seenSignal instanceof AbortSignal, 'fetchSessions must attach an abort signal');
});

test('fetchAgents: a hanging bridge rejects via the 3s timeout (no infinite hang)', async (t) => {
  t.after(() => { globalThis.fetch = origFetch; });
  fakeFetch(async (url, init) => new Promise((_res, rej) => {
    (init.signal as AbortSignal).addEventListener('abort', () => {
      rej(new DOMException('The operation timed out.', 'TimeoutError'));
    });
  }));
  const start = Date.now();
  await assert.rejects(fetchAgents());
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 2900, `timeout should fire near 3s (saw ${elapsed}ms)`);
  assert.ok(elapsed < 10000, `timeout should not be far beyond 3s (saw ${elapsed}ms)`);
});

for (const [label, load] of [['agents', fetchAgents], ['sessions', fetchSessions]] as const) {
  test(`${label}: non-OK responses reject instead of committing an error body`, async (t) => {
    t.after(() => { globalThis.fetch = origFetch; });
    fakeFetch(async () => new Response(JSON.stringify({ ok: false, error: 'boom' }), { status: 500 }));
    await assert.rejects(load(), /HTTP 500/);
  });

  test(`${label}: malformed JSON rejects through the normal connection failure path`, async (t) => {
    t.after(() => { globalThis.fetch = origFetch; });
    fakeFetch(async () => new Response('<html>oops</html>', { status: 200 }));
    await assert.rejects(load(), /malformed JSON/);
  });

  test(`${label}: a successful non-array body is rejected`, async (t) => {
    t.after(() => { globalThis.fetch = origFetch; });
    fakeFetch(async () => new Response(JSON.stringify({ ok: true, [label]: [] }), { status: 200 }));
    await assert.rejects(load(), /expected an array/);
  });
}
