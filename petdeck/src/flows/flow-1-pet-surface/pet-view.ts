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
