// Capability tiering + inject gating / clipboard fallback (spike-validated).
export const TIER = {
  codex: 'full',
  claude: 'full',
  opencode: 'full',
  kimi: 'observe-only',
  // 新增适配器：inject 语法未在真机验证，先只读（诚实约定，见 docs/agent-会话存储勘察.md）
  'kimi-code': 'observe-only',
  zcode: 'observe-only',
  dsh: 'observe-only',
  cursor: 'observe-only',
  gemini: 'observe-only',
};

export function canInject(tier) {
  return tier === 'full';
}

/**
 * Build the full relay handoff package. Used for adapter inject prompts AND the
 * clipboard fallback (plus the frontend mirror registry.handoffPackageText), so an
 * online handoff and a degraded offline handoff carry exactly the same content.
 * @param {{from?:string, context?:string, instruction?:string, artifacts?:string[]}} h
 */
export function handoffPackage(h = {}) {
  const parts = [`Relay handoff from ${h.from ?? 'petdeck'}`];
  if (h.context) parts.push(`\n上下文：\n${h.context}`);
  if (h.instruction) parts.push(`\n指令：\n${h.instruction}`);
  if (Array.isArray(h.artifacts) && h.artifacts.length) parts.push(`\n产物：\n${h.artifacts.join('\n')}`);
  return parts.join('');
}

/**
 * Decide inject vs clipboard handoff. Returns {mode, response?, sessionID?, package?, fallbackReason?}.
 * Clipboard mode carries the complete handoff (context + instruction + artifacts).
 * fallbackReason 标注降级原因：tier = 能力分级不允许注入；cli = 目标 CLI 拒绝。
 * （bridge 不可达由 bridge 层以 reason 'bridge-error' 显式返回。）
 */
export function injectDecision(tier, result, handoff) {
  if (canInject(tier) && result?.ok) {
    return { mode: 'inject', response: result.response ?? '', sessionID: result.sessionID ?? '' };
  }
  return {
    mode: 'clipboard',
    package: handoffPackage(handoff ?? { context: result?.context }),
    fallbackReason: canInject(tier) ? 'cli' : 'tier',
  };
}
