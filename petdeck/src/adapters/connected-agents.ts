import type { CapabilityTier } from '../flows/shared/types.ts'

export interface ConnectedAgentStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const CONNECTED_AGENTS_KEY = 'petdeck.connectedAgents.v1'

export function shouldPersistConnection(mock: boolean, capability: CapabilityTier): boolean {
  return !mock && capability !== 'manual'
}

export function resolveConnectedAgentIds(storedIds: string[], observedIds: string[]): string[] {
  return [...new Set([...storedIds, ...observedIds])]
}

function browserStorage(): ConnectedAgentStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function loadConnectedAgentIds(storage: ConnectedAgentStorage | null = browserStorage()): string[] {
  if (!storage) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(CONNECTED_AGENTS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  } catch {
    return []
  }
}

export function recordConnectedAgent(storage: ConnectedAgentStorage | null = browserStorage(), id: string): void {
  if (!storage || !id) return
  const current = loadConnectedAgentIds(storage)
  if (current.includes(id)) return
  try {
    storage.setItem(CONNECTED_AGENTS_KEY, JSON.stringify([...current, id]))
  } catch {
    // The current connection remains usable when local persistence is unavailable.
  }
}
