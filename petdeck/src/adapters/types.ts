// Adapter-layer contracts (frontend). Domain types live in flows/shared/types.
import type { Agent, Artifact, CapabilityTier, PetEvent, Project, Session } from '../flows/shared/types'

/** Unified observe row emitted by every server adapter. */
export interface ObservedSession {
  agent: string
  source: string
  session: string
  status: string
  lastMessage: string
  cwd?: string
  turn?: string
  stale?: boolean
  lastSeen?: number
}

/** Raw bus event (newest-first) used to derive relay tracking status. */
export interface RawAgentEvent {
  id: string
  agentId: string
  type: string
  ts: number
  sessionId?: string
}

export interface InjectPayload {
  from?: string
  to: string
  context?: string
  instruction?: string
}

export interface InjectResult {
  ok: boolean
  response: string
  sessionID?: string
}

export interface InjectDecision {
  mode: 'inject' | 'clipboard'
  response?: string
  sessionID?: string
  package?: string
}

/** The contract every agent adapter implements (server + frontend facade). */
export interface AgentAdapter {
  id: string
  name: string
  tier: CapabilityTier
  observe(): Promise<ObservedSession[]>
  inject(p: InjectPayload): Promise<InjectResult>
}

/** Everything the UI consumes, from live bridge or mock fallback. */
export interface PetData {
  mode: 'live' | 'mock'
  agents: Agent[]
  projects: Project[]
  sessions: Session[]
  events: PetEvent[]
  artifacts: Artifact[]
}