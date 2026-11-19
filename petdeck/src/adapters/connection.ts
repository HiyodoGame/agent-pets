// Connection state machine (pure): bridge health + SSE liveness -> display state.
// Demo mode is an independent switch and never enters this machine.

export type ConnState = 'live' | 'reconnecting' | 'offline'
export type ConnEvent = { type: 'health'; ok: boolean } | { type: 'sse'; open: boolean }
export interface ConnSnapshot { state: ConnState; fails: number }

export const FAILS_TO_OFFLINE = 2

export function nextConnState(prev: ConnSnapshot, ev: ConnEvent): ConnSnapshot {
  if (ev.type === 'health') {
    if (ev.ok) return { state: 'live', fails: 0 }
    const fails = Math.min(prev.fails + 1, FAILS_TO_OFFLINE)
    return { state: fails >= FAILS_TO_OFFLINE ? 'offline' : 'reconnecting', fails }
  }
  if (ev.open) return { state: 'live', fails: 0 }
  return prev.state === 'offline' ? prev : { state: 'reconnecting', fails: prev.fails }
}

/** Demo data is self-contained and must not inherit an unrelated offline bridge state. */
export function visibleConnState(demo: boolean, state: ConnState): ConnState {
  return demo ? 'live' : state
}