// RED tests for a11y/UX pure logic: stepper state + user motion preference.
// Run: node --test src/flows/shared/ui-logic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepperState, resolveMotionEnabled, fmtAgo } from './ui-logic.ts';

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

test('fmtAgo: relative freshness buckets', () => {
  const now = 1_700_000_000_000;
  assert.equal(fmtAgo(now - 30_000, now), '刚刚');
  assert.equal(fmtAgo(now - 5 * 60_000, now), '5 分钟前');
  assert.equal(fmtAgo(now - 3 * 3_600_000, now), '3 小时前');
  assert.equal(fmtAgo(now - 2 * 86_400_000, now), '2 天前');
  assert.equal(fmtAgo(now + 10_000, now), '刚刚');
});