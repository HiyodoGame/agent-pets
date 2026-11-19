import { test } from 'node:test'
import assert from 'node:assert/strict'
import { petEventFromBridge, shouldSurfacePetEvent } from './pet-events.ts'
import type { Agent } from '../flows/shared/types.ts'

const agents: Agent[] = [{ id: 'codex', name: 'Codex', form: 'cli', capability: 'full', status: 'running', projectIds: [] }]

function bridgeEvent(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'e1', agentId: 'codex', sessionId: 's1', type: 'task_started', petType: 'started', ts: 2000,
    payload: {
      session: {
        agent: 'codex', source: 'rollout-jsonl', session: 's1', status: 'running',
        title: 'Fix login', lastMessage: 'private conversation body', cwd: 'F:/Work/App',
      },
    },
    ...over,
  }
}

test('pet events: started retains agent, project, task and composite deep-link id', () => {
  const event = petEventFromBridge(bridgeEvent(), agents)
  assert.ok(event)
  assert.equal(event.type, 'started')
  assert.equal(event.agentId, 'codex')
  assert.equal(event.agentName, 'Codex')
  assert.equal(event.projectId, 'local:F:/Work/App')
  assert.equal(event.projectName, 'App')
  assert.equal(event.sessionTitle, 'Fix login')
  assert.equal(event.sessionId, 'codex:s1')
  assert.equal(event.text, 'private conversation body')
  assert.equal(event.timestamp, '1970-01-01T00:00:02.000Z')
  assert.equal(event.handled, false)
})

test('pet events: remote deep links include host and unknown agents remain readable', () => {
  const event = petEventFromBridge(bridgeEvent({
    payload: { session: { agent: 'codex', source: 'remote', session: 's1', status: 'done', title: 'Deploy', lastMessage: '', cwd: '/work/app', host: 'build-box' } },
    petType: 'done',
  }), [])
  assert.ok(event)
  assert.equal(event.sessionId, 'build-box@codex:s1')
  assert.equal(event.projectId, 'build-box:/work/app')
  assert.equal(event.agentName, 'codex')
})

test('pet events: historical replay is isolated from the live notification boundary', () => {
  assert.equal(shouldSurfacePetEvent(999, 1000), false)
  assert.equal(shouldSurfacePetEvent(1000, 1000), true)
  assert.equal(shouldSurfacePetEvent(1001, 1000), true)
  assert.equal(shouldSurfacePetEvent(Number.NaN, 1000), false)
})

test('pet events: malformed or unsupported payloads are ignored safely', () => {
  assert.equal(petEventFromBridge(bridgeEvent({ payload: {} }), agents), null)
  assert.equal(petEventFromBridge(bridgeEvent({ petType: 'sessions' }), agents), null)
  assert.equal(petEventFromBridge(bridgeEvent({ ts: 'bad' }), agents), null)
  assert.equal(petEventFromBridge(bridgeEvent({ payload: { session: { agent: 'codex' } } }), agents), null)
})
