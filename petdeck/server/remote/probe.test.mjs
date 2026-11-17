import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { collectRows, parseClaudeLines, parseCodexLines } from './probe.mjs'

const claudeLine = (over) => JSON.stringify(over)

test('parseClaudeLines: done/running/waiting, last text and usage', () => {
  const done = parseClaudeLines([
    claudeLine({ type: 'user', message: { content: 'hi' }, cwd: '/work' }),
    claudeLine({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done!' }], usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 1 } } }),
  ], 123, 's.jsonl')
  assert.equal(done.status, 'done')
  assert.equal(done.lastMessage, 'done!')
  assert.equal(done.session, 's.jsonl')
  assert.deepEqual(done.tokens, { input: 5, output: 2, cacheRead: 1 })

  const running = parseClaudeLines([claudeLine({ type: 'assistant', message: { stop_reason: null, content: [{ type: 'text', text: 'working' }] } })], 1, 'r')
  assert.equal(running.status, 'running')

  const waiting = parseClaudeLines([claudeLine({ type: 'user', message: { content: 'next' } })], 1, 'w')
  assert.equal(waiting.status, 'waiting')
  assert.equal(parseClaudeLines([claudeLine({ type: 'result', is_error: true })], 1, 'e').status, 'stuck')
})

test('parseCodexLines: task lifecycle and last agent message', () => {
  assert.equal(parseCodexLines([claudeLine({ payload: { type: 'task_started', turn_id: 't1' } })], 1, 'a').status, 'running')
  const done = parseCodexLines([
    claudeLine({ payload: { type: 'task_complete', last_agent_message: 'finished', turn_id: 't1' } }),
  ], 2, 'b')
  assert.equal(done.status, 'done')
  assert.equal(done.lastMessage, 'finished')
  assert.equal(done.turn, 't1')
  assert.equal(parseCodexLines([claudeLine({ payload: { type: 'turn_aborted' } })], 1, 'c').status, 'stuck')
})

test('collectRows: walks Claude and Codex layouts and sorts newest first', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-probe-'))
  const claude = path.join(home, '.claude', 'projects', 'p1')
  const codex = path.join(home, '.codex', 'sessions', '2026', '01', '02')
  fs.mkdirSync(claude, { recursive: true })
  fs.mkdirSync(codex, { recursive: true })
  const cf = path.join(claude, 'session-a.jsonl')
  const xf = path.join(codex, 'rollout-b.jsonl')
  fs.writeFileSync(cf, [
    claudeLine({ type: 'user', message: { content: 'u' } }),
    claudeLine({ type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'claude done' }] } }),
  ].join('\n'))
  fs.writeFileSync(xf, [
    claudeLine({ payload: { type: 'task_started', turn_id: 't' } }),
  ].join('\n'))
  fs.utimesSync(cf, new Date(2000), new Date(2000))
  fs.utimesSync(xf, new Date(3000), new Date(3000))
  const rows = collectRows(home)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].agent, 'codex', 'newest first')
  assert.equal(rows[0].status, 'running')
  assert.equal(rows[1].agent, 'claude')
  assert.equal(rows[1].status, 'done')
})
