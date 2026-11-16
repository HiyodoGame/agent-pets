// =============================================
// Agent Pets (petdeck) — Shared Domain Types
// 所有 flow 共用的数据类型。
// ⚠️ 本文件只 export type/interface —— 消费方必须用 `import type`。
// =============================================

/** Agent 形态：决定接入方式（spike 能力分级的载体） */
export type AgentForm = 'cli' | 'desktop' | 'web'

/** 集成能力分级：full=API 双向 / observe-only=读状态+剪贴板辅助注入 / manual=手动 check-in */
export type CapabilityTier = 'full' | 'observe-only' | 'manual'

/** Agent 四态 + 空闲/离线（动效策略：思考/运行/完成/卡住） */
export type AgentStatus = 'idle' | 'thinking' | 'running' | 'done' | 'stuck' | 'offline'

export type SessionStatus = 'active' | 'waiting' | 'done' | 'stuck' | 'archived'

export type MessageRole = 'user' | 'agent' | 'system'

export type ArtifactKind = 'image' | 'file' | 'text' | 'code'

/** 宠物轻拍事件类型 */
export type EventType = 'done' | 'stuck' | 'decision' | 'relay-ready'

export type RelayStatus = 'draft' | 'sending' | 'sent' | 'failed'

export interface Agent {
  id: string
  name: string
  form: AgentForm
  capability: CapabilityTier
  status: AgentStatus
  projectIds: string[]
}

export interface Artifact {
  id: string
  name: string
  kind: ArtifactKind
  size: string
  fromSessionId: string
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  timestamp: string
  artifactIds: string[]
}

/** 用量（成本 MVP）。input/output/cacheRead = 分项聚合（claude/zcode）；
 *  total = 仅累计值（kimi）。字段按来源可选——没有的数据不得伪造为 0。 */
export interface TokenUsage {
  input?: number
  output?: number
  cacheRead?: number
  total?: number
}

export interface Session {
  id: string
  projectId: string
  agentId: string
  title: string
  status: SessionStatus
  messages: Message[]
  artifactIds: string[]
  updatedAt: string
  tokens?: TokenUsage
  stale?: boolean
  lastSeen?: number
}

export interface Project {
  id: string
  name: string
  description: string
  sessionIds: string[]
  updatedAt: string
}

export interface PetEvent {
  id: string
  type: EventType
  projectId: string
  sessionId: string
  text: string
  timestamp: string
  handled: boolean
}

/** 接力交接草稿：宠物自动打包的上下文+产物+指令 */
export interface RelayDraft {
  id: string
  sourceSessionId: string
  targetAgentId: string
  contextSummary: string
  instruction: string
  artifactIds: string[]
  status: RelayStatus
}

/** 接入 flow 的 Agent 目录条目 */
export interface AgentCatalogEntry {
  id: string
  name: string
  form: AgentForm
  capability: CapabilityTier
  detectHint: string
  supported: boolean
}