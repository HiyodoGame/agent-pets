// Tests for a11y/UX pure logic: stepper/motion/freshness + live-connect & follow-up decisions.
// Run: node --test src/flows/shared/ui-logic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepperState, resolveMotionEnabled, getOsReducedMotion, fmtAgo, fmtTokens, fmtResetCountdown, decideLiveConnect, planFollowUp, fmtRateLimitWait, nextRateLimit, rateLimitPhase, mapSessionStatus, eventWatermark, newEventsAfter, routeDndArrivals, shouldStreamResponse, fieldErrorState, trapTabIndex } from './ui-logic.ts';
import type { PetEvent } from './types.ts';
import type { InjectDecision } from '../../adapters/types.ts';

test('trapTabIndex wraps at both edges and enters from outside', () => {
  assert.equal(trapTabIndex(0, 3, true), 2);
  assert.equal(trapTabIndex(2, 3, false), 0);
  assert.equal(trapTabIndex(1, 3, false), 2);
  assert.equal(trapTabIndex(1, 3, true), 0);
  assert.equal(trapTabIndex(-1, 3, false), 0);
  assert.equal(trapTabIndex(-1, 3, true), 2);
  assert.equal(trapTabIndex(0, 0, false), -1);
});

test('stepper: marks done/current/todo', () => {
  assert.deepEqual(stepperState(4, 1), ['done', 'current', 'todo', 'todo']);
});

test('stepper: first step current', () => {
  assert.deepEqual(stepperState(3, 0), ['current', 'todo', 'todo']);
});

test('stepper: last step all prior done', () => {
  assert.deepEqual(stepperState(3, 2), ['done', 'done', 'current']);
});

test('motion: off disables even if OS allows', () => {
  assert.equal(resolveMotionEnabled('off', false), false);
});

test('motion: on enables even if OS reduced', () => {
  assert.equal(resolveMotionEnabled('on', true), true);
});

test('motion: auto follows OS reduced', () => {
  assert.equal(resolveMotionEnabled('auto', true), false);
  assert.equal(resolveMotionEnabled('auto', false), true);
});

test('os-reduced-motion: no matchMedia (SSR) returns false', () => {
  assert.equal(getOsReducedMotion(undefined), false);
});

test('os-reduced-motion: follows injected matchMedia result', () => {
  assert.equal(getOsReducedMotion(() => ({ matches: true })), true);
  assert.equal(getOsReducedMotion(() => ({ matches: false })), false);
});

test('os-reduced-motion: queries the reduced-motion media feature', () => {
  let queried = '';
  getOsReducedMotion((q) => { queried = q; return { matches: false } });
  assert.equal(queried, '(prefers-reduced-motion: reduce)');
});

test('os-reduced-motion: throwing matchMedia degrades to false', () => {
  assert.equal(getOsReducedMotion(() => { throw new Error('no media') }), false);
});

// ---- fmtTokens（成本 MVP）：紧凑用量徽标 ----

test('fmtTokens: in/out arrows for split usage, total for cumulative, empty for absent', () => {
  assert.equal(fmtTokens({ input: 150, output: 25 }), '↑150 ↓25');
  assert.equal(fmtTokens({ input: 28_797_711, output: 136_316, cacheRead: 28_020_672 }), '↑28.8M ↓136.3k');
  assert.equal(fmtTokens({ total: 158_100 }), '158.1k', 'kimi 只有累计 token_count');
  assert.equal(fmtTokens(undefined), '');
  assert.equal(fmtTokens({ input: 0, output: 0 }), '');
});

// ---- fmtResetCountdown（P1-7 后半）：5h 用量窗口重置倒计时 ----

test('fmtResetCountdown: >=60min as 小时(1 位小数), <60min as 分钟, inactive/absent empty', () => {
  assert.equal(fmtResetCountdown({ active: true, minutesToReset: 150 }), '约 2.5 小时后重置');
  assert.equal(fmtResetCountdown({ active: true, minutesToReset: 60 }), '约 1 小时后重置');
  assert.equal(fmtResetCountdown({ active: true, minutesToReset: 40 }), '约 40 分钟后重置');
  assert.equal(fmtResetCountdown({ active: true, minutesToReset: 0 }), '', '0 分钟不展示(窗口已到点)');
  assert.equal(fmtResetCountdown({ active: false, minutesToReset: 0 }), '');
  assert.equal(fmtResetCountdown(undefined), '');
});

