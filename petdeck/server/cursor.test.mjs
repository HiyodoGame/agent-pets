// Cursor adapter tests — real transcript shape verified 2026-11-16:
//   {role:'user'|'assistant', message:{content:[{type:'text',text}]}}
//   final line of a turn: {type:'turn_ended', status:'success'|'error'}
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCursorTranscript, observe } from './adapters/cursor.mjs';

const msg = (role, text) => JSON.stringify({ role, message: { content: [{ type: 'text', text }] } });
const end = (status) => JSON.stringify({ type: 'turn_ended', status });

test('parseCursorTranscript: success => done, last assistant text wins', () => {
  const r = parseCursorTranscript([msg('user', 'fix it'), msg('assistant', 'done!'), end('success')], { now: 1000, mtimeMs: 1000 });
  assert.equal(r.status, 'done');
  assert.equal(r.lastMessage, 'done!');
  assert.equal(r.firstUserMessage, 'fix it');
});

test('parseCursorTranscript: error => stuck', () => {
  const r = parseCursorTranscript([msg('user', 'go'), msg('assistant', 'boom'), end('error')], { now: 1000, mtimeMs: 1000 });
  assert.equal(r.status, 'stuck');
});

test('parseCursorTranscript: a new user message clears the previous terminal', () => {
  const fresh = parseCursorTranscript([msg('user', 'a'), msg('assistant', 'b'), end('success'), msg('user', 'c')], { now: 1000, mtimeMs: 900 });
  assert.equal(fresh.status, 'running');
  const stale = parseCursorTranscript([msg('user', 'a'), msg('assistant', 'b'), end('success'), msg('user', 'c')], { now: 1000000, mtimeMs: 1000 });
  assert.equal(stale.status, 'unknown', 'an old incomplete turn must not look active');
});

test('observe: top-level transcripts only, newest first, project as title', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-cursor-'));
  const mk = (project, session) => {
    const d = path.join(home, '.cursor', 'projects', project, 'agent-transcripts', session);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const a = path.join(mk('proj-a', 's-a'), 's-a.jsonl');
  const b = path.join(mk('proj-b', 's-b'), 's-b.jsonl');
  fs.writeFileSync(a, [msg('user', 'u1'), msg('assistant', 'a1'), end('success')].join('\n'));
  fs.writeFileSync(b, [msg('user', 'u2'), msg('assistant', 'a2'), end('error')].join('\n'));
  // Subagent transcripts are implementation details and must not surface.
  const sub = path.join(mk('proj-b', 's-b'), 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'sub.jsonl'), [msg('user', 's'), end('success')].join('\n'));
  fs.utimesSync(a, new Date(2000), new Date(2000));
  fs.utimesSync(b, new Date(3000), new Date(3000));
  const rows = await observe({ home, now: 5000 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].session, 's-b', 'newest first');
  assert.equal(rows[0].title, 'proj-b');
  assert.equal(rows[0].status, 'stuck');
  assert.equal(rows[1].status, 'done');
});

test('observe: missing Cursor root => []', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-cursor-empty-'));
  assert.deepEqual(await observe({ home, now: 1000 }), []);
});
