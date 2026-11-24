// Local-only presentation overlay for observed (external) sessions. Rename and
// archive never touch the session files; they only change what PetDeck shows.
// The legacy panel key is migrated once, then all writes go to the new key.
export interface ObservedViewState {
  titles: Record<string, string>
  archived: string[]
}

export const OBSERVED_VIEW_KEY = 'petdeck.observe.view.v1'
export const LEGACY_PANEL_VIEW_KEY = 'petdeck.panel.view.v1'
const MAX_ENTRIES = 200
const MAX_TITLE = 200

type ViewStorage = Pick<Storage, 'getItem' | 'setItem'> | null

export function emptyObservedViewState(): ObservedViewState {
  return { titles: {}, archived: [] }
}

export function observedKey(agent: string, session: string, host?: string | null): string {
  return host ? host + '@' + agent + ':' + session : agent + ':' + session
}

function cleanTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TITLE) : ''
}

function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0).slice(0, MAX_ENTRIES))]
}

function sanitize(raw: unknown): ObservedViewState {
  const next = emptyObservedViewState()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return next
  const record = raw as { titles?: unknown; archived?: unknown }
  if (record.titles && typeof record.titles === 'object' && !Array.isArray(record.titles)) {
    for (const [key, value] of Object.entries(record.titles).slice(0, MAX_ENTRIES)) {
      const title = cleanTitle(value)
      if (title) next.titles[key] = title
    }
  }
  next.archived = cleanIds(record.archived)
  return next
}

/** Best-effort translation of the legacy panel overlay; unreadable shapes are dropped. */
export function migrateLegacyPanelView(raw: unknown): ObservedViewState {
  const next = emptyObservedViewState()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return next
  const record = raw as { overlays?: unknown; deleted?: unknown }
  if (record.overlays && typeof record.overlays === 'object' && !Array.isArray(record.overlays)) {
    for (const [key, value] of Object.entries(record.overlays).slice(0, MAX_ENTRIES)) {
      if (!value || typeof value !== 'object') continue
      const overlay = value as { title?: unknown; status?: unknown }
      const title = cleanTitle(overlay.title)
      if (title) next.titles[key] = title
      if (overlay.status === 'archived') next.archived.push(key)
    }
  }
  // The old panel's "delete" only hid a session locally; keep it hidden as archived.
  next.archived.push(...cleanIds(record.deleted))
  next.archived = [...new Set(next.archived)].slice(0, MAX_ENTRIES)
  return next
}

export function loadObservedViewState(storage: ViewStorage): ObservedViewState {
  if (!storage) return emptyObservedViewState()
  try {
    const raw = storage.getItem(OBSERVED_VIEW_KEY)
    if (raw) return sanitize(JSON.parse(raw))
  } catch { /* fall through to the legacy key */ }
  try {
    const legacy = storage.getItem(LEGACY_PANEL_VIEW_KEY)
    if (legacy) {
      const migrated = migrateLegacyPanelView(JSON.parse(legacy))
      saveObservedViewState(storage, migrated)
      return migrated
    }
  } catch { /* an unreadable legacy value is not a reason to fail startup */ }
  return emptyObservedViewState()
}

export function saveObservedViewState(storage: ViewStorage, state: ObservedViewState): ObservedViewState {
  const clean = sanitize(state)
  if (storage) {
    try { storage.setItem(OBSERVED_VIEW_KEY, JSON.stringify(clean)) } catch { /* storage disabled */ }
  }
  return clean
}

/** Migration keyed by the bare session id must still apply to an agent-qualified row. */
export function titleForObserved(state: ObservedViewState, agent: string, session: string, host?: string | null): string | null {
  return state.titles[observedKey(agent, session, host)] ?? state.titles[observedKey(agent, session)] ?? state.titles[session] ?? null
}

export function isObservedArchived(state: ObservedViewState, agent: string, session: string, host?: string | null): boolean {
  return state.archived.includes(observedKey(agent, session, host))
    || state.archived.includes(observedKey(agent, session))
    || state.archived.includes(session)
}

export function renameObserved(state: ObservedViewState, agent: string, session: string, title: string, host?: string | null): ObservedViewState {
  const key = observedKey(agent, session, host)
  const titles = { ...state.titles }
  const next = cleanTitle(title)
  if (next) titles[key] = next
  else delete titles[key]
  return { ...state, titles }
}

export function setObservedArchived(state: ObservedViewState, agent: string, session: string, archived: boolean, host?: string | null): ObservedViewState {
  const key = observedKey(agent, session, host)
  const rest = state.archived.filter((id) => id !== key && id !== observedKey(agent, session) && id !== session)
  return { ...state, archived: archived ? [...rest, key] : rest }
}
