// RED tests for the async CLI exec helper (no shell, timeout kill, stdin).
// Run: node --test server/exec.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runCli } from './adapters/exec.mjs';

function fakeSpawn({ stdout = '', code = 0, errorEv = null, keepOpen = false } = {}) {
  const calls = [];
  const impl = (cmd, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { chunks: [], ended: false, end(v) { this.ended = true; if (v != null) this.chunks.push(String(v)); }, on() {} };
    child.kill = (sig) => { child.killed = sig; };
    calls.push({ cmd, args, options, child });
    if (!keepOpen) {
      queueMicrotask(() => {
        if (stdout) child.stdout.emit('data', Buffer.from(stdout));
        if (errorEv) child.emit('error', errorEv);
        else child.emit('close', code);
      });
    }
    return child;
  };
  return { impl, calls };
}

test('runCli: spawns without shell and resolves stdout/status', async () => {
  const { impl, calls } = fakeSpawn({ stdout: 'HELLO', code: 0 });
  const r = await runCli('codex', ['exec', 'hi'], { spawnImpl: impl });
  assert.equal(calls[0].options.shell, false);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'HELLO');
  assert.equal(r.error, false);
});

test('runCli: writes input to stdin and ends it', async () => {
  const { impl, calls } = fakeSpawn({ stdout: 'ok' });
  await runCli('opencode', ['run'], { input: 'PROMPT', spawnImpl: impl });
  assert.equal(calls[0].child.stdin.ended, true);
  assert.equal(calls[0].child.stdin.chunks.join(''), 'PROMPT');
});

test('runCli: child error event resolves with error flag', async () => {
  const { impl } = fakeSpawn({ errorEv: new Error('ENOENT codex') });
  const r = await runCli('codex', ['exec'], { spawnImpl: impl });
  assert.equal(r.error, true);
  assert.notEqual(r.status, 0);
});

test('runCli: timeout kills the child and resolves error', async () => {
  const { impl, calls } = fakeSpawn({ keepOpen: true });
  const r = await runCli('codex', ['exec'], { timeout: 10, spawnImpl: impl });
  assert.equal(r.error, true);
  assert.equal(calls[0].child.killed, 'SIGKILL');
});
