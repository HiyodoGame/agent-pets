import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildObservedHandoff, defaultHandoffContext } from './handoff.ts'

test('handoff: payload trims text, keeps the observed agent as the target and never claims artifacts', () => {
  const payload = buildObservedHandoff({ agent: 'cursor', context: '  上文  ', instruction: '  继续做 X  ' })
  assert.deepEqual(payload, { to: 'cursor', from: 'petdeck', context: '上文', instruction: '继续做 X' })
  assert.equal('artifacts' in payload, false)
})

test('handoff: payload caps oversized text', () => {
  const payload = buildObservedHandoff({ agent: 'dsh', context: 'c'.repeat(5000), instruction: 'i'.repeat(5000) })
  assert.equal(payload.context?.length, 4000)
  assert.equal(payload.instruction?.length, 4000)
})

test('handoff: context prefers the latest assistant line, then the session last message', () => {
  const lines = [
    { role: 'user', text: '问题' },
    { role: 'assistant', text: '第一版' },
    { role: 'user', text: '追问' },
    { role: 'assistant', text: '最新回答' },
  ]
  assert.equal(defaultHandoffContext(lines, 'fallback'), '最新回答')
  assert.equal(defaultHandoffContext([{ role: 'user', text: '只有用户' }], 'fallback'), 'fallback')
  assert.equal(defaultHandoffContext([], null), '')
  assert.equal(defaultHandoffContext([{ role: 'assistant', text: 'x'.repeat(3000) }]).length, 2000)
})
