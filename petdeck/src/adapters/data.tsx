// Data-source seam: live bridge with offline cache + partial-sync freshness.
// Demo data only via explicit `demo` prop — never an automatic fallback.
// Only exports the provider component; context/hook live in pet-data-context.ts.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Agent, PetEvent, Project, Session } from '../flows/shared/types'
import { mockPetData } from './mock-adapter'
import { fetchAgents, fetchHealth, fetchSessions, inject as bridgeInject, subscribeEvents } from './bridge-client'
import { selectSource, injectOrClipboard } from './registry'
import { PetDataCtx, type PetDataContextValue } from './pet-data-context'
import { nextConnState, type ConnSnapshot } from './connection'
import { skipWhileRunningTrailing } from './poll-gate'
import { loadSnapshot, saveSnapshot, type SnapshotStorage } from './snapshot-cache'
import { createDeduper } from './event-dedup'
import { shouldCommitHttp, shouldLoadSnapshot, observedToSessions } from './data-sync'
import { track, EVENT } from '../telemetry'
import type { ObservedSession, PetData, RawAgentEvent } from './types'

function liveProjects(sessions: Session[]): Project[] {
  return [{ id: 'live', name: '实时 Agent', description: '来自本地 bridge 的真实会话', sessionIds: sessions.map((s) => s.id), updatedAt: new Date().toISOString() }]
}

function emptyLive(): PetData {
  return { mode: 'live', agents: [], projects: [], sessions: [], events: [], artifacts: [] }
}

