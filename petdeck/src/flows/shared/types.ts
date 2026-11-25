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
export type EventType = 'started' | 'done' | 'stuck' | 'decision' | 'relay-ready'

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

/** Agent 正在终端里等待回答的选择题（目前仅 Claude 的 AskUserQuestion）。
 *  observe 只读：桌宠可以展示并复制选项，真正的回答仍发生在终端里。 */
export interface AgentAskOption {
  label: string
  description?: string
}

export interface AgentAskQuestion {
  question: string
  header?: string
  multiSelect?: boolean
  options: AgentAskOption[]
}

export interface AgentAsk {
  toolUseId: string
  questions: AgentAskQuestion[]
}

/** Claude Notification hook 捕获到的等待信号（权限确认/空闲）。
 *  jsonl 里没有这类记录，只有 hook 能可靠区分「等确认」与「工具执行中」。 */
export interface AgentNotify {
  message: string
  type?: string
  at: number
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
  /** 账户级 5h 用量窗口（reset 倒计时，按最后活动推算=估）。仅 claude 等提供该数据的适配器有值。 */
  usageWindow?: UsageWindow
  /** SSH 远程主机别名；远程会话只读，不可接力/注入。 */
  host?: string
  stale?: boolean
  lastSeen?: number
  /** 终端里正在等待回答的问题；有值时桌宠展示选项而不是「正在工作」。 */
  ask?: AgentAsk
  /** Claude 权限确认/空闲等待的 hook 信号。 */
  notify?: AgentNotify
}

/** 5 小时滚动用量窗口（订阅限额口径，对标 petdash）。均为推算值，UI 必须标注「估」。 */
export interface UsageWindow {
  active: boolean
  blockStart: string | null
  resetAt: string | null
  minutesToReset: number
  windowTokens: TokenUsage
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
  agentId: string
  agentName: string
  projectName: string
  sessionTitle: string
  text: string
  timestamp: string
  handled: boolean
}
