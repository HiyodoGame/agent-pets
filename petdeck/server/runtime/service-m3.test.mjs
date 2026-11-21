// M3 lifecycle: review -> accept/reject -> merge authorization -> cleanup.
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
  while (Date.now() - started < timeout) {
    const value = await fn();
    if (value) return value;
    await sleep(40);
  }
  throw new Error('timeout waiting for ' + label);
}

function tempDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-' + tag + '-')); }

function gitIn(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
}

function makeGitRepo() {
  const dir = tempDir('m3-repo');
  gitIn(dir, 'init');
  gitIn(dir, 'config', 'user.email', 'test@example.com');
  gitIn(dir, 'config', 'user.name', 'PetDeck Test');
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  gitIn(dir, 'add', '.');
  gitIn(dir, 'commit', '-m', 'init');
  return dir;
}

function makeAdapter(calls, id = 'claude-code') {
  return {
    id,
    command: process.execPath,
    normalizePermissionMode: (value) => value || 'acceptEdits',
    buildArgs({ prompt, sessionId, permissionMode }) {
      calls.push({ agent: id, prompt, sessionId, permissionMode });
      return ['--fake-agent', prompt];
    },
    parseLine() { return { events: [] }; },
  };
}

// The action runs inside the task worktree before the fake run completes, so
// the test exercises real commits, real diffs and real worktree cleanup.
function createActionSupervisor(mode = 'done', action = null, result = 'done') {
  const record = { starts: [], stops: [] };
  return {
    record,
    factory({ onEvent, onExit }) {
      return {
        start({ runId, taskId, command, args, cwd }) {
          record.starts.push({ runId, taskId, command, args, cwd });
          let alive = true;
          const handle = { runId, taskId, pid: 5000 + record.starts.length, stop: null };
          const emit = (type, payload) => { if (alive) onEvent(type, payload, { taskId, runId }); };
          const exit = (payload) => {
            if (!alive) return;
            alive = false;
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
            emit('run.started', { sessionId: 'sess-' + record.starts.length });
            let touched = [];
            try { touched = action?.(cwd, record.starts.length) || []; }
            catch (e) {
              emit('run.failed', { subtype: 'error', error: e?.message ?? String(e) });
              exit({ code: 1, signal: null });
              return;
            }
            for (const file of touched) emit('tool.started', { name: 'Write', input: { path: file } });
            emit('message.assistant', { text: 'hello from fake agent' });
            if (mode === 'long') return;
            setTimeout(() => {
              if (!alive) return;
              emit('run.completed', { sessionId: 'sess-' + record.starts.length, result });
              setTimeout(() => exit({ code: 0, signal: null }), 0);
            }, 5);
          }, 0);
          return handle;
        },
        async stopAll() {
          for (const handle of record.starts) await handle.stop?.();
        },
      };
    },
  };
}

function makeService(t, { action = null, agents = ['claude-code'], mode = 'done', result = 'done' } = {}) {
  const dataDir = tempDir('m3-data');
  const worktreesRoot = tempDir('m3-wt');
  const calls = [];
  const adapters = Object.fromEntries(agents.map((id) => [id, makeAdapter(calls, id)]));
  const fake = createActionSupervisor(mode, action, result);
  const service = createRuntimeService({
    dataDir,
    worktreesRoot,
    adapters,
    supervisor: fake.factory,
    logger: { error() {} },
  });
  t.after(async () => {
    await service.shutdown();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(worktreesRoot, { recursive: true, force: true });
  });
  return { service, calls, fake };
}

async function startAndReview(service, project, task) {
  await service.startTask(task.id);
  return waitFor(() => {
    const detail = service.getTaskDetail(task.id);
    return detail.task.status === 'review' ? detail : null;
  }, 8000, 'review');
}

