import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeSessions } from '../../adapters/live-sessions.ts'
import { firstProjectSessionId, summarizeProjectSessions } from './project-summary.ts'
import type { Session } from '../shared/types.ts'

const active: Session = {
  id: 's1', projectId: 'p1', agentId: 'codex', title: 'Deploy', status: 'active',
  messages: [], artifactIds: [], updatedAt: '',
}

test('project summary: archived overlays no longer count as running', () => {
  const merged = mergeSessions([active], { s1: { status: 'archived' } }, [])
  assert.deepEqual(summarizeProjectSessions(merged, 'p1'), { running: 0, waiting: 0, total: 1 })
})

test('project summary: deleted sessions are absent from every overview count', () => {
  const merged = mergeSessions([active], {}, ['s1'])
  assert.deepEqual(summarizeProjectSessions(merged, 'p1'), { running: 0, waiting: 0, total: 0 })
})

test('project summary: waiting and stuck sessions share the attention count', () => {
  const sessions = [
    active,
    { ...active, id: 's2', status: 'waiting' as const },
    { ...active, id: 's3', status: 'stuck' as const },
  ]
  assert.deepEqual(summarizeProjectSessions(sessions, 'p1'), { running: 1, waiting: 2, total: 3 })
})

test('project entry: a deleted first session is never selected again', () => {
  const second = { ...active, id: 's2', title: 'Still present' }
  const merged = mergeSessions([active, second], {}, ['s1'])
  assert.equal(firstProjectSessionId(merged, 'p1'), 's2')
  assert.equal(firstProjectSessionId(mergeSessions([active], {}, ['s1']), 'p1'), null)
})
