import type { AgentStatus } from './types'
import { t } from '../../i18n/index.ts'
import type { MessageKey } from '../../i18n/messages.ts'

export const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: 'var(--color-primary)',
  thinking: 'var(--color-info)',
  running: 'var(--color-primary)',
  done: 'var(--color-success)',
  stuck: 'var(--color-warning)',
  offline: 'var(--color-text-secondary)',
}

export const STATUS_ORDER: AgentStatus[] = ['idle', 'thinking', 'running', 'done', 'stuck', 'offline']

const STATUS_KEY: Record<AgentStatus, MessageKey> = {
  idle: 'status.idle',
  thinking: 'status.thinking',
  running: 'status.running',
  done: 'status.done',
  stuck: 'status.stuck',
  offline: 'status.offline',
}

export function statusLabel(status: AgentStatus): string {
  return t(STATUS_KEY[status])
}
