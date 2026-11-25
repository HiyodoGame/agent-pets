import { Activity, AlertTriangle, Check, MessageCircle, X } from 'lucide-react'
import type { AgentAsk, AgentNotify, PetEvent } from '../shared/types'
import { t } from '../../i18n/index.ts'
import { petEventText, sanitizePetEventText } from './pet-view'
import { PetAskBody } from './pet-ask-card'

function eventKind(event: PetEvent): string {
  if (event.type === 'started') return t('eventCard.kindStarted')
  if (event.type === 'decision') return t('eventCard.kindDecision')
  if (event.type === 'stuck') return t('eventCard.kindStuck')
  if (event.type === 'relay-ready') return t('eventCard.kindRelayReady')
  return t('eventCard.kindDone')
}

/** Pet event card: a task-card layout (agent · kind, project, one readable line)
 *  with two direct actions. The raw transcript line is sanitized and clamped so a
 *  long protocol message can never turn the popover into a scroll box. */
export function PetEventCard({ event, ask, notify, onOpen, onDismiss }: {
  event: PetEvent
  ask?: AgentAsk
  notify?: AgentNotify
  onOpen: () => void
  onDismiss: () => void
}) {
  const Icon = event.type === 'done' || event.type === 'relay-ready'
    ? Check
    : event.type === 'decision'
      ? MessageCircle
      : event.type === 'stuck'
        ? AlertTriangle
        : Activity
  const kind = eventKind(event)
  const summary = sanitizePetEventText(event.text) || petEventText(event)
  return (
    <section className="pet-popover pet-event-card" aria-label={`${event.agentName} · ${kind}`}>
      <div className="pet-event-heading">
        <span className="pet-event-icon" data-event-type={event.type}><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <span className="pet-event-kind">{event.agentName} · {kind}</span>
        <button type="button" className="pet-icon-button ml-auto" aria-label={t('eventCard.dismiss')} onClick={onDismiss}>
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="pet-event-context">
        <span>{event.projectName}</span>
        <h2>{event.sessionTitle}</h2>
        {ask || notify ? null : <p className="pet-event-text">{summary}</p>}
      </div>
      {notify ? (
        <div className="pet-ask">
          <p className="pet-ask-hint">{notify.message || t('petAsk.permission')}</p>
        </div>
      ) : null}
      {ask ? (
        <PetAskBody ask={ask} onOpen={onOpen} />
      ) : (
        <div className="pet-event-actions">
          <button type="button" className="pet-secondary-button" onClick={onDismiss}>
            {t('eventCard.dismissAction')}
          </button>
          <button type="button" className="pet-primary-button" onClick={onOpen}>
            {event.type === 'decision' ? t('eventCard.reviewDecision') : t('eventCard.viewDetail')}
          </button>
        </div>
      )}
    </section>
  )
}
