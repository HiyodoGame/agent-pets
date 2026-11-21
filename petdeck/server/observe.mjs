// Read-only observation surface for the new console: aggregate sessions from
// observe-only adapters, keep per-adapter health counters, and expose a sanitized
// transcript preview. Nothing here can inject, accept, merge or feed the task board —
// the runtime task tables stay the only source of truth for work.
import fs from 'node:fs';
import path from 'node:path';
import { TIER } from './tiers.mjs';
import { safeJson, tailLines } from './adapters/shared.mjs';
import { decodeDshEvents } from './adapters/dsh.mjs';
import { cleanUserText } from './adapters/cursor.mjs';

export const OBSERVE_LIMIT_DEFAULT = 20;
export const OBSERVE_LIMIT_MAX = 50;
export const TRANSCRIPT_LIMIT_DEFAULT = 20;
export const TRANSCRIPT_LIMIT_MAX = 50;

/** Observe-only is the default for unknown ids: an adapter we cannot inject must never
 *  look injectable just because it is missing from TIER. */
export function isObserveOnly(agentId, tierOf = (id) => TIER[id] ?? 'observe-only') {
  return (tierOf(agentId) ?? 'observe-only') === 'observe-only';
}

export function clampLimit(value, fallback = OBSERVE_LIMIT_DEFAULT, max = OBSERVE_LIMIT_MAX) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

/** Adapter status vocabulary (done/running/stuck/waiting/unknown) -> the three UI
 *  states the console understands. waiting is idle: the turn is parked on a human,
 *  not failing; the raw status still travels alongside for detail views. */
export function mapObserveState(status) {
  if (status === 'running') return 'running';
  if (status === 'stuck' || status === 'error' || status === 'failed') return 'error';
  return 'idle';
}

export function observeProjectName(row) {
  const named = String(row?.projectName ?? '').trim();
  if (named) return named;
  const id = String(row?.projectId ?? '').trim();
  if (id) return id;
  const cwd = String(row?.cwd ?? '').trim();
  return cwd ? path.basename(cwd) : '';
}

/** Plain-text preview only: transcripts are untrusted data, so strip markup (React
 *  escapes the rest), collapse whitespace, cap length. Never render raw HTML. */
export function sanitizeTranscriptText(text, maxChars = 500) {
  let value = String(text ?? '').replace(/\r\n?/g, '\n');
  value = value.replace(/```[^\n]*\n?/g, ' ');
  value = value.replace(/<[^>\n]{1,200}>/g, ' ');
  value = value.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  value = value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  value = value.replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '');
  value = value.replace(/^[ \t]*[-*+][ \t]+/gm, '');
  value = value.replace(/[*_`~]/g, '');
  value = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
  value = value.replace(/\s+/g, ' ').trim();
  if (value.length > maxChars) value = value.slice(0, Math.max(0, maxChars - 1)) + '…';
  return value;
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    // Hidden reasoning / tool-call parts are not transcript text: DSH stores most
    // assistant turns as reasoning + tool-call, and surfacing that would leak the
    // model's private scratchpad into the read-only view.
    .filter((part) => part && typeof part === 'object' && typeof part.text === 'string' && (part.type === undefined || part.type === 'text'))
    .map((part) => part.text)
    .join('');
}

function normalizeRole(role) {
  const value = String(role ?? '').toLowerCase();
  if (value === 'user' || value === 'human') return 'user';
  if (value === 'assistant' || value === 'gemini' || value === 'model') return 'assistant';
  if (value === 'system' || value === 'error') return 'system';
  return '';
}

/** Translate one adapter's transcript records into {role, text} entries.
 *  Pure; unknown shapes are skipped rather than guessed. */
export function parseTranscriptLines(agent, lines, { limit = TRANSCRIPT_LIMIT_DEFAULT, maxChars = 500 } = {}) {
  const out = [];
  const add = (role, text) => {
    const clean = sanitizeTranscriptText(text, maxChars);
    if (clean) out.push({ role, text: clean });
  };
  for (const line of lines) {
    const record = safeJson(line);
    if (!record) continue;
    if (agent === 'cursor') {
      if (record.role === 'user' || record.role === 'assistant') {
        const text = textOf(record.message?.content ?? record.message);
        add(record.role, record.role === 'user' ? cleanUserText(text) : text);
      }
      continue;
    }
    if (agent === 'gemini') {
      if (record.type === 'user') add('user', textOf(record.content));
      else if (record.type === 'gemini') add('assistant', textOf(record.content));
      else if (record.type === 'error') add('system', textOf(record.content));
      continue;
    }
    if (agent === 'kimi-code') {
      if (record.type === 'turn.prompt') add('user', textOf(record.input));
      else if (record.type === 'context.append_message') add(normalizeRole(record.message?.role), textOf(record.message?.content));
      else if (record.role) add(normalizeRole(record.role), textOf(record.content));
      continue;
    }
    if (agent === 'dsh') {
      if (record.type === 'assistant/message') add('assistant', textOf(record.data?.message?.content));
      else if (record.type === 'user/message') add('user', textOf(record.data?.message?.content));
      else if (record.type === 'context.append_message') add(normalizeRole(record.message?.role), textOf(record.message?.content));
      else if (record.type === 'turn/start') {
        const prompt = record.data?.prompt ?? record.data?.input;
        if (prompt) add('user', textOf(prompt));
      }
      continue;
    }
    const role = normalizeRole(record.role ?? record.type ?? record.message?.role);
    if (role) add(role, textOf(record.content ?? record.text ?? record.message?.content));
  }
  return out.slice(-limit);
}

