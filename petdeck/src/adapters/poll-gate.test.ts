// RED tests: overlapping invocations of an async tick are skipped while one is in flight.
// Run: node --test src/adapters/poll-gate.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skipWhileRunning, skipWhileRunningTrailing } from './poll-gate.ts';

function deferred() {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => { resolve = r; });
  return { promise, resolve };
}

test('poll-gate: a second call during an in-flight call is skipped', async () => {
  let calls = 0;
  const gate = deferred();
  const fn = skipWhileRunning(async () => { calls++; await gate.promise; return 'done'; });
  const p1 = fn();
  const p2 = fn();
  assert.equal(await p2, undefined, 'overlapping call must be skipped (undefined)');
  gate.resolve('x');
  assert.equal(await p1, 'done');
  assert.equal(calls, 1);
});

test('poll-gate: after the in-flight call settles, the next call runs', async () => {
  let calls = 0;
  const fn = skipWhileRunning(async () => { calls++; return calls; });
  assert.equal(await fn(), 1);
  assert.equal(await fn(), 2);
  assert.equal(calls, 2);
});

test('poll-gate: a rejected in-flight call releases the gate (no permanent stall)', async () => {
  const fn = skipWhileRunning(async () => { throw new Error('boom'); });
  await assert.rejects(fn(), /boom/);
  let ran = false;
  const fn2 = skipWhileRunning(async () => { ran = true; });
  await fn2();
  assert.equal(ran, true);
});

// --- Trailing variant: a manual reconnect during an in-flight tick must not be lost ---

const flush = () => new Promise((r) => setTimeout(r, 0));

test('poll-gate trailing: an overlapping call is skipped but triggers one trailing run after settle', async () => {
  let calls = 0;
  const gate = deferred();
  const fn = skipWhileRunningTrailing(async () => { calls++; await gate.promise; return calls; });
  const p1 = fn();
  const p2 = fn();
  assert.equal(await p2, undefined, 'overlapping call still skipped (undefined)');
  assert.equal(calls, 1);
  gate.resolve('x');
  await p1;
  await flush();
  assert.equal(calls, 2, 'exactly one trailing invocation runs after the in-flight tick settles');
});

test('poll-gate trailing: several overlapping calls collapse into a single trailing run (no stacking)', async () => {
  let calls = 0;
  const gate = deferred();
  const fn = skipWhileRunningTrailing(async () => { calls++; await gate.promise; return calls; });
  const p1 = fn();
  fn(); fn(); fn();
  gate.resolve('x');
  await p1;
  await flush();
  assert.equal(calls, 2, 'three overlapping calls produce exactly one trailing run');
});

test('poll-gate trailing: no overlapping call => no trailing run', async () => {
  let calls = 0;
  const fn = skipWhileRunningTrailing(async () => { calls++; return calls; });
  await fn();
  await flush();
  assert.equal(calls, 1);
});

test('poll-gate trailing: trailing run uses the args of the latest skipped call and never overlaps', async () => {
  const seen: string[] = [];
  const gate = deferred();
  let secondStartedBeforeFirstFinished = false;
  let firstFinished = false;
  const fn = skipWhileRunningTrailing(async (tag: string) => {
    seen.push(`${tag}:start`);
    if (tag === 'a') { await gate.promise; firstFinished = true; }
    else secondStartedBeforeFirstFinished = !firstFinished;
    seen.push(`${tag}:end`);
    return tag;
  });
  const p1 = fn('a');
  fn('b');
  fn('c');
  gate.resolve('x');
  await p1;
  await flush();
  assert.deepEqual(seen, ['a:start', 'a:end', 'c:start', 'c:end'], 'trailing run uses the latest skipped args and starts only after the first ended');
  assert.equal(secondStartedBeforeFirstFinished, false, 'trailing invocation must never overlap the in-flight one');
});

test('poll-gate trailing: a rejected in-flight call still releases the gate and runs the trailing call', async () => {
  let calls = 0;
  const gate = deferred();
  const fn = skipWhileRunningTrailing(async () => { calls++; await gate.promise; throw new Error('boom'); });
  const p1 = fn();
  fn();
  gate.resolve('x');
  await assert.rejects(p1, /boom/);
  await flush();
  assert.equal(calls, 2);
});
