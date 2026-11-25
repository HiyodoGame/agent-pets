// Claude adapter observe(): staleness of an unfinished turn + title hygiene.
// The 2026-11-25 real-machine report: a 4-day-old kimi turn and a live opencode
// session were both mislabelled; claude had the same latent staleness bug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { observe, parseClaude, parseHookEvents, parsePendingAsk } from './adapters/claude.mjs';

const assistantRunning = JSON.stringify({
  type: 'assistant', cwd: 'F:/Work',
  message: { stop_reason: null, content: [{ type: 'text', text: '正在执行工具' }] },
});

function project(home, lines, mtimeSec) {
  const dir = path.join(home, '.claude', 'projects', 'proj');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'a.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  if (mtimeSec != null) fs.utimesSync(file, mtimeSec, mtimeSec);
  return file;
}

function withHome(home, fn) {
  const previous = process.env.PETDECK_OBSERVE_HOME;
  process.env.PETDECK_OBSERVE_HOME = home;
  try { return fn(); } finally {
    if (previous === undefined) delete process.env.PETDECK_OBSERVE_HOME;
    else process.env.PETDECK_OBSERVE_HOME = previous;
  }
}

test('claude observe: an unfinished turn with no writes for days is not running', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-claude-stale-'));
  const fourDaysAgo = (Date.now() - 4 * 24 * 3600_000) / 1000;
  project(home, [assistantRunning], fourDaysAgo);

  const rows = withHome(home, () => observe(Date.now()));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'unknown', 'a dead turn must not be reported as running');
  assert.ok(Math.abs(rows[0].updatedAt - fourDaysAgo * 1000) < 1000);
});

test('claude observe: a fresh unfinished turn stays running', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-claude-live-'));
  project(home, [assistantRunning], null);

  const rows = withHome(home, () => observe(Date.now()));
  assert.equal(rows[0].status, 'running');
  assert.ok(rows[0].updatedAt > Date.now() - 60_000);
});

test('claude parseClaude: a cross-session message never becomes the title', () => {
  const noise = JSON.stringify({
    type: 'user',
    message: { content: 'Another Claude session sent a message:\n<cross-session-message from="x">hello</cross-session-message>' },
  });
  const real = JSON.stringify({ type: 'user', message: { content: '修复登录页' } });
  const r = parseClaude([noise, real]);
  assert.equal(r.title, '修复登录页');
});

const askUse = (id) => JSON.stringify({
  type: 'assistant',
  message: {
    content: [{
      type: 'tool_use', id, name: 'AskUserQuestion',
      input: {
        questions: [{
          question: '这版猫咪在你的终端里可以吗，还是继续调？',
          header: '猫咪',
          multiSelect: false,
          options: [
            { label: '可以', description: '接受当前版本' },
            { label: '继续调', description: '继续迭代' },
          ],
        }],
      },
    }],
  },
});
const toolResult = (id) => JSON.stringify({
  type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] },
});

test('claude parsePendingAsk: an unanswered AskUserQuestion surfaces its options', () => {
  const ask = parsePendingAsk([askUse('t1')]);
  assert.equal(ask.toolUseId, 't1');
  assert.equal(ask.questions[0].question, '这版猫咪在你的终端里可以吗，还是继续调？');
  assert.deepEqual(ask.questions[0].options.map((o) => o.label), ['可以', '继续调']);
});

test('claude parsePendingAsk: a matching tool_result clears the question', () => {
  assert.equal(parsePendingAsk([askUse('t1'), toolResult('t1')]), null);
});

test('claude parsePendingAsk: the newest unanswered question wins; other tools are ignored', () => {
  const other = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', id: 'p1', name: 'ExitPlanMode', input: { plan: '# plan' } }] },
  });
  const ask = parsePendingAsk([askUse('old'), toolResult('old'), other, askUse('new')]);
  assert.equal(ask.toolUseId, 'new');
});

test('claude parseHookEvents: newest event per session, stale events dropped', () => {
  const now = Date.now();
  const lines = [
    JSON.stringify({ ts: now - 2 * 3600_000, session_id: 'a', message: 'old' }),
    JSON.stringify({ ts: now - 5_000, session_id: 'a', message: 'Claude needs permission to use Bash' }),
    JSON.stringify({ ts: now - 1_000, session_id: 'b', message: 'waiting for input' }),
  ];
  const map = parseHookEvents(lines, now);
  assert.equal(map.get('a').message, 'Claude needs permission to use Bash');
  assert.equal(map.get('b').message, 'waiting for input');
  assert.equal(parseHookEvents(lines, now + 31 * 60_000).size, 0, 'older than 30 minutes is not a live prompt');
});

test('claude observe: a Notification hook turns a running session into waiting', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-claude-hook-'));
  project(home, [assistantRunning], null);
  const events = path.join(home, 'claude-hook-events.jsonl');
  fs.writeFileSync(events, `${JSON.stringify({
    ts: Date.now(), session_id: 'a', message: 'Claude needs your permission to use Bash', notification_type: 'permission',
  })}\n`);

  const previous = process.env.PETDECK_HOOK_EVENTS;
  process.env.PETDECK_HOOK_EVENTS = events;
  try {
    const rows = withHome(home, () => observe(Date.now()));
    assert.equal(rows[0].status, 'waiting');
    assert.equal(rows[0].notify.message, 'Claude needs your permission to use Bash');
  } finally {
    if (previous === undefined) delete process.env.PETDECK_HOOK_EVENTS;
    else process.env.PETDECK_HOOK_EVENTS = previous;
  }
});