function browserStorage(): SnapshotStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function DataSourceProvider({ demo = false, children }: { demo?: boolean; children: ReactNode }) {
  const [data, setData] = useState<PetData>(emptyLive)
  const [agentEvents, setAgentEvents] = useState<RawAgentEvent[]>([])
  const [conn, setConn] = useState<ConnSnapshot>({ state: 'reconnecting', fails: 0 })
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const eventsRef = useRef<PetEvent[]>([])
  const dedupRef = useRef(createDeduper(500))
  const savedKeyRef = useRef('')
  const cacheShownRef = useRef(false)
  const tickRef = useRef<() => void>(() => {})
  const prevConnRef = useRef(conn.state)
  const revRef = useRef(0)
  const hasMemoryRef = useRef(false)
  const lastAgentsRef = useRef<Agent[]>([])
  const mockData = useMemo(() => mockPetData(), [])

  useEffect(() => {
    if (selectSource(demo) === 'mock') return
    let alive = true
    let un: (() => void) | null = null
    const storage = browserStorage()
    // Single commit path for real sessions: writes state + snapshot, bumps the revision
    // so an in-flight HTTP tick (whose response is now older) can detect and skip.
    const commit = (rows: ObservedSession[], agents?: Agent[]) => {
      const sessions = observedToSessions(rows, new Date().toISOString())
      hasMemoryRef.current = true
      if (agents) lastAgentsRef.current = agents
      setData((prev) => ({ mode: 'live', agents: agents ?? prev.agents, projects: liveProjects(sessions), sessions, events: eventsRef.current, artifacts: prev.artifacts }))
      revRef.current++
      const key = JSON.stringify(rows)
      if (key !== savedKeyRef.current) {
        savedKeyRef.current = key
        saveSnapshot(storage, { sessions: rows, agents: lastAgentsRef.current }, Date.now())
      }
    }
    // Trailing gate: a manual reconnect during an in-flight tick is skipped but
    // remembered, then re-run once after the tick settles — never lost, never stacked.
    const tick = skipWhileRunningTrailing(async () => {
      const healthy = await fetchHealth()
      if (!alive) return
      setConn((prev) => nextConnState(prev, { type: 'health', ok: healthy }))
      if (healthy) {
        cacheShownRef.current = false
        const revBefore = revRef.current
        let agents: Agent[]
        let rows: ObservedSession[]
        try {
          ;[agents, rows] = await Promise.all([fetchAgents(), fetchSessions()])
        } catch {
          // Timed-out or failed fetches count as a connection failure, not an
          // unhandled rejection in the 5s loop.
          if (!alive) return
          setConn((prev) => nextConnState(prev, { type: 'health', ok: false }))
          return
        }
        if (!alive) return
        // A fresher SSE commit landed while this HTTP request was in flight => response is stale, skip.
        if (!shouldCommitHttp(revBefore, revRef.current)) return
        commit(rows, agents)
        setSavedAt(null)
        if (!un) {
          un = subscribeEvents((e) => {
            if (e.type === 'sessions' || e.petType === 'sessions') {
              const sseRows = (e.payload as { sessions?: ObservedSession[] })?.sessions ?? []
              commit(sseRows)
              return
            }
            const raw: RawAgentEvent = {
              id: String(e.id ?? Date.now()),
              agentId: String(e.agentId ?? ''),
              type: String(e.type ?? ''),
              ts: Number(e.ts ?? Date.now()),
              sessionId: String(e.sessionId ?? ''),
            }
            if (!dedupRef.current.seen(raw.id)) return
            setAgentEvents((prev) => [raw, ...prev].slice(0, 100))
            const pt = e.petType as string
            if (pt) {
              eventsRef.current = [{
                id: raw.id,
                type: pt as PetEvent['type'],
                projectId: 'live',
                sessionId: String(e.sessionId ?? ''),
                text: String((e.payload as { lastMessage?: string })?.lastMessage ?? ''),
                timestamp: new Date().toISOString(),
                handled: false,
              }, ...eventsRef.current].slice(0, 50)
              setData((prev) => ({ ...prev, events: eventsRef.current }))
            }
          }, {
            onOpen: () => { setConn((prev) => nextConnState(prev, { type: 'sse', open: true })); tickRef.current() },
            onError: () => { setConn((prev) => nextConnState(prev, { type: 'sse', open: false })) },
          })
        }
      } else if (shouldLoadSnapshot(hasMemoryRef.current, cacheShownRef.current)) {
        // 断连：保留内存 last-good；仅冷启动且无内存数据时才读磁盘快照。
        cacheShownRef.current = true
        const cached = loadSnapshot(storage)
        if (cached) {
          commit(cached.sessions, cached.agents)
          setSavedAt(cached.savedAt)
        }
      }
    })
    tickRef.current = () => { void tick() }
    void tick()
    const t = setInterval(() => { void tick() }, 5000)
    return () => { alive = false; clearInterval(t); if (un) un() }
  }, [demo])

  // 连接状态迁移埋点（行为-only，无内容字段）
  useEffect(() => {
    const prev = prevConnRef.current
    if (conn.state === 'offline' && prev !== 'offline') track('shell', EVENT.offlineEntered, { fails: conn.fails })
    if (conn.state === 'live' && prev === 'offline') track('shell', EVENT.connectionRecovered)
    prevConnRef.current = conn.state
  }, [conn.state, conn.fails])

  const shown = demo ? mockData : data
  // unhandledEvents 结果在同一 shown.events 上保持引用稳定，避免消费方 effect 因每次
  // render 新建数组而空转（水位线语义不变：值相同，只是不再无谓重算）。
  const value = useMemo<PetDataContextValue>(() => {
    const unhandled = shown.events.filter((e) => !e.handled)
    return ({
    ...shown,
    getAgent: (id) => shown.agents.find((a) => a.id === id),
    getProject: (id) => shown.projects.find((p) => p.id === id),
    getSession: (id) => shown.sessions.find((s) => s.id === id),
    getArtifact: (id) => shown.artifacts.find((a) => a.id === id),
    sessionsOfProject: (pid) => shown.sessions.filter((s) => s.projectId === pid),
    unhandledEvents: () => unhandled,
    agentEvents,
    connState: conn.state,
    savedAt,
    reconnect: () => tickRef.current(),
    inject: (p) => injectOrClipboard(p, shown.mode === 'live', bridgeInject),
  })}, [shown, agentEvents, conn.state, savedAt])

  return <PetDataCtx.Provider value={value}>{children}</PetDataCtx.Provider>
}