test('fmtAgo: relative freshness buckets', () => {  const now = 1_700_000_000_000;
  assert.equal(fmtAgo(now - 30_000, now), '刚刚');
  assert.equal(fmtAgo(now - 5 * 60_000, now), '5 分钟前');
  assert.equal(fmtAgo(now - 3 * 3_600_000, now), '3 小时前');
  assert.equal(fmtAgo(now - 2 * 86_400_000, now), '2 天前');
  assert.equal(fmtAgo(now + 10_000, now), '刚刚');
});

// ---- live connect 决策：只有 bridge 健康且目标在已发现列表中才可成功 ----

test('live connect: bridge offline fails even when target exists', () => {
  assert.equal(decideLiveConnect({ healthy: false, agentIds: ['a1'], selectedId: 'a1' }), 'offline');
});

test('live connect: healthy but target not discovered fails', () => {
  assert.equal(decideLiveConnect({ healthy: true, agentIds: ['a1'], selectedId: 'a2' }), 'missing');
});

test('live connect: healthy and target discovered succeeds', () => {
  assert.equal(decideLiveConnect({ healthy: true, agentIds: ['a1', 'a2'], selectedId: 'a2' }), 'ok');
});

// ---- 追问结果决策：只有 mode=inject 才声称已发送；clipboard 给出真实可复制交接内容 ----

test('follow-up: only a real inject decision claims sent', () => {
  const d: InjectDecision = { mode: 'inject', response: 'ack', sessionID: 'sess-1' };
  const plan = planFollowUp(d);
  assert.equal(plan.outcome, 'sent');
  assert.equal(plan.toast, '已发送追问');
  assert.equal(plan.copyText, undefined);
});

test('follow-up: clipboard fallback exposes the real package instead of claiming sent', () => {
  const d: InjectDecision = { mode: 'clipboard', package: 'Relay handoff package:\nctx\ninst' };
  const plan = planFollowUp(d);
  assert.equal(plan.outcome, 'clipboard');
  assert.equal(plan.copyText, 'Relay handoff package:\nctx\ninst');
  assert.ok(!plan.toast.includes('已发送'));
});

test('follow-up: clipboard fallback without package still does not claim sent', () => {
  const plan = planFollowUp({ mode: 'clipboard' });
  assert.equal(plan.outcome, 'clipboard');
  assert.ok(!plan.toast.includes('已发送'));
});

// ---- 限流倒计时文案：只提示可重试时间，不承诺自动重试 ----

test('rate-limit copy: states retry wait without promising auto retry', () => {
  assert.equal(fmtRateLimitWait(5), '桥接限流，5 秒后可重试。');
  assert.ok(!fmtRateLimitWait(5).includes('自动'));
});

test('rate-limit state: countdown reaches a stable manual-retry state', () => {
  assert.equal(nextRateLimit(null), null);
  assert.equal(nextRateLimit(2), 1);
  assert.equal(nextRateLimit(1), 0);
  assert.equal(nextRateLimit(0), 0);
  assert.equal(rateLimitPhase(null), null);
  assert.equal(rateLimitPhase(1), 'waiting');
  assert.equal(rateLimitPhase(0), 'ready');
});

// ---- Task 5: 状态映射 —— unknown / 未识别状态绝不冒充 active（运行中） ----

test('session status: known adapter statuses map to their session status', () => {
  assert.equal(mapSessionStatus('running'), 'active');
  assert.equal(mapSessionStatus('done'), 'done');
  assert.equal(mapSessionStatus('stuck'), 'stuck');
  assert.equal(mapSessionStatus('waiting'), 'waiting');
});

test('session status: unknown maps to waiting, never active', () => {
  assert.equal(mapSessionStatus('unknown'), 'waiting');
});

test('session status: unrecognized raw statuses fall back to waiting, not active', () => {
  assert.equal(mapSessionStatus(''), 'waiting');
  assert.equal(mapSessionStatus('busy-doing-what'), 'waiting');
});

// ---- Task 5: 水位线 —— 列表满 50 条被截断时仍能识别新事件 ----

const ev = (id: string, ts: number): PetEvent => ({
  id,
  type: 'done',
  projectId: 'live',
  sessionId: 's1',
  agentId: 'codex',
  agentName: 'Codex',
  projectName: 'Project',
  sessionTitle: 'Task',
  text: `text-${id}`,
  timestamp: new Date(ts).toISOString(),
  handled: false,
});

