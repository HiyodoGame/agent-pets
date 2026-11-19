import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLatestOnlyQueue } from './latest-only-queue.ts'

test('latest-only queue: work superseded before starting is skipped', async () => {
  const schedule = createLatestOnlyQueue()
  const calls: string[] = []
  await Promise.all([
    schedule(async () => { calls.push('old') }),
    schedule(async () => { calls.push('new') }),
  ])
  assert.deepEqual(calls, ['new'])
})

test('latest-only queue: a newer request finishes after an in-flight native mutation', async () => {
  const schedule = createLatestOnlyQueue()
  const calls: string[] = []
  let release: () => void = () => {}
  const blocked = new Promise<void>((resolve) => { release = resolve })
  const first = schedule(async () => {
    calls.push('old:start')
    await blocked
    calls.push('old:end')
  })
  await Promise.resolve()
  const second = schedule(async () => { calls.push('new') })
  release()
  await Promise.all([first, second])
  assert.deepEqual(calls, ['old:start', 'old:end', 'new'])
})

test('latest-only queue: a failed mutation does not block the latest correction', async () => {
  const schedule = createLatestOnlyQueue()
  const calls: string[] = []
  await assert.rejects(schedule(async () => { throw new Error('native failure') }))
  await schedule(async () => { calls.push('recovered') })
  assert.deepEqual(calls, ['recovered'])
})
