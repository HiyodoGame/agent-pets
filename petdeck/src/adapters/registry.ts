// Adapter registry: source selection (explicit demo only) + capability gating + inject fallback.
// Pure logic, unit-tested in logic.test.ts.
import type { CapabilityTier } from '../flows/shared/types'
import type { InjectDecision, InjectPayload } from './types'

export type SourceMode = 'live' | 'mock'

/** 演示数据仅在显式开关时使用；bridge 健康与否由连接状态机处理，不再自动降级 mock。 */
export function selectSource(demo: boolean): SourceMode {
  return demo ? 'mock' : 'live'
}

/** full =双向 inject；observe-only / manual = 剪贴板交接。 */
export function gateInject(tier: CapabilityTier): boolean {
  return tier === 'full'
}

export function clipboardPackage(p: InjectPayload): InjectDecision {
  return { mode: 'clipboard', package: `Relay handoff package:\n${p.context ?? ''}\n${p.instruction ?? ''}` }
}

/** live 且 bridge 可达 → 真注入；否则（mock 模式 / bridge 断连）→ 剪贴板降级。 */
export async function injectOrClipboard(
  p: InjectPayload,
  live: boolean,
  bridge: (p: InjectPayload) => Promise<InjectDecision>,
): Promise<InjectDecision> {
  if (!live) return clipboardPackage(p)
  try { return await bridge(p) } catch { return clipboardPackage(p) }
}