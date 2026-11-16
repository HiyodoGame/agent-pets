// Adapter registry: source selection (explicit demo only) + capability gating + inject fallback.
// Pure logic, unit-tested in logic.test.ts.
import type { CapabilityTier } from '../flows/shared/types'
import type { InjectDecision, InjectPayload } from './types'
import { handoffPackage } from '../../server/tiers.mjs'

export type SourceMode = 'live' | 'mock'

/** 演示数据仅在显式开关时使用；bridge 健康与否由连接状态机处理，不再自动降级 mock。 */
export function selectSource(demo: boolean): SourceMode {
  return demo ? 'mock' : 'live'
}

/** full =双向 inject；observe-only / manual = 剪贴板交接。 */
export function gateInject(tier: CapabilityTier): boolean {
  return tier === 'full'
}

/**
 * 交接包文本单一来源（P2-11 合一）：直接引用 server/tiers.mjs 的 handoffPackage，
 * 不再维护逐字镜像。server 的纯函数无 Node 依赖，Vite 可直接打包。
 * 保留 handoffPackageText 名称以稳定前端消费方（flow4 / index barrel）。
 */
export { handoffPackage as handoffPackageText } from '../../server/tiers.mjs'

export function clipboardPackage(p: InjectPayload, fallbackReason?: 'tier' | 'cli' | 'bridge-error'): InjectDecision {
  return { mode: 'clipboard', package: handoffPackage(p), ...(fallbackReason ? { fallbackReason } : {}) }
}

/** live 且 bridge 可达 → 真注入；demo（非 live）→ 剪贴板（非降级，不带原因）；
 *  bridge 抛错 → 剪贴板降级并标注 fallbackReason 'bridge-error'。 */
export async function injectOrClipboard(
  p: InjectPayload,
  live: boolean,
  bridge: (p: InjectPayload) => Promise<InjectDecision>,
): Promise<InjectDecision> {
  if (!live) return clipboardPackage(p)
  try { return await bridge(p) } catch { return clipboardPackage(p, 'bridge-error') }
}