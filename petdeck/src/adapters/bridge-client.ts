// Thin HTTP/SSE client to the local bridge (server/bridge.mjs).
import type { Agent } from '../flows/shared/types'
import type { InjectDecision, InjectPayload, ObservedSession } from './types'

export const BRIDGE_URL = 'http://127.0.0.1:5199'

// Shared local secret (optional). Empty => bridge enforces only Host+Origin+Content-Type.
const BRIDGE_TOKEN = (import.meta.env?.VITE_PETDECK_BRIDGE_TOKEN as string | undefined) ?? ''

export async function fetchHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${BRIDGE_URL}/api/health`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return false
    const j = await r.json()
    return Boolean(j.ok)
  } catch {
    return false
  }
}

export async function fetchAgents(): Promise<Agent[]> {
  const r = await fetch(`${BRIDGE_URL}/api/agents`)
  return r.json()
}

export async function fetchSessions(): Promise<ObservedSession[]> {
  const r = await fetch(`${BRIDGE_URL}/api/sessions`)
  return r.json()
}

export function subscribeEvents(
  fn: (e: Record<string, unknown>) => void,
  hooks?: { onOpen?: () => void; onError?: () => void },
): () => void {
  const es = new EventSource(`${BRIDGE_URL}/api/events`)
  es.onmessage = (m) => {
    try { fn(JSON.parse(m.data)) } catch { /* ignore malformed */ }
  }
  if (hooks?.onOpen) es.onopen = hooks.onOpen
  if (hooks?.onError) es.onerror = hooks.onError
  return () => es.close()
}

export async function inject(payload: InjectPayload): Promise<InjectDecision> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (BRIDGE_TOKEN) headers['X-Petdeck-Token'] = BRIDGE_TOKEN
  const r = await fetch(`${BRIDGE_URL}/api/inject`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  return r.json()
}