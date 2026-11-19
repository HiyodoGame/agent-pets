import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSerialSender } from './serial-sender.ts'

test('serial sender: rejects a second request until the real async task completes', async () => {
  const sender = createSerialSender()
  const calls: string[] = []
  let release: () => void = () => {}
  const pending = new Promise<void>((resolve) => { release = resolve })
  const first = sender.run(async () => {
    calls.push('first:start')
    await pending
    calls.push('first:end')
  })
  assert.equal(sender.isBusy(), true)
  assert.equal(await sender.run(async () => { calls.push('second') }), false)
  assert.deepEqual(calls, ['first:start'])
  release()
  assert.equal(await first, true)
  assert.equal(sender.isBusy(), false)
  assert.deepEqual(calls, ['first:start', 'first:end'])
})

test('serial sender: failures release the lock for an explicit retry', async () => {
  const sender = createSerialSender()
  await assert.rejects(sender.run(async () => { throw new Error('failed') }))
  assert.equal(sender.isBusy(), false)
  assert.equal(await sender.run(async () => {}), true)
})
