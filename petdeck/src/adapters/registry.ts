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

/**
 * 离线交接包文本。与 server/tiers.mjs 的 handoffPackage 保持逐字一致
 * （同一字段顺序与中文标签 from/context/instruction/artifacts）——在线 prompt 与
 * 离线剪贴板包必须等价，降级的交接不得丢 from 或产物。parity fixture 见 logic.test.ts。
 */
export function handoffPackageText(p: Pick<InjectPayload, 'from' | 'context' | 'instruction' | 'artifacts'>): string {
  const parts = [`Relay handoff from ${p.from ?? 'petdeck'}`]
  if (p.context) parts.push(`\n上下文：\n${p.context}`)
  if (p.instruction) parts.push(`\n指令：\n${p.instruction}`)
  if (Array.isArray(p.artifacts) && p.artifacts.length) parts.push(`\n产物：\n${p.artifacts.join('\n')}`)
  return parts.join('')
}

export function clipboardPackage(p: InjectPayload, fallbackReason?: 'tier' | 'cli' | 'bridge-error'): InjectDecision {
  return { mode: 'clipboard', package: handoffPackageText(p), ...(fallbackReason ? { fallbackReason } : {}) }
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