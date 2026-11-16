// Pure sync decisions behind DataSourceProvider: stale-HTTP gating, cold-start
// snapshot loading, and observed-row projection. Extracted from data.tsx so the
// provider's data-sync behavior is unit-testable without React.
import type { Session } from '../flows/shared/types.ts'
import { mapSessionStatus } from '../flows/shared/ui-logic.ts'
import type { ObservedSession } from './types.ts'

/** HTTP 轮询提交门：响应在途期间若无更新提交（rev 未变）才允许落盘，否则视为旧数据丢弃。 */
export function shouldCommitHttp(revBefore: number, revNow: number): boolean {
  return revBefore === revNow
}

/** 断连读盘门：仅冷启动（内存无数据）且本次断连未展示过缓存时才读磁盘快照。 */
export function shouldLoadSnapshot(hasMemory: boolean, cacheShown: boolean): boolean {
  return !hasMemory && !cacheShown
}

/** 观察行 → Session 投影；时间戳统一来自 `now`，便于测试与复现。 */
export function observedToSessions(rows: ObservedSession[], now: string): Session[] {
  return rows.map((r) => ({
    id: `${r.agent}:${r.session}`,
    projectId: 'live',
    agentId: r.agent,
    title: r.lastMessage || r.session,
    status: mapSessionStatus(r.status),
    messages: r.lastMessage
      ? [{ id: `${r.session}-m`, role: 'agent' as const, content: r.lastMessage, timestamp: now, artifactIds: [] }]
      : [],
    artifactIds: [],
    updatedAt: now,
    tokens: r.tokens,
    usageWindow: r.usageWindow,
    stale: r.stale,
    lastSeen: r.lastSeen,
  }))
}
