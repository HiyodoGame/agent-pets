// Adapter-layer contracts (frontend). Domain types live in flows/shared/types.
import type { Agent, Artifact, CapabilityTier, PetEvent, Project, Session, TokenUsage, UsageWindow } from '../flows/shared/types'

/** Unified observe row emitted by every server adapter. */
export interface ObservedSession {
  agent: string
  source: string
  session: string
  status: string
  lastMessage: string
  cwd?: string
  turn?: string
  title?: string
  tokens?: TokenUsage
  usageWindow?: UsageWindow
  /** SSH 远程主机的别名（本地会话为空）。远程会话只读，不可接力/注入。 */
  host?: string
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
  /** 交接产物显示名（Flow4 取产物文件名），随 prompt / 交接包一并传递。 */
  artifacts?: string[]
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
  /** 降级原因：tier=能力分级 / cli=目标 CLI 拒绝（server tiers.injectDecision 填充）；
   *  bridge-error=桥不可达或抛错（bridge 500 响应与前端 injectOrClipboard catch 填充）。 */
  fallbackReason?: 'tier' | 'cli' | 'bridge-error'
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