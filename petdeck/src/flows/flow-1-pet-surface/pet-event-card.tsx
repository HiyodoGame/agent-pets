import { Activity, AlertTriangle, Check, MessageCircle, X } from 'lucide-react'
import type { PetEvent } from '../shared/types'
import { t } from '../../i18n/index.ts'

function eventKind(event: PetEvent): string {
  if (event.type === 'started') return t('eventCard.kindStarted')
  if (event.type === 'decision') return t('eventCard.kindDecision')
  if (event.type === 'stuck') return t('eventCard.kindStuck')
  if (event.type === 'relay-ready') return t('eventCard.kindRelayReady')
  return t('eventCard.kindDone')
}

export function PetEventCard({ event, onOpen, onDismiss }: {
  event: PetEvent
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
      </div>
      <button type="button" className="pet-primary-button" onClick={onOpen}>
        {event.type === 'decision' ? t('eventCard.reviewDecision') : t('eventCard.viewDetail')}
      </button>
    </section>
  )
}
