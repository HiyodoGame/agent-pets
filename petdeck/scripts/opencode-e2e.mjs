// Real opencode lifecycle acceptance (manual, network + credentials required):
// start -> review -> reject/continue -> review -> accept -> authorize -> merge -> cleanup.
//
// Runs the real `opencode` CLI through the real adapter, so it needs an installed and
// authenticated opencode (model from opencode's own config) and takes ~1 minute. It is
// not part of `npm test`; run it after touching shims, supervisor spawning, worktree
// cleanup or the opencode adapter:
//
//   node scripts/opencode-e2e.mjs
//
// Everything happens in a fresh temp dir (repo, dataDir, worktrees), and the report is
// written there as report.json; exit code 0 means the whole chain passed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRuntimeService } from '../server/runtime/service.mjs';
import { createApp } from '../server/bridge.mjs';

const log = (...a) => console.log('[e2e]', ...a);
const t0 = Date.now();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-oc-e2e-'));
const repo = path.join(root, 'repo');
const dataDir = path.join(root, 'data');
const worktreesRoot = path.join(root, 'worktrees');
fs.mkdirSync(repo, { recursive: true });
const git = (args, opts = {}) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', ...opts });
git(['init', '-b', 'main']);
git(['config', 'user.email', 'e2e@local']);
git(['config', 'user.name', 'e2e']);
fs.writeFileSync(path.join(repo, 'README.md'), '# e2e project\n');
git(['add', '-A']);
git(['commit', '-m', 'init']);

const token = 'e2e-token';
const runtimeLogger = { log() {}, warn() {}, error: (...a) => console.error('[runtime]', ...a) };
const runtime = createRuntimeService({ dataDir, worktreesRoot, logger: runtimeLogger });
const server = createApp({ adapters: [], security: { token, allowedOrigins: ['http://localhost:5173'] }, runtime, logger: runtimeLogger });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;

async function api(p, init = {}) {
  const headers = { Origin: 'http://localhost:5173', 'X-Petdeck-Token': token, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) };
  const res = await fetch(base + p, { ...init, headers });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(label, fn, timeoutMs = 300000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('timeout waiting for ' + label);
    await sleep(2000);
  }
}
const report = { startedAt: new Date().toISOString(), root, repo, steps: [] };
const step = (name, data = {}) => { report.steps.push({ at: new Date().toISOString(), ms: Date.now() - t0, name, ...data }); log(name, JSON.stringify(data).slice(0, 400)); };
const taskView = async (id) => (await api('/api/runtime/tasks/' + id)).body;
const summarize = (detail) => ({
  status: detail.task.status,
  session: detail.task.session_id,
  runs: (detail.runs || []).map((r) => ({ id: r.id, status: r.status, exit: r.exit_code, agent: r.agent, ms: (r.finished_at && r.started_at) ? r.finished_at - r.started_at : null })),
  summary: (detail.task.summary || '').slice(0, 400),
  artifacts: (detail.artifacts || []).length,
});

