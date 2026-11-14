// Re-entrancy gate for periodic ticks (client poll loop): while one invocation is
// still in flight, overlapping invocations are skipped instead of stacking up.
export function skipWhileRunning<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<R | undefined> {
  let running = false
  return async (...args: T) => {
    if (running) return undefined
    running = true
    try {
      return await fn(...args)
    } finally {
      running = false
    }
  }
}

/** Like skipWhileRunning, but an invocation that arrives while one is in flight is not
 *  lost: it is skipped immediately (returning undefined) and remembered; after the
 *  in-flight call settles, exactly one trailing invocation runs with the latest skipped
 *  args. Multiple overlapping calls collapse into a single trailing run — manual
 *  reconnects land promptly without ever stacking overlapping requests. */
export function skipWhileRunningTrailing<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<R | undefined> {
  let running = false
  let trailingArgs: T | null = null
  const wrapped = async (...args: T): Promise<R | undefined> => {
    if (running) {
      trailingArgs = args
      return undefined
    }
    running = true
    try {
      return await fn(...args)
    } finally {
      running = false
      if (trailingArgs) {
        const next = trailingArgs
        trailingArgs = null
        // Fire-and-forget: the skipped caller is gone, so a trailing rejection has no
        // awaiter; fn is expected to handle its own errors (the client tick does).
        void wrapped(...next).catch(() => {})
      }
    }
  }
  return wrapped
}
