import { AlertTriangle, Bell, Check, MessageCircle, X } from 'lucide-react'
import type { PetEvent } from '../shared/types'
import { petEventText } from './pet-view'

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
    <section className="pet-popover pet-event-card" aria-label={event.type === 'decision' ? '需要你拍板' : '宠物轻拍事件'}>
      <div className="pet-event-heading">
        <span className="pet-event-icon" data-event-type={event.type}><Icon className="h-4 w-4" /></span>
        <span className="pet-event-kind">{event.type === 'decision' ? '需要你拍板' : '有新进展'}</span>
        <button type="button" className="pet-icon-button ml-auto" aria-label="忽略事件" onClick={onDismiss}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="pet-event-text">{petEventText(event)}</p>
      <button type="button" className="pet-primary-button" onClick={onOpen}>
        {event.type === 'decision' ? '查看并处理' : '查看详情'}
      </button>
    </section>
  )
}
