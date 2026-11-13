// Last-known-real snapshot cache (localStorage). Local-first: content never leaves the machine.
// Callers must only save live-bridge data — demo/mock data is never cached.
import type { Agent } from '../flows/shared/types'
import type { ObservedSession } from './types'

export interface SnapshotStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

export interface Snapshot {
  savedAt: number
  sessions: ObservedSession[]
  agents: Agent[]
}

export const SNAPSHOT_KEY = 'petdeck.snapshot.v1'
export const SNAPSHOT_CAP = 200

export function saveSnapshot(
  storage: SnapshotStorage | null,
  data: { sessions: ObservedSession[]; agents: Agent[] },
  now: number,
): void {
  if (!storage) return
  try {
    const snap: Snapshot = { savedAt: now, sessions: data.sessions.slice(0, SNAPSHOT_CAP), agents: data.agents }
    storage.setItem(SNAPSHOT_KEY, JSON.stringify(snap))
  } catch { /* storage full/unavailable => degrade to memory-only */ }
}

export function loadSnapshot(storage: SnapshotStorage | null): Snapshot | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const j = JSON.parse(raw) as Partial<Snapshot>
    if (typeof j.savedAt !== 'number' || !Array.isArray(j.sessions) || !Array.isArray(j.agents)) {
      storage.removeItem(SNAPSHOT_KEY)
      return null
    }
    return { savedAt: j.savedAt, sessions: j.sessions, agents: j.agents }
  } catch {
    try { storage.removeItem(SNAPSHOT_KEY) } catch { /* ignore */ }
    return null
  }
}