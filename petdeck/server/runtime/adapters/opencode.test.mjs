import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, createParser, parseLine } from './opencode.mjs';

const line = (obj) => JSON.stringify(obj);

test('buildArgs uses run --format json --auto and --session for resume', () => {
  assert.deepEqual(buildArgs({ prompt: 'do it' }), ['run', '--format', 'json', '--auto', 'do it']);
  // guardDash neutralises a leading dash with a space instead of inserting `--`.
  assert.deepEqual(buildArgs({ prompt: '-danger', sessionId: 'ses_1' }), ['run', '--format', 'json', '--auto', '--session', 'ses_1', ' -danger']);
});

test('step_start announces the session once', () => {
  const parser = createParser();
  const first = parser.parseLine(line({ type: 'step_start', sessionID: 'ses_abc', part: { model: 'm' } }));
  assert.equal(first.events[0].type, 'run.started');
  assert.equal(first.events[0].payload.sessionId, 'ses_abc');
  const second = parser.parseLine(line({ type: 'step_start', sessionID: 'ses_abc' }));
  assert.deepEqual(second.events, []);
});

test('text becomes assistant text', () => {
  const ev = parseLine(line({ type: 'text', sessionID: 's', part: { text: 'hello' } })).events[0];
  assert.equal(ev.type, 'message.assistant');
  assert.equal(ev.payload.text, 'hello');
});

test('tool_use maps callID, tool and input', () => {
  const ev = parseLine(line({ type: 'tool_use', sessionID: 's', part: { callID: 'c1', tool: 'bash', state: { input: { command: 'ls' } } } })).events[0];
  assert.equal(ev.type, 'tool.started');
  assert.equal(ev.payload.name, 'bash');
  assert.deepEqual(ev.payload.input, { command: 'ls' });
});

test('error becomes run.failed with its message', () => {
  const ev = parseLine(line({ type: 'error', sessionID: 's', error: { type: 'provider.quota', message: 'Insufficient balance', status: 402 } })).events[0];
  assert.equal(ev.type, 'run.failed');
  assert.match(ev.payload.error, /Insufficient balance/);
});

test('malformed lines degrade to log.stdout instead of throwing', () => {
  const ev = parseLine('not json').events[0];
  assert.equal(ev.type, 'log.stdout');
});
