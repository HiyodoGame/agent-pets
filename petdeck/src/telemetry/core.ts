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
function sanitize(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(extra)) if (!FORBIDDEN.includes(k)) out[k] = v
  return out
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
    _load: (evts) => { buf = evts.slice(-cap) },
  }
  return core
}

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** Persist to a local storage (localStorage in browser). Restores on attach; saves on each track. */
export function attachPersistence(core: TelemetryCore, storage: StorageLike, key: string): void {
  try {
    const raw = storage.getItem(key)
    if (raw) core._load(JSON.parse(raw))
  } catch { /* corrupt local data => start fresh */ }
  const orig = core.track.bind(core)
  core.track = (page, action, extra) => {
    const e = orig(page, action, extra)
    try { storage.setItem(key, core.exportJSON()) } catch { /* storage full => drop silently */ }
    return e
  }
}