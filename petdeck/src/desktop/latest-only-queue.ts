export type AsyncTask = () => Promise<void>

/** Serialize native mutations and skip queued work that has already been superseded. */
export function createLatestOnlyQueue(): (task: AsyncTask) => Promise<void> {
  let revision = 0
  let tail: Promise<void> = Promise.resolve()
  return (task) => {
    const current = ++revision
    const run = tail.then(async () => {
      if (current !== revision) return
      await task()
    })
    tail = run.catch(() => {})
    return run
  }
}
