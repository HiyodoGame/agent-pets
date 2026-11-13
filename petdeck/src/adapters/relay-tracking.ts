// Derive Flow4 relay tracking status from the live SSE agent-event stream.
import type { RawAgentEvent } from './types'

export type TrackingStatus = 'sending' | 'running' | 'done' | 'stuck'

/** events are newest-first; only the target agent's latest event matters. */
export function deriveTracking(events: RawAgentEvent[], targetAgentId: string): TrackingStatus {
  const latest = events.find((e) => e.agentId === targetAgentId)
  if (!latest) return 'sending'
  if (latest.type === 'task_complete') return 'done'
  if (latest.type === 'turn_aborted') return 'stuck'
  if (latest.type === 'task_started') return 'running'
  return 'sending'
}