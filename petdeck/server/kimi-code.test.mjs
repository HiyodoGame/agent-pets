// RED tests: Kimi Code CLI adapter — ~/.kimi/sessions/<projHash>/<uuid>/context.jsonl.
// Run: node --test server/kimi-code.test.mjs
// 存储事实（docs/agent-会话存储勘察.md）：行格式 {"role": ...}，role ∈
// _system_prompt / user / assistant / _checkpoint / _usage(token_count)。无显式回合终止信号，
// 状态按「最后一条非下划线 role」推断：user => running（模型正在处理），assistant => done。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseKimi, observe } from './adapters/kimi-code.mjs';

const NOW = Date.now();
const u = (t) => JSON.stringify({ role: 'user', content: [{ type: 'text', text: t }] });
const a = (t) => JSON.stringify({ role: 'assistant', content: [{ type: 'think', think: '...' }, { type: 'text', text: t }] });

test('parseKimi: last user => running (model is working on it)', () => {
  const r = parseKimi([u('帮我修 bug'), a('已修复') + '', u('再改一处')], NOW);
  assert.equal(r.status, 'running');
  assert.equal(r.lastMessage, '再改一处');
});

test('parseKimi: last assistant => done (reply finished, waiting for user input)', () => {
  const r = parseKimi([u('任务'), a('完成了')], NOW);
  assert.equal(r.status, 'done');
  assert.equal(r.lastMessage, '完成了');
});

test('parseKimi: _system_prompt / _checkpoint / _usage are metadata, not conversation', () => {
  const r = parseKimi([
    JSON.stringify({ role: '_system_prompt', content: 'You are Kimi Code CLI...' }),
    JSON.stringify({ role: '_checkpoint', id: 0 }),
    JSON.stringify({ role: '_usage', token_count: 158100 }),
    a('结论'),
  ], NOW);
  assert.equal(r.status, 'done');
  assert.equal(r.lastMessage, '结论');
  assert.equal(r.tokens, 158100, 'cumulative _usage token_count must surface for cost display');
});

test('parseKimi: empty/system-only => unknown and empty (no fabrication)', () => {
  assert.equal(parseKimi([], NOW).status, 'unknown');
  const sysOnly = parseKimi([JSON.stringify({ role: '_system_prompt', content: 'x' })], NOW);
  assert.equal(sysOnly.status, 'unknown');
  assert.equal(sysOnly.lastMessage, '');
});

test('observe: walks session dirs newest-first cap 5, skips system-only files', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-kimi-'));
  const mk = (hash, uuid, lines) => {
    const d = path.join(home, '.kimi', 'sessions', hash, uuid);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'context.jsonl'), lines.join('\n') + '\n');
  };
  mk('h1', 'u1', [u('任务'), a('完成')]);
  mk('h2', 'u2', [u('新任务')]);
  mk('h3', 'u3', [JSON.stringify({ role: '_system_prompt', content: 'x' })]);
  const rows = await observe({ home, now: NOW });
  assert.equal(rows.length, 2, 'system-only session must be skipped');
  assert.equal(rows[0].agent, 'kimi-code');
  assert.ok([rows[0].session, rows[1].session].includes('u1'));
  assert.ok([rows[0].status, rows[1].status].includes('running'));
  assert.ok([rows[0].status, rows[1].status].includes('done'));
});
