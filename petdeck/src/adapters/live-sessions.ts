// Live-session overlay merge: real-time base (from SSE) + local edit overlays.
// Keeps rename/archive/delete/followUp working while the base refreshes live.
import type { Message, Session, SessionStatus } from '../flows/shared/types'

export interface SessionOverlay {
  title?: string
  status?: SessionStatus
  extraMessages?: Message[]
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