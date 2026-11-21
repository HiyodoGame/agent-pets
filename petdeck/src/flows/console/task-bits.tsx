import type { ReactNode } from 'react'
import type { Task, TaskStatus } from '../../adapters/runtime-client.ts'
import { t } from '../../i18n/index.ts'

const STATUS_KEY: Record<TaskStatus, string> = {
  ready: 'console.status.ready',
  queued: 'console.status.queued',
  running: 'console.status.running',
  waiting: 'console.status.waiting',
  paused: 'console.status.paused',
  review: 'console.status.review',
  pending_merge: 'console.status.pending_merge',
  merged: 'console.status.merged',
  completed: 'console.status.completed',
  failed: 'console.status.failed',
  stopped: 'console.status.stopped',
}

export function statusLabel(status: TaskStatus): string {
  return t(STATUS_KEY[status] as Parameters<typeof t>[0])
}

export function TaskStatusBadge({ status, active = false }: { status: TaskStatus; active?: boolean }) {
  const pulsing = active || status === 'running' || status === 'waiting' || status === 'review' || status === 'pending_merge'
  return (
    <span className="task-status" data-status={status}>
      <span className="task-status-dot" aria-hidden="true" />
      {statusLabel(status)}
      {pulsing ? <span className="task-status-pulse" aria-hidden="true" /> : null}
    </span>
  )
}

export function TaskRow({ task, selected, onSelect }: { task: Task; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`task-row${selected ? ' is-selected' : ''}`} onClick={onSelect} aria-current={selected}>
      <span className="task-row-top">
        <span className="task-row-title">{task.title}</span>
        <TaskStatusBadge status={task.status} />
      </span>
      <span className="task-row-meta">
        <span>{task.project_name ?? task.project_id.slice(0, 8)}</span>
        <span aria-hidden="true">·</span>
        <span>{task.agent}</span>
      </span>
    </button>
  )
}

export function EmptyState({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon" aria-hidden="true">{icon}</div>
      <h3>{title}</h3>
      <p>{body}</p>
      {children ? <div className="empty-state-actions">{children}</div> : null}
    </div>
  )
}
