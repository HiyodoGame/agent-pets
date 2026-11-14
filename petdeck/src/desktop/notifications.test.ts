import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PetEvent } from '../flows/shared/types.ts'
import { createNotificationDispatcher, notificationBody, sendPetSystemNotification } from './notifications.ts'

function event(type: PetEvent['type'], id = 'e1'): PetEvent {
  return { id, type, projectId: 'live', sessionId: 's1', text: 'private conversation body', timestamp: new Date().toISOString(), handled: false }
}

test('notifications: non-Tauri environments report system notification as unavailable', async () => {
  assert.equal(await sendPetSystemNotification(event('done')), false)
})

test('notifications: completion taps once with a generic summary', async () => {
  const sent: string[] = []
  const dispatch = createNotificationDispatcher((item) => { sent.push(notificationBody(item)) })
  assert.equal(await dispatch(event('done'), false), 'tap')
  assert.deepEqual(sent, ['有 Agent 完成任务'])
  assert.equal(sent[0].includes('private conversation body'), false)
})

test('notifications: DND routes ordinary events to inbox without system notification', async () => {
  let calls = 0
  const dispatch = createNotificationDispatcher(() => { calls++ })
  assert.equal(await dispatch(event('done'), true), 'inbox')
  assert.equal(await dispatch(event('stuck', 'e2'), true), 'inbox')
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
