import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CRASH_FILE_RE,
  consumeCrashReports,
  crashFilePath,
  installCrashHandlers,
  writeCrashReport,
} from './crash.mjs';

function tempDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-' + name + '-'));
  return dir;
}

test('crashStamp: UTC filename is lexicographically sortable and matches the consumer', () => {
  const file = crashFilePath('C:/data', Date.UTC(2026, 10, 21, 7, 39, 3, 123));
  assert.equal(path.basename(file), 'crash-2026-11-21T07-39-03-123.json');
  assert.equal(CRASH_FILE_RE.test(path.basename(file)), true);
});

test('writeCrashReport: keeps reason, error and at most 50 recent log lines', () => {
  const dir = tempDir('crash-write');
  try {
    const lines = Array.from({ length: 80 }, (_, i) => 'line-' + i);
    const error = new Error('boom');
    const file = writeCrashReport({
      dataDir: dir,
      reason: 'uncaughtException',
      error,
      extra: { activeTasks: ['t1'], counts: { running: 1 } },
      recentLines: lines,
      now: Date.UTC(2026, 10, 21, 7, 0, 0, 0),
    });
    assert.equal(file, path.join(dir, 'crash-2026-11-21T07-00-00-000.json'));
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(raw.reason, 'uncaughtException');
    assert.equal(raw.error.name, 'Error');
    assert.equal(raw.error.message, 'boom');
    assert.equal(Array.isArray(raw.error.stack), true);
    assert.deepEqual(raw.activeTasks, ['t1']);
    assert.equal(raw.recentLogs.length, 50);
    assert.equal(raw.recentLogs[0], 'line-30');
    assert.equal(raw.recentLogs[49], 'line-79');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('writeCrashReport: a missing dataDir is a no-op', () => {
  assert.equal(writeCrashReport({ dataDir: '', reason: 'x' }), null);
});

test('consumeCrashReports: returns the newest report and renames every report to .seen', () => {
  const dir = tempDir('crash-consume');
  try {
    writeCrashReport({ dataDir: dir, reason: 'first', now: Date.UTC(2026, 10, 20, 1, 0, 0, 0) });
    writeCrashReport({ dataDir: dir, reason: 'second', error: new Error('kaput'), now: Date.UTC(2026, 10, 21, 2, 0, 0, 0) });
    const newest = consumeCrashReports({ dataDir: dir });
    assert.equal(newest.reason, 'second');
    assert.equal(newest.error, 'kaput');
    assert.equal(fs.readdirSync(dir).filter((n) => CRASH_FILE_RE.test(n)).length, 0);
    assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.json.seen')).length, 2);
    assert.equal(consumeCrashReports({ dataDir: dir }), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('consumeCrashReports: an unreadable report still gets consumed and reported', () => {
  const dir = tempDir('crash-bad');
  try {
    fs.writeFileSync(crashFilePath(dir, Date.UTC(2026, 10, 21, 3, 0, 0, 0)), '{not json', 'utf8');
    const newest = consumeCrashReports({ dataDir: dir });
    assert.equal(newest.reason, 'unreadable');
    assert.equal(fs.readdirSync(dir).filter((n) => n.endsWith('.seen')).length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('installCrashHandlers: records uncaught errors, exits, and uninstalls cleanly', () => {
  const dir = tempDir('crash-handlers');
  const logs = [];
  const logger = { error: (msg, fields) => logs.push([msg, fields]), recentLines: () => ['log-a'] };
  let exitCode = null;
  const beforeUncaught = new Set(process.listeners('uncaughtException'));
  const beforeCounts = [process.listenerCount('uncaughtException'), process.listenerCount('unhandledRejection')];
  const beforeRejection = new Set(process.listeners('unhandledRejection'));
  const uninstall = installCrashHandlers({ dataDir: dir, logger, getExtra: () => ({ activeTasks: ['t9'] }), exit: (code) => { exitCode = code; } });
  const onUncaught = process.listeners('uncaughtException').find((fn) => !beforeUncaught.has(fn));
  const onRejection = process.listeners('unhandledRejection').find((fn) => !beforeRejection.has(fn));
  try {
    assert.equal(typeof onUncaught, 'function');
    assert.equal(typeof onRejection, 'function');
    onUncaught(new Error('kaboom'));
    assert.equal(exitCode, 1);
    const files = fs.readdirSync(dir).filter((n) => CRASH_FILE_RE.test(n));
    assert.equal(files.length, 1);
    const raw = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    assert.equal(raw.reason, 'uncaughtException');
    assert.deepEqual(raw.activeTasks, ['t9']);
    assert.deepEqual(raw.recentLogs, ['log-a']);
    assert.equal(logs[0][0], 'crash.report_written');
    onRejection(new Error('rejected'));
    assert.equal(fs.readdirSync(dir).filter((n) => CRASH_FILE_RE.test(n)).length, 2);
  } finally {
    uninstall();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(
    [process.listenerCount('uncaughtException'), process.listenerCount('unhandledRejection')],
    beforeCounts,
  );
});