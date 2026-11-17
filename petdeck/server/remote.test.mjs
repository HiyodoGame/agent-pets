import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ROWS, observe, parseHosts, parseProbeRows } from './adapters/remote.mjs'

test('parseHosts: aliases/user@host only; option-like and metacharacter hosts are rejected', () => {
  assert.deepEqual(parseHosts('me@build-box, dev1, , -oProxyCommand=evil, a;rm, host:22'), ['me@build-box', 'dev1'])
})

test('parseProbeRows: tags host, clamps messages, ignores malformed payloads', () => {
  const rows = parseProbeRows(JSON.stringify([
    { agent: 'claude', session: 's1', status: 'done', lastMessage: 'x'.repeat(300), title: 't', updatedAt: 123 },
    { agent: 'codex', session: 's2', status: 'running', lastMessage: 'ok' },
    { agent: 'claude' },
    null,
  ]), 'me@h')
  assert.equal(rows.length, 2)
  assert.equal(rows[0].host, 'me@h')
  assert.equal(rows[0].source, 'ssh-probe')
  assert.equal(rows[0].lastMessage.length, 200)
  assert.equal(rows[0].updatedAt, 123)
  assert.equal(rows[1].updatedAt, 0)
  assert.deepEqual(parseProbeRows('not json', 'h'), [])
  assert.deepEqual(parseProbeRows('{"rows":[]}', 'h'), [])
})

test('observe: one failing host does not discard the others; all failing throws', async () => {
  const calls = []
  const run = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    if (args.includes('good')) {
      return { status: 0, stdout: JSON.stringify([{ agent: 'claude', session: 's1', status: 'done', lastMessage: 'm', updatedAt: 2 }]), stderr: '', summary: '' }
    }
    return { status: 255, stdout: '', stderr: '', summary: 'exit:255' }
  }
  const rows = await observe({ hosts: ['good', 'bad'], run })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].host, 'good')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].cmd, 'ssh')
  assert.equal(calls[0].args.at(-2), 'node')
  assert.equal(calls[0].args.at(-1), '-')
  assert.ok(String(calls[0].opts.input).includes('collectRows'))
  assert.deepEqual(await observe({ hosts: [], run }), [])
  await assert.rejects(observe({ hosts: ['bad'], run }), /remote observe failed/)
})

test('observe: caps remote rows at MAX_ROWS', async () => {
  const payload = Array.from({ length: 25 }, (_, i) => ({ agent: 'claude', session: `s${i}`, status: 'done', lastMessage: 'm', updatedAt: i }))
  const run = async () => ({ status: 0, stdout: JSON.stringify(payload), stderr: '', summary: '' })
  const rows = await observe({ hosts: ['h'], run })
  assert.equal(rows.length, MAX_ROWS)
  assert.equal(rows[0].session, 's24', 'newest first')
})
