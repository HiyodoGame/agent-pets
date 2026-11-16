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

test('latestFiles: identical mtimes tiebreak deterministically by path (no flaky order)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-tie-'));
  const b = path.join(dir, 'b.jsonl');
  const a = path.join(dir, 'a.jsonl'); // created AFTER b: same-name-first would differ per fs
  fs.writeFileSync(b, 'x');
  fs.writeFileSync(a, 'x');
  const at = fs.statSync(a).mtimeMs;
  const d = new Date(at); // utimesSync 接受 Date；直接传毫秒数会被当秒导致时间错乱
  fs.utimesSync(b, d, d); // force identical mtimes: order must not depend on creation luck
  const r = latestFiles(dir, (n) => n.endsWith('.jsonl'), 5);
  assert.deepEqual(r, [a, b], 'mtime 打平时必须按路径升序，跨平台确定性');
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

// --- Task 6: directory-entry caching — unchanged subtrees are not re-walked, but
// candidate files are still stat-ed so content/mtime updates stay visible. ---

function makeTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-cache-'));
  const a = path.join(dir, 'a.jsonl');
  const b = path.join(dir, 'sub', 'b.jsonl');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(a, 'x');
  fs.writeFileSync(b, 'x');
  return { dir, a, b };
}

test('latestFiles: content/mtime update without a directory mtime change stays visible', () => {
  const { dir, a, b } = makeTree();
  const pred = (n) => n.endsWith('.jsonl');
  const before = fs.statSync(dir).mtimeMs;
  // Make a.jsonl the newest file while leaving the directory mtime untouched.
  const t = Date.now() / 1000 + 5;
  fs.utimesSync(a, t, t);
  fs.utimesSync(dir, before / 1000, before / 1000); // dir mtime must look unchanged to the cache
  const r = latestFiles(dir, pred, 5);
  assert.equal(r[0], a, 'newest-first must reflect the file mtime we just bumped');
  assert.ok(r.includes(b));
});

test('latestFiles: vanished candidate is dropped even when the directory mtime looks unchanged', () => {
  const { dir, a } = makeTree();
  const pred = (n) => n.endsWith('.jsonl');
  assert.deepEqual(latestFiles(dir, pred, 5).sort(), [a, path.join(dir, 'sub', 'b.jsonl')].sort());
  const before = fs.statSync(dir).mtimeMs;
  fs.rmSync(a);
  fs.utimesSync(dir, before / 1000, before / 1000); // hide the deletion from directory mtime
  const r = latestFiles(dir, pred, 5);
  assert.deepEqual(r, [path.join(dir, 'sub', 'b.jsonl')], 'ghost candidate must not survive via cache');
});

test('latestFiles: a new file appears once the directory mtime moves', () => {
  const { dir, a, b } = makeTree();
  const pred = (n) => n.endsWith('.jsonl');
  latestFiles(dir, pred, 5); // warm the cache
  const c = path.join(dir, 'c.jsonl');
  fs.writeFileSync(c, 'x');
  const r = latestFiles(dir, pred, 5);
  assert.ok(r.includes(c), 'cache must invalidate when the directory mtime changes');
  assert.ok(r.includes(a) && r.includes(b));
});

test('latestFiles: cached directory deleted afterwards => [] (ENOENT semantics kept)', () => {
  const { dir } = makeTree();
  const pred = (n) => n.endsWith('.jsonl');
  latestFiles(dir, pred, 5); // warm the cache
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(latestFiles(dir, pred, 5), []);
});
