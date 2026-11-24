// M2 runtime: scheduling, dependencies, pause/resume, decision cards, capability list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntimeService } from './service.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 5000, label = 'condition') {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await fn();
    if (value) return value;
    await sleep(25);
  }
  throw new Error('timeout waiting for ' + label);
}

function tempDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-' + tag + '-')); }

function makeAdapter(calls, overrides = {}) {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    form: 'cli',
    command: process.execPath,
    capabilities: { host: true, stream: true, resume: true, suspend: true, decisions: true, permissionModes: ['default', 'acceptEdits'] },
    normalizePermissionMode: (value) => value || 'acceptEdits',
    buildArgs({ prompt, sessionId, permissionMode }) {
      calls.push({ prompt, sessionId, permissionMode });
      return ['--fake-agent', prompt];
    },
    parseLine() { return { events: [] }; },
    ...overrides,
  };
}

/** Supervisor with explicit emit/exit control; supports suspend/resume. */
function createScriptedSupervisor() {
  const record = { starts: [], stops: [], suspends: [], resumes: [], stopAllCalls: 0, runs: [] };
  return {
    record,
    factory({ onEvent, onExit }) {
      return {
        start({ runId, taskId, command, args, cwd }) {
          record.starts.push({ runId, taskId, command, args, cwd });
          let alive = true;
          const run = { runId, taskId, alive: true };
          const emit = (type, payload) => { if (alive) onEvent(type, payload, { taskId, runId }); };
          const exit = (payload) => {
            if (!alive) return;
            alive = false;
            run.alive = false;
            onEvent('run.exited', payload, { taskId, runId });
            onExit({ runId, taskId });
          };
          const handle = {
            runId, taskId, pid: 5000 + record.starts.length, paused: false,
            emit,
            exit,
            stop: async () => {
              if (!alive) return;
              record.stops.push({ runId, taskId });
              exit({ code: null, signal: 'SIGTERM', stopped: true });
            },
            suspend: async () => {
              if (!alive) return { ok: false, code: 'not-running' };
              record.suspends.push({ runId, taskId });
              handle.paused = true;
              return { ok: true };
            },
            resume: async () => {
              if (!alive) return { ok: false, code: 'not-running' };
              record.resumes.push({ runId, taskId });
              handle.paused = false;
              return { ok: true };
            },
          };
          record.runs.push({ runId, taskId, handle, emit, exit });
          return handle;
        },
        async stopAll() {
          record.stopAllCalls += 1;
          for (const run of record.runs) {
            if (run.handle.paused) run.handle.resume();
            run.handle.stop();
          }
        },
      };
    },
  };
}

function makeService(t, { supervisor = null, maxConcurrent = null } = {}) {
  const dataDir = tempDir('m2-data');
  const worktreesRoot = tempDir('m2-wt');
  const calls = [];
  const fake = supervisor ?? createScriptedSupervisor();
  const service = createRuntimeService({
    dataDir,
    worktreesRoot,
    adapters: { 'claude-code': makeAdapter(calls) },
    supervisor: fake.factory,
    logger: { error() {} },
  });
  if (maxConcurrent != null) service.updateSettings({ maxConcurrent });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(worktreesRoot, { recursive: true, force: true });
  });
  return { service, calls, fake };
}

function autoSupervisor({ decisionFirstRun = false } = {}) {
  const record = { starts: [], runs: 0 };
  return {
    record,
    factory({ onEvent, onExit }) {
      return {
        start({ runId, taskId, command: _command, args, cwd }) {
          record.starts.push({ runId, taskId, args, cwd });
          record.runs += 1;
          const nth = record.runs;
          const handle = { runId, taskId, pid: 6000 + nth, stop: async () => {} };
          setTimeout(() => {
            onEvent('run.started', { sessionId: 'sess-m2' }, { taskId, runId });
            if (decisionFirstRun && nth === 1) {
              onEvent('run.completed', {
                sessionId: 'sess-m2',
                result: '初稿写好了，但需要你确认发布方式：\n1. 直接发布\n2. 先预览',
              }, { taskId, runId });
            } else {
              onEvent('run.completed', { sessionId: 'sess-m2', result: 'done' }, { taskId, runId });
            }
            setTimeout(() => {
              onEvent('run.exited', { code: 0, signal: null, stopped: false }, { taskId, runId });
              onExit({ runId, taskId });
            }, 0);
          }, 0);
          return handle;
        },
        async stopAll() {},
      };
    },
  };
}

test('scheduler: over-capacity tasks queue and drain when a slot frees', async (t) => {
  const { service, fake } = makeService(t, { maxConcurrent: 1 });
  const { project } = await service.registerProject({ projectPath: tempDir('m2-queue-proj') });
  const a = service.createTask({ projectId: project.id, title: 'A', prompt: 'a' });
  const b = service.createTask({ projectId: project.id, title: 'B', prompt: 'b' });

  const startedA = await service.startTask(a.id);
  assert.equal(startedA.status, 'starting');
  const queuedB = await service.startTask(b.id);
  assert.equal(queuedB.queued, true);
  assert.equal(service.getTaskDetail(b.id).task.status, 'queued');
  assert.equal(fake.record.starts.length, 1);

  fake.record.runs[0].emit('run.started', { sessionId: 'sess-a' });
  await service.stopTask(a.id);
  await waitFor(() => service.getTaskDetail(b.id).task.status === 'running', 3000, 'queued B to start');
  assert.equal(fake.record.starts.length, 2);
  await service.stopTask(b.id);
});

