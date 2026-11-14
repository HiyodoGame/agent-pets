// Flow4 relay-draft logic: real source only, real target, no mock fallback.
// Run: node --test src/flows/flow-4-relay/relay-draft.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRelayDraft, resolveTarget, canSend, summarizeSource, sendStateFromDecision } from './relay-draft.ts';
import type { Agent, Session } from '../shared/types.ts';

const agent = (id: string): Agent => ({ id, name: id.toUpperCase(), form: 'cli', capability: 'full', status: 'idle', projectIds: [] });
const session = (over: Partial<Session> = {}): Session => ({
  id: 'codex:s1', projectId: 'live', agentId: 'codex', title: 'T', status: 'done',
  messages: [{ id: 'm1', role: 'agent', content: '素材已生成', timestamp: '', artifactIds: [] }],
  artifactIds: ['a1', 'a2'], updatedAt: '', ...over,
});

test('buildRelayDraft: null source => null (no mock substitution)', () => {
  assert.equal(buildRelayDraft(null, [agent('claude')]), null);
});

test('buildRelayDraft: uses real context + artifacts + a target != source agent', () => {
  const d = buildRelayDraft(session(), [agent('codex'), agent('claude')]);
  assert.equal(d?.sourceSessionId, 'codex:s1');
  assert.equal(d?.contextSummary, '素材已生成');
  assert.deepEqual(d?.artifactIds, ['a1', 'a2']);
  assert.equal(d?.targetAgentId, 'claude');
});

test('buildRelayDraft: no other agent => empty target (send blocked downstream)', () => {
  const d = buildRelayDraft(session(), [agent('codex')]);
  assert.equal(d?.targetAgentId, '');
});

test('resolveTarget: unknown id => null (never falls back to a mock agent)', () => {
  const d = { targetAgentId: 'ghost' } as never;
  assert.equal(resolveTarget(d, [agent('codex')]), null);
});

test('canSend: requires source + target + non-empty instruction', () => {
  const base = buildRelayDraft(session(), [agent('codex'), agent('claude')])!;
  const target = resolveTarget(base, [agent('codex'), agent('claude')]);
  assert.equal(canSend(base, target, session()), false); // instruction empty
  assert.equal(canSend({ ...base, instruction: 'go' }, target, session()), true);
  assert.equal(canSend({ ...base, instruction: 'go' }, null, session()), false); // no target
  assert.equal(canSend({ ...base, instruction: 'go' }, target, null), false); // no source
});

test('summarizeSource: falls back to title when no agent message', () => {
  assert.equal(summarizeSource(session({ messages: [] })), 'T');
});

// 注入响应契约：只有 mode === 'inject' 算成功；clipboard 降级为手动；任何其它
// （undefined / 未知 mode，例如 bridge 错误体被误传）必须 failed，绝不假成功。
test('sendStateFromDecision: inject -> injected, clipboard -> manual', () => {
  assert.equal(sendStateFromDecision('inject'), 'injected');
  assert.equal(sendStateFromDecision('clipboard'), 'manual');
});

test('sendStateFromDecision: undefined or unknown mode -> failed (no fake success)', () => {
  assert.equal(sendStateFromDecision(undefined), 'failed');
  assert.equal(sendStateFromDecision('error'), 'failed');
  assert.equal(sendStateFromDecision(null), 'failed');
});
