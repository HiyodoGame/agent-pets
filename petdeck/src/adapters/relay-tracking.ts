// Derive Flow4 relay tracking status from the live SSE agent-event stream,
// scoped to THIS attempt (target agent + returned session id + send time).
import type { RawAgentEvent } from './types'

export type TrackingStatus = 'sending' | 'running' | 'done' | 'stuck' | 'unconfirmed'

export interface TrackingScope {
  /** Target session id returned by inject; empty/undefined => not correlatable. */
  sessionId?: string
  /** Attempt start (epoch ms); events with ts < this are ignored (kills history/replay). */
  startedAt?: number
}

/**
 * events are newest-first. Only events belonging to this attempt count:
 * same agent, at/after start, and — when the adapter gave us a session id — same session.
 * Without a correlatable session id the attempt is 'unconfirmed' from the very start
 * (never presented as auto-completable); a completion without a session id is likewise
 * 'unconfirmed', never a false 'done'.
 */
export function deriveTracking(events: RawAgentEvent[], targetAgentId: string, scope: TrackingScope = {}): TrackingStatus {
  const { sessionId, startedAt } = scope
  const hasSession = sessionId != null && sessionId !== ''
  let scoped = events.filter((e) => e.agentId === targetAgentId)
  if (startedAt != null) scoped = scoped.filter((e) => e.ts >= startedAt)
  if (hasSession) scoped = scoped.filter((e) => e.sessionId === sessionId)
  const latest = scoped[0]
  // An attempt that can never be correlated (adapter gave no session id) is
  // unconfirmed from the start — never presented as auto-completable.
  if (!latest) return hasSession || startedAt == null ? 'sending' : 'unconfirmed'
  switch (latest.type) {
    case 'task_complete': return hasSession ? 'done' : 'unconfirmed'
    case 'turn_aborted': return hasSession ? 'stuck' : 'unconfirmed'
    case 'task_started': return 'running'
    default: return 'running' // an in-flight (unknown-kind) event implies running, never downgrade to sending
  }
}