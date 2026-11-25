// The pause button runs a generated PowerShell script that suspends the whole
// agent process tree via ntdll. These tests pin the script shape and the result
// mapping; the real OS call is verified separately on Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProcessControlScript, controlProcessTree, resumeProcessTree, suspendProcessTree,
} from './process-control.mjs';

test('script: rejects non-positive and non-integer pids', () => {
  for (const pid of [0, -1, 1.5, 'abc', null, undefined]) {
    assert.throws(() => buildProcessControlScript(pid, 'suspend'), /invalid pid/);
  }
});

test('script: rejects unknown actions', () => {
  for (const action of ['kill', '', null, undefined, 'SUSPEND']) {
    assert.throws(() => buildProcessControlScript(1234, action), /invalid action/);
  }
});

test('script: suspend walks the tree, reverses it and calls NtSuspendProcess', () => {
  const script = buildProcessControlScript(4321, 'suspend');
  assert.match(script, /\$queue\.Enqueue\(4321\)/);
  assert.match(script, /ParentProcessId/);
  assert.match(script, /NtSuspendProcess/);
  assert.equal(script.includes('if ($ids.Count -gt 0) { $ids.Reverse() }'), true, 'children are suspended before the root');
  assert.match(script, /OpenProcess\(0x0800/);
});

test('script: resume skips the reversal and calls NtResumeProcess', () => {
  const script = buildProcessControlScript(4321, 'resume');
  assert.match(script, /NtResumeProcess/);
  assert.match(script, /# resume root first, then children/);
  assert.equal(script.includes('$ids.Reverse()'), false);
});

test('non-Windows hosts report unsupported instead of pretending', () => {
  let spawned = false;
  const result = controlProcessTree(1, 'suspend', {
    platform: 'linux',
    spawnImpl: () => { spawned = true; return { status: 0 }; },
  });
  assert.deepEqual(result, { ok: false, code: 'unsupported-platform', detail: 'pause is only implemented on Windows' });
  assert.equal(spawned, false);
});

test('spawn failures and non-zero exits map to explicit codes', () => {
  const spawnError = controlProcessTree(10, 'suspend', {
    platform: 'win32',
    spawnImpl: () => ({ error: new Error('spawn ENOENT') }),
  });
  assert.deepEqual(spawnError, { ok: false, code: 'spawn-error', detail: 'spawn ENOENT' });

  const failed = controlProcessTree(10, 'suspend', {
    platform: 'win32',
    spawnImpl: () => ({ status: 3, stderr: '  access denied  ' }),
  });
  assert.deepEqual(failed, { ok: false, code: 'control-failed', detail: 'access denied' });

  const silent = controlProcessTree(10, 'resume', {
    platform: 'win32',
    spawnImpl: () => ({ status: 3 }),
  });
  assert.deepEqual(silent, { ok: false, code: 'control-failed', detail: 'exit 3' });
});

test('failure detail is bounded so a stuck shell cannot flood the log', () => {
  const result = controlProcessTree(10, 'suspend', {
    platform: 'win32',
    spawnImpl: () => ({ status: 1, stderr: 'x'.repeat(2000) }),
  });
  assert.equal(result.code, 'control-failed');
  assert.equal(result.detail.length, 500);
});

test('failure detail drops the CLIXML envelope PowerShell adds to redirected stderr', () => {
  const stderr = [
    '#< CLIXML',
    '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress">',
    'access denied',
    '</Objs>',
  ].join('\r\n');
  const result = controlProcessTree(10, 'suspend', {
    platform: 'win32',
    spawnImpl: () => ({ status: 3, stderr }),
  });
  assert.deepEqual(result, { ok: false, code: 'control-failed', detail: 'access denied' });
});

test('script: suppresses module progress noise on first run', () => {
  assert.match(buildProcessControlScript(1, 'suspend'), /^\$ErrorActionPreference = 'Stop'\n\$ProgressPreference = 'SilentlyContinue'/);
});

test('success maps to the requested action and passes the script as an encoded command', () => {
  const seen = [];
  const result = controlProcessTree(99, 'resume', {
    platform: 'win32',
    timeoutMs: 1234,
    spawnImpl: (command, args, options) => {
      seen.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.deepEqual(result, { ok: true, code: 'resumed' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].command, 'powershell.exe');
  assert.deepEqual(seen[0].args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.equal(seen[0].args.length, 4);
  // The encoded payload must be the exact script: -Command - was silently
  // swallowed by the here-string and reported success without suspending.
  const decoded = Buffer.from(seen[0].args.at(-1), 'base64').toString('utf16le');
  assert.equal(decoded, buildProcessControlScript(99, 'resume'));
  assert.equal(seen[0].options.input, undefined, 'no stdin payload: it works on Windows PowerShell 5.1');
  assert.equal(seen[0].options.timeout, 1234);
  assert.equal(seen[0].options.windowsHide, true);
});

test('suspendProcessTree / resumeProcessTree delegate the right action', () => {
  const actions = [];
  const spawnImpl = () => { actions.push('called'); return { status: 0 }; };
  assert.equal(suspendProcessTree(7, { platform: 'win32', spawnImpl }).code, 'suspended');
  assert.equal(resumeProcessTree(7, { platform: 'win32', spawnImpl }).code, 'resumed');
  assert.equal(actions.length, 2);
});
