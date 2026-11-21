// Runtime service: fake supervisor (no OS processes), real git worktree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRuntimeService } from './service.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 8000, label = 'condition') {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(40);
  }
  throw new Error('timeout waiting for ' + label);
}

function tempDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-' + tag + '-')); }

function makeGitRepo() {
  const dir = tempDir('repo');
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore', windowsHide: true });
  git('init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'PetDeck Test');
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  git('add', '.');
  git('commit', '-m', 'init');
  return dir;
}

function makeAdapter(calls) {
  return {
    id: 'claude-code',
    command: process.execPath,
    normalizePermissionMode: (value) => value || 'acceptEdits',
    buildArgs({ prompt, sessionId, permissionMode }) {
      calls.push({ prompt, sessionId, permissionMode });
      return ['--fake-agent', prompt];
    },
    parseLine() { return { events: [] }; },
  };
}

// A supervisor-shaped object whose start() emits the same events a real agent
// would, on a timer so the service has already registered the active run.
function createFakeSupervisor(mode) {
  const record = { starts: [], stops: [], stopAllCalls: 0 };
  const live = new Set();
  return {
    record,
    factory({ onEvent, onExit }) {
      return {
        start({ runId, taskId, command, args, cwd }) {
          record.starts.push({ runId, taskId, command, args, cwd });
          let alive = true;
          const handle = { runId, taskId, pid: 4000 + record.starts.length, stop: null };
          live.add(handle);
          const emit = (type, payload) => {
            if (!alive) return;
            onEvent(type, payload, { taskId, runId });
          };
          const exit = (payload) => {
            if (!alive) return;
            alive = false;
            live.delete(handle);
            onEvent('run.exited', payload, { taskId, runId });
            onExit({ runId, taskId });
          };
          handle.stop = async () => {
            if (!alive) return;
            record.stops.push({ runId, taskId });
            exit({ code: null, signal: 'SIGTERM', stopped: true });
          };
          setTimeout(() => {
            if (!alive) return;
            emit('run.started', { sessionId: mode === 'long' ? 'sess-long' : 'sess-1' });
            if (mode === 'long') return;
            emit('message.assistant', { text: 'hello from fake agent' });
            setTimeout(() => {
              if (!alive) return;
              emit('run.completed', { sessionId: 'sess-1', result: 'done' });
              setTimeout(() => exit({ code: 0, signal: null }), 0);
            }, 5);
          }, 0);
          return handle;
        },
        async stopAll() {
          record.stopAllCalls += 1;
          for (const handle of [...live]) await handle.stop();
        },
      };
    },
  };
}

function makeService(t, mode = 'done') {
  const dataDir = tempDir('data');
  const worktreesRoot = tempDir('wt');
  const calls = [];
  const fake = createFakeSupervisor(mode);
  const service = createRuntimeService({
    dataDir,
    worktreesRoot,
    adapters: { 'claude-code': makeAdapter(calls) },
    supervisor: fake.factory,
    logger: { error() {} },
  });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(worktreesRoot, { recursive: true, force: true });
  });
  return { service, calls, dataDir, worktreesRoot, fake };
}

