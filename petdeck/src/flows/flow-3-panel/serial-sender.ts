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
        // An inject already accepted by the bridge cannot be recalled by returning to
        // the editor. Only its real completion may unlock another attempt.
        busy = false
      }
    },
  }
}
