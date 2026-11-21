import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, parseLine } from './adapters/kimi-code.mjs';

test('kimi buildArgs: prompt mode with stream-json', () => {
  assert.deepEqual(buildArgs({ prompt: 'do it' }), ['-p', 'do it', '--output-format', 'stream-json']);
});

test('kimi buildArgs: resume uses -S and guards a leading dash', () => {
  const args = buildArgs({ prompt: '--help', sessionId: 'session_1' });
  assert.deepEqual(args, ['-S', 'session_1', '-p', ' --help', '--output-format', 'stream-json']);
});

test('kimi buildArgs: empty prompt is rejected', () => {
  assert.throws(() => buildArgs({ prompt: '  ' }), /prompt is required/);
});

test('kimi parseLine: assistant text and tool calls', () => {
  const { events } = parseLine(JSON.stringify({
    role: 'assistant',
    content: 'working',
    tool_calls: [{ type: 'function', id: 'tool_1', function: { name: 'Write', arguments: '{"path":"NOTES.md"}' } }],
  }));
  assert.equal(events[0].type, 'message.assistant');
  assert.equal(events[0].payload.text, 'working');
  assert.equal(events[1].type, 'tool.started');
  assert.equal(events[1].payload.name, 'Write');
  assert.deepEqual(events[1].payload.input, { path: 'NOTES.md' });
});

test('kimi parseLine: tool result maps to tool.completed', () => {
  const { events } = parseLine(JSON.stringify({ role: 'tool', tool_call_id: 'tool_1', content: 'Wrote 24 bytes' }));
  assert.equal(events[0].type, 'tool.completed');
  assert.equal(events[0].payload.toolUseId, 'tool_1');
  assert.equal(events[0].payload.isError, false);
});

test('kimi parseLine: resume hint completes the run with a session id', () => {
  const { events } = parseLine(JSON.stringify({ role: 'meta', type: 'session.resume_hint', session_id: 'session_9', content: 'kimi -r session_9' }));
  assert.equal(events[0].type, 'run.completed');
  assert.equal(events[0].payload.sessionId, 'session_9');
});

test('kimi parseLine: version and malformed lines never throw', () => {
  assert.equal(parseLine(JSON.stringify({ role: 'meta', type: 'system.version', version: '2.3.0' })).events[0].type, 'log.system');
  assert.equal(parseLine('not json').events[0].type, 'log.stdout');
  assert.equal(parseLine('').events.length, 0);
});