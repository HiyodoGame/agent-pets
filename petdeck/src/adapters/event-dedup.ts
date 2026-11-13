// Id-based dedup for SSE replay: bridge bus re-subscribe replays recent events.
export function createDeduper(cap = 500): { seen(id: string): boolean } {
  const set = new Set<string>()
  const order: string[] = []
  return {
    seen(id) {
      if (set.has(id)) return false
      set.add(id)
      order.push(id)
      if (order.length > cap) {
        const old = order.shift()
        if (old !== undefined) set.delete(old)
      }
      return true
    },
  }
}