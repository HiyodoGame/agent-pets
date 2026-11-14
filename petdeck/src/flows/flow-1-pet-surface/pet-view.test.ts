import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compactPetStatus, notificationDecision, summarizeSessions } from './pet-view.ts'

test('pet view: aggregates running, done, waiting and stuck independently', () => {
  const summary = summarizeSessions([
    { status: 'active' },
    { status: 'active' },
    { status: 'done' },
    { status: 'waiting' },
    { status: 'stuck' },
    { status: 'archived' },
  ])
  assert.deepEqual(summary, { running: 2, done: 1, waiting: 1, stuck: 1 })
})

test('pet view: empty sessions produce an idle pet', () => {
  const summary = summarizeSessions([])
  assert.deepEqual(summary, { running: 0, done: 0, waiting: 0, stuck: 0 })
  assert.equal(compactPetStatus('live', summary), 'idle')
})

test('pet view: offline takes precedence over all session counts', () => {
  const summary = { running: 3, done: 2, waiting: 1, stuck: 1 }
  assert.equal(compactPetStatus('offline', summary), 'offline')
})

test('pet view: attention states outrun running and done states', () => {
  assert.equal(compactPetStatus('live', { running: 1, done: 1, waiting: 1, stuck: 0 }), 'stuck')
  assert.equal(compactPetStatus('reconnecting', { running: 1, done: 0, waiting: 0, stuck: 0 }), 'running')
  assert.equal(compactPetStatus('live', { running: 0, done: 1, waiting: 0, stuck: 0 }), 'done')
})

test('pet view: ordinary events tap normally and enter the inbox under DND', () => {
  assert.equal(notificationDecision({ type: 'done' }, false), 'tap')
  assert.equal(notificationDecision({ type: 'done' }, true), 'inbox')
  assert.equal(notificationDecision({ type: 'stuck' }, true), 'inbox')
})

test('pet view: decisions still tap under DND', () => {
  assert.equal(notificationDecision({ type: 'decision' }, true), 'tap')
  assert.equal(notificationDecision({ type: 'decision' }, false), 'tap')
})
