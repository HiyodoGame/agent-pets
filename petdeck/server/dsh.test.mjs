// RED tests: DeepSeek Harness adapter — multi-frame zstd session files.
// Run: node --test server/dsh.test.mjs
// 存储事实（见 docs/agent-会话存储勘察.md）：~/.dsh/sessions/<workspaceSlug>/<sessionId>/session.v4.jsonl.zstd
// = 多个独立 zstd frame 顺序拼接，每帧一条 JSON 事件。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { decodeDshEvents, parseDshEvents, observe } from './adapters/dsh.mjs';

/** Build a session.v4.jsonl.zstd the way dsh writes it: one zstd frame per event line. */
function zstdSession(events) {
  return Buffer.concat(events.map((e) => zlib.zstdCompressSync(Buffer.from(JSON.stringify(e) + '\n'))));
}

const NOW = Date.now();

test('decodeDshEvents: concatenated frames decode to one event per frame', async () => {
  const buf = zstdSession([
    { type: 'session', seq: 0, data: { id: 'session-a', cwd: 'F:\\x' } },
    { type: 'turn/start', seq: 1, data: { turn: 1 } },
    { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  ]);
  const events = await decodeDshEvents(buf);
  assert.equal(events.length, 3);
  assert.equal(events[0].type, 'session');
  assert.equal(events[2].data.reason.kind, 'completed');
});

test('parseDshEvents: turn/start without end => running', () => {
  const r = parseDshEvents([
    { type: 'session', data: { id: 's1' } },
    { type: 'session/title', data: { title: '修 bug' } },
    { type: 'turn/start', data: { turn: 1 } },
  ], NOW);
  assert.equal(r.status, 'running');
  assert.equal(r.title, '修 bug');
  assert.equal(r.turn, 1);
});

test('parseDshEvents: turn/end completed => done; interrupted => stuck', () => {
  const done = parseDshEvents([
    { type: 'session', data: { id: 's1' } },
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ], NOW);
  assert.equal(done.status, 'done');
  const stuck = parseDshEvents([
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'turn/end', data: { turn: 2, reason: { kind: 'interrupted' } } },
  ], NOW);
  assert.equal(stuck.status, 'stuck');
});

test('parseDshEvents: pending approval/asked => waiting even mid-turn', () => {
  const r = parseDshEvents([
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'approval/asked', data: { id: 'ap1', toolName: 'run_code' } },
  ], NOW);
  assert.equal(r.status, 'waiting');
  const decided = parseDshEvents([
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'approval/asked', data: { id: 'ap1', toolName: 'run_code' } },
    { type: 'approval/decided', data: { id: 'ap1' } },
  ], NOW);
  assert.equal(decided.status, 'running', 'decided approval must unblock');
});

test('parseDshEvents: last assistant text block becomes lastMessage (reasoning skipped)', () => {
  const r = parseDshEvents([
    { type: 'assistant/message', data: { turn: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'think...' }, { type: 'text', text: '已完成检查' }] } } },
  ], NOW);
  assert.equal(r.lastMessage, '已完成检查');
  assert.equal(r.status, 'unknown', 'no turn signal must not fabricate done/running');
});

test('decodeDshEvents: skips leading garbage, still decodes every frame', async () => {
  const buf = Buffer.concat([
    Buffer.from([0, 1, 2, 3]),
    zstdSession([
      { type: 'session', seq: 0, data: { id: 'session-ddd' } },
      { type: 'turn/start', data: { turn: 1 } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]),
  ]);
  const events = await decodeDshEvents(buf);
  assert.equal(events.length, 3);
  assert.equal(events[2].data.reason.kind, 'completed');
});

test('observe: walks real directory layout, newest-first cap 5, uses workspace slug as project', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-dsh-'));
  const mk = (slug, id) => {
    const d = path.join(home, '.dsh', 'sessions', slug, id);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  fs.writeFileSync(path.join(mk('ws1', 'session-aaa'), 'session.v4.jsonl.zstd'), zstdSession([
    { type: 'session', seq: 0, data: { id: 'session-aaa', cwd: 'F:\\ws1' } },
    { type: 'session/title', data: { title: 'A' } },
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ]));
  fs.writeFileSync(path.join(mk('ws2', 'session-bbb'), 'session.v4.jsonl.zstd'), zstdSession([
    { type: 'session', seq: 0, data: { id: 'session-bbb', cwd: 'F:\\ws2' } },
    { type: 'turn/start', data: { turn: 1 } },
  ]));
  // 显式 mtime：bbb 更新（newest-first => bbb 排第一）。依赖文件创建顺序的隐式 mtime
  // 在 CI 的 ext4 上严格递增而本地可能打平，之前正是这里在 CI 抖红（2026-11-16）。
  fs.utimesSync(path.join(mk('ws1', 'session-aaa'), 'session.v4.jsonl.zstd'), new Date(NOW - 60000), new Date(NOW - 60000));
  fs.utimesSync(path.join(mk('ws2', 'session-bbb'), 'session.v4.jsonl.zstd'), new Date(NOW), new Date(NOW));
  const rows = await observe({ home, now: NOW });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].session, 'session-bbb', 'newest-first：mtime 更新的 bbb 必须在前');
  assert.equal(rows[0].status, 'running');
  assert.equal(rows[1].session, 'session-aaa');
  assert.equal(rows[1].status, 'done');
  assert.equal(rows[0].agent, 'dsh');
  assert.equal(rows[0].cwd, 'F:\\ws2');
  assert.equal(rows[1].cwd, 'F:\\ws1');
});

// 真实 v4 事件是扁平的：{"type":"session","id":"session-…","cwd":"F:\\…"}。
// 旧解析只认 e.data.cwd，于是 5/5 条 dsh 会话 cwd 全空、全部掉进「未识别项目」。
test('parseDshEvents: flat session event supplies id + cwd', () => {
  const r = parseDshEvents([
    { type: 'session', version: 4, id: 'session-xyz', cwd: 'F:\\WorkSpace\\AIProjects\\Agent_Pets', createdAt: 1 },
  ], NOW);
  assert.equal(r.session, 'session-xyz');
  assert.equal(r.cwd, 'F:\\WorkSpace\\AIProjects\\Agent_Pets');
});

test('observe: corrupt zstd frame is skipped, session without events yields nothing', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-dsh-'));
  const d = path.join(home, '.dsh', 'sessions', 'ws', 'session-ccc');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'session.v4.jsonl.zstd'), Buffer.concat([
    Buffer.from([0, 1, 2, 3]),
    zstdSession([{ type: 'session', seq: 0, data: { id: 'session-ccc' } }]),
  ]));
  const rows = await observe({ home, now: NOW });
  assert.equal(rows.length, 0, 'header-only session must not fabricate a row');
});