test('dependencies: task cannot start before its dependency completes', async (t) => {
  const auto = autoSupervisor();
  const { service } = makeService(t, { supervisor: auto });
  const { project } = await service.registerProject({ projectPath: tempDir('m2-dep-proj') });
  const first = service.createTask({ projectId: project.id, title: 'First', prompt: 'first' });
  const second = service.createTask({ projectId: project.id, title: 'Second', prompt: 'second', dependsOn: [first.id] });

  await assert.rejects(() => service.startTask(second.id), (e) => e.code === 'DEPENDENCY_NOT_MET');
  await service.startTask(first.id);
  await waitFor(() => service.getTaskDetail(first.id).task.status === 'review', 3000, 'first review');
  await service.acceptTask(first.id);
  assert.equal(service.getTaskDetail(first.id).task.status, 'completed');
  await service.startTask(second.id);
  await waitFor(() => service.getTaskDetail(second.id).task.status === 'review', 3000, 'second review');
  assert.deepEqual(service.getTaskDetail(second.id).task.depends_on, [first.id]);
});

test('decisions: a question becomes a pending card and the answer resumes with the choice', async (t) => {
  const auto = autoSupervisor({ decisionFirstRun: true });
  const { service, calls } = makeService(t, { supervisor: auto });
  const { project } = await service.registerProject({ projectPath: tempDir('m2-decision-proj') });
  const task = service.createTask({ projectId: project.id, title: 'Decision', prompt: 'work' });

  await service.startTask(task.id);
  await waitFor(() => service.getTaskDetail(task.id).task.status === 'waiting', 3000, 'waiting for decision');
  const open = service.listDecisions();
  assert.equal(open.length, 1);
  assert.match(open[0].question, /发布方式/);
  assert.deepEqual(open[0].options, ['直接发布', '先预览']);

  await waitFor(() => service.activeCount === 0, 3000, 'process exit');
  const answered = await service.answerDecision(open[0].id, { optionIndex: 1 });
  assert.equal(answered.decision.answer, '先预览');
  assert.match(calls.at(-1).prompt, /先预览/);
  assert.equal(calls.at(-1).sessionId, 'sess-m2');
  await waitFor(() => service.getTaskDetail(task.id).task.status === 'review', 3000, 'resumed review');
  assert.equal(service.getTaskDetail(task.id).decisions[0].status, 'answered');
});

test('decisions: an expired decision rejects late answers without launching a run', async (t) => {
  const auto = autoSupervisor({ decisionFirstRun: true });
  const { service, calls } = makeService(t, { supervisor: auto });
  const { project } = await service.registerProject({ projectPath: tempDir('m2-expired-decision') });
  const task = service.createTask({ projectId: project.id, title: 'Expired decision', prompt: 'work' });

  await service.startTask(task.id);
  await waitFor(() => service.getTaskDetail(task.id).task.status === 'waiting', 3000, 'waiting for decision');
  await waitFor(() => service.activeCount === 0, 3000, 'process exit');
  const decision = service.listDecisions()[0];
  service.db.updateDecision(decision.id, { expires_at: Date.now() - 1 });

  await assert.rejects(
    () => service.answerDecision(decision.id, { optionIndex: 0 }),
    (error) => error.code === 'DECISION_EXPIRED' && error.status === 409,
  );
  assert.equal(service.db.getDecision(decision.id).status, 'expired');
  assert.equal(service.getTaskDetail(task.id).task.status, 'review');
  assert.equal(calls.length, 1, 'late answer must not start another Agent run');
});

test('pause/resume: suspend and resume the live process', async (t) => {
  const { service, fake } = makeService(t);
  const { project } = await service.registerProject({ projectPath: tempDir('m2-pause-proj') });
  const task = service.createTask({ projectId: project.id, title: 'Pause', prompt: 'x' });
  await service.startTask(task.id);
  fake.record.runs[0].emit('run.started', { sessionId: 'sess-p' });

  const paused = await service.pauseTask(task.id);
  assert.equal(paused.task.status, 'paused');
  assert.equal(paused.runs[0].status, 'paused');
  assert.equal(fake.record.suspends.length, 1);

  const resumed = await service.resumePausedTask(task.id);
  assert.equal(resumed.task.status, 'running');
  assert.equal(resumed.runs[0].status, 'running');
  assert.equal(fake.record.resumes.length, 1);

  await service.stopTask(task.id);
});

test('settings and agents: capability matrix and validated concurrency', async (t) => {
  const { service } = makeService(t);
  assert.equal(service.getSettings().maxConcurrent, 2);
  assert.equal(service.updateSettings({ maxConcurrent: 3 }).maxConcurrent, 3);
  await assert.rejects(async () => service.updateSettings({ maxConcurrent: 0 }), (e) => e.code === 'INVALID_INPUT');

  const agents = service.listAgents();
  assert.equal(agents.length, 1);
  assert.equal(agents[0].capabilities.suspend, true);
  assert.deepEqual(agents[0].capabilities.permissionModes, ['default', 'acceptEdits']);
});

test('dependencies: unknown or cross-project dependencies are rejected', async (t) => {
  const { service } = makeService(t);
  const p1 = (await service.registerProject({ projectPath: tempDir('m2-dep-a') })).project;
  const p2 = (await service.registerProject({ projectPath: tempDir('m2-dep-b') })).project;
  const other = service.createTask({ projectId: p2.id, title: 'Other', prompt: 'x' });
  assert.throws(
    () => service.createTask({ projectId: p1.id, title: 'Bad', prompt: 'x', dependsOn: ['missing-id'] }),
    (e) => e.code === 'DEPENDENCY_NOT_FOUND',
  );
  assert.throws(
    () => service.createTask({ projectId: p1.id, title: 'Cross', prompt: 'x', dependsOn: [other.id] }),
    (e) => e.code === 'DEPENDENCY_CROSS_PROJECT',
  );
});
