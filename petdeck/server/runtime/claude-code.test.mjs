// Claude Code adapter contract: argv shape, permission fallback, stream-json mapping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, parseLine, normalizePermissionMode } from './adapters/claude-code.mjs';

test('buildArgs: new run uses stream-json and acceptEdits', () => {
  const args = buildArgs({ prompt: 'fix the bug' });
  assert.deepEqual(args.slice(0, 6), ['-p', '--verbose', '--output-format', 'stream-json', '--permission-mode', 'acceptEdits']);
  assert.equal(args.at(-1), 'fix the bug');
  assert.ok(!args.includes('--resume'));
});

test('buildArgs: resume adds --resume and guards a leading dash prompt', () => {
  const args = buildArgs({ prompt: '--help me', sessionId: 'sess-1', permissionMode: 'bypassPermissions' });
  assert.ok(args.includes('--resume'));
  assert.equal(args[args.indexOf('--resume') + 1], 'sess-1');
  assert.equal(args.at(-1), ' --help me');
});

test('buildArgs: unknown permission mode falls back to acceptEdits', () => {
  assert.equal(normalizePermissionMode('nope'), 'acceptEdits');
  const args = buildArgs({ prompt: 'x', permissionMode: 'nope' });
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
});

test('buildArgs: empty prompt is rejected', () => {
  assert.throws(() => buildArgs({ prompt: '   ' }), /prompt is required/);
});

test('parseLine: system/init -> run.started with session and model', () => {
  const { events } = parseLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-sonnet', cwd: 'C:/w', permissionMode: 'acceptEdits', claude_code_version: '2.1.312', tools: ['Read', 'Edit'] }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'run.started');
  assert.equal(events[0].payload.sessionId, 's1');
  assert.equal(events[0].payload.tools, 2);
});

test('parseLine: assistant text, thinking and tool_use become separate events', () => {
  const line = JSON.stringify({
    type: 'assistant',
    message: { id: 'm1', model: 'claude', content: [
      { type: 'text', text: 'hello' },
      { type: 'thinking', thinking: 'hmm' },
      { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a.ts' } },
    ] },
  });
  const { events } = parseLine(line);
  assert.deepEqual(events.map((e) => e.type), ['message.assistant', 'message.thinking', 'tool.started']);
  assert.equal(events[2].payload.name, 'Read');
  assert.equal(events[2].payload.input.file_path, 'a.ts');
});

test('parseLine: tool_result -> tool.completed', () => {
  const { events } = parseLine(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: 'ok' }] }] } }));
  assert.equal(events[0].type, 'tool.completed');
  assert.equal(events[0].payload.content, 'ok');
  assert.equal(events[0].payload.isError, false);
});

test('parseLine: success/failure result mapping', () => {
  const ok = parseLine(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'done', session_id: 's1', duration_ms: 12 }));
  assert.equal(ok.events[0].type, 'run.completed');
  assert.equal(ok.events[0].payload.result, 'done');
  const bad = parseLine(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's1' }));
  assert.equal(bad.events[0].type, 'run.failed');
  assert.equal(bad.events[0].payload.subtype, 'error_during_execution');
});

test('parseLine: malformed / unknown lines never throw', () => {
  assert.equal(parseLine('not json').events[0].type, 'log.stdout');
  assert.equal(parseLine(JSON.stringify({ type: 'weird' })).events[0].type, 'log.raw');
  assert.deepEqual(parseLine('   ').events, []);
});
