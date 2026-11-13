// Adapter registry: source selection (live vs mock) + capability gating.
// Pure logic, unit-tested in logic.test.ts.
import type { CapabilityTier } from '../flows/shared/types'

export type SourceMode = 'live' | 'mock'

/** Live only when the local bridge is healthy; otherwise fall back to mock. */
export function selectSource(bridgeHealthy: boolean): SourceMode {
  return bridgeHealthy ? 'live' : 'mock'
}

/** full =双向 inject；observe-only / manual = 剪贴板交接。 */
export function gateInject(tier: CapabilityTier): boolean {
  return tier === 'full'
}