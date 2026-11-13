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

/** Decide inject vs clipboard handoff. Returns {mode, response?, sessionID?, package?}. */
export function injectDecision(tier, result) {
  if (canInject(tier) && result?.ok) {
    return { mode: 'inject', response: result.response ?? '', sessionID: result.sessionID ?? '' };
  }
  const body = result?.response || result?.context || '';
  return { mode: 'clipboard', package: `Relay handoff package:\n${body}` };
}