import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compactPetStatus, notificationDecision, petEventText, petOverlayMode, shouldResetEventWatermark, summarizeSessions } from './pet-view.ts'

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

test('pet view: attention and running outrank historical completion, which settles to idle', () => {
  assert.equal(compactPetStatus('live', { running: 1, done: 1, waiting: 1, stuck: 0 }), 'stuck')
  assert.equal(compactPetStatus('reconnecting', { running: 1, done: 0, waiting: 0, stuck: 0 }), 'running')
  assert.equal(compactPetStatus('live', { running: 0, done: 1, waiting: 0, stuck: 0 }), 'idle')
})

test('pet view: ordinary events tap normally and enter the inbox under DND', () => {
  assert.equal(notificationDecision({ type: 'done' }, false), 'tap')
  assert.equal(notificationDecision({ type: 'done' }, true), 'inbox')
  assert.equal(notificationDecision({ type: 'stuck' }, true), 'inbox')
})

test('pet view: empty event text gets a useful type-specific fallback', () => {
  assert.equal(petEventText({ type: 'started', text: '' }), '有一个 Agent 开始工作')
  assert.equal(petEventText({ type: 'decision', text: '' }), '有一个 Agent 正在等待你的决定')
  assert.equal(petEventText({ type: 'stuck', text: '  ' }), '有一个 Agent 遇到困难，需要查看')
  assert.equal(petEventText({ type: 'done', text: '' }), '有一个 Agent 完成了任务')
  assert.equal(petEventText({ type: 'relay-ready', text: '' }), '任务已完成，可以进行下一次接力')
  assert.equal(petEventText({ type: 'done', text: '已完成官网更新' }), '已完成官网更新')
})

test('pet view: decisions still tap under DND', () => {
  assert.equal(notificationDecision({ type: 'decision' }, true), 'tap')
  assert.equal(notificationDecision({ type: 'decision' }, false), 'tap')
})

test('pet view: an active event replaces quick panel instead of overlapping it', () => {
  assert.equal(petOverlayMode({ settingsOpen: false, menuOpen: false, activeEvent: true, expanded: true, hasError: true }), 'event')
  assert.equal(petOverlayMode({ settingsOpen: false, menuOpen: false, activeEvent: false, expanded: true, hasError: false }), 'quick')
  assert.equal(petOverlayMode({ settingsOpen: true, menuOpen: false, activeEvent: true, expanded: true, hasError: false }), 'event')
})

test('pet view: source switches reset the event watermark in both directions', () => {
  assert.equal(shouldResetEventWatermark('live', 'mock'), true)
  assert.equal(shouldResetEventWatermark('mock', 'live'), true)
  assert.equal(shouldResetEventWatermark('live', 'live'), false)
})
