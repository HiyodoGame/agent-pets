import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPetSettings, subscribePetSettings, updatePetSettings, type SettingsStorage } from './pet-settings.ts'

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

test('pet settings: storage events synchronize another window and unsubscribe cleanly', (t) => {
  const storage = memoryStorage()
  const listeners = new Map<string, EventListener[]>()
  const previousWindow = globalThis.window
  globalThis.window = {
    localStorage: storage,
    addEventListener: (type: string, listener: EventListener) => {
      listeners.set(type, [...listeners.get(type) ?? [], listener])
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener))
    },
  } as unknown as Window & typeof globalThis
  t.after(() => {
    if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
    else globalThis.window = previousWindow
  })

  let latestScale = 1
  const stop = subscribePetSettings((settings) => { latestScale = settings.scale })
  storage.setItem('petdeck.settings', JSON.stringify({ scale: 1.25 }))
  const event = new Event('storage')
  Object.defineProperty(event, 'key', { value: 'petdeck.settings' })
  for (const listener of listeners.get('storage') ?? []) listener(event)
  assert.equal(latestScale, 1.25)
  stop()
  assert.equal(listeners.get('storage')?.length, 0)
})
