interface PreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const DEMO_KEY = 'petdeck.demo'

function localStore(): PreferenceStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

export function getDemoPreference(storage = localStore()): boolean {
  try { return storage?.getItem(DEMO_KEY) === 'true' } catch { return false }
}

export function setDemoPreference(demo: boolean, storage = localStore()): void {
  try { storage?.setItem(DEMO_KEY, String(demo)) } catch { /* Keep the in-memory mode when storage is unavailable. */ }
}

export function subscribeDemoPreference(handler: (demo: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (event: StorageEvent) => {
    if (event.key === DEMO_KEY) handler(getDemoPreference())
  }
  window.addEventListener('storage', listener)
  return () => window.removeEventListener('storage', listener)
}
