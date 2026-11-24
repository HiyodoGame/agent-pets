import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_ROWS, observe, parseHosts, parseProbeRows } from './adapters/remote.mjs'
import { pollOnce } from './freshness.mjs'

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

test('observe: partial failure identifies healthy and failed hosts; all failing throws', async () => {
  const calls = []
  const run = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts })
    if (args.includes('good')) {
      return { status: 0, stdout: JSON.stringify([{ agent: 'claude', session: 's1', status: 'done', lastMessage: 'm', updatedAt: 2 }]), stderr: '', summary: '' }
    }
    return { status: 255, stdout: '', stderr: '', summary: 'exit:255' }
  }
  let partial
  await assert.rejects(observe({ hosts: ['good', 'bad'], run }), (error) => { partial = error; return true })
  assert.equal(partial.code, 'REMOTE_PARTIAL_FAILURE')
  assert.deepEqual(partial.okHosts, ['good'])
  assert.deepEqual(partial.failedHosts, ['bad'])
  assert.equal(partial.partialRows.length, 1)
  assert.equal(partial.partialRows[0].host, 'good')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].cmd, 'ssh')
  assert.equal(calls[0].args.at(-2), 'node')
  assert.equal(calls[0].args.at(-1), '-')
  assert.ok(String(calls[0].opts.input).includes('collectRows'))
  assert.deepEqual(await observe({ hosts: [], run }), [])
  await assert.rejects(observe({ hosts: ['bad'], run }), /remote observe failed/)
})

test('freshness: partial remote failure keeps only the failed host stale with its own last-good time', async () => {
  const payload = (host, updatedAt) => JSON.stringify([{ agent: host === 'good' ? 'claude' : 'codex', session: host + '-session', status: 'done', updatedAt }])
  let round = 0
  const run = async (_cmd, args) => {
    const host = args.find((arg) => arg === 'good' || arg === 'bad')
    if (round === 2 && host === 'bad') return { status: 255, stdout: '' }
    if (round === 3) return { status: 255, stdout: '' }
    return { status: 0, stdout: payload(host, round === 2 && host === 'good' ? 20 : 10) }
  }
  const adapter = { id: 'remote', observe: () => observe({ hosts: ['good', 'bad'], run }) }
  round = 1
  const first = await pollOnce([adapter], new Map(), 1000)
  round = 2
  const second = await pollOnce([adapter], first.lastGood, 2000)
  const good = second.sessions.find((row) => row.host === 'good')
  const bad = second.sessions.find((row) => row.host === 'bad')
  assert.deepEqual([good.stale, good.lastSeen, good.updatedAt], [false, 2000, 20])
  assert.deepEqual([bad.stale, bad.lastSeen, bad.updatedAt], [true, 1000, 10])
  assert.equal(second.sources.remote.ok, false)
  assert.equal(second.lastGood.get('remote').rows.length, 2, 'partial success must not erase the failed host cache')

  round = 3
  const third = await pollOnce([adapter], second.lastGood, 3000)
  assert.equal(third.sessions.find((row) => row.host === 'good').lastSeen, 2000)
  assert.equal(third.sessions.find((row) => row.host === 'bad').lastSeen, 1000)
  assert.ok(third.sessions.every((row) => row.stale))
})

test('observe: malformed successful output is a failed host, not a fresh empty result', async () => {
  const goodPayload = JSON.stringify([{ agent: 'claude', session: 'cached', status: 'done', updatedAt: 1 }])
  let malformed = false
  const adapter = {
    id: 'remote',
    observe: () => observe({
      hosts: ['h'],
      run: async () => ({ status: 0, stdout: malformed ? 'not json' : goodPayload }),
    }),
  }
  const first = await pollOnce([adapter], new Map(), 1000)
  malformed = true
  const second = await pollOnce([adapter], first.lastGood, 2000)
  assert.equal(second.sources.remote.ok, false)
  assert.equal(second.sessions.length, 1)
  assert.equal(second.sessions[0].session, 'cached')
  assert.equal(second.sessions[0].stale, true)
  assert.equal(second.sessions[0].lastSeen, 1000)
})

test('observe: caps remote rows at MAX_ROWS', async () => {
  const payload = Array.from({ length: 25 }, (_, i) => ({ agent: 'claude', session: `s${i}`, status: 'done', lastMessage: 'm', updatedAt: i }))
  const run = async () => ({ status: 0, stdout: JSON.stringify(payload), stderr: '', summary: '' })
  const rows = await observe({ hosts: ['h'], run })
  assert.equal(rows.length, MAX_ROWS)
  assert.equal(rows[0].session, 's24', 'newest first')
})
