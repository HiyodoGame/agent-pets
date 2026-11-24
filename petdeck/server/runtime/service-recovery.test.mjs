// Crash recovery: a hard exit must not strand queued work or hide what was interrupted.
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

function makeAdapter() {
  return {
    id: 'claude-code',
    command: process.execPath,
    normalizePermissionMode: (value) => value || 'acceptEdits',
    buildArgs({ prompt }) { return ['--fake-agent', prompt]; },
    parseLine() { return { events: [] }; },
  };
}

function createFakeSupervisor() {
  const record = { starts: [] };
  const live = new Set();
  return {
    record,
    factory({ onEvent, onExit }) {
      return {
        start({ runId, taskId, command, args, cwd }) {
          record.starts.push({ runId, taskId, command, args, cwd });
          let alive = true;
          const handle = { runId, taskId, pid: 5000 + record.starts.length, stop: null };
          live.add(handle);
          const emit = (type, payload) => { if (alive) onEvent(type, payload, { taskId, runId }); };
          handle.stop = async () => {
            if (!alive) return;
            alive = false;
            live.delete(handle);
            onEvent('run.exited', { code: null, signal: 'SIGTERM', stopped: true }, { taskId, runId });
            onExit({ runId, taskId });
          };
          setTimeout(() => {
            if (!alive) return;
            emit('run.started', { sessionId: 'sess-rec' });
            emit('message.assistant', { text: 'recovered run finished' });
            setTimeout(() => {
              if (!alive) return;
              emit('run.completed', { sessionId: 'sess-rec', result: 'done' });
              setTimeout(() => {
                if (!alive) return;
                alive = false;
                live.delete(handle);
                onEvent('run.exited', { code: 0, signal: null }, { taskId, runId });
                onExit({ runId, taskId });
              }, 0);
            }, 5);
          }, 0);
          return handle;
        },
        async stopAll() { for (const handle of [...live]) await handle.stop(); },
      };
    },
  };
}

const quiet = (() => {
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  log.child = () => log;
  return log;
})();

test('startup sweeps a leftover worktree that git no longer registers', async (t) => {
  const dataDir = tempDir('sweep-data');
  const worktreesRoot = tempDir('sweep-wt');
  const repo = makeGitRepo();

  const seed = createRuntimeService({
    dataDir, worktreesRoot, adapters: { 'claude-code': makeAdapter() },
    supervisor: createFakeSupervisor().factory, logger: quiet,
  });
  const { project } = await seed.registerProject({ projectPath: repo, name: 'P' });
  const task = seed.createTask({ projectId: project.id, title: 'Leftover', prompt: 'x', agent: 'claude-code' });
  const leftover = path.join(worktreesRoot, 'P-' + project.id.slice(0, 8), task.id);
  fs.mkdirSync(leftover, { recursive: true });
  fs.writeFileSync(path.join(leftover, 'left.txt'), 'left\n');
  seed.db.updateTask(task.id, { worktree_path: leftover, branch: 'petdeck/' + task.id });
  await seed.shutdown();

  const service = createRuntimeService({
    dataDir, worktreesRoot, adapters: { 'claude-code': makeAdapter() },
    supervisor: createFakeSupervisor().factory, logger: quiet,
  });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(worktreesRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  await waitFor(() => service.getTaskDetail(task.id).task.worktree_path === null, 6000, 'leftover sweep');
  assert.equal(fs.existsSync(leftover), false);
});

test('startup recovery resumes queued work and marks the interrupted run', async (t) => {
  const dataDir = tempDir('rec-data');
  const worktreesRoot = tempDir('rec-wt');
  const repo = makeGitRepo();

  // First boot: leave one queued task and one running task behind, then drop the handle
  // without shutdown() — exactly what a crash looks like to the next process.
  const seed = createRuntimeService({
    dataDir, worktreesRoot, adapters: { 'claude-code': makeAdapter() },
    supervisor: createFakeSupervisor().factory, logger: quiet,
  });
  const { project } = await seed.registerProject({ projectPath: repo, name: 'P' });
  const queued = seed.createTask({ projectId: project.id, title: 'Queued', prompt: 'do the thing', agent: 'claude-code' });
  seed.db.updateTask(queued.id, { status: 'queued' });
  const interrupted = seed.createTask({ projectId: project.id, title: 'Interrupted', prompt: 'long task', agent: 'claude-code' });
  const run = seed.db.createRun({ taskId: interrupted.id, status: 'running' });
  seed.db.updateTask(interrupted.id, { status: 'running' });
  seed.db.close();

  const fake = createFakeSupervisor();
  const service = createRuntimeService({
    dataDir, worktreesRoot, adapters: { 'claude-code': makeAdapter() },
    supervisor: fake.factory, logger: quiet,
  });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(worktreesRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  const snapshot = service.statusSnapshot();
  assert.equal(snapshot.recovery.interrupted, 1);
  assert.equal(snapshot.recovery.runsFailed, 1);
  assert.equal(snapshot.recovery.queued, 1);
  assert.deepEqual(snapshot.dbIntegrity, { ok: true });
  assert.equal(snapshot.crash, null);

  const stopped = service.getTaskDetail(interrupted.id);
  assert.equal(stopped.task.status, 'stopped');
  assert.equal(stopped.task.interrupted.runId, run.id);
  assert.equal(stopped.runs.find((r) => r.id === run.id).error, 'bridge-restarted');
  assert.equal(service.listTasks().find((task) => task.id === interrupted.id).interrupted.runId, run.id);

  // The queued task is picked up by the startup drain without any user action.
  await waitFor(() => fake.record.starts.length >= 1, 8000, 'startup drain launch');
  await waitFor(() => ['review', 'completed'].includes(service.getTaskDetail(queued.id).task.status), 8000, 'queued task finish');
  assert.equal(service.getTaskDetail(queued.id).task.status, 'review');
});

test('startup recovery moves a completed latest run to review instead of stopped', async (t) => {
  const dataDir = tempDir('rec-complete-data');
  const worktreesRoot = tempDir('rec-complete-wt');
  const projectDir = tempDir('rec-complete-project');
  const seed = createRuntimeService({
    dataDir, worktreesRoot, adapters: { 'claude-code': makeAdapter() },
    supervisor: createFakeSupervisor().factory, logger: quiet,
  });
  const { project } = await seed.registerProject({ projectPath: projectDir, name: 'P' });
  const task = seed.createTask({ projectId: project.id, title: 'Completed before exit', prompt: 'done', agent: 'claude-code' });
  const run = seed.db.createRun({ taskId: task.id, status: 'running' });
  seed.db.updateRun(run.id, { status: 'completed', ended_at: Date.now() });
  seed.db.updateTask(task.id, { status: 'running', summary: 'completed output' });
  seed.db.close();

  const service = createRuntimeService({
    dataDir, worktreesRoot, adapters: { 'claude-code': makeAdapter() },
    supervisor: createFakeSupervisor().factory, logger: quiet,
  });
  t.after(async () => {
    await service.shutdown();
    for (const dir of [dataDir, worktreesRoot, projectDir]) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  const detail = service.getTaskDetail(task.id);
  assert.equal(detail.task.status, 'review');
  assert.equal(detail.runs[0].status, 'completed');
  assert.equal(service.statusSnapshot().recovery.runsFailed, 0);
  assert.equal(service.statusSnapshot().recovery.tasksReviewed, 1);
  assert.equal(service.statusSnapshot().recovery.tasksStopped, 0);
});
