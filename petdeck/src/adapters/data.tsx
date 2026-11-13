// Data-source seam: live bridge when healthy, mock fallback otherwise.
// Only exports the provider component; context/hook live in pet-data-context.ts.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PetEvent, Session } from '../flows/shared/types'
import { mockPetData } from './mock-adapter'
import { fetchAgents, fetchHealth, fetchSessions, inject as bridgeInject, subscribeEvents } from './bridge-client'
import { selectSource } from './registry'
import { PetDataCtx, type PetDataContextValue } from './pet-data-context'
import type { ObservedSession, PetData, RawAgentEvent } from './types'

const STATUS_MAP: Record<string, Session['status']> = {
  done: 'done', running: 'active', stuck: 'stuck', waiting: 'waiting', unknown: 'active',
}

function observedToSessions(rows: ObservedSession[]): Session[] {
  return rows.map((r) => ({
    id: `${r.agent}:${r.session}`,
    projectId: 'live',
    agentId: r.agent,
    title: r.lastMessage || r.session,
    status: STATUS_MAP[r.status] ?? 'active',
    messages: r.lastMessage
      ? [{ id: `${r.session}-m`, role: 'agent' as const, content: r.lastMessage, timestamp: new Date().toISOString(), artifactIds: [] }]
      : [],
    artifactIds: [],
    updatedAt: new Date().toISOString(),
  }))
}

export function DataSourceProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<PetData>(() => mockPetData())
  const [agentEvents, setAgentEvents] = useState<RawAgentEvent[]>([])
  const eventsRef = useRef<PetEvent[]>([])

  useEffect(() => {
    let alive = true
    let un: (() => void) | null = null
    const tick = async () => {
      const healthy = await fetchHealth()
      if (!alive) return
      const mode = selectSource(healthy)
      if (mode === 'mock') { setData(mockPetData()); return }
      const [agents, rows] = await Promise.all([fetchAgents(), fetchSessions()])
      if (!alive) return
      const sessions = observedToSessions(rows)
      setData({
        mode: 'live',
        agents,
        projects: [{ id: 'live', name: '实时 Agent', description: '来自本地 bridge 的真实会话', sessionIds: sessions.map((s) => s.id), updatedAt: new Date().toISOString() }],
        sessions,
        events: eventsRef.current,
        artifacts: [],
      })
      if (!un) un = subscribeEvents((e) => {
        if (e.type === 'sessions' || e.petType === 'sessions') {
          const rows = (e.payload as { sessions?: ObservedSession[] })?.sessions ?? []
          setData((prev) => (prev.mode === 'live' ? { ...prev, sessions: observedToSessions(rows) } : prev))
          return
        }
        const raw: RawAgentEvent = { id: String(e.id ?? Date.now()), agentId: String(e.agentId ?? ''), type: String(e.type ?? ''), ts: Date.now() }
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
          setData((prev) => (prev.mode === 'live' ? { ...prev, events: eventsRef.current } : prev))
        }
      })
    }
    tick()
    const t = setInterval(tick, 5000)
    return () => { alive = false; clearInterval(t); if (un) un() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<PetDataContextValue>(() => ({
    ...data,
    getAgent: (id) => data.agents.find((a) => a.id === id),
    getProject: (id) => data.projects.find((p) => p.id === id),
    getSession: (id) => data.sessions.find((s) => s.id === id),
    getArtifact: (id) => data.artifacts.find((a) => a.id === id),
    sessionsOfProject: (pid) => data.sessions.filter((s) => s.projectId === pid),
    unhandledEvents: () => data.events.filter((e) => !e.handled),
    agentEvents,
    inject: async (p) => {
      if (data.mode === 'live') return bridgeInject(p)
      return { mode: 'clipboard', package: `Relay handoff package:\n${p.context ?? ''}\n${p.instruction ?? ''}` }
    },
  }), [data, agentEvents])

  return <PetDataCtx.Provider value={value}>{children}</PetDataCtx.Provider>
}