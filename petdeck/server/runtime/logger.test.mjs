import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLogger, localDate, pruneOldLogs, sanitizeFields } from './logger.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-log-'));
}

function readLines(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

test('writes one JSON record per line with scope and structured fields', () => {
  const dir = tmpDir();
  const log = createLogger({ dir, scope: 'bridge', echo: false });
  log.info('listening', { port: 5199, authRequired: true });
  log.error('boom', { exitCode: 1 });
  const file = log.filePath();
  assert.ok(file.endsWith(localDate() + '.log'));
  const records = readLines(file);
  assert.equal(records.length, 2);
  assert.equal(records[0].level, 'info');
  assert.equal(records[0].scope, 'bridge');
  assert.equal(records[0].msg, 'listening');
  assert.equal(records[0].port, 5199);
  assert.equal(records[1].level, 'error');
  assert.equal(records[1].exitCode, 1);
  assert.match(records[0].ts, /^\d{4}-\d{2}-\d{2}T/);
});

test('child loggers extend the scope without changing the file', () => {
  const dir = tmpDir();
  const log = createLogger({ dir, scope: 'bridge', echo: false });
  log.child('runtime').child('supervisor').warn('slow', { runId: 'r1' });
  const records = readLines(log.filePath());
  assert.equal(records[0].scope, 'bridge:runtime:supervisor');
});

test('rotates by size without losing records', () => {
  const dir = tmpDir();
  const log = createLogger({ dir, scope: 'test', echo: false, maxBytes: 320 });
  for (let i = 0; i < 30; i += 1) log.info('message number ' + i, { i });
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.log')).sort();
  assert.ok(files.length >= 2, 'expected a size rotation, got ' + files.join(','));
  for (const file of files) assert.ok(fs.statSync(path.join(dir, file)).size <= 320 + 200);
  const all = files.flatMap((file) => readLines(path.join(dir, file)));
  assert.equal(all.length, 30);
  assert.deepEqual(all.map((r) => r.i).sort((a, b) => a - b), Array.from({ length: 30 }, (_, i) => i));
});

test('drops prompt-like fields and masks secret-like fields', () => {
  const fields = sanitizeFields({
    taskId: 't1',
    prompt: 'FULL SECRET PROMPT',
    stdout: 'raw cli output',
    code: 'line-of-code',
    token: 'sk-live-123',
    apiKey: 'abc',
    nested: { password: 'hunter2', keep: 1 },
  });
  assert.equal(fields.taskId, 't1');
  assert.equal('prompt' in fields, false);
  assert.equal('stdout' in fields, false);
  assert.equal('code' in fields, false);
  assert.equal(fields.token, '***');
  assert.equal(fields.apiKey, '***');
  assert.deepEqual(fields.nested, { password: '***', keep: 1 });
  assert.equal(JSON.stringify(fields).includes('SECRET PROMPT'), false);
  assert.equal(JSON.stringify(fields).includes('sk-live-123'), false);
});

test('truncates long strings and strips newlines', () => {
  const dir = tmpDir();
  const log = createLogger({ dir, scope: 'test', echo: false, maxString: 20 });
  log.info('multi\nline msg', { detail: 'x'.repeat(100) });
  const record = readLines(log.filePath())[0];
  assert.equal(record.msg.includes('\n'), false);
  assert.ok(record.msg.length <= 20 + 10);
  assert.ok(record.detail.length < 40);
});

test('prunes log files older than keepDays and keeps recent ones', () => {
  const dir = tmpDir();
  const now = new Date('2026-11-21T12:00:00');
  fs.writeFileSync(path.join(dir, 'petdeck-2026-11-10.log'), '{}\n');
  fs.writeFileSync(path.join(dir, 'petdeck-2026-11-20.1.log'), '{}\n');
  fs.writeFileSync(path.join(dir, 'petdeck-2026-11-21.log'), '{}\n');
  fs.writeFileSync(path.join(dir, 'other-2026-11-10.log'), '{}\n');
  const removed = pruneOldLogs(dir, { now: now.getTime(), keepDays: 7 });
  assert.equal(removed, 1);
  assert.equal(fs.existsSync(path.join(dir, 'petdeck-2026-11-10.log')), false);
  assert.equal(fs.existsSync(path.join(dir, 'petdeck-2026-11-20.1.log')), true);
  assert.equal(fs.existsSync(path.join(dir, 'other-2026-11-10.log')), true);
});

test('never throws when the log directory cannot be created', () => {
  const file = path.join(tmpDir(), 'not-a-dir');
  fs.writeFileSync(file, 'x');
  const log = createLogger({ dir: path.join(file, 'logs'), scope: 'test', echo: false });
  assert.doesNotThrow(() => log.info('still safe', { a: 1 }));
  assert.ok(log.lastWarning());
});

test('recentLines: keeps the tail of what was written and drops prompt-shaped fields', () => {
  const dir = tmpDir();
  const log = createLogger({ dir, scope: 'bridge', echo: false });
  for (let i = 0; i < 80; i += 1) log.info('tick', { i });
  log.warn('leaky', { prompt: 'SECRET PROMPT', taskId: 't1' });
  const tail = log.recentLines(10);
  assert.equal(tail.length, 10);
  const last = JSON.parse(tail[9]);
  assert.equal(last.msg, 'leaky');
  assert.equal(last.prompt, undefined);
  assert.equal(last.taskId, 't1');
  assert.equal(tail.some((line) => line.includes('SECRET PROMPT')), false);
  assert.equal(log.recentLines(1000).length, 81);
  fs.rmSync(dir, { recursive: true, force: true });
});