const CAP = 50;

/** newest-first 满 50 条基线：e49 最新，e0 最旧。 */
function cappedBaseline(base: number): PetEvent[] {
  return Array.from({ length: CAP }, (_, i) => ev(`e${CAP - 1 - i}`, base + (CAP - 1 - i) * 1000));
}

function cappedListWithNewest(newId: string, base: number): { list: PetEvent[]; newest: PetEvent } {
  // 第 51 条到达后最旧的一条被挤出，长度仍停在 50，最新一条位于队首。
  const newest = ev(newId, base + CAP * 1000);
  const list = [newest, ...cappedBaseline(base)];
  return { list: list.slice(0, CAP), newest };
}

test('watermark: null watermark treats every event as new; empty list has no watermark', () => {
  assert.equal(eventWatermark([]), null);
  const all = [ev('a', 1000), ev('b', 2000)];
  assert.deepEqual(newEventsAfter(all, null).map((e) => e.id), ['a', 'b']);
});

test('watermark: unchanged capped list yields no new events', () => {
  const base = 1_700_000_000_000;
  const list = cappedBaseline(base);
  const wm = eventWatermark(list);
  assert.ok(wm);
  assert.deepEqual(newEventsAfter(list, wm), []);
});

test('watermark: detects the new event even when the list stays capped at 50', () => {
  const base = 1_700_000_000_000;
  const wm = eventWatermark(cappedBaseline(base));
  assert.ok(wm);
  const { list, newest } = cappedListWithNewest('e-new', base);
  assert.equal(list.length, CAP);
  assert.deepEqual(newEventsAfter(list, wm).map((e) => e.id), [newest.id]);
});

test('watermark: derived from max timestamp regardless of list order (demo data is oldest-first)', () => {
  const base = 1_700_000_000_000;
  // 旧事件在前的乱序列表（演示数据即如此）：水位线必须取最大 timestamp 的事件。
  const unordered = [ev('e-old', base), ev('e-new', base + 5000)];
  const wm = eventWatermark(unordered);
  assert.ok(wm);
  assert.equal(wm.ts, base + 5000);
  assert.deepEqual(newEventsAfter(unordered, wm), []);
  assert.deepEqual(newEventsAfter([ev('e-fresh', base + 9000), ...unordered], wm).map((e) => e.id), ['e-fresh']);
});

test('watermark: same-millisecond burst is disambiguated by the frontier id set', () => {  const base = 1_700_000_000_000;
  // 同毫秒突发 [b, a] 全部进入水位线 id 集合；新到达者只要不在集合内即算新，
  // 与 uuid 大小序无关（bridge 一轮 poll 内多事件同毫秒且 uuid 无序）。
  const before = [ev('b', base), ev('a', base)];
  const wm = eventWatermark(before);
  assert.ok(wm);
  assert.deepEqual(newEventsAfter([ev('0-smaller-uuid', base), ...before], wm).map((e) => e.id), ['0-smaller-uuid']);
  assert.deepEqual(newEventsAfter(before, wm), []);
});
// ---- Task 5 复审修复：DND 分流 —— decision 绝不入静默队列（无论用户身处哪个 screen 都要轻拍）；quiet 保持入队 ----

test('dnd routing: decision events route to tap, never to the suppressed queue', () => {
  const base = 1_700_000_000_000;
  const d1 = { ...ev('d1', base + 1000), type: 'decision' as const };
  const { quiet, decision } = routeDndArrivals([ev('q1', base + 2000), d1, ev('q2', base + 3000)]);
  assert.deepEqual(quiet.map((e) => e.id), ['q1', 'q2']);
  assert.equal(decision?.id, 'd1');
});

test('dnd routing: same-batch decisions collapse to a single tap representative; empty batch routes nothing', () => {
  const base = 1_700_000_000_000;
  const d1 = { ...ev('d1', base + 1000), type: 'decision' as const };
  const d2 = { ...ev('d2', base + 2000), type: 'decision' as const };
  const both = routeDndArrivals([d1, d2]);
  assert.equal(both.decision?.id, 'd1');
  assert.deepEqual(both.quiet, []);
  const none = routeDndArrivals([]);
  assert.equal(none.decision, null);
  assert.deepEqual(none.quiet, []);
});

