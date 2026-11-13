// kimi adapter — hosted web agent. observe-only tier: no local session store,
// status via manual check-in / browser extension; inject always degrades to clipboard.
export const id = 'kimi';
export const name = 'kimi work';
export const tier = 'observe-only';

export function observe() {
  // Hosted agent: no local jsonl. Real status comes from manual check-in or
  // the WebBridge extension; return empty so the UI shows the manual path.
  return [];
}

export function inject() {
  // No headless inject surface verified => always clipboard handoff.
  return { ok: false, response: '' };
}

export default { id, name, tier, observe, inject };