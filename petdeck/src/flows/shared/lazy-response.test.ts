import { test } from 'node:test'
import assert from 'node:assert/strict'
import { responseBehavior } from './response-behavior.ts'

test('lazy response: completed observations never inject demo rounds or simulate progress', () => {
  assert.deepEqual(responseBehavior('done'), { rounds: [], simulate: false })
})

test('lazy response: demo streaming uses explicit empty rounds instead of library demo data', () => {
  assert.deepEqual(responseBehavior('streaming'), { rounds: [], simulate: true })
})
