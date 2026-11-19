export type SendTask = () => Promise<void>

/** Acquire synchronously so a double click cannot enter a second request before React renders. */
export function createSerialSender() {
  let busy = false
  return {
    isBusy: () => busy,
    run: async (task: SendTask): Promise<boolean> => {
      if (busy) return false
      busy = true
      try {
        await task()
        return true
      } finally {
        busy = false
      }
    },
  }
}