try {
  const proj = await api('/api/runtime/projects', { method: 'POST', body: JSON.stringify({ path: repo, name: 'oc-e2e' }) });
  if (proj.status !== 201) throw new Error('register project -> ' + proj.status + ' ' + JSON.stringify(proj.body));
  const projectId = proj.body.project.id;
  step('project.registered', { projectId, base: proj.body.project.base_branch });

  const created = await api('/api/runtime/tasks', {
    method: 'POST',
    body: JSON.stringify({
      projectId,
      title: 'E2E: 新建 hello.txt',
      prompt: '只做一件事：在仓库根目录新建 hello.txt，内容是一行 ok。完成后用一句话汇报。不要执行 git add 或 git commit，不要改其他文件。',
      agent: 'opencode',
    }),
  });
  if (created.status !== 201) throw new Error('create task -> ' + created.status + ' ' + JSON.stringify(created.body));
  const taskId = created.body.task.id;
  step('task.created', { taskId, status: created.body.task.status });

  const started = await api('/api/runtime/tasks/' + taskId + '/start', { method: 'POST', body: '{}' });
  step('run1.start', { http: started.status, runId: started.body?.run?.runId, pid: started.body?.run?.pid });

  const reviewed1 = await waitFor('run1 review', async () => {
    const d = await taskView(taskId);
    if (d.task.status === 'review' || d.task.status === 'failed' || d.task.status === 'needs_decision') return d;
    return null;
  });
  step('run1.settled', summarize(reviewed1));

  const ev1 = (await api('/api/runtime/tasks/' + taskId + '/events?limit=500')).body.events || [];
  const types1 = ev1.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {});
  const tools1 = [...new Set(ev1.filter((e) => e.type === 'tool.started').map((e) => e.payload?.name || e.payload?.tool))];
  step('run1.events', { total: ev1.length, types: types1, tools: tools1 });
  if (reviewed1.task.status !== 'review') throw new Error('run1 did not reach review: ' + reviewed1.task.status);

  const rejected = await api('/api/runtime/tasks/' + taskId + '/reject', {
    method: 'POST',
    body: JSON.stringify({ feedback: '再新建 second.txt，内容为 done，并在汇报里确认 hello.txt 的内容仍是 ok。' }),
  });
  step('task.rejected', { http: rejected.status, status: rejected.body?.task?.status });
  if (rejected.status !== 200) throw new Error('reject -> ' + rejected.status + ' ' + JSON.stringify(rejected.body));

  const rerun = await waitFor('run2 exists', async () => {
    const d = await taskView(taskId);
    return d.runs.length >= 2 ? d : null;
  }, 60000);
  step('run2.started', summarize(rerun));

  const reviewed2 = await waitFor('run2 review', async () => {
    const d = await taskView(taskId);
    return d.task.status === 'review' && d.runs.length >= 2 ? d : null;
  });
  step('run2.settled', summarize(reviewed2));
  report.sessionContinued = Boolean(reviewed1.task.session_id) && reviewed2.task.session_id === reviewed1.task.session_id;
  report.sessionId = reviewed2.task.session_id;

  const ev2 = (await api('/api/runtime/tasks/' + taskId + '/events?limit=1000')).body.events || [];
  step('run2.events', { total: ev2.length, toolEvents: ev2.filter((e) => e.type === 'tool.started').length });

  const wtPath = reviewed2.task.worktree_path;
  step('worktree', { path: wtPath, files: wtPath && fs.existsSync(wtPath) ? fs.readdirSync(wtPath) : null });

  const accepted = await api('/api/runtime/tasks/' + taskId + '/accept', { method: 'POST', body: '{}' });
  step('task.accepted', { http: accepted.status, status: accepted.body?.task?.status, merge_required: accepted.body?.merge_required, token: Boolean(accepted.body?.merge_token) });
  if (accepted.status !== 200) throw new Error('accept -> ' + accepted.status + ' ' + JSON.stringify(accepted.body));

  const authorized = await api('/api/runtime/tasks/' + taskId + '/authorize-merge', { method: 'POST', body: '{}' });
  step('merge.authorized', { http: authorized.status, token: Boolean(authorized.body?.merge_token) });
  const mergeToken = authorized.body?.merge_token || accepted.body?.merge_token;

  const merged = await api('/api/runtime/tasks/' + taskId + '/merge', { method: 'POST', body: JSON.stringify({ token: mergeToken }) });
  step('task.merged', { http: merged.status, status: merged.body?.task?.status, error: merged.body?.error });
  if (merged.status !== 200) throw new Error('merge -> ' + merged.status + ' ' + JSON.stringify(merged.body));

  report.mainFiles = fs.readdirSync(repo);
  report.hello = fs.existsSync(path.join(repo, 'hello.txt')) ? fs.readFileSync(path.join(repo, 'hello.txt'), 'utf8') : null;
  report.second = fs.existsSync(path.join(repo, 'second.txt')) ? fs.readFileSync(path.join(repo, 'second.txt'), 'utf8') : null;
  step('main.verified', { files: report.mainFiles, hello: report.hello, second: report.second });

  report.secondInWorktree = reviewed2.task.worktree_path ? fs.existsSync(path.join(reviewed2.task.worktree_path, 'second.txt')) : false;
  const cleaned = await api('/api/runtime/tasks/' + taskId + '/cleanup', { method: 'POST', body: '{}' });
  const afterCleanup = await taskView(taskId);
  step('task.cleaned', {
    http: cleaned.status, error: cleaned.body?.error ?? null, message: cleaned.body?.message ?? cleaned.body ?? null,
    status: afterCleanup.task.status, worktree_path: afterCleanup.task.worktree_path, branch: afterCleanup.task.branch,
    worktree_exists: Boolean(afterCleanup.task.worktree_path) && fs.existsSync(afterCleanup.task.worktree_path),
  });
  if (cleaned.status !== 200) throw new Error('cleanup -> ' + cleaned.status + ' ' + JSON.stringify(cleaned.body));
  report.ok = Boolean(report.hello && report.hello.trim() === 'ok' && report.second && report.second.trim() === 'done' && report.sessionContinued && cleaned.status === 200);
} catch (e) {
  report.ok = false;
  report.error = e?.message || String(e);
  step('failed', { error: report.error });
} finally {
  report.finishedAt = new Date().toISOString();
  report.totalMs = Date.now() - t0;
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  console.log('[e2e] REPORT ' + path.join(root, 'report.json'));
  console.log('[e2e] RESULT ' + JSON.stringify({ ok: report.ok, totalMs: report.totalMs, error: report.error || null, sessionContinued: report.sessionContinued }));
  await new Promise((r) => server.close(r));
  try { await runtime.shutdown(); } catch {}
  process.exit(report.ok ? 0 : 1);
}