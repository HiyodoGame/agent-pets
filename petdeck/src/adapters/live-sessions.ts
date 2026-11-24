// Live-session overlay merge: real-time base (from SSE) + local edit overlays.
// Keeps rename/archive/delete/followUp working while the base refreshes live.
import type { Message, Session, SessionStatus } from '../flows/shared/types'

export interface SessionOverlay {
  title?: string
  status?: SessionStatus
  extraMessages?: Message[]
}

export interface PanelViewState {
  overlays: Record<string, SessionOverlay>
  deleted: string[]
}

const PANEL_VIEW_KEY = 'petdeck.panel.view.v1'
type ViewStorage = Pick<Storage, 'getItem' | 'setItem'> | null

/** Rename/archive/hide are PetDeck presentation choices, not transcript deletion.
 *  Persist only those choices; transient follow-up message overlays are not re-read. */
export function loadPanelViewState(storage: ViewStorage): PanelViewState {
  if (!storage) return { overlays: {}, deleted: [] }
  try {
    const raw = JSON.parse(storage.getItem(PANEL_VIEW_KEY) ?? 'null') as {
      overlays?: Record<string, { title?: unknown; status?: unknown }>
      deleted?: unknown
    }
    const overlays: Record<string, SessionOverlay> = {}
    if (raw?.overlays && typeof raw.overlays === 'object' && !Array.isArray(raw.overlays)) {
      for (const [id, value] of Object.entries(raw.overlays).slice(0, 200)) {
        if (!value || typeof value !== 'object') continue
        const overlay: SessionOverlay = {}
        if (typeof value.title === 'string' && value.title.trim()) overlay.title = value.title.slice(0, 500)
        if (value.status === 'archived') overlay.status = 'archived'
        if (Object.keys(overlay).length) overlays[id] = overlay
      }
    }
    const deleted = Array.isArray(raw?.deleted)
      ? raw.deleted.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0).slice(0, 200)
      : []
    return { overlays, deleted: [...new Set(deleted)] }
  } catch {
    return { overlays: {}, deleted: [] }
  }
}

export function savePanelViewState(storage: ViewStorage, state: PanelViewState): void {
  if (!storage) return
  const overlays = Object.fromEntries(
    Object.entries(state.overlays).slice(0, 200).map(([id, overlay]) => [id, {
      ...(typeof overlay.title === 'string' ? { title: overlay.title.slice(0, 500) } : {}),
      ...(overlay.status === 'archived' ? { status: 'archived' as const } : {}),
    }]).filter(([, overlay]) => Object.keys(overlay).length > 0),
  )
  try { storage.setItem(PANEL_VIEW_KEY, JSON.stringify({ overlays, deleted: state.deleted.slice(0, 200) })) }
  catch { /* storage-disabled/private contexts keep in-memory behavior */ }
}

export function mergeSessions(
  base: Session[],
  overlays: Record<string, SessionOverlay>,
  deleted: string[],
): Session[] {
  const del = new Set(deleted)
  return base
    .filter((s) => !del.has(s.id))
    .map((s) => {
      const o = overlays[s.id]
      if (!o) return s
      return {
        ...s,
        title: o.title ?? s.title,
        status: o.status ?? s.status,
        messages: o.extraMessages ? [...s.messages, ...o.extraMessages] : s.messages,
      }
    })
}