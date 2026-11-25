import type { ConnState } from '../../adapters/connection'
import type { PetWindowMode } from '../../desktop/pet-layout.ts'
import type { AgentStatus, PetEvent, SessionStatus } from '../shared/types'
import { t } from '../../i18n/index.ts'

export interface PetSummary {
  running: number
  done: number
  waiting: number
  stuck: number
}

/** 桌宠只呈现「现在还在动」的会话；历史会话留在观察页，不占运行/待处理名额。 */
export const PET_ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000

/**
 * 近 24 小时有写入才算活跃。没有时间证据（updatedAt/lastSeen 都不可用）时不隐藏：
 * 「不知道」不能当成「已过期」，否则旧版数据源会从桌宠里整体消失。
 */
export function isRecentlyActive(
  session: { updatedAt?: string; lastSeen?: number },
  now = Date.now(),
  windowMs = PET_ACTIVE_WINDOW_MS,
): boolean {
  const parsed = Date.parse(session.updatedAt ?? '')
  const at = Number.isFinite(parsed) && parsed > 0 ? parsed : Number(session.lastSeen) || 0
  if (!at) return true
  return now - at <= windowMs
}

export function summarizeSessions(sessions: { status: SessionStatus }[]): PetSummary {
  const summary: PetSummary = { running: 0, done: 0, waiting: 0, stuck: 0 }
  for (const session of sessions) {
    if (session.status === 'active') summary.running++
    else if (session.status === 'done') summary.done++
    else if (session.status === 'waiting') summary.waiting++
    else if (session.status === 'stuck') summary.stuck++
  }
  return summary
}

export function compactPetStatus(connState: ConnState, summary: PetSummary): AgentStatus {
  if (connState === 'offline') return 'offline'
  if (summary.waiting > 0 || summary.stuck > 0) return 'stuck'
  if (summary.running > 0) return 'running'
  return 'idle'
}

export function petEventText(event: Pick<PetEvent, 'type' | 'text'>): string {
  if (event.text.trim()) return event.text
  if (event.type === 'started') return t('eventText.started')
  if (event.type === 'decision') return t('eventText.decision')
  if (event.type === 'stuck') return t('eventText.stuck')
  if (event.type === 'relay-ready') return t('eventText.relayReady')
  return t('eventText.done')
}

/**
 * 事件卡摘要：真实 transcript 里混着 `<cross-session-message>`、markdown 包裹和
 * 超长段落，直接塞进宠物卡片会撑出滚动条。去标签、压平空白、按字符数截断，
 * 只留一句人话。空结果由调用方回退到 petEventText()。
 */
export function sanitizePetEventText(text: string, max = 160): string {
  let value = String(text ?? '').replace(/\r\n?/g, '\n')
  value = value.replace(/```[^\n]*\n?/g, ' ')
  value = value.replace(/<[^>\n]{1,300}>/g, ' ')
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  value = value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  value = value.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
  value = value.replace(/^[ \t]*[-*+][ \t]+/gm, '')
  value = value.replace(/[*_`~]/g, '')
  value = value.replace(/\s+/g, ' ').trim()
  const chars = Array.from(value)
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : value
}

export function notificationDecision(event: Pick<PetEvent, 'type'>, dnd: boolean): 'tap' | 'inbox' {
  return dnd && event.type !== 'decision' ? 'inbox' : 'tap'
}

export function petOverlayMode(input: { settingsOpen: boolean; menuOpen: boolean; activeEvent: boolean; expanded: boolean; hasError: boolean }): PetWindowMode {
  if (input.activeEvent) return 'event'
  if (input.settingsOpen) return 'settings'
  if (input.menuOpen) return 'menu'
  if (input.expanded) return 'quick'
  return input.hasError ? 'event' : 'compact'
}

/** A source switch starts a new observation boundary; existing events are not new arrivals. */
export function shouldResetEventWatermark(previousMode: string, nextMode: string): boolean {
  return previousMode !== nextMode
}
