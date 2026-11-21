// End-to-end runtime slice over the real bridge HTTP/SSE surface.
// The agent process is a fake supervisor (no OS spawn): this exercises project
// registration, task lifecycle, event fan-out, transcript persistence, stop and
// --resume wiring. Real process launch is covered by supervisor tests and needs a
// host that permits piped child stdio.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../bridge.mjs';
import { createRuntimeService } from './service.mjs';

function makeFakeSupervisor(script) {
  return (hooks) => {
    const handles = new Map();
    return {
      start({ runId, taskId, args, cwd }) {
        const handle = {
          runId, taskId, pid: 4242,
          stop: async () => {
            handles.delete(runId);
            hooks.onEvent('run.exited', { code: null, signal: null, stopped: true }, { runId, taskId });
            hooks.onExit({ runId, taskId, code: null, signal: null, stopped: true });
          },
        };
        handles.set(runId, handle);
        script({ hooks, runId, taskId, args, cwd, handle });
        return handle;
      },
      async stopAll() {
        for (const h of [...handles.values()]) await h.stop();
      },
    };
  };
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function withBridge(t, { script, token = 'e2e-token' }) {
  const dataDir = tempDir('pd-e2e-data-');
  const worktreesRoot = tempDir('pd-e2e-wt-');
  const projectDir = tempDir('pd-e2e-proj-');
  fs.writeFileSync(path.join(projectDir, 'README.md'), '# e2e project\n', 'utf8');

  const runtime = createRuntimeService({
    dataDir,
    worktreesRoot,
    adapters: {
      'claude-code': {
        id: 'claude-code', name: 'Claude Code', command: 'claude',
        buildArgs: ({ prompt, sessionId, permissionMode }) => {
          const args = ['-p', '--permission-mode', permissionMode];
          if (sessionId) args.push('--resume', sessionId);
          args.push(prompt);
          return args;
        },
        parseLine: () => ({ events: [] }),
        normalizePermissionMode: (m) => (['default', 'acceptEdits', 'bypassPermissions', 'plan'].includes(m) ? m : 'acceptEdits'),
      },
    },
    supervisor: makeFakeSupervisor(script),
    logger: { error() {} },
  });

  const server = createApp({
    adapters: [],
    security: { token, allowedOrigins: ['http://localhost:5173'] },
    runtime,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  const api = async (urlPath, init = {}) => {
    const headers = { Origin: 'http://localhost:5173', 'X-Petdeck-Token': token, ...(init.body ? { 'Content-Type': 'application/json' } : {}) };
    const res = await fetch(base + urlPath, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await runtime.shutdown();
    for (const dir of [dataDir, worktreesRoot, projectDir]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  return { api, runtime, projectDir, dataDir, base, token };
}

async function waitFor(fn, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('runtime bridge: register -> task -> start -> stream -> complete -> resume', async (t) => {
  const calls = [];
  const { api, runtime, projectDir, dataDir } = await withBridge(t, {
    script({ hooks, runId, taskId, args }) {
      calls.push({ runId, taskId, args });
      setTimeout(() => {
        hooks.onEvent('run.started', { sessionId: 'sess-e2e-1' }, { runId, taskId });
        hooks.onEvent('message.assistant', { text: 'working on it' }, { runId, taskId });
        hooks.onEvent('run.completed', { sessionId: 'sess-e2e-1', subtype: 'success' }, { runId, taskId });
        hooks.onEvent('run.exited', { code: 0, signal: null, stopped: false }, { runId, taskId });
        hooks.onExit({ runId, taskId, code: 0, signal: null, stopped: false });
      }, 10);
    },
  });

  const registered = await api('/api/runtime/projects', { method: 'POST', body: JSON.stringify({ path: projectDir, name: 'E2E' }) });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.created, true);
  const projectId = registered.body.project.id;

  const again = await api('/api/runtime/projects', { method: 'POST', body: JSON.stringify({ path: projectDir }) });
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false);

  const created = await api('/api/runtime/tasks', { method: 'POST', body: JSON.stringify({ projectId, title: 'Fix the bug', prompt: 'fix it', agent: 'claude-code' }) });
  assert.equal(created.status, 201);
  const taskId = created.body.task.id;
  assert.equal(created.body.task.status, 'ready');

  const started = await api('/api/runtime/tasks/' + taskId + '/start', { method: 'POST', body: '{}' });
  assert.equal(started.status, 202);
  assert.ok(started.body.run.runId);

  const detail = await waitFor(async () => {
    const r = await api('/api/runtime/tasks/' + taskId);
    return r.body.task.status === 'review' ? r.body : null;
  });
  assert.equal(detail.runs.length, 1);
  assert.equal(detail.task.session_id, 'sess-e2e-1');
  assert.equal(detail.runs[0].status, 'completed');
  assert.equal(detail.runs[0].exit_code, 0);

  const events = await api('/api/runtime/tasks/' + taskId + '/events');
  const types = events.body.events.map((e) => e.type);
  for (const type of ['run.starting', 'run.started', 'message.assistant', 'run.completed', 'run.exited']) {
    assert.ok(types.includes(type), 'missing event ' + type + ' in ' + types.join(','));
  }
  const transcript = path.join(dataDir, 'runs', detail.runs[0].id, 'events.jsonl');
  assert.ok(fs.existsSync(transcript), 'transcript exists');
  assert.ok(fs.readFileSync(transcript, 'utf8').trim().split('\n').length >= 5);

  // Rejection must pass the persisted session id through to the CLI and open a new run.
  const rejected = await api('/api/runtime/tasks/' + taskId + '/reject', {
    method: 'POST', body: JSON.stringify({ feedback: 'try again' }),
  });
  assert.equal(rejected.status, 200);
  await waitFor(async () => (await api('/api/runtime/tasks/' + taskId)).body.runs.length === 2);
  assert.equal(calls.length, 2);
  const resumeArgs = calls[1].args;
  assert.ok(resumeArgs.includes('--resume'));
  assert.equal(resumeArgs[resumeArgs.indexOf('--resume') + 1], 'sess-e2e-1');
  await waitFor(async () => (await api('/api/runtime/tasks/' + taskId)).body.task.status === 'review');
});

test('runtime bridge: live SSE delivers events and stop settles the task', async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { api, base, token } = await withBridge(t, {
    script({ hooks, runId, taskId }) {
      setTimeout(() => hooks.onEvent('run.started', { sessionId: 'sess-e2e-2' }, { runId, taskId }), 5);
      gate.then(() => {
        hooks.onEvent('message.assistant', { text: 'done' }, { runId, taskId });
      });
    },
  });

  const project = await api('/api/runtime/projects', { method: 'POST', body: JSON.stringify({ path: tempDir('pd-e2e-proj2-') }) });
  const projectId = project.body.project.id;
  const created = await api('/api/runtime/tasks', { method: 'POST', body: JSON.stringify({ projectId, title: 'Chat task', prompt: 'listen', agent: 'claude-code' }) });
  const taskId = created.body.task.id;

  const controller = new AbortController();
  const res = await fetch(base + '/api/runtime/tasks/' + taskId + '/stream?after=0&token=' + encodeURIComponent(token), {
    headers: { Origin: 'http://localhost:5173' },
    signal: controller.signal,
  });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const seen = [];

  const readUntil = async (predicate) => {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              seen.push(event);
              if (predicate(event)) return true;
            } catch { /* keep-alive */ }
          }
        }
      }
    }
    return false;
  };

  const start = await api('/api/runtime/tasks/' + taskId + '/start', { method: 'POST', body: '{}' });
  assert.equal(start.status, 202);
  assert.ok(await readUntil((e) => e.type === 'run.started'), 'saw run.started over SSE');
  release();
  assert.ok(await readUntil((e) => e.type === 'message.assistant'), 'saw assistant message over SSE');

  const stop = await api('/api/runtime/tasks/' + taskId + '/stop', { method: 'POST', body: '{}' });
  assert.equal(stop.status, 200);
  assert.equal(stop.body.task.status, 'stopped');
  controller.abort();
});

