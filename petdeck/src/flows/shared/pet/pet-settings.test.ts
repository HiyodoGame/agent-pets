import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPetSettings, updatePetSettings, type SettingsStorage } from './pet-settings.ts'

function memoryStorage(initial: Record<string, string> = {}): SettingsStorage {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
  }
}

test('pet settings: defaults preserve calm behavior and existing motion preference', () => {
  const settings = getPetSettings(memoryStorage({ 'petdeck.motion': 'off' }))
  assert.deepEqual(settings, {
    skinId: 'default',
    motion: 'off',
    roaming: true,
    scale: 1,
    alwaysOnTop: true,
  })
})

test('pet settings: updates persist and corrupt values fall back safely', () => {
  const storage = memoryStorage({ 'petdeck.settings': '{bad json' })
  assert.equal(getPetSettings(storage).skinId, 'default')
  const updated = updatePetSettings({ skinId: 'orange-cat', scale: 1.25, roaming: false }, storage)
  assert.equal(updated.skinId, 'orange-cat')
  assert.equal(updated.scale, 1.25)
  assert.equal(updated.roaming, false)
  assert.deepEqual(getPetSettings(storage), updated)
  assert.equal(storage.getItem('petdeck.motion'), 'auto')
})

test('pet settings: unsupported scale and unsafe skin id are ignored', () => {
  const storage = memoryStorage({
    'petdeck.settings': JSON.stringify({ skinId: '../bad', scale: 9, motion: 'reduced' }),
  })
  const settings = getPetSettings(storage)
  assert.equal(settings.skinId, 'default')
  assert.equal(settings.scale, 1)
  assert.equal(settings.motion, 'reduced')
})
