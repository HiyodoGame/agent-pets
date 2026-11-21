// M4: manager chat -> pending proposal -> user confirmation -> tasks -> daily report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntimeService } from './service.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeout = 8000, label = 'condition') {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await fn();
    if (value) return value;
    await sleep(30);
  }
  throw new Error('timeout waiting for ' + label);
}

function tempDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-' + tag + '-')); }

function today() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
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

function makeSupervisor() {
  return {
    record: { starts: [] },
    factory({ onEvent, onExit }) {
      return {
        start({ runId, taskId }) {
          const handle = { runId, taskId, pid: 6000 + Math.floor(Math.random() * 1000), stop: null };
          let alive = true;
          const emit = (type, payload) => { if (alive) onEvent(type, payload, { taskId, runId }); };
          const exit = () => {
            if (!alive) return;
            alive = false;
            onEvent('run.exited', { code: 0, signal: null }, { taskId, runId });
            onExit({ runId, taskId });
          };
          handle.stop = async () => { alive = false; onExit({ runId, taskId }); };
          setTimeout(() => {
            emit('run.started', { sessionId: 'sess-m4-' + runId });
            emit('message.assistant', { text: 'done from fake agent' });
            emit('run.completed', { sessionId: 'sess-m4-' + runId, result: 'done' });
            setTimeout(exit, 0);
          }, 0);
          return handle;
        },
        async stopAll() {},
      };
    },
  };
}

function makeService(t, { manager = null } = {}) {
  const dataDir = tempDir('m4-data');
  const worktreesRoot = tempDir('m4-wt');
  const service = createRuntimeService({
    dataDir,
    worktreesRoot,
    adapters: { 'claude-code': makeAdapter() },
    supervisor: makeSupervisor().factory,
    managerClient: manager,
    logger: { error() {} },
  });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(worktreesRoot, { recursive: true, force: true });
  });
  return service;
}

function readyManager(t) {
  const calls = [];
  const manager = {
    calls,
    async chat(args) {
      calls.push(args);
      return { content: '经理回复', toolCalls: [], model: 'mock-manager', usage: { total_tokens: 1 } };
    },
  };
  const service = makeService(t, { manager });
  service.updateManagerSettings({ provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'mock-manager' });
  return { service, manager, calls };
}

test('m4: manager settings keep the key private and validate patches', async (t) => {
  const { service, manager } = readyManager(t);
  const settings = service.getManagerSettings();
  assert.equal(settings.ready, true);
  assert.equal(settings.apiKeySet, false);
  assert.equal('apiKey' in settings, false);
  const withKey = service.updateManagerSettings({ apiKey: 'sk-private' });
  assert.equal(withKey.apiKeySet, true);
  assert.equal(JSON.stringify(withKey).includes('sk-private'), false);
  assert.throws(() => service.updateManagerSettings({ baseUrl: 'ftp://bad' }), (error) => error.code === 'INVALID_INPUT');
  const tested = await service.testManager();
  assert.equal(tested.ok, true);
  assert.equal(tested.model, 'mock-manager');
  assert.equal(manager.calls.length, 1);
});

