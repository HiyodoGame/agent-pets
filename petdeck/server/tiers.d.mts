// Type declarations for server/tiers.mjs (imported by frontend registry for the
// single-source handoff package text). server 侧是纯 JS 无构建步骤，声明放这里。
export declare const TIER: Record<string, 'full' | 'observe-only' | 'manual'>
export declare function canInject(tier: string): boolean
export interface HandoffInput {
  from?: string
  context?: string
  instruction?: string
  artifacts?: string[]
}
export declare function handoffPackage(h?: HandoffInput): string
export declare function injectDecision(
  tier: string,
  result: { ok?: boolean; response?: string; sessionID?: string; context?: string } | null | undefined,
  handoff?: HandoffInput,
): { mode: 'inject' | 'clipboard'; response?: string; sessionID?: string; package?: string; fallbackReason?: 'tier' | 'cli' }
