// Capability tiering + inject gating / clipboard fallback (spike-validated).
export const TIER = {
  codex: 'full',
  claude: 'full',
  opencode: 'full',
  kimi: 'observe-only',
};

export function canInject(tier) {
  return tier === 'full';
}

/**
 * Build the full relay handoff package. Used for BOTH inject text and the
 * clipboard fallback, so a degraded handoff never silently drops the instruction.
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
 * Decide inject vs clipboard handoff. Returns {mode, response?, sessionID?, package?}.
 * Clipboard mode carries the complete handoff (context + instruction + artifacts).
 */
export function injectDecision(tier, result, handoff) {
  if (canInject(tier) && result?.ok) {
    return { mode: 'inject', response: result.response ?? '', sessionID: result.sessionID ?? '' };
  }
  return { mode: 'clipboard', package: handoffPackage(handoff ?? { context: result?.context }) };
}