test('m4: a proposal creates no task until the user confirms it', async (t) => {
  const calls = [];
  const manager = {
    calls,
    async chat(args) {
      calls.push(args);
      return {
        content: '我建议拆成两个任务。',
        toolCalls: [{
          id: 'call-1',
          name: 'propose_tasks',
          arguments: JSON.stringify({
            summary: '先做后端，再做前端',
            tasks: [
              { ref: 't1', title: '后端接口', prompt: '实现接口', acceptance: '接口返回 200', agent: 'claude-code' },
              { ref: 't2', title: '前端页面', prompt: '实现页面', acceptance: '页面可见', agent: 'claude-code', depends_on: ['t1'] },
            ],
          }),
        }],
        model: 'mock-manager',
        usage: null,
      };
    },
  };
  const service = makeService(t, { manager });
  service.updateManagerSettings({ provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'mock-manager' });
  const repo = tempDir('m4-repo');
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { project } = await service.registerProject({ projectPath: repo });

  const sent = await service.sendManagerMessage({ content: '做一个登录页', projectId: project.id });
  assert.equal(sent.proposal.status, 'pending');
  assert.equal(service.listTasks(project.id).length, 0, 'proposal alone never creates tasks');
  assert.equal(service.listManagerMessages().length, 2);

  const confirmed = await service.confirmProposal(sent.proposal.id, { start: false });
  assert.equal(confirmed.proposal.status, 'confirmed');
  assert.equal(confirmed.tasks.length, 2);
  const [first, second] = confirmed.tasks;
  assert.deepEqual(second.depends_on, [first.id]);
  assert.equal(first.status, 'ready');
  assert.equal(second.status, 'ready');
  assert.equal(confirmed.started.length, 0);

  await service.startTask(first.id);
  await waitFor(() => service.getTaskDetail(first.id).task.status === 'review', 8000, 'first review');
  await service.acceptTask(first.id);
  assert.equal(service.getTaskDetail(first.id).task.status, 'completed');
  await service.startTask(second.id);
  await waitFor(() => service.getTaskDetail(second.id).task.status === 'review', 8000, 'second review');
  const accepted = await service.acceptTask(second.id);
  assert.equal(accepted.task.status, 'completed');
});

test('m4: confirming with start dispatches independent tasks and defers dependents', async (t) => {
  const manager = {
    async chat() {
      return {
        content: '',
        toolCalls: [{
          id: 'call-1',
          name: 'propose_tasks',
          arguments: JSON.stringify({
            tasks: [
              { ref: 'a', title: '独立任务', prompt: 'do a' },
              { ref: 'b', title: '依赖任务', prompt: 'do b', depends_on: ['a'] },
            ],
          }),
        }],
        model: 'mock-manager',
      };
    },
  };
  const service = makeService(t, { manager });
  service.updateManagerSettings({ provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'mock-manager' });
  const repo = tempDir('m4-repo-start');
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { project } = await service.registerProject({ projectPath: repo });
  const sent = await service.sendManagerMessage({ content: '两个任务', projectId: project.id });
  const confirmed = await service.confirmProposal(sent.proposal.id, { start: true });
  assert.equal(confirmed.proposal.status, 'confirmed');
  assert.equal(confirmed.started.length, 2);
  assert.equal(confirmed.started[0].error, undefined);
  assert.equal(confirmed.started[1].deferred, true);
  const detail = service.getTaskDetail(confirmed.tasks[0].id);
  assert.ok(['running', 'review', 'completed'].includes(detail.task.status));
  await waitFor(() => service.getTaskDetail(confirmed.tasks[0].id).task.status === 'review', 8000, 'dispatched task review');
});

test('m4: daily report falls back locally and upgrades to the manager', async (t) => {
  const manager = {
    async chat() {
      return { content: '## 今日产出\n- 已完成登录页\n\n## 明天建议\n- 补测试', toolCalls: [], model: 'mock-manager' };
    },
  };
  const service = makeService(t, { manager });
  const date = today();
  const local = await service.generateDailyReport({ date });
  assert.equal(local.source, 'local');
  assert.match(local.body, /## 今日产出/);
  assert.equal(local.date, date);

  service.updateManagerSettings({ provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', model: 'mock-manager' });
  const upgraded = await service.generateDailyReport({ date });
  assert.equal(upgraded.source, 'manager');
  assert.match(upgraded.body, /补测试/);
  assert.equal(service.listReports({ limit: 10 }).length, 1, 'same date+project upserts one report');
  assert.equal(service.getReport(upgraded.id).id, upgraded.id);
  assert.throws(() => service.getReport('missing'), (error) => error.code === 'REPORT_NOT_FOUND');
});
