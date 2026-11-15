import type { MotionPref } from '../ui-logic'

export interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface PetSettings {
  skinId: string
  motion: MotionPref
  roaming: boolean
  scale: 0.75 | 1 | 1.25
  alwaysOnTop: boolean
}

export const PET_SETTINGS_CHANGED = 'petdeck:pet-settings-changed'
const SETTINGS_KEY = 'petdeck.settings'
const MOTION_KEY = 'petdeck.motion'
const SKIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const DEFAULTS: PetSettings = { skinId: 'default', motion: 'auto', roaming: true, scale: 1, alwaysOnTop: true }

function browserStorage(): SettingsStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

export function getPetSettings(storage = browserStorage()): PetSettings {
  if (!storage) return DEFAULTS
  try {
    const parsed = JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}') as Partial<PetSettings>
    const legacyMotion = storage.getItem(MOTION_KEY)
    const motionValue = parsed.motion ?? legacyMotion
    const motion: MotionPref = motionValue === 'on' || motionValue === 'off' || motionValue === 'reduced' ? motionValue : 'auto'
    return {
      skinId: typeof parsed.skinId === 'string' && SKIN_ID.test(parsed.skinId) ? parsed.skinId : 'default',
      motion,
      roaming: typeof parsed.roaming === 'boolean' ? parsed.roaming : true,
      scale: parsed.scale === 0.75 || parsed.scale === 1.25 ? parsed.scale : 1,
      alwaysOnTop: typeof parsed.alwaysOnTop === 'boolean' ? parsed.alwaysOnTop : true,
    }
  } catch {
    return { ...DEFAULTS, motion: storage.getItem(MOTION_KEY) === 'off' ? 'off' : 'auto' }
  }
}

export function updatePetSettings(patch: Partial<PetSettings>, storage = browserStorage()): PetSettings {
  const next = { ...getPetSettings(storage), ...patch }
  try {
    storage?.setItem(SETTINGS_KEY, JSON.stringify(next))
    storage?.setItem(MOTION_KEY, next.motion)
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(PET_SETTINGS_CHANGED, { detail: next }))
  } catch { /* Settings remain available for this session when storage is unavailable. */ }
  return next
}

export function subscribePetSettings(handler: (settings: PetSettings) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: Event) => handler((event as CustomEvent<PetSettings>).detail ?? getPetSettings())
  window.addEventListener(PET_SETTINGS_CHANGED, listener)
  return () => window.removeEventListener(PET_SETTINGS_CHANGED, listener)
}
