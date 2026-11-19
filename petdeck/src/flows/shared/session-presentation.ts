import { t } from '../../i18n/index.ts'
import type { MessageKey } from '../../i18n/messages.ts'
import type { Agent, Project, Session, SessionStatus } from './types.ts'

const STATUS_LABEL_KEY: Record<SessionStatus, MessageKey> = {
  active: 'status.active',
  waiting: 'status.waiting',
  done: 'status.done',
  stuck: 'status.stuck',
  archived: 'status.archived',
}

export function sessionStatusText(status: SessionStatus): string {
  return t(STATUS_LABEL_KEY[status])
}

export function presentSession(session: Session, agents: Agent[], projects: Project[]) {
  return {
    agentName: agents.find((agent) => agent.id === session.agentId)?.name ?? session.agentId,
    projectName: projects.find((project) => project.id === session.projectId)?.name ?? t('data.unidentifiedProject'),
    title: session.title.trim() || session.id,
    status: session.status,
    statusLabel: sessionStatusText(session.status),
    host: session.host,
    stale: Boolean(session.stale),
  }
}

export function prioritizeSessions(sessions: Session[]): Session[] {
  return [
    ...sessions.filter((session) => session.status === 'waiting' || session.status === 'stuck'),
    ...sessions.filter((session) => session.status === 'active'),
    ...sessions.filter((session) => session.status === 'done'),
    ...sessions.filter((session) => session.status === 'archived'),
  ]
}
