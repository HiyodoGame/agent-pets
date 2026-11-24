export interface TaskRequestStamp {
  taskId: string
  revision: number
}

/** A response may commit only while both its task and effect generation are current. */
export function shouldCommitTaskRequest(
  request: TaskRequestStamp,
  currentTaskId: string | null,
  currentRevision: number,
): boolean {
  return request.taskId === currentTaskId && request.revision === currentRevision
}