test('m3: git task collects artifacts, accepts, previews, merges with token, then cleans up', async (t) => {
  const repo = makeGitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { service } = makeService(t, {
    action(cwd) {
      fs.writeFileSync(path.join(cwd, 'result.txt'), 'delivered\n');
      fs.writeFileSync(path.join(cwd, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));
      gitIn(cwd, 'add', '.');
      gitIn(cwd, 'commit', '-m', 'deliver result');
      return ['result.txt', 'shot.png'];
    },
  });

  const { project } = await service.registerProject({ projectPath: repo });
  assert.ok(project.base_branch, 'project records its base branch');
  const task = service.createTask({ projectId: project.id, title: 'M3 deliver', prompt: 'write result.txt' });
  const detail = await startAndReview(service, project, task);

  assert.equal(detail.task.summary, 'done');
  const names = detail.artifacts.map((a) => a.name).sort();
  assert.deepEqual(names, ['result.txt', 'shot.png']);
  assert.equal(detail.artifacts.find((a) => a.name === 'shot.png').kind, 'image');
  assert.ok(detail.task.worktree_path && fs.existsSync(detail.task.worktree_path));
  const reviewEvent = service.listEvents(task.id).find((event) => event.type === 'task.review_requested');
  assert.equal(reviewEvent.payload.artifact_count, 2, 'review event reports collected artifacts after the exit race');

  const accepted = await service.acceptTask(task.id);
  assert.equal(accepted.merge_required, true);
  assert.equal(accepted.task.status, 'pending_merge');
  assert.match(accepted.merge_token, /^[0-9a-f]{32}$/);

  const preview = await service.mergePreviewForTask(task.id);
  assert.equal(preview.clean, true);
  assert.equal(preview.branch, detail.task.branch);
  assert.equal(preview.base_branch, project.base_branch);

  await assert.rejects(
    () => service.mergeTask(task.id, { token: 'deadbeef'.repeat(4) }),
    (error) => error.code === 'MERGE_TOKEN_INVALID' && error.status === 409,
  );
  const merged = await service.mergeTask(task.id, { token: accepted.merge_token });
  assert.equal(merged.task.status, 'merged');
  assert.ok(merged.task.merged_at);
  assert.ok(fs.existsSync(path.join(repo, 'result.txt')), 'merge lands on the base branch');

  const cleaned = await service.cleanupTask(task.id);
  assert.equal(cleaned.task.worktree_path, null);
  assert.equal(cleaned.task.branch, null);
  assert.equal(fs.existsSync(detail.task.worktree_path), false);
});

test('m3: conflicting branches are reported and never merged', async (t) => {
  const repo = makeGitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { service } = makeService(t, {
    action(cwd) {
      fs.writeFileSync(path.join(cwd, 'conflict.txt'), 'worktree\n');
      gitIn(cwd, 'add', '.');
      gitIn(cwd, 'commit', '-m', 'worktree change');
      return ['conflict.txt'];
    },
  });

  const { project } = await service.registerProject({ projectPath: repo });
  const task = service.createTask({ projectId: project.id, title: 'M3 conflict', prompt: 'edit conflict.txt' });
  const detail = await startAndReview(service, project, task);

  fs.writeFileSync(path.join(repo, 'conflict.txt'), 'base\n');
  gitIn(repo, 'add', '.');
  gitIn(repo, 'commit', '-m', 'base change');

  const accepted = await service.acceptTask(task.id);
  const preview = await service.mergePreviewForTask(task.id);
  assert.equal(preview.clean, false);
  assert.ok(preview.conflicts.includes('conflict.txt'));

  await assert.rejects(
    () => service.mergeTask(task.id, { token: accepted.merge_token }),
    (error) => error.code === 'MERGE_CONFLICT' && error.details.conflicts.includes('conflict.txt'),
  );
  const abandoned = await service.abandonMerge(task.id);
  assert.equal(abandoned.task.status, 'completed');
  assert.equal(service.getTaskDetail(task.id).task.status, 'completed');
  assert.equal(fs.readFileSync(path.join(repo, 'conflict.txt'), 'utf8'), 'base\n');
  await service.cleanupTask(task.id);
  assert.equal(fs.existsSync(detail.task.worktree_path), false);
});

test('m3: rejecting onto another agent opens a new run without overwriting history', async (t) => {
  const repo = makeGitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { service, calls } = makeService(t, {
    agents: ['claude-code', 'kimi-code'],
    action(cwd, index) {
      fs.writeFileSync(path.join(cwd, 'run-' + index + '.txt'), String(index));
      gitIn(cwd, 'add', '.');
      gitIn(cwd, 'commit', '-m', 'run ' + index);
      return ['run-' + index + '.txt'];
    },
  });

  const { project } = await service.registerProject({ projectPath: repo });
  const task = service.createTask({ projectId: project.id, title: 'M3 rework', prompt: 'original request', agent: 'claude-code' });
  const first = await startAndReview(service, project, task);
  assert.equal(first.runs.length, 1);

  await service.rejectTask(task.id, { feedback: 'please tighten the copy', agent: 'kimi-code' });
  assert.equal(calls.at(-1).agent, 'kimi-code');
  assert.equal(calls.at(-1).sessionId, null, 'switching agent starts a clean session');
  assert.match(calls.at(-1).prompt, /original request/);
  assert.match(calls.at(-1).prompt, /please tighten the copy/);

  const second = await waitFor(() => {
    const detail = service.getTaskDetail(task.id);
    return detail.task.status === 'review' && detail.runs.length === 2 ? detail : null;
  }, 8000, 'second review');
  assert.equal(second.task.agent, 'kimi-code');
  assert.equal(second.task.reject_count, 1);
  assert.equal(second.task.last_feedback, 'please tighten the copy');
  assert.equal(second.runs[0].status, 'completed', 'old run is preserved');
  assert.equal(second.runs[1].status, 'completed');

  const worktree = second.task.worktree_path;
  const manual = path.join(worktree, 'review.pdf');
  fs.writeFileSync(manual, 'pdf');
  const added = service.addArtifact(task.id, { path: 'review.pdf' });
  assert.equal(added.kind, 'pdf');
  assert.throws(
    () => service.addArtifact(task.id, { path: '../../outside.txt' }),
    (error) => error.code === 'ARTIFACT_INVALID',
  );
  service.removeArtifact(task.id, added.id);
  assert.equal(service.listArtifacts(task.id).some((a) => a.id === added.id), false);
});

