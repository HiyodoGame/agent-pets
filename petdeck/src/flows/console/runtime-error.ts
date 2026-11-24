// User-facing copy for runtime/bridge failures. Raw Error.message is English and
// often a transport string ("Failed to fetch"); map known shapes and codes, and fall
// back to a localized generic message instead of leaking engine text.
import { RuntimeClientError } from '../../adapters/runtime-client.ts'
import { t } from '../../i18n/index.ts'
import type { MessageKey } from '../../i18n/messages.ts'

const CODE_KEYS: Record<string, MessageKey> = {
  INVALID_INPUT: 'console.error.invalidInput',
  BODY_TOO_LARGE: 'console.error.invalidInput',
  TASK_RUNNING: 'console.error.taskRunning',
  TASK_AWAITING_REVIEW: 'console.error.taskAwaitingReview',
  TASK_WORKTREE_DIRTY: 'console.error.taskWorktreeDirty',
  MERGE_CONFLICT: 'console.error.mergeConflict',
  MERGE_DIRTY: 'console.error.mergeDirty',
  MERGE_WRONG_BRANCH: 'console.error.mergeWrongBranch',
  MERGE_TOKEN_INVALID: 'console.error.mergeToken',
  MERGE_TOKEN_EXPIRED: 'console.error.mergeToken',
  DEPENDENCY_NOT_MET: 'console.error.dependencyNotMet',
  NO_SESSION: 'console.error.noSession',
  CLEANUP_FAILED: 'console.error.cleanupFailed',
  TASK_BRANCH_UNMERGED: 'console.error.branchUnmerged',
  MANAGER_NOT_CONFIGURED: 'console.error.managerNotConfigured',
  ARTIFACT_INVALID: 'console.error.artifactInvalid',
}

export interface RuntimeErrorInfo {
  key: MessageKey
  code: string | null
  retryable: boolean
}

export function runtimeErrorInfo(cause: unknown): RuntimeErrorInfo {
  if (cause instanceof RuntimeClientError) {
    if (cause.status === 0 || cause.code === 'NETWORK') return { key: 'console.error.runtimeOffline', code: cause.code, retryable: true }
    if (cause.code === 'TIMEOUT') return { key: 'console.error.runtimeTimeout', code: cause.code, retryable: true }
    if (cause.status === 401 || cause.status === 403) return { key: 'console.error.runtimeAuth', code: cause.code, retryable: true }
    if (cause.status >= 500) return { key: 'console.error.runtimeServer', code: cause.code, retryable: true }
    const mapped = CODE_KEYS[cause.code]
    if (mapped) return { key: mapped, code: cause.code, retryable: false }
    return { key: 'console.error.unknown', code: cause.code, retryable: true }
  }
  if (cause instanceof Error && /failed to fetch|networkerror|load failed|err_connection/i.test(cause.message)) {
    return { key: 'console.error.runtimeOffline', code: 'NETWORK', retryable: true }
  }
  return { key: 'console.error.unknown', code: null, retryable: true }
}

export function runtimeErrorText(cause: unknown): string {
  return t(runtimeErrorInfo(cause).key)
}
