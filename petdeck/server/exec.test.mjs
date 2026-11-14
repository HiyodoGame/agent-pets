// RED tests for the async CLI exec helper (no shell, timeout kill, stdin).
// Run: node --test server/exec.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runCli } from './adapters/exec.mjs';

function fakeSpawn({ stdout = '', stderr = '', code = 0, errorEv = null, keepOpen = false } = {}) {
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
        if (stderr) child.stderr.emit('data', Buffer.from(stderr));
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

// --- Task 6: sync spawn errors resolve (never reject), output capped at 1 MiB ---

test('runCli: synchronous spawn throw resolves a normal error result', async () => {
  const impl = () => { throw new Error('ENOENT: spawn codex ENOENT'); };
  let rejected = null;
  const r = await runCli('codex', ['exec'], { spawnImpl: impl }).catch((e) => { rejected = e; return null; });
  assert.equal(rejected, null, 'sync spawn throw must resolve, not reject');
  assert.ok(r, 'must resolve a result object');
  assert.equal(r.error, true);
  assert.equal(r.status, -1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /ENOENT/);
});

test('runCli: stdout and stderr each retain only the last 1 MiB', async () => {
  const { impl, calls } = fakeSpawn({ keepOpen: true });
  const p = runCli('codex', ['exec'], { spawnImpl: impl });
  const child = calls[0].child;
  const head = 'H'.repeat(2 * 1024 * 1024); // 2 MiB head, must be dropped entirely
  const tail = 'T'.repeat(1024 * 1024);     // exactly 1 MiB of tail
  child.stdout.emit('data', Buffer.from(head));
  child.stderr.emit('data', Buffer.from(head));
  child.stdout.emit('data', Buffer.from(tail));
  child.stderr.emit('data', Buffer.from(tail));
  child.stdout.emit('data', Buffer.from('end'));
  child.stderr.emit('data', Buffer.from('!'));
  child.emit('close', 0);
  const r = await p;
  assert.equal(r.error, false);
  // each stream keeps exactly the last 1 MiB
  assert.equal(r.stdout, tail.slice(0, -3) + 'end');
  assert.equal(r.stderr, tail.slice(0, -1) + '!');
  assert.equal(r.stdout.length, 1024 * 1024);
  assert.equal(r.stderr.length, 1024 * 1024);
});


// --- Task 7 (review fix): summary is a STRUCTURED outcome code only ---
// 自由文本（stderr 末行 / error message）可能回显 prompt 内容（payload echo），
// 单行化/截断不是内容脱敏 —— summary 只许携带结构化类别/码，绝不携带任意文本。
const SECRET = 'deploy SECRET_TOKEN and rm the db';

test('runCli: non-zero exit summary = exit code only, never stderr content', async () => {
  const { impl } = fakeSpawn({ stderr: `Error: ${SECRET}`, code: 1 });
  const r = await runCli('codex', ['exec'], { spawnImpl: impl });
  assert.equal(r.error, false); // a clean non-zero exit is a normal result
  assert.equal(r.summary, 'exit:1');
  assert.ok(!r.summary.includes('SECRET'), 'stderr content must never reach the summary');
});

test('runCli: exit code with no stderr still yields a structured summary', async () => {
  const { impl } = fakeSpawn({ code: 2 });
  const r = await runCli('codex', ['exec'], { spawnImpl: impl });
  assert.equal(r.summary, 'exit:2');
});

test('runCli: timeout summary = timeout token (no duration text needed for logs)', async () => {
  const { impl } = fakeSpawn({ keepOpen: true });
  const r = await runCli('codex', ['exec'], { timeout: 10, spawnImpl: impl });
  assert.equal(r.summary, 'timeout');
});

test('runCli: sync spawn failure summary = spawn-error token, message dropped', async () => {
  const impl = () => { throw new Error(`spawn failed: ${SECRET}`); };
  const r = await runCli('codex', ['exec'], { spawnImpl: impl });
  assert.equal(r.summary, 'spawn-error');
  assert.ok(!r.summary.includes('SECRET'));
});

test('runCli: child error event summary carries only the error CODE (structured), not the message', async () => {
  const err = new Error(`gone: ${SECRET}`);
  err.code = 'FAKE_ENOENT';
  const { impl } = fakeSpawn({ errorEv: err });
  const r = await runCli('codex', ['exec'], { spawnImpl: impl });
  assert.equal(r.summary, 'spawn-error:FAKE_ENOENT');
  assert.ok(!r.summary.includes('SECRET'));
});

test('runCli: child error without a code falls back to the bare token', async () => {
  const { impl } = fakeSpawn({ errorEv: new Error(`gone: ${SECRET}`) });
  const r = await runCli('codex', ['exec'], { spawnImpl: impl });
  assert.equal(r.summary, 'spawn-error');
});

test('runCli: success has an empty summary', async () => {
  const { impl } = fakeSpawn({ stdout: 'ok', code: 0 });
  const r = await runCli('codex', ['exec'], { spawnImpl: impl });
  assert.equal(r.summary, '');
});
