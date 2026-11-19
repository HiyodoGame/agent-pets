import { test } from 'node:test'
import assert from 'node:assert/strict'
import { observedSessionId, observedToProjects, projectForObservation } from './session-identity.ts'
import type { ObservedSession } from './types.ts'

function row(over: Partial<ObservedSession> = {}): ObservedSession {
  return {
    agent: 'codex', source: 'test', session: 's1', status: 'running', lastMessage: 'working',
    ...over,
  }
}

test('session identity: local and remote raw ids map to unique composite session ids', () => {
  assert.equal(observedSessionId(row()), 'codex:s1')
  assert.equal(observedSessionId(row({ host: 'build-box' })), 'build-box@codex:s1')
})

test('project identity: cwd spelling is normalized and shared across agents', () => {
  const codex = row({ cwd: 'F:\\Work\\App\\' })
  const claude = row({ agent: 'claude', session: 's2', cwd: 'F:/Work/App' })
  assert.equal(projectForObservation(codex).id, 'local:F:/Work/App')
  assert.equal(projectForObservation(claude).id, 'local:F:/Work/App')
  assert.equal(projectForObservation(codex).name, 'App')
  const projects = observedToProjects([codex, claude], '2026-11-19T10:00:00.000Z')
  assert.equal(projects.length, 1)
  assert.deepEqual(projects[0].sessionIds, ['codex:s1', 'claude:s2'])
  assert.equal(projects[0].updatedAt, '2026-11-19T10:00:00.000Z')
})

test('project identity: remote hosts and source project slugs stay distinct', () => {
  const local = projectForObservation(row({ cwd: '/work/app' }))
  const remote = projectForObservation(row({ cwd: '/work/app', host: 'build-box' }))
  assert.equal(local.id, 'local:/work/app')
  assert.equal(remote.id, 'build-box:/work/app')
  const slug = projectForObservation(row({ projectId: 'proj-a', projectName: 'proj-a' }))
  assert.equal(slug.id, 'local:proj-a')
  assert.equal(slug.name, 'proj-a')
})

test('project identity: temp-dir sessions share one bucket per host instead of a fake project', () => {
  const a = row({ agent: 'codex', session: 'a', cwd: '', temp: true })
  const b = row({ agent: 'claude', session: 'b', cwd: '', temp: true })
  const remote = row({ agent: 'codex', session: 'c', host: 'build-box', temp: true })
  assert.equal(projectForObservation(a).id, 'local:temp')
  assert.equal(projectForObservation(a).name, '临时目录')
  assert.equal(projectForObservation(b).id, 'local:temp')
  assert.equal(projectForObservation(remote).id, 'build-box:temp')
  const projects = observedToProjects([a, b], '2026-11-20T00:00:00.000Z')
  assert.equal(projects.length, 1)
  assert.deepEqual(projects[0].sessionIds, ['codex:a', 'claude:b'])
})

test('project identity: missing metadata is honestly scoped to host and agent', () => {
  const missing = projectForObservation(row())
  const remoteMissing = projectForObservation(row({ host: 'build-box' }))
  assert.equal(missing.id, 'local:codex:unidentified')
  assert.equal(missing.name, '未识别项目')
  assert.equal(remoteMissing.id, 'build-box:codex:unidentified')
  assert.equal(missing.id === projectForObservation(row({ agent: 'claude' })).id, false)
})
