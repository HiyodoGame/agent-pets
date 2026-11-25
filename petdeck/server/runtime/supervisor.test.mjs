import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createSupervisor } from './supervisor.mjs';

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

function fakeChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.signals = [];
  child.kill = (signal) => { child.signals.push(signal); return true; };
  return child;
}

test('supervisor: POSIX stop signals the process group, not only the direct CLI', async () => {
  const child = fakeChild(4242);
  const groupSignals = [];
  let spawnOptions;
  const supervisor = createSupervisor({
    platform: 'linux',
    spawnImpl: (_command, _args, options) => { spawnOptions = options; return child; },
    killGroupImpl: (pid, signal) => groupSignals.push({ pid, signal }),
    logger: quiet,
  });
  const handle = supervisor.start({ runId: 'run', taskId: 'task', command: process.execPath, args: [], cwd: process.cwd(), parseLine: () => ({ events: [] }) });
  assert.equal(spawnOptions.detached, true);
  assert.equal(spawnOptions.env.PWD, process.cwd(), 'child PWD must match the isolated task cwd, not the shell that launched PetDeck');
  assert.equal(spawnOptions.env.OLDPWD, process.cwd());
  const stopped = handle.stop();
  assert.deepEqual(groupSignals, [{ pid: 4242, signal: 'SIGTERM' }]);
  assert.deepEqual(child.signals, []);
  child.emit('close', null, 'SIGTERM');
  await stopped;
});

test('supervisor: POSIX stop timeout escalates the whole process group', async () => {
  const child = fakeChild(4343);
  const groupSignals = [];
  const supervisor = createSupervisor({
    platform: 'linux',
    spawnImpl: () => child,
    killGroupImpl: (pid, signal) => groupSignals.push({ pid, signal }),
    killTimeoutMs: 10,
    logger: quiet,
  });
  const handle = supervisor.start({ runId: 'run', taskId: 'task', command: process.execPath, args: [], cwd: process.cwd(), parseLine: () => ({ events: [] }) });
  await handle.stop();
  assert.deepEqual(groupSignals, [
    { pid: 4343, signal: 'SIGTERM' },
    { pid: 4343, signal: 'SIGKILL' },
  ]);
  assert.ok(child.signals.includes('SIGKILL'));
});

test('supervisor: suspend/resume delegate with the platform and track the paused flag', () => {
  const child = fakeChild(4444);
  const calls = [];
  const supervisor = createSupervisor({
    platform: 'linux',
    spawnImpl: () => child,
    suspendImpl: (pid, options) => { calls.push(['suspend', pid, options]); return { ok: true, code: 'suspended' }; },
    resumeImpl: (pid, options) => { calls.push(['resume', pid, options]); return { ok: true, code: 'resumed' }; },
    logger: quiet,
  });
  const handle = supervisor.start({ runId: 'run', taskId: 'task', command: process.execPath, args: [], cwd: process.cwd(), parseLine: () => ({ events: [] }) });
  assert.equal(handle.paused, false);
  assert.deepEqual(handle.suspend(), { ok: true, code: 'suspended' });
  assert.equal(handle.paused, true);
  assert.deepEqual(handle.resume(), { ok: true, code: 'resumed' });
  assert.equal(handle.paused, false);
  assert.deepEqual(calls, [
    ['suspend', 4444, { platform: 'linux' }],
    ['resume', 4444, { platform: 'linux' }],
  ]);
});

test('supervisor: an unsupported pause propagates unchanged and does not claim paused', () => {
  const child = fakeChild(4545);
  const supervisor = createSupervisor({
    platform: 'linux',
    spawnImpl: () => child,
    suspendImpl: () => ({ ok: false, code: 'unsupported-platform', detail: 'pause is only implemented on Windows' }),
    logger: quiet,
  });
  const handle = supervisor.start({ runId: 'run', taskId: 'task', command: process.execPath, args: [], cwd: process.cwd(), parseLine: () => ({ events: [] }) });
  const result = handle.suspend();
  assert.deepEqual(result, { ok: false, code: 'unsupported-platform', detail: 'pause is only implemented on Windows' });
  assert.equal(handle.paused, false, 'the service maps the code and must never be told the run is paused');
});

test('supervisor: stopping a paused run resumes it before terminating', async () => {
  const child = fakeChild(4646);
  const order = [];
  const supervisor = createSupervisor({
    platform: 'linux',
    spawnImpl: () => child,
    suspendImpl: () => { order.push('suspend'); return { ok: true, code: 'suspended' }; },
    resumeImpl: () => { order.push('resume'); return { ok: true, code: 'resumed' }; },
    killGroupImpl: () => order.push('kill'),
    logger: quiet,
  });
  const handle = supervisor.start({ runId: 'run', taskId: 'task', command: process.execPath, args: [], cwd: process.cwd(), parseLine: () => ({ events: [] }) });
  handle.suspend();
  const stopped = handle.stop();
  assert.deepEqual(order, ['suspend', 'resume', 'kill']);
  assert.equal(handle.paused, false);
  child.emit('close', null, 'SIGTERM');
  await stopped;
});

test('supervisor: Windows stop kills the whole tree with taskkill /T', async () => {
  const child = fakeChild(5151);
  const killer = fakeChild(0);
  const spawned = [];
  const supervisor = createSupervisor({
    platform: 'win32',
    spawnImpl: (command, args) => { spawned.push([command, args]); return command === 'taskkill' ? killer : child; },
    logger: quiet,
  });
  const handle = supervisor.start({ runId: 'run', taskId: 'task', command: process.execPath, args: [], cwd: process.cwd(), parseLine: () => ({ events: [] }) });
  const stopped = handle.stop();
  assert.deepEqual(spawned.at(-1), ['taskkill', ['/PID', '5151', '/T', '/F']]);
  killer.emit('close', 0);
  child.emit('close', 0, null);
  await stopped;
  assert.equal(handle.stopped, true);
});