function readBounded(file, maxBytes = 8 * 1024 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, 0);
    return buffer;
  } finally {
    try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

/** Read one indexed transcript. Only paths registered by a poll can be read, and
 *  sqlite-backed (zcode) or remote sessions have no text file: unsupported, never a
 *  filesystem guess. ENOENT degrades to an empty list. */
export function readTranscript(entry, { limit = TRANSCRIPT_LIMIT_DEFAULT, maxChars = 500 } = {}) {
  const base = { agent: entry.agent, session: entry.session, path: entry.path ? entry.path : null };
  if (!entry.path || entry.agent === 'zcode') return { ...base, lines: [], unsupported: true };
  let lines = [];
  if (entry.agent === 'dsh') {
    let buffer;
    try { buffer = readBounded(entry.path); }
    catch (e) { if (e.code === 'ENOENT') return { ...base, lines: [] }; throw e; }
    const events = decodeDshEvents(buffer);
    lines = parseTranscriptLines('dsh', events.map((event) => JSON.stringify(event)), { limit, maxChars });
  } else {
    const raw = tailLines(entry.path, Math.max(200, limit * 12));
    lines = parseTranscriptLines(entry.agent, raw, { limit, maxChars });
  }
  return { ...base, lines };
}

/** Build the addressable transcript registry from the rows of one poll. */
export function buildTranscriptIndex(rows) {
  const index = new Map();
  for (const row of rows) {
    if (!row || !row.path || !isObserveOnly(row.agent)) continue;
    index.set(`${row.agent}:${row.session}`, {
      agent: row.agent,
      session: row.session,
      path: row.path,
      source: row.source,
      updatedAt: Number(row.updatedAt) || null,
    });
  }
  return index;
}

/** Fold one poll into the long-lived per-adapter counters. */
export function trackObservePoll(stats, sources, rows, now = Date.now()) {
  for (const [id, source] of Object.entries(sources ?? {})) {
    const current = stats.get(id) ?? {
      okCount: 0, failCount: 0, lastOkAt: null, lastErrorAt: null,
      lastError: null, rowCount: 0, lastWriteAt: null,
    };
    if (source.ok) {
      current.okCount += 1;
      current.lastOkAt = now;
    } else {
      current.failCount += 1;
      current.lastErrorAt = now;
      if (source.error) current.lastError = source.error;
    }
    const mine = rows.filter((row) => row.agent === id);
    current.rowCount = mine.length;
    let latest = 0;
    for (const row of mine) if (Number(row.updatedAt) > latest) latest = Number(row.updatedAt);
    current.lastWriteAt = latest || null;
    stats.set(id, current);
  }
  return stats;
}

/** Public snapshot: observe-only rows sorted by recent activity, plus one health row
 *  per observe-only adapter (including adapters with no sessions at all). */
export function buildObserveSnapshot({
  adapters = [], sessions = [], sources = {}, stats = new Map(),
  limit = OBSERVE_LIMIT_DEFAULT, now = Date.now(),
} = {}) {
  const nameOf = new Map(adapters.map((adapter) => [adapter.id, adapter.name ?? adapter.id]));
  const rows = sessions
    .filter((row) => row && isObserveOnly(row.agent))
    .map((row) => ({
      agent: row.agent,
      agentName: nameOf.get(row.agent) ?? row.agent,
      session: row.session,
      title: row.title ?? '',
      project: observeProjectName(row),
      cwd: row.cwd ?? '',
      host: row.host ?? '',
      status: row.status ?? 'unknown',
      state: mapObserveState(row.status),
      lastMessage: row.lastMessage ?? '',
      updatedAt: Number(row.updatedAt) || null,
      lastSeen: Number(row.lastSeen) || null,
      path: row.path ?? null,
      stale: row.stale === true,
      tokens: row.tokens ?? null,
    }))
    .sort((a, b) => (b.updatedAt ?? b.lastSeen ?? 0) - (a.updatedAt ?? a.lastSeen ?? 0)
      || (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0)
      || (a.session < b.session ? -1 : a.session > b.session ? 1 : 0));
  const agents = adapters
    .filter((adapter) => isObserveOnly(adapter.id))
    .map((adapter) => {
      const counted = stats.get(adapter.id) ?? {};
      const source = sources[adapter.id] ?? {};
      return {
        id: adapter.id,
        name: adapter.name ?? adapter.id,
        tier: 'observe-only',
        ok: source.ok ?? null,
        lastSeen: source.lastSeen ?? null,
        okCount: counted.okCount ?? 0,
        failCount: counted.failCount ?? 0,
        lastOkAt: counted.lastOkAt ?? null,
        lastErrorAt: counted.lastErrorAt ?? source.lastSeen ?? null,
        lastError: counted.lastError ?? source.error ?? null,
        rowCount: counted.rowCount ?? 0,
        lastWriteAt: counted.lastWriteAt ?? null,
      };
    });
  return { generatedAt: now, limit, sessions: rows.slice(0, limit), total: rows.length, agents };
}
