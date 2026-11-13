// RED tests for a11y/UX pure logic: stepper state + user motion preference.
// Run: node --test src/flows/shared/ui-logic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepperState, resolveMotionEnabled } from './ui-logic.ts';

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