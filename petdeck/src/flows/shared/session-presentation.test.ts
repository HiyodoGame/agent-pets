import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presentSession, prioritizeSessions } from './session-presentation.ts'
import type { Agent, Project, Session } from './types.ts'

const agents: Agent[] = [{ id: 'a1', name: 'Codex', form: 'cli', capability: 'full', status: 'running', projectIds: ['p1'] }]
const projects: Project[] = [{ id: 'p1', name: 'App 发版管线', description: '', sessionIds: ['s1'], updatedAt: '' }]

function session(over: Partial<Session> = {}): Session {
  return { id: 's1', projectId: 'p1', agentId: 'a1', title: '生成素材包', status: 'active', messages: [], artifactIds: [], updatedAt: '', ...over }
}

test('session presentation: resolves display names instead of leaking internal ids', () => {
  const view = presentSession(session(), agents, projects)
  assert.equal(view.agentName, 'Codex')
  assert.equal(view.projectName, 'App 发版管线')
  assert.equal(view.title, '生成素材包')
  assert.equal(view.statusLabel, '运行中')
})

test('session presentation: missing metadata and long or remote sessions stay readable', () => {
  const longTitle = '很长的任务标题'.repeat(20)
  const view = presentSession(session({ agentId: 'missing', projectId: 'missing', title: longTitle, host: 'build-box', stale: true }), agents, projects)
  assert.equal(view.agentName, 'missing')
  assert.equal(view.projectName, '未识别项目')
  assert.equal(view.title, longTitle)
  assert.equal(view.host, 'build-box')
  assert.equal(view.stale, true)
  assert.equal(presentSession(session({ title: '' }), agents, projects).title, 's1')
})

test('session presentation: attention and running precede history without reordering peers', () => {
  const sessions = [
    session({ id: 'done-1', status: 'done' }),
    session({ id: 'active-1', status: 'active' }),
    session({ id: 'waiting-1', status: 'waiting' }),
    session({ id: 'stuck-1', status: 'stuck' }),
    session({ id: 'active-2', status: 'active' }),
    session({ id: 'archived-1', status: 'archived' }),
  ]
  assert.deepEqual(prioritizeSessions(sessions).map((item) => item.id), ['waiting-1', 'stuck-1', 'active-1', 'active-2', 'done-1', 'archived-1'])
})
