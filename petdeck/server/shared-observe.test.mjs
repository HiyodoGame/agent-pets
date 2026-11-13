// RED tests: observe helpers must surface real faults, tolerate legit absence.
// Run: node --test server/shared-observe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tailLines, latestFiles } from './adapters/shared.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-observe-'));
const aFile = path.join(tmp, 'rollout-a.jsonl');
fs.writeFileSync(aFile, '{"payload":{"type":"task_complete"}}\n');

test('latestFiles: missing base dir => [] (source not installed, legit empty)', () => {
  const r = latestFiles(path.join(tmp, 'nope-does-not-exist'), () => true, 5);
  assert.deepEqual(r, []);
});

test('latestFiles: base path is a file (ENOTDIR) => throws (a real fault)', () => {
  assert.throws(() => latestFiles(aFile, () => true, 5));
});

test('latestFiles: finds matching files newest-first', () => {
  const r = latestFiles(tmp, (n) => n.endsWith('.jsonl'), 5);
  assert.deepEqual(r, [aFile]);
});

test('tailLines: missing file => [] (ENOENT tolerated)', () => {
  assert.deepEqual(tailLines(path.join(tmp, 'gone.jsonl'), 10), []);
});

test('tailLines: reads lines from a real file', () => {
  const lines = tailLines(aFile, 10);
  assert.equal(lines.length, 1);
});

test('tailLines: bounded window returns only the tail and drops the partial first line', () => {
  const big = path.join(tmp, 'rollout-big.jsonl');
  fs.writeFileSync(big, 'L1\nL2\nL3\nL4\n'); // 4 lines, each 3 bytes
  // maxBytes 4 => start mid-file; must never return L1 and should yield trailing whole lines.
  const tail = tailLines(big, 10, 4);
  assert.equal(tail.includes('L1'), false);
  assert.deepEqual(tail, ['L4']);
});
