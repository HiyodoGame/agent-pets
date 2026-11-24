// M5 W6 — observation surface pure helpers: state mapping, transcript sanitation,
// snapshot aggregation and per-adapter health counters. No fs/UI involved.
// Run: node --test server/observe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildObserveSnapshot, buildTranscriptIndex, clampLimit, isObserveOnly,
  mapObserveState, observeProjectName, parseTranscriptLines, readTranscript,
  sanitizeTranscriptText, trackObservePoll,
} from './observe.mjs';

test('mapObserveState: running/stuck/done/waiting collapse to three UI states', () => {
  assert.equal(mapObserveState('running'), 'running');
  assert.equal(mapObserveState('stuck'), 'error');
  assert.equal(mapObserveState('error'), 'error');
  assert.equal(mapObserveState('done'), 'idle');
  assert.equal(mapObserveState('waiting'), 'idle');
  assert.equal(mapObserveState('unknown'), 'idle');
  assert.equal(mapObserveState(undefined), 'idle');
});

test('isObserveOnly: full agents are excluded, unknown agents default to observe-only', () => {
  assert.equal(isObserveOnly('cursor'), true);
  assert.equal(isObserveOnly('kimi-code'), true);
  assert.equal(isObserveOnly('claude'), false);
  assert.equal(isObserveOnly('opencode'), false);
  assert.equal(isObserveOnly('mystery-agent'), true, 'unknown ids must never look injectable');
});

test('clampLimit: defaults on junk, floors and caps valid values', () => {
  assert.equal(clampLimit(undefined), 20);
  assert.equal(clampLimit('nope'), 20);
  assert.equal(clampLimit(0), 20);
  assert.equal(clampLimit(3.9), 3);
  assert.equal(clampLimit(999), 50);
  assert.equal(clampLimit('7'), 7);
});

test('sanitizeTranscriptText: strips markdown/html/link syntax and collapses whitespace', () => {
  const raw = '## 标题\n**粗体** [链接](https://example.com) <b>标签</b>\n```js\nconst x = 1;\n```\n尾巴';
  const clean = sanitizeTranscriptText(raw);
  assert.equal(clean, '标题 粗体 链接 标签 const x = 1; 尾巴');
  assert.equal(clean.includes('<'), false);
  assert.equal(clean.includes('###'), false);
  assert.equal(clean.includes('```'), false);
});

test('sanitizeTranscriptText: caps length and survives empty input', () => {
  const clean = sanitizeTranscriptText('abcdefghijklmnop', 10);
  assert.equal(clean, 'abcdefghi…');
  assert.equal(clean.length, 10);
  assert.equal(sanitizeTranscriptText(null), '');
});

test('observeProjectName: projectName then projectId then cwd basename', () => {
  assert.equal(observeProjectName({ projectName: 'A', projectId: 'b', cwd: 'C:\\x\\c' }), 'A');
  assert.equal(observeProjectName({ projectId: 'b', cwd: 'C:\\x\\c' }), 'b');
  assert.equal(observeProjectName({ cwd: 'C:\\x\\c' }), 'c');
  assert.equal(observeProjectName({}), '');
});

test('parseTranscriptLines: Cursor user text is unwrapped and assistant text kept', () => {
  const lines = [
    JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: '<timestamp>Friday</timestamp><user_query>修 bug</user_query>' }] } }),
    JSON.stringify({ type: 'turn_ended', status: 'success' }),
    JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: '**已修复**' }] } }),
  ];
  const out = parseTranscriptLines('cursor', lines, { limit: 5 });
  assert.deepEqual(out, [{ role: 'user', text: '修 bug' }, { role: 'assistant', text: '已修复' }]);
});

