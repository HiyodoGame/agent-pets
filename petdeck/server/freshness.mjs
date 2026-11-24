// Bridge-authoritative freshness: merge live observe results with last-known-good.
// Pure (adapters injected, immutable lastGood update) — unit-tested with fakes.
// Contract: observe throws = source unreachable; returns [] = legitimately empty.

/**
 * @param {Array<{id: string, observe: () => any}>} adapters
 * @param {Map<string, {at: number, rows: any[]}>} lastGood
 * @param {number} now
 * @returns {Promise<{sessions: any[], sources: Record<string, {ok: boolean, lastSeen: number|null, error?: {code: string, message: string}}>, lastGood: Map<string, {at: number, rows: any[]}>, key: string}>}
 */
export async function pollOnce(adapters, lastGood, now) {
  const sessions = [];
  const sources = {};
  const lg = new Map(lastGood);
  for (const a of adapters) {
    try {
      const rows = await a.observe();
      lg.set(a.id, { at: now, rows });
      sources[a.id] = { ok: true, lastSeen: now };
      for (const r of rows) sessions.push({ ...r, stale: false, lastSeen: now });
    } catch (e) {
      // Surface a bounded, secret-free reason so the Agents page can show why a
      // source is stale without leaking its raw error object into the UI.
      const error = {
        code: e?.code ? String(e.code).slice(0, 40) : '',
        message: String(e?.message ?? 'observe failed').slice(0, 160),
      };
      const prev = lg.get(a.id);
      // remote can succeed on some SSH hosts and fail on others. Merge only the
      // successful partition into cache; failed hosts retain their own timestamps.
      if (Array.isArray(e?.partialRows) && Array.isArray(e?.failedHosts)) {
        const failed = new Set(e.failedHosts.map(String));
        const freshRows = e.partialRows.filter((r) => r && !failed.has(String(r.host ?? '')));
        const hostAts = { ...(prev?.hostAts ?? {}) };
        if (prev && !prev.hostAts) {
          for (const r of prev.rows) if (r.host) hostAts[r.host] = prev.at;
        }
        for (const host of e.okHosts ?? []) hostAts[String(host)] = now;
        const staleRows = prev ? prev.rows.filter((r) => failed.has(String(r.host ?? ''))) : [];
        for (const r of freshRows) sessions.push({ ...r, stale: false, lastSeen: now });
        for (const r of staleRows) sessions.push({ ...r, stale: true, lastSeen: hostAts[r.host] ?? prev.at });
        lg.set(a.id, { at: now, rows: [...freshRows, ...staleRows], hostAts });
        sources[a.id] = { ok: false, lastSeen: now, error };
      } else if (prev) {
        sources[a.id] = { ok: false, lastSeen: prev.at, error };
        for (const r of prev.rows) sessions.push({ ...r, stale: true, lastSeen: prev.hostAts?.[r.host] ?? prev.at });
      } else {
        sources[a.id] = { ok: false, lastSeen: null, error };
      }
    }
  }
  // key 含 stale 不含 lastSeen：fresh->stale 转折触发推送，纯时间流逝不触发。
  const key = JSON.stringify(sessions.map((r) => [r.agent, r.session, r.status, r.lastMessage, r.stale]));
  return { sessions, sources, lastGood: lg, key };
}