// RED tests: adapters inject must not use shell and must pass prompt safely (async).
// Run: node --test server/adapters-inject.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import codex from './adapters/codex.mjs';
import claude from './adapters/claude.mjs';
import opencode from './adapters/opencode.mjs';

const captureRun = (stdout = 'RESP', code = 0) => {
  const calls = [];
  const run = async (cmd, args, opts = {}) => { calls.push({ cmd, args, opts }); return { status: code, stdout, stderr: '', error: false }; };
  return { calls, run };
};

const EVIL = 'A; rm -rf / && echo $(pwn)';

test('codex.inject: async, no shell, prompt verbatim in argv', async () => {
  const { calls, run } = captureRun('done-pack');
  const r = await codex.inject({ context: EVIL, instruction: 'next' }, { run });
  assert.equal(r.ok, true);
  assert.equal(r.response, 'done-pack');
  assert.notEqual(calls[0].opts.shell, true); // never opt into a shell
  const flat = JSON.stringify(calls[0].args);
  assert.ok(flat.includes(EVIL), 'metacharacters must ride as a literal argv element');
});

test('claude.inject: async, no shell, prompt verbatim in argv', async () => {
  const { calls, run } = captureRun('hi');
  const r = await claude.inject({ context: 'c', instruction: EVIL }, { run });
  assert.equal(r.ok, true);
  assert.notEqual(calls[0].opts.shell, true);
  assert.ok(JSON.stringify(calls[0].args).includes(EVIL));
});

test('codex.inject: leading-dash prompt guarded against option injection', async () => {
  const { calls, run } = captureRun('x');
  await codex.inject({ instruction: '-rf', context: '--no-sandbox' }, { run });
  const promptArg = calls[0].args.at(-1);
  assert.ok(!promptArg.trimStart().startsWith('-'), 'prompt passed as option must be neutralised');
});

test('opencode.inject: prompt routed via stdin, no shell, parses sessionID', async () => {
  const { calls, run } = captureRun(JSON.stringify({ type: 'text', part: { text: 'ok' }, sessionID: 'ses_9' }));
  const r = await opencode.inject({ context: 'ctx', instruction: EVIL }, { run });
  assert.equal(r.ok, true);
  assert.equal(r.sessionID, 'ses_9');
  assert.notEqual(calls[0].opts.shell, true);
  assert.ok(String(calls[0].opts.input).includes(EVIL), 'prompt must go through stdin, not argv');
});

test('codex.inject: non-zero exit => ok:false (degrade path)', async () => {
  const { run } = captureRun('', 1);
  const r = await codex.inject({ context: 'c', instruction: 'i' }, { run });
  assert.equal(r.ok, false);
});

// --- Task 7: CLI 失败把 runCli 的结构化 outcome code 透传给 bridge（类别/码，绝无自由文本） ---
test('codex.inject: CLI failure surfaces the structured outcome code from runCli', async () => {
  const run = async () => ({ status: 1, stdout: '', stderr: 'Error: whatever', error: false, summary: 'exit:1' });
  const r = await codex.inject({ context: 'c', instruction: 'i' }, { run });
  assert.equal(r.ok, false);
  assert.equal(r.summary, 'exit:1');
});

test('opencode.inject: CLI failure surfaces the structured outcome code from runCli', async () => {
  const run = async () => ({ status: 1, stdout: '', stderr: 'Error: whatever', error: false, summary: 'exit:1' });
  const r = await opencode.inject({ context: 'c', instruction: 'i' }, { run });
  assert.equal(r.ok, false);
  assert.equal(r.summary, 'exit:1');
});
