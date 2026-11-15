import type { AgentStatus } from './types'

export const STATUS_COLOR: Record<AgentStatus, string> = {
  idle: 'var(--color-primary)',
  thinking: 'var(--color-info)',
  running: 'var(--color-primary)',
  done: 'var(--color-success)',
  stuck: 'var(--color-warning)',
  offline: 'var(--color-text-secondary)',
}

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: '空闲',
  thinking: '思考中',
  running: '运行中',
  done: '已完成',
  stuck: '待处理',
  offline: '离线',
}
