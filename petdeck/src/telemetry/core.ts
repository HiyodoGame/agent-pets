// Local-first telemetry core. Pure logic (unit-tested). Only behavior events, never content.
export const EVENT = {
  relayStarted: 'relay_started',
  relayPreviewConfirmed: 'relay_preview_confirmed',
  relayInjectResult: 'relay_inject_result',
  relayDone: 'relay_done',
  connectStarted: 'connect_started',
  connectSuccess: 'connect_success',
  ambientGlance: 'ambient_glance',
  appSessionStart: 'app_session_start',
  dndToggle: 'dnd_toggle',
  notificationSuppressed: 'notification_suppressed',
  relayStopped: 'relay_stopped',
  petPoke: 'pet_poke',
  panelDrilldown: 'panel_drilldown',
  offlineEntered: 'offline_entered',
  connectionRecovered: 'connection_recovered',
} as const

// Privacy red line: never store conversation/content fields.
export const FORBIDDEN = ['context', 'instruction', 'lastMessage', 'content', 'message', 'prompt']

export interface TelemetryEvent {
  id: string
  user: string
  page: string
  action: string
  extra: Record<string, unknown>
  ts: number
}

export interface TelemetryCore {
  track(page: string, action: string, extra?: Record<string, unknown>): TelemetryEvent
  events(): TelemetryEvent[]
  exportJSON(): string
  clear(): void
  _load(evts: TelemetryEvent[]): void
}

let seq = 0
// Recursively strip forbidden keys at ANY depth, and clone so a caller mutating
// its own object after track() cannot retroactively leak content into the event.
function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (FORBIDDEN.includes(k)) continue
      out[k] = strip(val)
    }
    return out
  }
  return v
}
function sanitize(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return strip(extra) as Record<string, unknown>
}

export function createTelemetryCore(opts: { user: string; cap?: number; now?: () => number }): TelemetryCore {
  const cap = opts.cap ?? 500
  const now = opts.now ?? (() => Date.now())
  let buf: TelemetryEvent[] = []
  const core: TelemetryCore = {
    track(page, action, extra) {
      const e: TelemetryEvent = { id: `e${++seq}-${now()}`, user: opts.user, page, action, extra: sanitize(extra), ts: now() }
      buf.push(e)
      if (buf.length > cap) buf.shift()
      return e
    },
    events: () => [...buf],
    exportJSON: () => JSON.stringify(buf),
    clear: () => { buf = [] },
    _load: (evts) => {
      // Only accept an array of well-formed events; anything else => start fresh (never poison buf).
      const safe = Array.isArray(evts) ? evts.filter((e) => e && typeof e === 'object' && typeof (e as TelemetryEvent).id === 'string' && typeof (e as TelemetryEvent).action === 'string') : []
      buf = safe.slice(-cap)
    },
  }
  return core
}

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export interface PersistenceOpts {
  /** Debounce window; default 250ms. Each track coalesces into one pending flush. */
  debounceMs?: number
  /** Timer injection (test seam). Must return a cancel fn. Defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => () => void
  /** pagehide hook registration (test seam). Defaults to window 'pagehide' when available. */
  onPagehide?: (fn: () => void) => void
}

const DEFAULT_DEBOUNCE_MS = 250

/**
 * Persist to a local storage (localStorage in browser). Restores on attach.
 * Writes are DEBOUNCED (never one sync write per track) and always flushed on
 * pagehide, so the final events of a session are never lost to an unfired timer.
 * API-compatible: the opts arg is optional; attachPersistence(core, storage, key) unchanged.
 */
export function attachPersistence(core: TelemetryCore, storage: StorageLike, key: string, opts: PersistenceOpts = {}): void {
  try {
    const raw = storage.getItem(key)
    if (raw) core._load(JSON.parse(raw))
  } catch { /* corrupt local data => start fresh */ }
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  })
  const onPagehide = opts.onPagehide ?? ((fn: () => void) => {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('pagehide', fn)
    }
  })
  let cancelPending: (() => void) | null = null
  const flush = () => {
    if (cancelPending) { cancelPending(); cancelPending = null }
    try { storage.setItem(key, core.exportJSON()) } catch { /* storage full => drop silently */ }
  }
  onPagehide(flush)
  const orig = core.track.bind(core)
  core.track = (page, action, extra) => {
    const e = orig(page, action, extra)
    if (cancelPending) cancelPending()
    cancelPending = schedule(flush, debounceMs)
    return e
  }
}