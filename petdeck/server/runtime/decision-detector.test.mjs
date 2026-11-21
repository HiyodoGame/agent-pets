import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDecision } from './decision-detector.mjs';

test('detects a numbered choice with a question above it', () => {
  const result = detectDecision('I can take either path.\n\nWhich one should I use?\n\n1. Add the migration now\n2. Write the docs first\n');
  assert.ok(result);
  assert.equal(result.options.length, 2);
  assert.match(result.question, /Which one/);
  assert.equal(result.options[0].label, 'Add the migration now');
  assert.equal(result.allowFreeform, true);
});

test('detects Chinese choice with full-width question mark', () => {
  const result = detectDecision('两种方案都能跑通。\n请选择下一步：\n1. 先补测试\n2. 先做界面\n');
  assert.ok(result);
  assert.equal(result.options.length, 2);
  assert.match(result.question, /请选择/);
});

test('ignores option-like list without a question', () => {
  assert.equal(detectDecision('Steps completed:\n1. Read the file\n2. Edited the config\n3. Ran the tests\n'), null);
});

test('ignores a bare question without options', () => {
  assert.equal(detectDecision('Should I continue?'), null);
});

test('ignores ordinary prose with numbered references', () => {
  assert.equal(detectDecision('See section 1. Intro and 2. Usage for details.\nThe build passed.'), null);
});

test('accepts markdown bullets and strips bold markers', () => {
  const result = detectDecision('Need your call before I continue.\n\n- **Keep** the old API\n- **Replace** it with the new one\n');
  assert.ok(result);
  assert.deepEqual(result.options.map((o) => o.label), ['Keep the old API', 'Replace it with the new one']);
});

test('rejects an over-long option block', () => {
  const result = detectDecision('Which one?\n' + Array.from({ length: 12 }, (_, i) => (i + 1) + '. option ' + i).join('\n'));
  assert.equal(result, null);
});

test('detects lettered options', () => {
  const result = detectDecision('Please confirm the target branch:\nA) main\nB) release\n');
  assert.ok(result);
  assert.equal(result.options.length, 2);
});
