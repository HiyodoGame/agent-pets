// RED tests for Claude 5h usage window (reset countdown) — pure logic only.
// Run: node --test server/usage-window.test.mjs
// 口径对标 petdash:Anthropic 订阅的 5 小时滚动窗口——窗口从上一窗口结束后的
// 第一条消息起算,resetAt = 窗口起点 + 5h;数据全部来自本地 jsonl 的时间戳,
// 不做配额百分比的猜测(诚实约定:推算值必须可标注为「估」)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeUsageWindow, WINDOW_MS } from './usage-window.mjs';

const iso = (h, m = 0, s = 0) => `2026-11-16T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000Z`;
const tokens = (input = 0, output = 0, cacheRead = 0) => ({ input, output, cacheRead });

test('usage-window: empty input => inactive, zero tokens', () => {
  const w = computeUsageWindow([], iso(10));
  assert.equal(w.active, false);
  assert.equal(w.blockStart, null);
  assert.equal(w.resetAt, null);
  assert.equal(w.minutesToReset, 0);
  assert.deepEqual(w.windowTokens, { input: 0, output: 0, cacheRead: 0 });
});

test('usage-window: single entry, now inside window => active with blockStart/resetAt', () => {
  const w = computeUsageWindow([{ ts: iso(6), tokens: tokens(10, 20, 30) }], iso(8));
  assert.equal(w.active, true);
  assert.equal(w.blockStart, iso(6));
  assert.equal(w.resetAt, iso(11));
  assert.deepEqual(w.windowTokens, tokens(10, 20, 30));
});

test('usage-window: multiple entries same block => blockStart is first, tokens summed', () => {
  const w = computeUsageWindow(
    [
      { ts: iso(6), tokens: tokens(10, 20, 30) },
      { ts: iso(7, 30), tokens: tokens(100, 5, 200) },
      { ts: iso(9), tokens: tokens(1, 2, 3) },
    ],
    iso(9, 30),
  );
  assert.equal(w.active, true);
  assert.equal(w.blockStart, iso(6));
  assert.equal(w.resetAt, iso(11));
  assert.deepEqual(w.windowTokens, tokens(111, 27, 233));
});

test('usage-window: gap >= 5h opens a new block (00:00 vs 06:00, now 07:00)', () => {
  const w = computeUsageWindow(
    [
      { ts: iso(0), tokens: tokens(999, 999, 999) },
      { ts: iso(6), tokens: tokens(10, 20, 30) },
    ],
    iso(7),
  );
  assert.equal(w.active, true);
  assert.equal(w.blockStart, iso(6));
  assert.deepEqual(w.windowTokens, tokens(10, 20, 30), '旧窗口的 token 不得计入当前窗口');
});

test('usage-window: gap exactly 5h opens a new block (boundary is exclusive)', () => {
  const w = computeUsageWindow(
    [
      { ts: iso(0), tokens: tokens(1, 1, 1) },
      { ts: iso(5), tokens: tokens(2, 2, 2) },
    ],
    iso(6),
  );
  assert.equal(w.blockStart, iso(5));
  assert.deepEqual(w.windowTokens, tokens(2, 2, 2));
});

test('usage-window: last activity older than window end => inactive (window expired)', () => {
  // last message 06:00 => reset at 11:00; now 11:00:01 means expired
  const w = computeUsageWindow([{ ts: iso(6), tokens: tokens(10, 10, 10) }], iso(11, 0, 1));
  assert.equal(w.active, false);
  assert.equal(w.minutesToReset, 0);
});

test('usage-window: minutesToReset rounds up to whole minutes', () => {
  // last 06:00 => reset 11:00; now 10:59:30 => 30s left => 1 minute
  const w = computeUsageWindow([{ ts: iso(6), tokens: tokens(0, 0, 0) }], iso(10, 59, 30));
  assert.equal(w.active, true);
  assert.equal(w.minutesToReset, 1);
});

test('usage-window: entries out of order are sorted before blocking', () => {
  const w = computeUsageWindow(
    [
      { ts: iso(7, 30), tokens: tokens(100, 0, 0) },
      { ts: iso(6), tokens: tokens(10, 0, 0) },
    ],
    iso(8),
  );
  assert.equal(w.blockStart, iso(6), '乱序输入必须先排序再分块');
  assert.deepEqual(w.windowTokens, tokens(110, 0, 0));
});

test('usage-window: entries without valid ts are ignored', () => {
  const w = computeUsageWindow(
    [
      { tokens: tokens(5, 5, 5) }, // no ts
      { ts: 'not-a-date', tokens: tokens(6, 6, 6) }, // invalid
      { ts: iso(6), tokens: tokens(10, 20, 30) },
    ],
    iso(8),
  );
  assert.equal(w.active, true);
  assert.deepEqual(w.windowTokens, tokens(10, 20, 30));
});

test('usage-window: WINDOW_MS is exactly 5 hours', () => {
  assert.equal(WINDOW_MS, 5 * 60 * 60 * 1000);
});

// ---- 集成：claude observe() 把全部 jsonl 的 marks 聚合成账户级 usageWindow 挂到每行 ----
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { observe as claudeObserve } from './adapters/claude.mjs';

test('claude observe: attaches account-wide usageWindow (active) to every claude row', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-uw-'));
  const proj = path.join(home, '.claude', 'projects', 'proj-1');
  fs.mkdirSync(proj, { recursive: true });
  const line = JSON.stringify({
    type: 'assistant', timestamp: '2026-11-16T06:00:00.000Z', cwd: 'F:/proj',
    message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30 } },
  });
  fs.writeFileSync(path.join(proj, 'a.jsonl'), `${line}\n`);
  process.env.PETDECK_OBSERVE_HOME = home;
  try {
    const rows = claudeObserve(Date.parse('2026-11-16T08:00:00.000Z'));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].usageWindow, {
      active: true, blockStart: '2026-11-16T06:00:00.000Z', resetAt: '2026-11-16T11:00:00.000Z',
      minutesToReset: 180, windowTokens: { input: 10, output: 20, cacheRead: 30 },
    });
  } finally {
    delete process.env.PETDECK_OBSERVE_HOME;
  }
});

test('claude observe: inactive window still attached with minutesToReset 0 (not omitted)', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-uw2-'));
  const proj = path.join(home, '.claude', 'projects', 'proj-2');
  fs.mkdirSync(proj, { recursive: true });
  const line = JSON.stringify({
    type: 'assistant', timestamp: '2026-11-16T00:00:00.000Z', cwd: 'F:/proj',
    message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'old' }], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1 } },
  });
  fs.writeFileSync(path.join(proj, 'b.jsonl'), `${line}\n`);
  process.env.PETDECK_OBSERVE_HOME = home;
  try {
    // now 10:00 => window ended at 05:00, long expired
    const rows = claudeObserve(Date.parse('2026-11-16T10:00:00.000Z'));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].usageWindow, {
      active: false, blockStart: null, resetAt: null, minutesToReset: 0,
      windowTokens: { input: 0, output: 0, cacheRead: 0 },
    });
  } finally {
    delete process.env.PETDECK_OBSERVE_HOME;
  }
});
