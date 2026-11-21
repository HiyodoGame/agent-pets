// Windows shim resolution: a multi-line prompt must survive argv untouched.
// opencode.cmd wraps a real .exe; codex/dsh.cmd wrap a node script. Hosting either
// through cmd.exe /c truncated argv at the first newline (cmd treats LF as a command
// separator even inside quotes), so a rejected run never saw its review feedback.
// Run: node --test server/exec-shim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quoteForCmd, resolveExecutable, runCli } from './adapters/exec.mjs';

function winTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-exec-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function fakeSpawn({ stdout = '' } = {}) {
  const calls = [];
  const impl = (cmd, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end() {}, on() {} };
    child.kill = () => {};
    calls.push({ cmd, args, options, child });
    queueMicrotask(() => { if (stdout) child.stdout.emit('data', Buffer.from(stdout)); child.emit('close', 0); });
    return child;
  };
  return { impl, calls };
}

test('resolveExecutable: a shim wrapping a concrete .exe resolves to the exe (no cmd.exe)', () => {
  const { dir, cleanup } = winTempDir();
  try {
    const exe = path.join(dir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, '');
    fs.writeFileSync(path.join(dir, 'opencode.cmd'), [
      '@ECHO off',
      'SET dp0=%~dp0',
      '"%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe"   %*',
    ].join('\r\n'));
    const target = resolveExecutable('opencode', { platform: 'win32', env: { PATH: dir } });
    assert.equal(target.viaCmd, false);
    assert.equal(path.resolve(target.file), path.resolve(exe));
    assert.equal(target.preface, undefined);
  } finally { cleanup(); }
});

test('resolveExecutable: a node-script shim resolves to node + script preface', () => {
  const { dir, cleanup } = winTempDir();
  try {
    const script = path.join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, '');
    const node = path.join(dir, 'node.exe');
    fs.writeFileSync(node, '');
    fs.writeFileSync(path.join(dir, 'codex.cmd'), [
      '@ECHO off',
      'SET dp0=%~dp0',
      'IF EXIST "%dp0%\\node.exe" (SET "_prog=%dp0%\\node.exe") ELSE (SET "_prog=node")',
      'endLocal & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*',
    ].join('\r\n'));
    const target = resolveExecutable('codex', { platform: 'win32', env: { PATH: dir } });
    assert.equal(target.viaCmd, false);
    assert.equal(path.resolve(target.file), path.resolve(node));
    assert.deepEqual(target.preface.map((p) => path.resolve(p)), [path.resolve(script)]);
  } finally { cleanup(); }
});

test('resolveExecutable: a shim with no resolvable target still falls back to cmd.exe', () => {
  const { dir, cleanup } = winTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'mystery.cmd'), '@ECHO off\r\nnode %*\r\n');
    const target = resolveExecutable('mystery', { platform: 'win32', env: { PATH: dir } });
    assert.equal(target.viaCmd, true);
  } finally { cleanup(); }
});

test('quoteForCmd: folds CR/LF so cmd.exe cannot cut the command at line 1', () => {
  assert.equal(quoteForCmd('line1\nline2'), '"line1 line2"');
  assert.equal(quoteForCmd('a\r\nb c'), '"a b c"');
  assert.ok(!quoteForCmd('x\ny').includes('\n'));
});

test('runCli: a multi-line argv payload reaches a resolved shim CLI intact', async () => {
  const { dir, cleanup } = winTempDir();
  try {
    const script = path.join(dir, 'node_modules', 'pkg', 'cli.js');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, '');
    fs.writeFileSync(path.join(dir, 'node.exe'), '');
    fs.writeFileSync(path.join(dir, 'petcli.cmd'), [
      '@ECHO off',
      'SET dp0=%~dp0',
      'endLocal & "%dp0%\\node.exe" "%dp0%\\node_modules\\pkg\\cli.js" %*',
    ].join('\r\n'));
    const { impl, calls } = fakeSpawn({ stdout: 'ok' });
    const prompt = 'first line\nsecond line';
    await runCli('petcli', ['run', prompt], { spawnImpl: impl, platform: 'win32', env: { PATH: dir } });
    assert.equal(calls[0].options.shell, false);
    assert.deepEqual(calls[0].args.slice(1), ['run', prompt]);
  } finally { cleanup(); }
});

test('runCli: an unresolvable shim is hosted by cmd.exe with newlines folded', async () => {
  const { dir, cleanup } = winTempDir();
  try {
    fs.writeFileSync(path.join(dir, 'mystery.cmd'), '@ECHO off\r\nnode %*\r\n');
    const { impl, calls } = fakeSpawn({ stdout: 'ok' });
    await runCli('mystery', ['run', 'first\nsecond'], { spawnImpl: impl, platform: 'win32', env: { PATH: dir } });
    assert.deepEqual(calls[0].args.slice(0, 3), ['/d', '/s', '/c']);
    assert.ok(!String(calls[0].args[3]).includes('\n'), 'cmd.exe command must be one line');
  } finally { cleanup(); }
});
