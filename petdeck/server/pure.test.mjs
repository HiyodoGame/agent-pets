// RED tests for server adapter pure logic (parsers / tiers / bus / bridge).
// Run: node --test server/pure.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { parseRollout, inject as codexInject } from './adapters/codex.mjs';
import { parseClaude, inject as claudeInject } from './adapters/claude.mjs';
import { parseRun, mapServeStatus, inject as opencodeInject } from './adapters/opencode.mjs';
import { TIER, canInject, injectDecision, handoffPackage } from './tiers.mjs';
import { createBus, toPetEventType } from './bus.mjs';
import { createApp } from './bridge.mjs';

const J = (o) => JSON.stringify(o);

test('codex parseRollout: task_complete wins status + lastMessage', () => {
  const lines = [
    J({ payload: { type: 'task_started', turn_id: 't1' } }),
    J({ payload: { type: 'agent_message', message: 'working' } }),
    J({ payload: { type: 'task_complete', last_agent_message: 'done pack', turn_id: 't1' } }),
  ];
  const r = parseRollout(lines);
  assert.equal(r.status, 'done');
  assert.equal(r.lastMessage, 'done pack');
  assert.equal(r.turn, 't1');
});

test('codex parseRollout: turn_aborted => stuck', () => {
  const r = parseRollout([J({ payload: { type: 'turn_aborted' } })]);
  assert.equal(r.status, 'stuck');
});

test('codex parseRollout: empty => unknown', () => {
  const r = parseRollout([]);
  assert.equal(r.status, 'unknown');
  assert.equal(r.lastMessage, '');
});

test('claude parseClaude: assistant text + cwd', () => {
  const lines = [
    J({ type: 'user', cwd: 'F:/proj', message: { content: 'hi' } }),
    J({ type: 'assistant', message: { content: [{ type: 'text', text: 'reply' }] } }),
  ];
  const r = parseClaude(lines);
  assert.equal(r.status, 'running');
  assert.equal(r.lastMessage, 'reply');
  assert.equal(r.cwd, 'F:/proj');
});

test('claude parseClaude: trailing user => waiting', () => {
  const r = parseClaude([J({ type: 'user', message: { content: 'q' } })]);
  assert.equal(r.status, 'waiting');
});

test('opencode parseRun: extracts text + sessionID', () => {
  const stdout = [J({ type: 'step' }), J({ type: 'text', part: { text: 'ok' }, sessionID: 'ses_1' })].join('\n');
  const r = parseRun(stdout);
  assert.equal(r.response, 'ok');
  assert.equal(r.sessionID, 'ses_1');
});

test('claude parseClaude: end_turn stop_reason => done', () => {
  const r = parseClaude([J({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'final' }] } })]);
  assert.equal(r.status, 'done');
});

test('claude parseClaude: aggregates usage over the window (input/output/cacheRead)', () => {
  const lines = [
    J({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'a' }], usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 5000, cache_creation_input_tokens: 10 } } }),
    J({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'b' }], usage: { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
  ];
  const r = parseClaude(lines);
  assert.deepEqual(r.tokens, { input: 150, output: 25, cacheRead: 5000 },
    'usage sums over the observe window; cache read is separate from input');
});

test('claude parseClaude: no usage lines => zero tokens (no fabrication)', () => {
  assert.deepEqual(parseClaude([J({ type: 'result', is_error: false })]).tokens, { input: 0, output: 0, cacheRead: 0 });
});

test('claude parseClaude: result is_error => stuck', () => {
  const r = parseClaude([J({ type: 'result', is_error: true })]);
  assert.equal(r.status, 'stuck');
});

test('claude parseClaude: mid-turn tool_use stays running', () => {
  const r = parseClaude([J({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'hmm' }] } })]);
  assert.equal(r.status, 'running');
});

// ---- Task 5: 状态生命周期 —— tool_result 不是用户输入，不得置 waiting / 覆盖 assistant 文本 ----

const ASSISTANT_LINE = J({ type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: 'checking the file' }] } });

test('claude parseClaude: tool_result array content does not set waiting or clobber status', () => {
  const toolResult = J({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'file contents here' }] } });
  const r = parseClaude([ASSISTANT_LINE, toolResult]);
  assert.equal(r.status, 'running');
  assert.equal(r.lastMessage, 'checking the file');
});

test('claude parseClaude: real string user prompt sets waiting', () => {
  const r = parseClaude([J({ type: 'user', message: { content: 'please refactor this' } })]);
  assert.equal(r.status, 'waiting');
});

