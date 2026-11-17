import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULTS,
  GROWTH_KEY,
  PET_COOLDOWN_MS,
  TASK_XP,
  addXp,
  awardPet,
  awardTask,
  levelProgress,
  loadGrowth,
  saveGrowth,
} from './growth.ts'

const day = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()

test('levelProgress: thresholds, titles and percent', () => {
  assert.equal(levelProgress(0).level, 1)
  assert.equal(levelProgress(39).level, 1)
  assert.equal(levelProgress(40).level, 2)
  assert.equal(levelProgress(39).percent, 98)
  const max = levelProgress(2000)
  assert.equal(max.level, 8)
  assert.equal(max.nextMinXp, null)
  assert.equal(max.percent, 100)
  assert.equal(levelProgress(-5).level, 1)
})

test('addXp: streak increments only on consecutive days', () => {
  const now = day(2026, 11, 17)
  const first = addXp(DEFAULTS, 10, now)
  assert.equal(first.streakDays, 1)
  assert.equal(addXp(first, 10, now).streakDays, 1, 'same day keeps the streak')
  const nextDay = addXp(first, 10, now + 86_400_000)
  assert.equal(nextDay.streakDays, 2)
  const later = addXp(nextDay, 10, now + 4 * 86_400_000)
  assert.equal(later.streakDays, 1, 'a gap resets the streak')
})

test('awardTask: counts tasks and grants TASK_XP each', () => {
  const next = awardTask(DEFAULTS, 3, day(2026, 11, 17))
  assert.equal(next.xp, 3 * TASK_XP)
  assert.equal(next.tasks, 3)
  assert.equal(awardTask(next, 0).xp, next.xp)
})

test('awardPet: cooldown prevents rapid XP farming', () => {
  const now = day(2026, 11, 17)
  const first = awardPet(DEFAULTS, now)
  assert.equal(first.awarded, true)
  assert.equal(first.state.pets, 1)
  assert.equal(first.state.xp, 2)
  const blocked = awardPet(first.state, now + PET_COOLDOWN_MS - 1)
  assert.equal(blocked.awarded, false)
  assert.equal(blocked.state.xp, first.state.xp)
  const later = awardPet(first.state, now + PET_COOLDOWN_MS)
  assert.equal(later.awarded, true)
  assert.equal(later.state.xp, 4)
})

test('loadGrowth/saveGrowth: round-trips and recovers from corrupt data', () => {
  const mem = new Map<string, string>()
  const store = {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => { mem.set(key, value) },
  }
  const saved = saveGrowth({ ...DEFAULTS, xp: 55, streakDays: 3, tasks: 4 }, store)
  assert.deepEqual(loadGrowth(store), saved)
  mem.set(GROWTH_KEY, '{broken')
  assert.deepEqual(loadGrowth(store), DEFAULTS)
  mem.set(GROWTH_KEY, JSON.stringify({ version: 2, xp: 999 }))
  assert.deepEqual(loadGrowth(store), DEFAULTS, 'unknown schema resets')
})
