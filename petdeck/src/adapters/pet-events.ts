import type { Agent, EventType, PetEvent } from '../flows/shared/types.ts'
import type { ObservedSession } from './types.ts'
import { observedSessionId, projectForObservation } from './session-identity.ts'

const EVENT_TYPES = new Set<EventType>(['started', 'done', 'stuck', 'decision', 'relay-ready'])

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

export function shouldSurfacePetEvent(eventTs: number, subscribedAt: number): boolean {
  return Number.isFinite(eventTs) && Number.isFinite(subscribedAt) && eventTs >= subscribedAt
}

export function petEventFromBridge(e: Record<string, unknown>, agents: Agent[]): PetEvent | null {
  const type = text(e.petType) as EventType
  const ts = typeof e.ts === 'number' ? e.ts : Number.NaN
  const sessionValue = record(record(e.payload)?.session)
  if (!EVENT_TYPES.has(type) || !Number.isFinite(ts) || Number.isNaN(new Date(ts).getTime()) || !sessionValue) return null
  const agent = text(sessionValue.agent)
  const session = text(sessionValue.session)
  const id = text(e.id)
  if (!id || !agent || !session) return null
  const observed: ObservedSession = {
    agent,
    source: text(sessionValue.source),
    session,
    status: text(sessionValue.status),
    lastMessage: text(sessionValue.lastMessage),
    cwd: optionalText(sessionValue.cwd),
    projectId: optionalText(sessionValue.projectId),
    projectName: optionalText(sessionValue.projectName),
    title: optionalText(sessionValue.title),
    host: optionalText(sessionValue.host),
  }
  const project = projectForObservation(observed)
  return {
    id,
    type,
    projectId: project.id,
    sessionId: observedSessionId(observed),
    agentId: agent,
    agentName: agents.find((item) => item.id === agent)?.name ?? agent,
    projectName: project.name,
    sessionTitle: observed.title?.trim() || session,
    text: observed.lastMessage,
    timestamp: new Date(ts).toISOString(),
    handled: false,
  }
}
