// Gemini CLI adapter tests — shapes taken from google-gemini/gemini-cli source
// (packages/core/src/services/chatRecordingTypes.ts, 2026-11-16):
//   metadata: {sessionId, projectHash, startTime, lastUpdated, kind?, summary?}
//   message:  {id, timestamp, content, type:'user'|'gemini'|'info'|'error'|'warning', tokens?}
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseGeminiSession, observe } from './adapters/gemini.mjs';

const meta = (summary) => JSON.stringify({ sessionId: 'sess-1', projectHash: 'h', startTime: 't0', lastUpdated: 't1', ...(summary ? { summary } : {}) });
const user = (text) => JSON.stringify({ id: 'm1', timestamp: 't2', type: 'user', content: text });
const gem = (text, tokens) => JSON.stringify({ id: 'm2', timestamp: 't3', type: 'gemini', content: [{ text }], ...(tokens ? { tokens } : {}) });

test('parseGeminiSession: user+gemini => done, summary/title and tokens extracted', () => {
  const text = [meta('修复登录'), user('帮我修'), gem('已修复', { input: 10, output: 5, cached: 3, total: 18 })].join('\n');
  const r = parseGeminiSession(text);
  assert.equal(r.status, 'done');
  assert.equal(r.title, '修复登录');
  assert.equal(r.lastMessage, '已修复');
  assert.deepEqual(r.tokens, { input: 10, output: 5, cacheRead: 3, total: 18 });
  assert.equal(r.session, 'sess-1');
});

test('parseGeminiSession: last user => running; error => stuck; info does not override', () => {
  assert.equal(parseGeminiSession([meta(), gem('ok'), user('next')].join('\n')).status, 'running');
  const stuck = parseGeminiSession([meta(), JSON.stringify({ id: 'e', type: 'error', content: 'boom' })].join('\n'));
  assert.equal(stuck.status, 'stuck');
  const info = parseGeminiSession([meta(), user('q'), JSON.stringify({ id: 'i', type: 'info', content: 'note' })].join('\n'));
  assert.equal(info.status, 'running', 'info must not hide a pending user turn');
});

test('parseGeminiSession: $set summary update and legacy single-object sessions', () => {
  const jsonl = [meta(), user('q'), JSON.stringify({ $set: { summary: '新标题' } })].join('\n');
  assert.equal(parseGeminiSession(jsonl).title, '新标题');
  const legacy = JSON.stringify({
    sessionId: 'legacy-1', projectHash: 'h',
    messages: [{ id: 'm1', type: 'user', content: 'old' }, { id: 'm2', type: 'gemini', content: 'answer' }],
  });
  const r = parseGeminiSession(legacy);
  assert.equal(r.status, 'done');
  assert.equal(r.session, 'legacy-1');
  assert.equal(r.lastMessage, 'answer');
});

test('observe: chats files only, subagents skipped, cap and newest-first', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-gemini-'));
  const mk = (project, name) => {
    const d = path.join(home, '.gemini', 'tmp', project, 'chats');
    fs.mkdirSync(d, { recursive: true });
    return path.join(d, name);
  };
  const a = mk('p1', 'session-20260101-aaaa.jsonl');
  const b = mk('p2', 'session-20260102-bbbb.jsonl');
  fs.writeFileSync(a, [meta(), user('a'), gem('ra')].join('\n'));
  fs.writeFileSync(b, [meta('B'), user('b'), gem('rb')].join('\n'));
  // A subagent session is nested and marked kind=subagent.
  const sub = mk('p2', 'session-20260103-cccc.jsonl');
  fs.writeFileSync(sub, [JSON.stringify({ sessionId: 'sub', projectHash: 'h', kind: 'subagent' }), user('s'), gem('rs')].join('\n'));
  fs.utimesSync(a, new Date(2000), new Date(2000));
  fs.utimesSync(b, new Date(3000), new Date(3000));
  fs.utimesSync(sub, new Date(4000), new Date(4000));
  const rows = await observe({ home });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, 'B');
  assert.equal(rows[0].status, 'done');
  assert.equal(rows[0].projectId, 'p2');
  assert.equal(rows[0].projectName, 'p2');
  assert.equal(rows[1].lastMessage, 'ra');
});

test('observe: missing Gemini root => []', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-gemini-empty-'));
  assert.deepEqual(await observe({ home }), []);
});