// ---- 流式响应归属：仅最后一条 assistant（非 user）消息在会话活跃时可显示 streaming ----

const thread = [
  { role: 'agent', content: 'a1' },
  { role: 'user', content: 'u1' },
  { role: 'agent', content: 'a2' },
];

test('streaming: only the last message streams, and only when it is an assistant message', () => {
  assert.equal(shouldStreamResponse(thread, 2, true), true);
  assert.equal(shouldStreamResponse(thread, 0, true), false);
  assert.equal(shouldStreamResponse(thread, 1, true), false);
});

test('streaming: inactive session never streams', () => {
  assert.equal(shouldStreamResponse(thread, 2, false), false);
});

test('streaming: last message being a user message streams nothing', () => {
  const t = [...thread, { role: 'user', content: 'u2' }];
  assert.equal(shouldStreamResponse(t, 3, true), false);
  assert.equal(shouldStreamResponse(t, 2, true), false);
});

test('streaming: empty thread or out-of-range index streams nothing', () => {
  assert.equal(shouldStreamResponse([], 0, true), false);
  assert.equal(shouldStreamResponse(thread, 3, true), false);
  assert.equal(shouldStreamResponse(thread, -1, true), false);
});

// ---- 表单校验可见性：错误仅在 blur/submit 后出现；aria-invalid / aria-describedby 与可见错误同步 ----

test('field error: pristine field shows no error and no a11y wiring', () => {
  assert.deepEqual(fieldErrorState({ value: '', touched: false, submitted: false, errorId: 'err' }), {
    showError: false, ariaInvalid: false, describedBy: null,
  });
});

test('field error: blur reveals the error on an invalid value', () => {
  assert.deepEqual(fieldErrorState({ value: '   ', touched: true, submitted: false, errorId: 'err' }), {
    showError: true, ariaInvalid: true, describedBy: 'err',
  });
});

test('field error: submit reveals the error without a prior blur', () => {
  assert.deepEqual(fieldErrorState({ value: '', touched: false, submitted: true, errorId: 'err' }), {
    showError: true, ariaInvalid: true, describedBy: 'err',
  });
});

test('field error: valid value never shows an error, even after blur/submit', () => {
  assert.deepEqual(fieldErrorState({ value: '  下一步  ', touched: true, submitted: true, errorId: 'err' }), {
    showError: false, ariaInvalid: false, describedBy: null,
  });
});

// ---- 演示模式追问：本地追加用户消息 + 如实交接复制，绝不谎称已发送 ----

test('follow-up: demo clipboard appends the message locally and shows an honest handoff (no sent claim)', () => {
  const d: InjectDecision = { mode: 'clipboard', package: 'Relay handoff package:\nctx\ninst' };
  const plan = planFollowUp(d, { live: false });
  assert.equal(plan.outcome, 'clipboard');
  assert.equal(plan.appendLocal, true, 'demo: the user message must appear in the thread locally');
  assert.equal(plan.copyText, 'Relay handoff package:\nctx\ninst');
  assert.ok(!plan.toast.includes('已发送'), 'demo must never claim a real send');
});

test('follow-up: demo clipboard without package still appends locally and does not claim sent', () => {
  const plan = planFollowUp({ mode: 'clipboard' }, { live: false });
  assert.equal(plan.outcome, 'clipboard');
  assert.equal(plan.appendLocal, true);
  assert.ok(!plan.toast.includes('已发送'));
});

test('follow-up: live clipboard fallback keeps prior behavior (no local append, honest copy toast)', () => {
  const d: InjectDecision = { mode: 'clipboard', package: 'p', fallbackReason: 'cli' };
  const plan = planFollowUp(d, { live: true });
  assert.equal(plan.appendLocal, false, 'live clipboard: message was never delivered, must not appear as sent');
  assert.equal(plan.copyText, 'p');
  assert.ok(!plan.toast.includes('已发送'));
});

test('follow-up: default options keep live semantics (inject claims sent, clipboard does not)', () => {
  assert.equal(planFollowUp({ mode: 'inject' }).appendLocal, true);
  assert.equal(planFollowUp({ mode: 'clipboard', package: 'p' }).appendLocal, false);
});

test('streaming: observed live snapshots render as completed Markdown instead of a fake stream', () => {
  assert.equal(shouldStreamResponse(thread, 2, true, false), false);
  assert.equal(shouldStreamResponse(thread, 2, true, true), true);
});
