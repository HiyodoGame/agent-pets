// RED tests: data-sync pure decisions behind DataSourceProvider's HTTP/SSE/cache sync.
// Run: node --test src/adapters/data-sync.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldCommitHttp, shouldLoadSnapshot, observedToSessions } from './data-sync.ts';
import type { ObservedSession } from './types.ts';

const NOW = '2026-11-14T10:00:00.000Z';

function row(over: Partial<ObservedSession> = {}): ObservedSession {
  return {
    agent: 'kimi',
    source: 'local',
    session: 's-1',
    status: 'running',
    lastMessage: 'hello',
    ...over,
  };
}

// ---- stale HTTP：in-flight 响应晚到时，若期间有更新提交则必须丢弃 ----

test('data-sync: an HTTP response is committed when no newer commit landed while it was in flight', () => {
  assert.equal(shouldCommitHttp(0, 0), true);
  assert.equal(shouldCommitHttp(3, 3), true);
});

test('data-sync: an HTTP response is skipped as stale when an SSE commit bumped the revision meanwhile', () => {
  // SSE 先提交：revBefore=1 时发起 fetch，响应到达前 commit 把 rev 推到 2 => 旧响应不得覆盖。
  assert.equal(shouldCommitHttp(1, 2), false);
  assert.equal(shouldCommitHttp(1, 0), false, 'revision must never go backwards into a commit');
});

// ---- 冷启动缓存与内存 last-good 优先 ----

test('data-sync: cold start with no in-memory data and cache not yet shown loads the disk snapshot', () => {
  assert.equal(shouldLoadSnapshot(false, false), true);
});

test('data-sync: in-memory last-good data wins — snapshot is not loaded while memory has data', () => {
  // 断连保留内存 last-good，绝不拿旧磁盘快照覆盖。
  assert.equal(shouldLoadSnapshot(true, false), false);
  assert.equal(shouldLoadSnapshot(true, true), false);
});

test('data-sync: cache is shown at most once per offline episode', () => {
  assert.equal(shouldLoadSnapshot(false, true), false);
});

// ---- observedToSessions：行 → Session 投影（含修正后的 unknown 状态映射） ----

test('data-sync: observed rows project to sessions with derived id and live project binding', () => {
  const sessions = observedToSessions([row(), row({ agent: 'codex', session: 's-2' })], NOW);
  assert.deepEqual(
    sessions.map((s) => [s.id, s.projectId, s.agentId]),
    [['kimi:s-1', 'live', 'kimi'], ['codex:s-2', 'live', 'codex']],
  );
});

test('data-sync: title falls back to the session id when there is no last message, and messages mirror it', () => {
  const [silent, chatty] = observedToSessions(
    [row({ lastMessage: '' }), row({ lastMessage: 'working on it' })],
    NOW,
  );
  assert.equal(silent.title, 's-1');
  assert.equal(silent.messages.length, 0);
  assert.equal(chatty.title, 'working on it');
  assert.equal(chatty.messages.length, 1);
  assert.equal(chatty.messages[0].role, 'agent');
  assert.equal(chatty.messages[0].content, 'working on it');
});

test('data-sync: freshness fields and timestamps pass through / derive from `now`', () => {
  const [s] = observedToSessions([row({ stale: true, lastSeen: 123 })], NOW);
  assert.equal(s.stale, true);
  assert.equal(s.lastSeen, 123);
  assert.equal(s.updatedAt, NOW);
  assert.equal(s.messages[0].timestamp, NOW);
});

test('data-sync: unknown observed statuses never pose as running — they map to waiting', () => {
  const statuses = ['done', 'running', 'stuck', 'waiting', 'unknown', 'garbage', ''].map((status) =>
    observedToSessions([row({ status })], NOW)[0].status,
  );
  // 修正后的映射：known 保留语义，任何未知值按 waiting 展示，绝不谎报 active。
  assert.deepEqual(statuses, ['done', 'active', 'stuck', 'waiting', 'waiting', 'waiting', 'waiting']);
});

// ---- 用量（成本 MVP）：观察行 tokens 透传到 Session ----

test('data-sync: tokens from observed rows pass through for cost display', () => {
  const [s] = observedToSessions([row({ tokens: { input: 150, output: 25, cacheRead: 5000 } })], NOW);
  assert.deepEqual(s.tokens, { input: 150, output: 25, cacheRead: 5000 });
  const [bare] = observedToSessions([row({ tokens: undefined })], NOW);
  assert.equal(bare.tokens, undefined, 'no usage data must stay absent, not zero-fabricated');
});
