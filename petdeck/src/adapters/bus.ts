// Client-side unified event bus: replay buffer + live fan-out.
// Pure logic, unit-tested in logic.test.ts.

export interface BusEvent {
  id: string
  type: string
  text: string
  [k: string]: unknown
}

export interface EventBus<E extends BusEvent = BusEvent> {
  emit(e: E): void
  subscribe(fn: (e: E) => void): () => void
  snapshot(): E[]
}

export function createEventBus<E extends BusEvent = BusEvent>(cap = 50): EventBus<E> {
  const subs = new Set<(e: E) => void>()
  const replay: E[] = []
  return {
    emit(e: E) {
      replay.push(e)
      if (replay.length > cap) replay.shift()
      for (const fn of subs) fn(e)
    },
    subscribe(fn: (e: E) => void) {
      for (const e of [...replay]) fn(e)
      subs.add(fn)
      return () => {
        subs.delete(fn)
      }
    },
    snapshot() {
      return [...replay]
    },
  }
}