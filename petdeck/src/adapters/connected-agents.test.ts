import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadConnectedAgentIds, recordConnectedAgent, resolveConnectedAgentIds, shouldPersistConnection, type ConnectedAgentStorage } from './connected-agents.ts'

function memStorage(): ConnectedAgentStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

test('connected agents: a successful connection persists and reopening does not return to the empty state', () => {
  const storage = memStorage()
  assert.equal(loadConnectedAgentIds(storage).length, 0)
  recordConnectedAgent(storage, 'codex')
  recordConnectedAgent(storage, 'claude')
  recordConnectedAgent(storage, 'codex')
  assert.deepEqual(loadConnectedAgentIds(storage), ['codex', 'claude'])
})

test('connected agents: corrupt or unsupported stored values fall back to empty', () => {
  const storage = memStorage()
  storage.setItem('petdeck.connectedAgents.v1', '{bad json')
  assert.deepEqual(loadConnectedAgentIds(storage), [])
  storage.setItem('petdeck.connectedAgents.v1', JSON.stringify(['codex', 42, '']))
  assert.deepEqual(loadConnectedAgentIds(storage), ['codex'])
})

test('connected agents: unavailable storage is a safe no-op', () => {
  recordConnectedAgent(null, 'codex')
  assert.deepEqual(loadConnectedAgentIds(null), [])
})

test('connected agents: only verified live non-manual connections are persisted', () => {
  assert.equal(shouldPersistConnection(false, 'full'), true)
  assert.equal(shouldPersistConnection(false, 'observe-only'), true)
  assert.equal(shouldPersistConnection(false, 'manual'), false)
  assert.equal(shouldPersistConnection(true, 'full'), false)
})

test('connected agents: observed sessions prove the connection even without a stored marker', () => {
  assert.deepEqual(resolveConnectedAgentIds([], ['codex']), ['codex'])
  assert.deepEqual(resolveConnectedAgentIds(['claude'], ['codex', 'claude']), ['claude', 'codex'])
})
