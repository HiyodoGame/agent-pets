import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PetEvent } from '../flows/shared/types.ts'
import { createNotificationDispatcher, notificationBody, sendPetSystemNotification } from './notifications.ts'

function event(type: PetEvent['type'], id = 'e1'): PetEvent {
  return { id, type, projectId: 'local:F:/Project', sessionId: 'codex:s1', agentId: 'codex', agentName: 'Codex', projectName: 'Project', sessionTitle: 'Task', text: 'private conversation body', timestamp: new Date().toISOString(), handled: false }
}

test('notifications: non-Tauri environments report system notification as unavailable', async () => {
  assert.equal(await sendPetSystemNotification(event('done')), false)
})

test('notifications: every lifecycle body identifies agent, project and task without conversation text', () => {
  const expected: Array<[PetEvent['type'], string]> = [
    ['started', 'Codex 开始工作\nProject · Task'],
    ['done', 'Codex 完成任务\nProject · Task'],
    ['relay-ready', 'Codex 完成任务\nProject · Task'],
    ['stuck', 'Codex 遇到困难\nProject · Task'],
    ['decision', 'Codex 需要你拍板\nProject · Task'],
  ]
  for (const [type, body] of expected) {
    assert.equal(notificationBody(event(type)), body)
    assert.equal(notificationBody(event(type)).includes('private conversation body'), false)
  }
})

test('notifications: completion taps once with an attributed summary', async () => {
  const sent: string[] = []
  const dispatch = createNotificationDispatcher((item) => { sent.push(notificationBody(item)) })
  assert.equal(await dispatch(event('done'), false), 'tap')
  assert.deepEqual(sent, ['Codex 完成任务\nProject · Task'])
})

test('notifications: DND routes ordinary events to inbox without system notification', async () => {
  let calls = 0
  const dispatch = createNotificationDispatcher(() => { calls++ })
  assert.equal(await dispatch(event('done'), true), 'inbox')
  assert.equal(await dispatch(event('stuck', 'e2'), true), 'inbox')
  assert.equal(await dispatch(event('started', 'e3'), true), 'inbox')
  assert.equal(calls, 0)
})

test('notifications: decisions retain local tap without an OS toast under DND', async () => {
  let calls = 0
  const dispatch = createNotificationDispatcher(() => { calls++ })
  assert.equal(await dispatch(event('decision'), true), 'tap')
  assert.equal(calls, 0)
})

test('notifications: duplicate event ids never notify twice', async () => {
  let calls = 0
  const dispatch = createNotificationDispatcher(() => { calls++ })
  assert.equal(await dispatch(event('done'), false), 'tap')
  assert.equal(await dispatch(event('done'), false), 'duplicate')
  assert.equal(calls, 1)
})