test('claude parseClaude: tool_result neither sets waiting nor blocks assistant lines from driving status', () => {
  const toolResult = J({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu_2', content: 'ok' }] } });
  const userPrompt = J({ type: 'user', message: { content: 'please refactor this' } });
  // 真实用户输入后的 tool_result：不改变 waiting。
  assert.equal(parseClaude([userPrompt, toolResult]).status, 'waiting');
  // tool_result 也不得挡住后续 assistant 行对状态的驱动。
  assert.equal(parseClaude([userPrompt, toolResult, ASSISTANT_LINE]).status, 'running');
  assert.equal(parseClaude([userPrompt, toolResult, ASSISTANT_LINE]).lastMessage, 'checking the file');
});

test('claude parseClaude: lastMessage takes assistant text only, never user string content', () => {
  const lines = [
    ASSISTANT_LINE,
    J({ type: 'user', message: { content: 'my question' } }),
  ];
  const r = parseClaude(lines);
  assert.equal(r.status, 'waiting');
  assert.equal(r.lastMessage, 'checking the file');
});

// ---- Task 5: bridge —— waiting 状态变化产生 decision 事件（petType=decision 直达前端收件箱） ----

test('bridge: waiting status transition emits a decision event', async () => {
  const adapters = [{
    id: 'claude', name: 'Claude', tier: 'full',
    observe: () => [{ agent: 'claude', session: 's1.jsonl', status: 'waiting', lastMessage: 'which one?', cwd: '' }],
    inject: () => Promise.resolve({ ok: true, response: '' }),
  }];
  const bus = createBus();
  const app = createApp({ adapters, security: {}, bus });
  await app.poll();
  const ev = bus.snapshot().find((e) => e.agentId === 'claude');
  assert.ok(ev, 'a status-change event must be emitted');
  assert.equal(ev.type, 'decision');
  assert.equal(ev.petType, 'decision');
  assert.equal(ev.payload.lastMessage, 'which one?');
});

test('opencode mapServeStatus: only real signals, else unknown', () => {
  assert.equal(mapServeStatus({ status: 'busy' }), 'running');
  assert.equal(mapServeStatus({ status: 'idle' }), 'unknown');
  assert.equal(mapServeStatus({}), 'unknown');
});

test('tiers: capability gating', () => {
  assert.equal(TIER.codex, 'full');
  assert.equal(TIER.kimi, 'observe-only');
  assert.equal(canInject('full'), true);
  assert.equal(canInject('observe-only'), false);
  assert.equal(canInject('manual'), false);
});

test('tiers: injectDecision falls back to clipboard when not full', () => {
  const d = injectDecision('observe-only', { ok: true, response: 'x' }, { context: 'c', instruction: 'do it' });
  assert.equal(d.mode, 'clipboard');
  assert.ok(d.package.includes('c'));
  assert.ok(d.package.includes('do it'), 'clipboard handoff must preserve the instruction');
});

test('tiers: injectDecision uses inject when full + ok', () => {
  const d = injectDecision('full', { ok: true, response: 'x', sessionID: 'ses_1' });
  assert.equal(d.mode, 'inject');
  assert.equal(d.sessionID, 'ses_1');
});

test('tiers: injectDecision falls back when full but failed', () => {
  const d = injectDecision('full', { ok: false, response: '' }, { context: 'c', instruction: 'keep me' });
  assert.equal(d.mode, 'clipboard');
  assert.ok(d.package.includes('keep me'));
});

test('tiers: handoffPackage includes every provided field', () => {
  const p = handoffPackage({ from: 'codex', context: 'CTX', instruction: 'INS', artifacts: ['a.png', 'b.md'] });
  for (const needle of ['codex', 'CTX', 'INS', 'a.png', 'b.md']) assert.ok(p.includes(needle));
});

// Task 4: 线上（adapter prompt / inject 文本）与离线（clipboard 交接包）必须使用
// 同一字段顺序与中文标签 from/context/instruction/artifacts，精确字面量锁死格式。
test('tiers: handoffPackage exact format, fixed field order, artifacts listed by line', () => {
  const full = handoffPackage({ from: 'codex', context: 'CTX', instruction: 'INS', artifacts: ['a.png', 'b.md'] });
  assert.equal(full, 'Relay handoff from codex\n上下文：\nCTX\n指令：\nINS\n产物：\na.png\nb.md');
  const empty = handoffPackage({});
  assert.equal(empty, 'Relay handoff from petdeck');
});

test('tiers: injectDecision clipboard preserves from + artifacts (offline package drops nothing)', () => {
  const d = injectDecision('full', { ok: false, response: '' }, { from: 'codex', context: 'c', instruction: 'i', artifacts: ['a.png'] });
  assert.equal(d.mode, 'clipboard');
  assert.equal(d.package, 'Relay handoff from codex\n上下文：\nc\n指令：\ni\n产物：\na.png');
});

// Adapter prompt inclusion: the CLI prompt must carry the SAME handoff format (with
// artifacts) so an injected handoff never drops what the clipboard fallback would keep.
test('adapters: inject prompt carries from/context/instruction/artifacts in unified format', async () => {
  const captured = [];
  const run = async (cmd, args, opts = {}) => {
    captured.push({ cmd, args, opts });
    return { status: 0, stdout: cmd === 'opencode' ? JSON.stringify({ type: 'text', part: { text: 'ok' } }) : 'ok', stderr: '' };
  };
  const payload = { from: 'codex', to: 'x', context: 'CTX', instruction: 'INS', artifacts: ['a.png', 'b.md'] };
  await codexInject(payload, { run });
  await claudeInject(payload, { run });
  await opencodeInject(payload, { run });
  assert.equal(captured.length, 3);
  for (const { cmd, args, opts } of captured) {
    const prompt = cmd === 'opencode' ? opts.input : args.at(-1);
    for (const needle of ['Relay handoff from codex', 'CTX', 'INS', 'a.png', 'b.md']) {
      assert.ok(String(prompt).includes(needle), `${cmd} prompt must include ${needle}`);
    }
    const order = ['上下文', '指令', '产物'].map((l) => String(prompt).indexOf(l));
    assert.ok(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], `${cmd} prompt must keep from/context/instruction/artifacts order`);
  }
});

// Bridge forwarding: /api/inject must pass artifacts (and from) straight into the
// clipboard fallback package — a degraded handoff must not silently lose them.
test('bridge: inject forwards artifacts into the decision package on CLI failure', async (t) => {
  const adapters = [{
    id: 'codex', name: 'Codex', tier: 'full',
    observe: () => [],
    inject: () => Promise.resolve({ ok: false, response: '' }),
  }];
  const app = createApp({ adapters, security: {} });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => { app.closeAllConnections?.(); app.close(); });
  const port = app.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'codex', to: 'codex', context: 'c', instruction: 'i', artifacts: ['a.png'] }),
  });
  assert.equal(res.status, 200);
  const d = await res.json();
  assert.equal(d.mode, 'clipboard');
  assert.equal(d.package, 'Relay handoff from codex\n上下文：\nc\n指令：\ni\n产物：\na.png');
});

