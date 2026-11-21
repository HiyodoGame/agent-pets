// In-process event fan-out for runtime SSE subscribers. Persistence is the
// service's job; this bus is intentionally tiny and lossy for slow consumers.
export function createRuntimeEventBus() {
  const subscribers = new Set();
  return {
    publish(event) {
      for (const fn of subscribers) {
        try { fn(event); } catch { /* a broken subscriber must not affect the run */ }
      }
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    get size() { return subscribers.size; },
  };
}
