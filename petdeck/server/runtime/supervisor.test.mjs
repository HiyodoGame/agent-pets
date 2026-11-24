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