test('runtime bridge: artifact content supports inline preview, Range and manual removal', async (t) => {
  const { api, base, token, projectDir } = await withBridge(t, {
    script({ hooks, runId, taskId, cwd }) {
      setTimeout(() => {
        fs.writeFileSync(path.join(cwd, 'note.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
        hooks.onEvent('run.started', { sessionId: 'sess-e2e-art' }, { runId, taskId });
        hooks.onEvent('tool.started', { name: 'Write', input: { path: 'note.png' } }, { runId, taskId });
        hooks.onEvent('run.completed', { sessionId: 'sess-e2e-art', result: 'artifact done' }, { runId, taskId });
        hooks.onEvent('run.exited', { code: 0, signal: null, stopped: false }, { runId, taskId });
        hooks.onExit({ runId, taskId, code: 0, signal: null, stopped: false });
      }, 10);
    },
  });

  const project = await api('/api/runtime/projects', { method: 'POST', body: JSON.stringify({ path: projectDir, name: 'Artifacts' }) });
  const created = await api('/api/runtime/tasks', {
    method: 'POST', body: JSON.stringify({ projectId: project.body.project.id, title: 'Collect', prompt: 'write note', agent: 'claude-code' }),
  });
  const taskId = created.body.task.id;
  assert.equal((await api('/api/runtime/tasks/' + taskId + '/start', { method: 'POST', body: '{}' })).status, 202);

  const detail = await waitFor(async () => {
    const r = await api('/api/runtime/tasks/' + taskId);
    return r.body.task.status === 'review' ? r.body : null;
  });
  assert.equal(detail.artifacts.length, 1);
  const artifact = detail.artifacts[0];
  assert.equal(artifact.name, 'note.png');
  assert.equal(artifact.kind, 'image');
  assert.equal(artifact.mime, 'image/png');

  const inline = await fetch(base + '/api/runtime/artifacts/' + artifact.id + '/content?token=' + encodeURIComponent(token));
  assert.equal(inline.status, 200);
  assert.equal(inline.headers.get('content-type'), 'image/png');
  assert.match(inline.headers.get('content-disposition'), /^inline/);
  assert.equal(Buffer.from(await inline.arrayBuffer()).length, 6);

  const ranged = await fetch(base + '/api/runtime/artifacts/' + artifact.id + '/content?token=' + encodeURIComponent(token), {
    headers: { Range: 'bytes=1-3' },
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 1-3/6');
  assert.equal(Buffer.from(await ranged.arrayBuffer()).toString('hex'), '504e47');

  const head = await fetch(base + '/api/runtime/artifacts/' + artifact.id + '/content?token=' + encodeURIComponent(token), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('accept-ranges'), 'bytes');

  fs.writeFileSync(path.join(projectDir, 'manual.txt'), 'manual note');
  const added = await api('/api/runtime/tasks/' + taskId + '/artifacts', { method: 'POST', body: JSON.stringify({ path: 'manual.txt' }) });
  assert.equal(added.status, 201);
  assert.equal(added.body.artifact.name, 'manual.txt');
  const removed = await api('/api/runtime/artifacts/' + added.body.artifact.id, {
    method: 'DELETE', body: JSON.stringify({ taskId }),
  });
  assert.equal(removed.status, 200);
  assert.equal((await api('/api/runtime/tasks/' + taskId)).body.artifacts.some((a) => a.id === added.body.artifact.id), false);

  const accepted = await api('/api/runtime/tasks/' + taskId + '/accept', { method: 'POST', body: '{}' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.task.status, 'completed');
  assert.equal(accepted.body.merge_required, false);
});

test('runtime bridge: CORS preflight advertises every method the console writes with', async (t) => {
  const { base } = await withBridge(t, { script() {} });
  const preflight = await fetch(base + '/api/runtime/manager/settings', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type,x-petdeck-token',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const methods = (preflight.headers.get('access-control-allow-methods') || '').split(',').map((value) => value.trim());
  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
    assert.ok(methods.includes(method), 'preflight must allow ' + method + ', got ' + methods.join(','));
  }
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /x-petdeck-token/i);
});

test('runtime bridge: auth, unknown ids, and unavailable runtime stay explicit', async (t) => {
  const { api, base } = await withBridge(t, { script() {} });
  assert.equal((await api('/api/runtime/tasks')).status, 200);
  const unauth = await fetch(base + '/api/runtime/projects', { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(unauth.status, 401);
  assert.equal((await api('/api/runtime/tasks/does-not-exist')).status, 404);
  assert.equal((await api('/api/runtime/tasks/does-not-exist/stream')).status, 200);
});
