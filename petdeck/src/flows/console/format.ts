import type { Task, TaskStatus } from '../../adapters/runtime-client.ts'
import type { Locale } from '../../i18n/index.ts'

export const TASK_STATUS_ORDER: TaskStatus[] = ['running', 'queued', 'review', 'pending_merge', 'waiting', 'paused', 'ready', 'merged', 'completed', 'failed', 'stopped']

export function isFinished(status: TaskStatus): boolean {
  return status === 'merged' || status === 'completed' || status === 'failed' || status === 'stopped'
}

export function formatRelative(ts: number, locale: Locale): string {
  const diff = Date.now() - ts
  const rtf = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { numeric: 'auto' })
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (Math.abs(diff) < minute) return locale === 'zh' ? '刚刚' : 'just now'
  if (Math.abs(diff) < hour) return rtf.format(-Math.round(diff / minute), 'minute')
  if (Math.abs(diff) < day) return rtf.format(-Math.round(diff / hour), 'hour')
  if (Math.abs(diff) < 7 * day) return rtf.format(-Math.round(diff / day), 'day')
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}

export function formatClock(ts: number | null, locale: Locale): string {
  if (!ts) return '—'
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(ts))
}

export function formatDuration(start: number, end: number | null): string {
  if (!end) return '—'
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes >= 60) return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm'
  if (minutes > 0) return minutes + 'm ' + String(rest).padStart(2, '0') + 's'
  return seconds + 's'
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
}

export function formatMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—'
  return formatDuration(0, Math.max(0, ms))
}

export function shortPath(path: string | null, max = 48): string {
  if (!path) return '—'
  if (path.length <= max) return path
  return path.slice(0, Math.ceil(max / 2) - 1) + '…' + path.slice(-Math.floor(max / 2))
}

export function summarizeToolInput(input: unknown): string {
  if (input === null || input === undefined) return ''
  if (typeof input === 'string') return input
  try {
    const text = JSON.stringify(input, null, 2)
    return text.length > 1200 ? text.slice(0, 1200) + '…' : text
  } catch {
    return String(input)
  }
}

export function eventText(payload: Record<string, unknown>, key: string): string {
  const value = payload[key]
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try { return JSON.stringify(value, null, 2) } catch { return String(value) }
}

export function groupTasks(tasks: Task[]): { active: Task[]; queued: Task[]; attention: Task[]; finished: Task[] } {
  return {
    active: tasks.filter((task) => task.status === 'running' || task.status === 'paused'),
    queued: tasks.filter((task) => task.status === 'ready' || task.status === 'queued'),
    attention: tasks.filter((task) => task.status === 'waiting' || task.status === 'failed' || task.status === 'review' || task.status === 'pending_merge'),
    finished: tasks.filter((task) => task.status === 'completed' || task.status === 'merged' || task.status === 'stopped'),
  }
}