test('bus: normalize + replay + unsubscribe', () => {
  const bus = createBus();
  const seen = [];
  const un = bus.subscribe((e) => seen.push(e));
  bus.emit({ agentId: 'codex', type: 'task_complete', payload: { lastMessage: 'a' } });
  bus.emit({ agentId: 'codex', type: 'turn_aborted', payload: {} });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].agentId, 'codex');
  assert.ok(seen[0].id);
  un();
  bus.emit({ agentId: 'codex', type: 'task_started', payload: {} });
  assert.equal(seen.length, 2);
  // late subscriber gets replay
  const late = [];
  bus.subscribe((e) => late.push(e));
  assert.equal(late.length, 3);
});

test('bus: toPetEventType mapping', () => {
  assert.equal(toPetEventType('task_complete'), 'done');
  assert.equal(toPetEventType('turn_aborted'), 'stuck');
  assert.equal(toPetEventType('decision'), 'decision');
  assert.equal(toPetEventType('relay-ready'), 'relay-ready');
});
// --- Task 7: 降级原因 —— tier（能力分级）/ cli（目标 CLI 拒绝）；bridge-error 在 bridge 层 ---
test('tiers: clipboard fallback carries fallbackReason tier when the tier cannot inject', () => {
  const d = injectDecision('observe-only', { ok: true, response: 'x' }, { context: 'c' });
  assert.equal(d.mode, 'clipboard');
  assert.equal(d.fallbackReason, 'tier');
});

test('tiers: clipboard fallback carries fallbackReason cli when a full-tier CLI refuses', () => {
  const d = injectDecision('full', { ok: false, response: '' }, { context: 'c', instruction: 'i' });
  assert.equal(d.mode, 'clipboard');
  assert.equal(d.fallbackReason, 'cli');
});

test('tiers: a successful inject has no fallbackReason', () => {
  const d = injectDecision('full', { ok: true, response: 'x', sessionID: 'ses_1' });
  assert.equal(d.mode, 'inject');
  assert.equal(d.fallbackReason, undefined);
});
