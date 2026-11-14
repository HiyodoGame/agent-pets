// Thin HTTP/SSE client to the local bridge (server/bridge.mjs).
import type { Agent } from '../flows/shared/types'
import type { InjectDecision, InjectPayload, ObservedSession } from './types'

export const BRIDGE_URL = 'http://127.0.0.1:5199'

export interface BridgeClientConfig {
  url: string
  token: string
}

let bridgeConfig: BridgeClientConfig = {
  url: BRIDGE_URL,
  token: (import.meta.env?.VITE_PETDECK_BRIDGE_TOKEN as string | undefined) ?? '',
}

export function configureBridgeClient(config: BridgeClientConfig): void {
  bridgeConfig = { url: config.url.replace(/\/$/, ''), token: config.token }
}

export async function fetchHealth(): Promise<boolean> {
  try {
    const r = await fetch(`${bridgeConfig.url}/api/health`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return false
    const j = await r.json()
    return Boolean(j.ok)
  } catch {
    return false
  }
}

const FETCH_TIMEOUT_MS = 3000

export async function fetchAgents(): Promise<Agent[]> {
  const r = await fetch(`${bridgeConfig.url}/api/agents`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  return r.json()
}

export async function fetchSessions(): Promise<ObservedSession[]> {
  const r = await fetch(`${bridgeConfig.url}/api/sessions`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  return r.json()
}

export function subscribeEvents(
  fn: (e: Record<string, unknown>) => void,
  hooks?: { onOpen?: () => void; onError?: () => void },
): () => void {
  const es = new EventSource(`${bridgeConfig.url}/api/events`)
  es.onmessage = (m) => {
    try { fn(JSON.parse(m.data)) } catch { /* ignore malformed */ }
  }
  if (hooks?.onOpen) es.onopen = hooks.onOpen
  if (hooks?.onError) es.onerror = hooks.onError
  return () => es.close()
}

/** Inject 失败错误：带 HTTP status（网络错误为 0）。调用方必须按失败处理，不得进入成功分支。 */
export class BridgeInjectError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'BridgeInjectError'
    this.status = status
  }
}

export async function inject(payload: InjectPayload): Promise<InjectDecision> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (bridgeConfig.token) headers['X-Petdeck-Token'] = bridgeConfig.token
  let r: Response
  try {
    r = await fetch(`${bridgeConfig.url}/api/inject`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
  } catch (e) {
    throw new BridgeInjectError(e instanceof Error ? e.message : 'network error', 0)
  }
  if (!r.ok) throw new BridgeInjectError(`bridge inject: HTTP ${r.status}`, r.status)
  let body: unknown
  try {
    body = await r.json()
  } catch {
    throw new BridgeInjectError('bridge inject: malformed JSON response', r.status)
  }
  const j = body as { ok?: unknown; status?: unknown; mode?: unknown }
  if (j?.ok === false) {
    throw new BridgeInjectError('bridge inject: rejected', typeof j.status === 'number' ? j.status : r.status)
  }
  return body as InjectDecision
}