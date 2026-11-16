import { AlertTriangle, Bell, Check, MessageCircle, X } from 'lucide-react'
import type { PetEvent } from '../shared/types'
import { petEventText } from './pet-view'
import { t } from '../../i18n/index.ts'

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
        : Bell
  return (
    <section className="pet-popover pet-event-card" aria-label={event.type === 'decision' ? t('eventCard.ariaDecision') : t('eventCard.aria')}>
      <div className="pet-event-heading">
        <span className="pet-event-icon" data-event-type={event.type}><Icon className="h-4 w-4" /></span>
        <span className="pet-event-kind">{event.type === 'decision' ? t('eventCard.kindDecision') : t('eventCard.kindProgress')}</span>
        <button type="button" className="pet-icon-button ml-auto" aria-label={t('eventCard.dismiss')} onClick={onDismiss}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="pet-event-text">{petEventText(event)}</p>
      <button type="button" className="pet-primary-button" onClick={onOpen}>
        {event.type === 'decision' ? t('eventCard.reviewDecision') : t('eventCard.viewDetail')}
      </button>
    </section>
  )
}