test('service: register git project, start task, worktree, events, session', async (t) => {
  const repo = makeGitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { service, calls, fake } = makeService(t, 'done');

  const { project, created } = await service.registerProject({ projectPath: repo });
  assert.equal(created, true);
  assert.equal(project.kind, 'git');
  const again = await service.registerProject({ projectPath: repo });
  assert.equal(again.created, false);

  const task = service.createTask({ projectId: project.id, title: 'Say hello', prompt: 'say hello' });
  assert.equal(task.status, 'ready');

  await service.startTask(task.id);
  const detail = await waitFor(() => {
    const d = service.getTaskDetail(task.id);
    return d.task.status === 'review' && d.runs[0]?.status === 'completed' ? d : null;
  }, 8000, 'task review');

  assert.equal(detail.task.session_id, 'sess-1');
  assert.equal(detail.task.summary, 'done');
  assert.ok(detail.task.worktree_path.startsWith(repo) === false, 'worktree must live outside the repo');
  assert.ok(fs.existsSync(detail.task.worktree_path), 'worktree exists');
  assert.match(detail.task.branch, /^petdeck\//);
  assert.equal(detail.runs.length, 1);
  assert.equal(detail.runs[0].status, 'completed');
  assert.deepEqual(calls.at(-1), { prompt: 'say hello', sessionId: null, permissionMode: 'acceptEdits' });
  assert.equal(fake.record.starts.length, 1);
  assert.equal(fake.record.starts[0].cwd, detail.task.worktree_path);

  const events = service.listEvents(task.id, { limit: 1000 });
  const types = events.map((e) => e.type);
  assert.deepEqual(types.slice(0, 2), ['run.starting', 'run.started']);
  assert.ok(types.includes('message.assistant'));
  assert.ok(types.includes('run.completed'));
  assert.ok(types.includes('run.exited'));

  const transcript = path.join(path.dirname(service.db.path), 'runs', detail.runs[0].id, 'events.jsonl');
  assert.ok(fs.existsSync(transcript), 'transcript file exists');
  assert.ok(fs.readFileSync(transcript, 'utf8').includes('run.exited'));
});

test('service: stop kills the run and marks task stopped', async (t) => {
  const repo = makeGitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { service, fake } = makeService(t, 'long');

  const { project } = await service.registerProject({ projectPath: repo });
  const task = service.createTask({ projectId: project.id, title: 'Long run', prompt: 'stay alive' });
  await service.startTask(task.id);
  await waitFor(() => service.getTaskDetail(task.id).task.status === 'running', 5000, 'run to start');

  await service.stopTask(task.id);
  const detail = service.getTaskDetail(task.id);
  assert.equal(detail.task.status, 'stopped');
  assert.equal(detail.runs[0].status, 'stopped');
  assert.equal(service.activeCount, 0);
  assert.equal(fake.record.stops.length, 1);

  const types = service.listEvents(task.id, { limit: 1000 }).map((e) => e.type);
  assert.ok(types.includes('run.stop_requested'));
  assert.ok(types.includes('run.exited'));
});

test('service: rejection reuses the captured session id for a new review run', async (t) => {
  const repo = makeGitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { service, calls } = makeService(t, 'done');

  const { project } = await service.registerProject({ projectPath: repo });
  const task = service.createTask({ projectId: project.id, title: 'Resume me', prompt: 'first' });
  await service.startTask(task.id);
  await waitFor(() => service.getTaskDetail(task.id).task.status === 'review', 8000, 'first run');

  await service.rejectTask(task.id, { feedback: 'please continue' });
  await waitFor(() => service.getTaskDetail(task.id).runs.length === 2 && service.getTaskDetail(task.id).task.status === 'review', 8000, 'resumed run');
  assert.equal(calls.at(-1).sessionId, 'sess-1');
  assert.match(calls.at(-1).prompt, /please continue/);
  assert.equal(service.getTaskDetail(task.id).task.reject_count, 1);
});

test('service: non-git directory runs in place without a worktree', async (t) => {
  const dir = tempDir('plain');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { service, fake } = makeService(t, 'done');

  const { project } = await service.registerProject({ projectPath: dir });
  assert.equal(project.kind, 'dir');
  const task = service.createTask({ projectId: project.id, title: 'Plain', prompt: 'x' });
  await service.startTask(task.id);
  await waitFor(() => service.getTaskDetail(task.id).task.status === 'review', 8000, 'review');
  await service.acceptTask(task.id);
  const detail = service.getTaskDetail(task.id);
  assert.equal(detail.task.status, 'completed');
  assert.equal(detail.task.worktree_path, null);
  assert.equal(fake.record.starts[0].cwd, project.path);
});
