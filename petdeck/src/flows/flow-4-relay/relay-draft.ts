// Pure relay-draft logic for Flow4: build from a REAL source session, resolve the
// target from REAL agents, and gate sending. No mock fallbacks in live mode.
import type { Agent, RelayDraft, Session } from '../shared/types'

/** Context summary = last agent message, else the session title. */
export function summarizeSource(source: Session): string {
  const agentMsgs = source.messages.filter((m) => m.role === 'agent')
  const last = agentMsgs[agentMsgs.length - 1]
  return last?.content?.trim() || source.title || ''
}

/**
 * Build a live relay draft from the selected source session.
 * Returns null when there is no real source (live mode) — caller must NOT substitute mock data.
 */
export function buildRelayDraft(source: Session | null | undefined, agents: Agent[]): RelayDraft | null {
  if (!source) return null
  const target = agents.find((a) => a.id !== source.agentId)
  return {
    id: `rd-live-${source.id}`,
    sourceSessionId: source.id,
    targetAgentId: target?.id ?? '',
    contextSummary: summarizeSource(source),
    instruction: '',
    artifactIds: [...source.artifactIds],
    status: 'draft',
  }
}

/** Resolve the chosen target from the real agent list; null => not sendable (never falls back). */
export function resolveTarget(draft: RelayDraft, agents: Agent[]): Agent | null {
  return agents.find((a) => a.id === draft.targetAgentId) ?? null
}

/** Sending requires a real source, a resolvable target, and a non-empty instruction. */
export function canSend(draft: RelayDraft, target: Agent | null, source: Session | null | undefined): boolean {
  return Boolean(source) && Boolean(target) && draft.instruction.trim().length > 0
}

/** Flow4 发送状态。'pending' 仅在注入进行中使用。 */
export type RelaySendState = 'pending' | 'injected' | 'manual' | 'failed'

/**
 * 注入响应 -> 发送状态：仅 mode === 'inject' 算注入成功；'clipboard' 为手动交接；
 * 任何其它值（含 undefined，例如 bridge 错误体被误传）一律 failed —— 绝不假成功。
 */
export function sendStateFromDecision(mode: unknown): RelaySendState {
  if (mode === 'inject') return 'injected'
  if (mode === 'clipboard') return 'manual'
  return 'failed'
}
