import type { Project } from '../flows/shared/types.ts'
import type { ObservedSession } from './types.ts'
import { t } from '../i18n/index.ts'

function normalizeProjectKey(value: string): string {
  const normalized = value.trim().replace(/\\/g, '/')
  if (/^(?:[A-Za-z]:)?\/$/.test(normalized)) return normalized
  return normalized.replace(/\/+$/, '')
}

function projectBaseName(value: string): string {
  const normalized = normalizeProjectKey(value)
  return normalized.split('/').filter(Boolean).at(-1) ?? normalized
}

export function observedSessionId(row: Pick<ObservedSession, 'agent' | 'session' | 'host'>): string {
  return `${row.host ? `${row.host}@` : ''}${row.agent}:${row.session}`
}

export function projectForObservation(row: Pick<ObservedSession, 'agent' | 'source' | 'host' | 'cwd' | 'projectId' | 'projectName' | 'temp'>): Pick<Project, 'id' | 'name' | 'description'> {
  const host = row.host?.trim() || 'local'
  // Relay injection sandboxes run in %TEMP%; one shared bucket keeps the panel from
  // listing a new "project" per random scratch directory.
  if (row.temp) {
    return { id: `${host}:temp`, name: t('data.tempProject'), description: t('data.tempProjectDesc') }
  }
  const sourceKey = row.cwd?.trim() || row.projectId?.trim() || ''
  if (!sourceKey) {
    return {
      id: `${host}:${row.agent}:unidentified`,
      name: t('data.unidentifiedProject'),
      description: t('data.unidentifiedProjectDesc', { agent: row.agent }),
    }
  }
  const key = normalizeProjectKey(sourceKey)
  return {
    id: `${host}:${key}`,
    name: row.projectName?.trim() || projectBaseName(row.cwd?.trim() || sourceKey),
    description: row.cwd?.trim() ? normalizeProjectKey(row.cwd) : sourceKey,
  }
}

export function observedToProjects(rows: ObservedSession[], now = new Date().toISOString()): Project[] {
  const projects = new Map<string, Project>()
  for (const row of rows) {
    const summary = projectForObservation(row)
    const sessionId = observedSessionId(row)
    const existing = projects.get(summary.id)
    if (existing) {
      existing.sessionIds.push(sessionId)
      continue
    }
    projects.set(summary.id, { ...summary, sessionIds: [sessionId], updatedAt: now })
  }
  return [...projects.values()]
}
