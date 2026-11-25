import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compactPetStatus, isRecentlyActive, notificationDecision, petEventText, petOverlayMode, sanitizePetEventText, shouldResetEventWatermark, summarizeSessions } from './pet-view.ts'

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

test('pet view: only sessions with activity in the last 24h count as working', () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z')
  assert.equal(isRecentlyActive({ updatedAt: '2026-11-25T11:59:00.000Z' }, now), true)
  assert.equal(isRecentlyActive({ updatedAt: '2026-11-24T11:00:00.000Z' }, now), false, 'a 4-day-old turn must not take a slot')
  assert.equal(isRecentlyActive({ updatedAt: '', lastSeen: now - 60_000 }, now), true, 'lastSeen is the fallback')
  assert.equal(isRecentlyActive({ updatedAt: '' }, now), true, 'no time evidence must not hide the session')
  assert.equal(isRecentlyActive({ updatedAt: 'not-a-date' }, now), true)
})

test('pet view: event summaries strip protocol markup and clamp to one readable line', () => {
  const raw = 'Another Claude session sent a message:\n<cross-session-message from="local_5d829830-b648" from-name="后续可做事项">未来发布时间差异已修正。</cross-session-message>'
  const clean = sanitizePetEventText(raw)
  assert.ok(!clean.includes('<cross-session-message'))
  assert.ok(!clean.includes('from='))
  assert.ok(clean.includes('未来发布时间差异已修正'))
  assert.ok(Array.from(sanitizePetEventText('字'.repeat(400))).length <= 160)
  assert.equal(sanitizePetEventText('   '), '')
})
