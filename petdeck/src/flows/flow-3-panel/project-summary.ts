import type { Session } from '../shared/types.ts'

export interface ProjectSessionSummary {
  running: number
  waiting: number
  total: number
}

export function summarizeProjectSessions(sessions: Session[], projectId: string): ProjectSessionSummary {
  const owned = sessions.filter((session) => session.projectId === projectId)
  return {
    running: owned.filter((session) => session.status === 'active').length,
    waiting: owned.filter((session) => session.status === 'waiting' || session.status === 'stuck').length,
    total: owned.length,
  }
}

export function firstProjectSessionId(sessions: Session[], projectId: string): string | null {
  return sessions.find((session) => session.projectId === projectId)?.id ?? null
}
