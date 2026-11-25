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
import { parseKimi, parseKimiWire, observe } from './adapters/kimi-code.mjs';

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
  assert.equal(r.title, '任务');
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
  assert.equal(rows.find((r) => r.session === 'u1').projectId, 'h1');
  assert.equal(rows.find((r) => r.session === 'u2').projectName, 'h2');
});

// --- v2 store (post-migration, 2026-11-20 real layout) ---
// 旧实现只读 ~/.kimi/sessions（迁移前的库），于是面板显示的是几个月前的旧会话。
const wire = (events) => events.map((e) => JSON.stringify(e)).join('\n');

test('parseKimiWire: real protocol-1.5 events drive status/lastMessage/tokens', () => {
  const r = parseKimiWire([
    JSON.stringify({ type: 'turn.prompt', agentId: 'main', input: [{ type: 'text', text: '修 bug' }], promptId: 'msg_1', turnId: 0 }),
    JSON.stringify({ type: 'context.append_message', message: { role: 'assistant', content: [{ type: 'text', text: '已修复' }] } }),
    JSON.stringify({ type: 'usage.record', usage: { inputOther: 100, output: 20, inputCacheRead: 300, inputCacheCreation: 5 } }),
    JSON.stringify({ type: 'turn.ended', turnId: 0, reason: 'completed', durationMs: 1000 }),
  ]);
  assert.equal(r.status, 'done');
  assert.equal(r.lastMessage, '已修复');
  assert.deepEqual(r.tokens, { input: 105, output: 20, cacheRead: 300 });
});

test('parseKimiWire: turn.ended interrupted => stuck', () => {
  const r = parseKimiWire([JSON.stringify({ type: 'turn.ended', turnId: 0, reason: 'interrupted' })]);
  assert.equal(r.status, 'stuck');
});

test('observe: v2 store wins over the legacy one, archived sessions are skipped', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-kimi-v2-'));
  const root = path.join(home, '.kimi-code');
  const mkSession = (sid, state, events, mtimeSec) => {
    const dir = path.join(root, 'sessions', 'wd_catwanted_067c8361cf15', sid);
    fs.mkdirSync(path.join(dir, 'agents', 'main'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
    fs.writeFileSync(path.join(dir, 'agents', 'main', 'wire.jsonl'), wire(events));
    fs.utimesSync(path.join(dir, 'state.json'), mtimeSec, mtimeSec);
    return dir;
  };
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ sessionId: 'session_live' }) + '\n');
  // An older legacy store must be ignored while v2 exists.
  const legacy = path.join(home, '.kimi', 'sessions', 'h1', 'u-legacy');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'context.jsonl'), u('旧会话'));
  mkSession('session_live', { id: 'session_live', cwd: 'F:\\WorkSpace\\HarmonyProjects\\CatWanted', archived: false, title: '检查项目进度' }, [
    { type: 'turn.prompt', input: [{ type: 'text', text: '检查项目进度' }] },
    { type: 'context.append_message', message: { role: 'assistant', content: [{ type: 'text', text: '进度如下' }] } },
  ], new Date(2000));
  mkSession('session_arch', { id: 'session_arch', cwd: 'F:\\tmp', archived: true, title: '旧的已归档' }, [
    { type: 'turn.ended', turnId: 0, reason: 'completed' },
  ], new Date(3000));

  const rows = await observe({ home, now: NOW });
  assert.equal(rows.length, 1, 'archived sessions are not live work');
  assert.equal(rows[0].session, 'session_live');
  assert.equal(rows[0].title, '检查项目进度');
  assert.equal(rows[0].status, 'running');
  assert.equal(rows[0].lastMessage, '进度如下');
  assert.equal(rows[0].projectName, 'CatWanted');
  assert.equal(rows[0].source, 'kimi-code-wire');
});

test('observe: an unfinished turn that stopped writing days ago is not running', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-kimi-stale-'));
  const root = path.join(home, '.kimi-code');
  const dir = path.join(root, 'sessions', 'wd_catwanted_067c8361cf15', 'session_dead');
  fs.mkdirSync(path.join(dir, 'agents', 'main'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ id: 'session_dead', cwd: 'F:\\WorkSpace\\X', title: '中断的会话' }));
  const wireFile = path.join(dir, 'agents', 'main', 'wire.jsonl');
  fs.writeFileSync(wireFile, wire([
    { type: 'turn.prompt', input: [{ type: 'text', text: '继续' }] },
    { type: 'llm.request', provider: 'openai', model: 'k3.1-pro' },
  ]));

  // 4 天前进程被杀，wire 里没有 turn.ended；状态机本身仍停在 running。
  const fourDaysAgo = (Date.now() - 4 * 24 * 3600_000) / 1000;
  fs.utimesSync(wireFile, fourDaysAgo, fourDaysAgo);

  const rows = await observe({ home, now: Date.now() });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'unknown', 'a dead turn must not be reported as running');
  assert.ok(Math.abs(rows[0].updatedAt - fourDaysAgo * 1000) < 1000, 'activity time comes from the wire file, not state.json');
});