test('parseTranscriptLines: gemini/kimi/dsh shapes map roles, unknown records skipped', () => {
  const gemini = parseTranscriptLines('gemini', [
    JSON.stringify({ type: 'user', content: '问题' }),
    JSON.stringify({ type: 'gemini', content: [{ text: '回答' }] }),
    JSON.stringify({ type: 'info', content: 'noise' }),
  ]);
  assert.deepEqual(gemini, [{ role: 'user', text: '问题' }, { role: 'assistant', text: '回答' }]);

  const kimi = parseTranscriptLines('kimi-code', [
    JSON.stringify({ type: 'turn.prompt', input: [{ type: 'text', text: '检查' }] }),
    JSON.stringify({ type: 'context.append_message', message: { role: 'assistant', content: [{ type: 'text', text: '进度如下' }] } }),
    JSON.stringify({ role: 'user', content: '旧库问题' }),
  ]);
  assert.deepEqual(kimi, [
    { role: 'user', text: '检查' },
    { role: 'assistant', text: '进度如下' },
    { role: 'user', text: '旧库问题' },
  ]);

  const dsh = parseTranscriptLines('dsh', [
    JSON.stringify({ type: 'turn/start', data: { prompt: '开始' } }),
    JSON.stringify({ type: 'assistant/message', data: { message: { content: [{ type: 'reasoning', text: '内部推理' }, { type: 'tool-call', text: 'call' }, { type: 'text', text: '完成' }] } } }),
    JSON.stringify({ type: 'approval/asked', data: { toolName: 'x' } }),
  ]);
  assert.deepEqual(dsh, [{ role: 'user', text: '开始' }, { role: 'assistant', text: '完成' }]);
});

test('parseTranscriptLines: limit keeps the newest entries', () => {
  const lines = Array.from({ length: 8 }, (_, i) => JSON.stringify({ role: i % 2 ? 'assistant' : 'user', content: 'm' + i }));
  const out = parseTranscriptLines('generic', lines, { limit: 3 });
  assert.deepEqual(out.map((x) => x.text), ['m5', 'm6', 'm7']);
});

test('buildObserveSnapshot: observe-only rows only, newest first, project fallback, agents health', () => {
  const adapters = [
    { id: 'opencode', name: 'opencode' },
    { id: 'cursor', name: 'Cursor' },
    { id: 'dsh', name: 'DeepSeek Harness' },
  ];
  const stats = new Map([
    ['cursor', { okCount: 3, failCount: 1, lastOkAt: 5, lastErrorAt: 9, lastError: { code: 'EACCES', message: 'denied' }, rowCount: 2, lastWriteAt: 300 }],
  ]);
  const sources = { cursor: { ok: true, lastSeen: 10 }, dsh: { ok: false, lastSeen: null, error: { code: 'ENOENT', message: 'missing' } } };
  const sessions = [
    { agent: 'opencode', session: 's1', status: 'running', cwd: 'C:\\p\\x' },
    { agent: 'cursor', session: 's2', title: 'B', status: 'done', projectName: 'proj', updatedAt: 200, path: 'C:\\t\\b.jsonl' },
    { agent: 'cursor', session: 's3', title: 'A', status: 'stuck', cwd: 'C:\\p\\y', updatedAt: 300, path: 'C:\\t\\a.jsonl' },
  ];
  const snap = buildObserveSnapshot({ adapters, sessions, sources, stats, limit: 2, now: 123 });
  assert.equal(snap.generatedAt, 123);
  assert.equal(snap.sessions.length, 2);
  assert.deepEqual(snap.sessions.map((s) => s.session), ['s3', 's2'], 'newest updatedAt first');
  assert.equal(snap.sessions[0].state, 'error');
  assert.equal(snap.sessions[0].project, 'y');
  assert.equal(snap.sessions[1].project, 'proj');
  assert.equal(snap.sessions[1].agentName, 'Cursor');
  assert.equal(snap.sessions.some((s) => s.agent === 'opencode'), false);
  const cursor = snap.agents.find((a) => a.id === 'cursor');
  assert.equal(cursor.tier, 'observe-only');
  assert.equal(cursor.okCount, 3);
  assert.equal(cursor.failCount, 1);
  assert.deepEqual(cursor.lastError, { code: 'EACCES', message: 'denied' });
  assert.equal(cursor.lastWriteAt, 300);
  const dsh = snap.agents.find((a) => a.id === 'dsh');
  assert.equal(dsh.ok, false);
  assert.deepEqual(dsh.lastError, { code: 'ENOENT', message: 'missing' });
  assert.equal(snap.agents.some((a) => a.id === 'opencode'), false);
});

