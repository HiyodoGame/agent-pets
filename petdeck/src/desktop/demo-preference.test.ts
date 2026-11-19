import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getDemoPreference, setDemoPreference } from './demo-preference.ts'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

test('demo preference: defaults to live data and persists the explicit demo choice', () => {
  const storage = memoryStorage()
  assert.equal(getDemoPreference(storage), false)
  setDemoPreference(true, storage)
  assert.equal(getDemoPreference(storage), true)
  setDemoPreference(false, storage)
  assert.equal(getDemoPreference(storage), false)
})
