import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getTaskDetail,
  listDecisions,
  listProjects,
  listTasks,
  type Decision,
  type Project,
  type Task,
  type TaskDetail,
} from '../../adapters/runtime-client.ts'
import { skipWhileRunning } from '../../adapters/poll-gate.ts'
import { runtimeErrorText } from './runtime-error.ts'

export interface RuntimeOverview {
  tasks: Task[]
  projects: Project[]
  loading: boolean
  error: string | null
  refresh: () => void
}

/** Poll the runtime overview. The bridge is local, so a light 4s poll is cheaper
 *  and more predictable than opening one SSE stream per list on the Today page. */
export function useRuntimeOverview(intervalMs = 4000, enabled = true): RuntimeOverview {
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const mounted = useRef(true)

  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    const load = skipWhileRunning(async () => {
      try {
        const [nextTasks, nextProjects] = await Promise.all([listTasks(), listProjects()])
        if (disposed) return
        setTasks(nextTasks)
        setProjects(nextProjects)
        setError(null)
      } catch (cause) {
        if (disposed) return
        setError(runtimeErrorText(cause))
      } finally {
        if (!disposed) setLoading(false)
      }
    })
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, intervalMs)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [intervalMs, tick, enabled])

  return { tasks, projects, loading: enabled ? loading : false, error: enabled ? error : null, refresh }
}

export interface TaskDetailState {
  detail: TaskDetail | null
  loading: boolean
  error: string | null
  refresh: () => void
  applyDetail: (detail: TaskDetail) => void
}

export function useTaskDetail(taskId: string | null, intervalMs = 4000): TaskDetailState {
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [loading, setLoading] = useState(Boolean(taskId))
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const activeTaskId = useRef<string | null>(taskId || null)
  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    activeTaskId.current = taskId || null
    setDetail(null)
    setError(null)
    setLoading(Boolean(taskId))
    if (!taskId) return
    let disposed = false
    const load = skipWhileRunning(async () => {
      if (!taskId) return
      try {
        const next = await getTaskDetail(taskId)
        if (!disposed) { setDetail(next); setError(null) }
      } catch (cause) {
        if (!disposed) setError(runtimeErrorText(cause))
      } finally {
        if (!disposed) setLoading(false)
      }
    })
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, intervalMs)
    return () => {
      disposed = true
      window.clearInterval(timer)
      if (activeTaskId.current === taskId) activeTaskId.current = null
    }
  }, [taskId, intervalMs, tick])

  const applyDetail = useCallback((next: TaskDetail) => {
    if (next.task.id === activeTaskId.current) setDetail(next)
  }, [])
  return { detail, loading, error, refresh, applyDetail }
}

export interface PendingDecisionsState {
  decisions: Decision[]
  loading: boolean
  error: string | null
  refresh: () => void
}

/** Pending decision cards across every task. This is the data behind the Today
 *  banner, the pet popup and the "needs attention" counters. */
export function usePendingDecisions(intervalMs = 4000, enabled = true): PendingDecisionsState {
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((value) => value + 1), [])

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    const load = skipWhileRunning(async () => {
      try {
        const next = await listDecisions()
        if (disposed) return
        setDecisions(next)
        setError(null)
      } catch (cause) {
        if (disposed) return
        setError(runtimeErrorText(cause))
      } finally {
        if (!disposed) setLoading(false)
      }
    })
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, intervalMs)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [intervalMs, tick, enabled])

  return { decisions, loading: enabled ? loading : false, error: enabled ? error : null, refresh }
}