test('m3: merge can be re-authorized after a reload and the old token stops working', async (t) => {
  const repo = makeGitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { service } = makeService(t, {
    action(cwd) {
      fs.writeFileSync(path.join(cwd, 'authorize.txt'), 'ok\n');
      gitIn(cwd, 'add', '.');
      gitIn(cwd, 'commit', '-m', 'authorize');
      return ['authorize.txt'];
    },
  });

  const { project } = await service.registerProject({ projectPath: repo });
  const task = service.createTask({ projectId: project.id, title: 'M3 authorize', prompt: 'write authorize.txt' });
  await startAndReview(service, project, task);

  await assert.rejects(
    () => service.authorizeMerge(task.id),
    (error) => error.code === 'TASK_NOT_PENDING_MERGE' && error.status === 409,
    'review tasks cannot be authorized before acceptance',
  );

  const accepted = await service.acceptTask(task.id);
  const reauthorized = await service.authorizeMerge(task.id);
  assert.equal(reauthorized.task.status, 'pending_merge');
  assert.equal(reauthorized.merge_required, true);
  assert.match(reauthorized.merge_token, /^[0-9a-f]{32}$/);
  assert.notEqual(reauthorized.merge_token, accepted.merge_token);
  assert.ok(reauthorized.merge_token_expires > Date.now());

  await assert.rejects(
    () => service.mergeTask(task.id, { token: accepted.merge_token }),
    (error) => error.code === 'MERGE_TOKEN_INVALID',
    'the previous authorization is revoked once a new token is issued',
  );

  const merged = await service.mergeTask(task.id, { token: reauthorized.merge_token });
  assert.equal(merged.task.status, 'merged');
  assert.ok(fs.existsSync(path.join(repo, 'authorize.txt')));
  await service.cleanupTask(task.id);
});

test('m3: uncommitted agent output is committed before review and survives merge', async (t) => {
  const repo = makeGitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { service } = makeService(t, {
    action(cwd) {
      fs.writeFileSync(path.join(cwd, 'deliver.txt'), 'uncommitted agent output\n');
      return ['deliver.txt'];
    },
  });

  const { project } = await service.registerProject({ projectPath: repo });
  const task = service.createTask({ projectId: project.id, title: 'M3 auto commit', prompt: 'write deliver.txt' });
  const detail = await startAndReview(service, project, task);

  assert.equal(detail.task.status, 'review');
  assert.equal(gitIn(detail.task.worktree_path, 'status', '--porcelain').trim(), '', 'worktree is clean before review');
  assert.match(gitIn(detail.task.worktree_path, 'log', '-1', '--format=%s'), /^PetDeck: /);

  const accepted = await service.acceptTask(task.id);
  assert.equal(accepted.merge_required, true);
  await service.mergeTask(task.id, { token: accepted.merge_token });
  assert.match(fs.readFileSync(path.join(repo, 'deliver.txt'), 'utf8'), /^uncommitted agent output\r?\n$/);
  await service.cleanupTask(task.id);
});

test('m3: a Kimi resume hint is not used as the review summary', async (t) => {
  const repo = makeGitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const { service } = makeService(t, { result: 'To resume this session: kimi -r session_fake' });

  const { project } = await service.registerProject({ projectPath: repo });
  const task = service.createTask({ projectId: project.id, title: 'M3 summary', prompt: 'summarize' });
  const detail = await startAndReview(service, project, task);

  assert.equal(detail.task.summary, 'hello from fake agent');
});