test('buildObserveSnapshot: remote claude/codex rows stay visible and Remote health counts them', () => {
  const sessions = [
    { agent: 'claude', source: 'ssh-probe', session: 'remote-c', host: 'build', status: 'running', updatedAt: 300 },
    { agent: 'codex', source: 'ssh-probe', session: 'remote-x', host: 'builder', status: 'done', updatedAt: 200 },
    { agent: 'claude', source: 'local', session: 'local-c', status: 'running', updatedAt: 400 },
  ];
  const stats = new Map();
  trackObservePoll(stats, { remote: { ok: true, lastSeen: 500 } }, sessions, 500);
  const snap = buildObserveSnapshot({
    adapters: [{ id: 'claude', name: 'Claude Code' }, { id: 'codex', name: 'Codex' }, { id: 'remote', name: 'Remote SSH' }],
    sessions, sources: { remote: { ok: true, lastSeen: 500 } }, stats,
  });
  assert.deepEqual(snap.sessions.map((row) => row.session), ['remote-c', 'remote-x']);
  assert.equal(snap.sessions[0].host, 'build');
  const remote = snap.agents.find((agent) => agent.id === 'remote');
  assert.equal(remote.rowCount, 2);
  assert.equal(remote.lastWriteAt, 300);
  assert.equal(remote.okCount, 1);
  assert.equal(snap.agents.some((agent) => agent.id === 'claude'), false, 'read-only remote rows do not make Claude an observe source');
  const index = buildTranscriptIndex([{ ...sessions[0], path: '/must/not/read' }]);
  assert.equal(index.size, 0, 'remote paths are never local transcript targets');
});

test('trackObservePoll: counts successes/failures and captures row write times', () => {
  const stats = new Map();
  const rows = [
    { agent: 'cursor', session: 'a', updatedAt: 200 },
    { agent: 'cursor', session: 'b', updatedAt: 100 },
  ];
  trackObservePoll(stats, { cursor: { ok: true, lastSeen: 1 } }, rows, 1000);
  trackObservePoll(stats, { cursor: { ok: false, lastSeen: 1, error: { code: 'EACCES', message: 'denied' } } }, [], 2000);
  const s = stats.get('cursor');
  assert.equal(s.okCount, 1);
  assert.equal(s.failCount, 1);
  assert.equal(s.lastOkAt, 1000);
  assert.equal(s.lastErrorAt, 2000);
  assert.deepEqual(s.lastError, { code: 'EACCES', message: 'denied' });
  assert.equal(s.rowCount, 0);
  assert.equal(s.lastWriteAt, null, 'failure carries no rows, so no write time');
});

test('buildTranscriptIndex + readTranscript: reads only registered paths, no fs guesses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-observe-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text: '你好' }] } }),
    JSON.stringify({ role: 'assistant', message: { content: [{ type: 'text', text: '**世界**' }] } }),
  ].join('\n'));
  const index = buildTranscriptIndex([
    { agent: 'cursor', session: 's1', path: file, source: 'cursor-transcript-jsonl', updatedAt: 5 },
    { agent: 'opencode', session: 's2', path: file, source: 'x', updatedAt: 6 },
  ]);
  assert.equal(index.size, 1);
  const entry = index.get('cursor:s1');
  const result = readTranscript(entry, { limit: 10 });
  assert.deepEqual(result.lines, [{ role: 'user', text: '你好' }, { role: 'assistant', text: '世界' }]);
  assert.equal(result.unsupported, undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('readTranscript: sqlite/remote sessions report unsupported instead of reading a path', () => {
  assert.deepEqual(readTranscript({ agent: 'zcode', session: 's', path: '' }), {
    agent: 'zcode', session: 's', path: null, lines: [], unsupported: true,
  });
});
