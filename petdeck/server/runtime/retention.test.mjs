import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dirSize, pruneRunTranscripts, storageUsage } from './retention.mjs';

const DAY = 86_400_000;

function makeRun(root, id, ageDays) {
  const dir = path.join(root, 'runs', id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'events.jsonl');
  fs.writeFileSync(file, '{"type":"x"}\n');
  if (ageDays != null) {
    const when = new Date(Date.now() - ageDays * DAY);
    fs.utimesSync(file, when, when);
  }
  return dir;
}

test('storageUsage counts runs, logs, artifacts and the database', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-retention-'));
  makeRun(root, 'run-old', 40);
  makeRun(root, 'run-new', 1);
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'logs', 'petdeck-2026-11-21.log'), 'x'.repeat(100));
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'artifacts', 'a.txt'), 'y'.repeat(50));
  fs.writeFileSync(path.join(root, 'petdeck.sqlite'), 'z'.repeat(10));
  const usage = storageUsage({ dir: root });
  assert.equal(usage.runCount, 2);
  assert.ok(usage.runsBytes >= 2 * 13);
  assert.ok(usage.logsBytes >= 100);
  assert.ok(usage.artifactsBytes >= 50);
  assert.equal(usage.dbBytes, 10);
  assert.equal(usage.totalBytes, usage.logsBytes + usage.runsBytes + usage.artifactsBytes + usage.dbBytes);
  assert.ok(usage.oldestRunMs <= Date.now() - 39 * DAY);
});

test('pruneRunTranscripts removes only runs older than keepDays', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-retention-'));
  const old = makeRun(root, 'run-old', 40);
  const fresh = makeRun(root, 'run-new', 1);
  const result = pruneRunTranscripts({ dir: root, keepDays: 30 });
  assert.equal(result.removed, 1);
  assert.ok(result.bytes > 0);
  assert.equal(fs.existsSync(old), false);
  assert.equal(fs.existsSync(fresh), true);
});

test('pruneRunTranscripts is a no-op when runs/ does not exist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-retention-'));
  assert.deepEqual(pruneRunTranscripts({ dir: root }), { removed: 0, bytes: 0, kept: 0 });
});

test('dirSize skips unreadable paths without throwing', () => {
  assert.equal(dirSize(path.join(os.tmpdir(), 'definitely-not-here-' + Date.now())), 0);
});
