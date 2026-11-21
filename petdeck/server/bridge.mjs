// petdeck local bridge — HTTP + SSE exposing real adapters to the browser app.
// Run: PETDECK_BRIDGE_TOKEN=... node server/bridge.mjs   (listens on 127.0.0.1:5199)
// Privacy: observe is read-only local fs; inject runs local CLIs (no shell); nothing leaves the machine.
// Import does NOT listen — call createApp()/main() so tests can inject fakes on an ephemeral port.
// main() requires PETDECK_BRIDGE_TOKEN (fails closed without it); PETDECK_BRIDGE_ORIGINS
// (comma-separated) is merged into the default allowed Origins.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import codex from './adapters/codex.mjs';
import claude from './adapters/claude.mjs';
import opencode from './adapters/opencode.mjs';
import kimi from './adapters/kimi.mjs';
import kimiCode from './adapters/kimi-code.mjs';
import zcode from './adapters/zcode.mjs';
import dsh from './adapters/dsh.mjs';
import cursor from './adapters/cursor.mjs';
import gemini from './adapters/gemini.mjs';
import remote from './adapters/remote.mjs';
import { TIER, injectDecision } from './tiers.mjs';
import { createBus, toPetEventType } from './bus.mjs';
import { pollOnce } from './freshness.mjs';
import { canonicalizeRows, createRootResolver } from './project-root.mjs';
import { createRuntimeService, RuntimeError } from './runtime/service.mjs';
import { resolveDataDir } from './runtime/db.mjs';
import { createLogger } from './runtime/logger.mjs';
import { pruneRunTranscripts, storageUsage } from './runtime/retention.mjs';
import { AGENT_CLI, collectDiagnostics, createAgentProbe } from './diagnostics.mjs';

const REAL_ADAPTERS = [codex, claude, opencode, kimi, kimiCode, zcode, dsh, cursor, gemini, remote];
// Reported by /api/health for the desktop status card. Read once: the file ships with
// the app, so a reload per request would be pure waste.
const APP_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? null; }
  catch { return null; }
})();
const DEFAULT_ALLOWED_HOSTS = ['127.0.0.1', 'localhost', '::1'];
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://tauri.localhost', 'http://localhost:5183'];

function withDefaults(security = {}) {
  return {
    token: security.token ?? '',
    allowedHostnames: security.allowedHostnames ?? DEFAULT_ALLOWED_HOSTS,
    allowedOrigins: security.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS,
    maxBodyBytes: security.maxBodyBytes ?? 64 * 1024,
    maxInject: security.maxInject ?? 4,
  };
}

function normalizeHostname(host) {
  const h = String(host || '');
  const bracketed = h.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) return bracketed[1];
  // Bare hostname or hostname:port — but never strip the colons of an unbracketed IPv6 literal.
  if (h.includes(':') && h.indexOf(':') !== h.lastIndexOf(':')) return h;
  return h.split(':')[0];
}

// Failure-log red line: STRUCTURED metadata only — adapter id, allowlisted error
// name/code, outcome category (timeout / spawn-error / exit:<code>). Never log arbitrary
// text: error messages, error name/code fields, and stderr can echo the prompt (payload),
// and single-lining or truncating text is not content sanitization.
const SAFE_CODE = /^(timeout|exit:-?\d+|spawn-error(:[A-Z0-9_]+)?)$/;
function safeCode(s) {
  const t = String(s ?? '');
  return SAFE_CODE.test(t) ? t : '';
}

// Adapter-thrown e.name/e.code are free text (an adapter may echo the prompt in them),
// so the catch log only carries allowlisted structured values; anything else collapses
// to the 'unknown' constant — never interpolated verbatim.
const SAFE_ERR_NAME = /^(Error|TimeoutError|AbortError|AggregateError)$/;
const SAFE_ERR_CODE = /^(ETIMEDOUT|ETIMEOUT|ECONNREFUSED|ECONNRESET|EACCES|EPERM|ENOENT|EAI_AGAIN|EBADF|EPIPE|BODY_TOO_LARGE)$/;
function safeInjectErrorMeta(e) {
  const name = SAFE_ERR_NAME.test(String(e?.name ?? '')) ? e.name : 'unknown';
  const code = SAFE_ERR_CODE.test(String(e?.code ?? '')) ? e.code : 'unknown';
  return { name, code };
}

function hostAllowed(req, sec) {
  return sec.allowedHostnames.includes(normalizeHostname(req.headers.host));
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; let settled = false; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max && !settled) {
        settled = true;
        // Keep consuming (drain) the remaining body so the keep-alive socket is not
        // poisoned by unread bytes after the 413 response; 'data' handler discards them.
        req.resume();
        const e = new Error('body too large'); e.code = 'BODY_TOO_LARGE'; reject(e);
      }
      else if (!settled) chunks.push(c);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
  });
}

/** Build the bridge HTTP server (not listening). Pure w.r.t. injected adapters/security/bus. */
export function createApp({
  adapters = REAL_ADAPTERS, security = {}, bus = createBus(100), logger = console, runtime = null,
  // Tests inject a fake so health never spawns real CLIs; production probes are cached 60s.
  probe = createAgentProbe(),
} = {}) {
  const sec = withDefaults(security);
  const bootedAt = Date.now();
  let sessions = [];
  let sessionsKey = '';
  // One cache for the whole process: cwd -> git work tree root rarely changes.
  const resolveProjectRoot = createRootResolver();
  let lastGood = new Map();
  let sources = {};
  const lastStatus = new Map();
  let statusBaselineReady = false;
  let inflight = 0;
  let pollInFlight = false;

  // Re-entrancy guard: a tick that arrives while the previous poll is still
  // observing is skipped (slow adapters must never stack up overlapping walks).
  async function poll() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
      const res = await pollOnce(adapters, lastGood, Date.now());
      lastGood = res.lastGood;
      sources = res.sources;
      // Group by repository root and flush relay scratch dirs before anything is
      // published: the UI, the event bus and /api/sessions must see the same rows.
      const rows = canonicalizeRows(res.sessions, { resolveRoot: resolveProjectRoot });
      const groupingKey = rows.map((r) => `${r.agent}:${r.session}:${r.cwd ?? ''}:${r.temp ? 1 : 0}`).join('|');
      const seenKeys = new Set();
      for (const r of rows) {
        const key = `${r.agent}:${r.session}`;
        seenKeys.add(key);
        if (lastStatus.get(key) !== r.status) {
          lastStatus.set(key, r.status);
          if (statusBaselineReady) {
            const type = r.status === 'done' ? 'task_complete' : r.status === 'stuck' ? 'turn_aborted' : r.status === 'waiting' ? 'decision' : r.status === 'running' ? 'task_started' : 'status_unknown';
            bus.emit({ agentId: r.agent, sessionId: r.session, type, petType: toPetEventType(type), payload: { session: { ...r } } });
          }
        }
      }
      statusBaselineReady = true;
      // Prune status memory to sessions still present this round; a session that
      // vanishes and later returns re-emits its status event instead of being silent.
      for (const key of lastStatus.keys()) if (!seenKeys.has(key)) lastStatus.delete(key);
      const key = `${res.key}|${groupingKey}`;
      if (key !== sessionsKey) {
        sessionsKey = key;
        bus.emit({ type: 'sessions', petType: 'sessions', payload: { sessions: rows } });
      }
      sessions = rows;
    } finally {
      pollInFlight = false;
    }
  }

  function cors(res, req) {
    const origin = req?.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin && sec.allowedOrigins.includes(origin) ? origin : sec.allowedOrigins[0]);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Petdeck-Token');
    res.setHeader('Vary', 'Origin');
  }
  function json(res, req, code, obj) {
    cors(res, req);
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  }

  // Runtime writes share inject's guard shape: whitelisted Origin, token, JSON body,
  // bounded size. Kept as one helper so a new endpoint cannot silently skip a check.
  async function readJsonWrite(req, res) {
    const origin = req.headers.origin;
    if (origin && !sec.allowedOrigins.includes(origin)) { json(res, req, 403, { ok: false, error: 'forbidden origin' }); return null; }
    if (!String(req.headers['content-type'] || '').includes('application/json')) { json(res, req, 415, { ok: false, error: 'json required' }); return null; }
    if (sec.token && req.headers['x-petdeck-token'] !== sec.token) { json(res, req, 401, { ok: false, error: 'unauthorised' }); return null; }
    let body;
    try { body = await readBody(req, sec.maxBodyBytes); }
    catch (e) { json(res, req, e.code === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'unreadable body' }); return null; }
    let payload = {};
    try { payload = body.trim() ? JSON.parse(body) : {}; }
    catch { json(res, req, 400, { ok: false, error: 'invalid json' }); return null; }
    return payload;
  }

  function runtimeUnavailable(res, req) {
    json(res, req, 503, { ok: false, error: 'runtime unavailable' });
  }

  function runtimeFailure(res, req, e, logger) {
    if (e instanceof RuntimeError) {
      return json(res, req, e.status, { ok: false, error: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) });
    }
    logger.error?.('[petdeck-runtime] request failed:', e?.message ?? e);
    return json(res, req, 500, { ok: false, error: 'runtime error' });
  }

  function sendEvent(res, event) {
    res.write(`id: ${event.id}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  /**
   * M5 W1: health for the desktop status card. Non-deep is cheap by design — it only
   * reads cached CLI probes (and warms them in the background), so the reconnect loop
   * that pings /api/health never waits on a spawning process. Deep probes are served
   * by the guarded /api/runtime/status route used by the settings card.
   */
  async function healthPayload({ deep = false } = {}) {
    const runtimeStatus = typeof runtime?.statusSnapshot === 'function' ? runtime.statusSnapshot() : null;
    const entries = adapters.map((a) => ({ id: a.id, name: a.name, tier: TIER[a.id] ?? 'observe-only', command: AGENT_CLI[a.id] ?? null }));
    const probed = await probe.list(entries, { deep });
    return {
      ok: true,
      version: APP_VERSION,
      node: process.version,
      startedAt: new Date(bootedAt).toISOString(),
      port: server.address()?.port ?? null,
      authRequired: Boolean(sec.token),
      dataDir: runtimeStatus?.dataDir ?? null,
      logDir: runtimeStatus?.dataDir ? path.join(runtimeStatus.dataDir, 'logs') : null,
      dbVersion: runtimeStatus?.dbVersion ?? null,
      runtime: runtimeStatus,
      adapters: probed,
      agents: adapters.map((a) => ({ id: a.id, name: a.name, tier: TIER[a.id] })),
      sources,
    };
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'OPTIONS') { cors(res, req); res.writeHead(204); res.end(); return; }

    // Every route is bound to a local loopback Host (DNS-rebinding guard).
    if (!hostAllowed(req, sec)) return json(res, req, 403, { ok: false, error: 'forbidden host' });

    // Read-endpoint guard: sessions/events expose session titles and last messages, so a
    // browser context must present a whitelisted Origin, and a configured token must be
    // presented (header; SSE may use ?token= since EventSource cannot set headers).
    // A request without an Origin header is a non-browser client and still needs the token.
    const readGuard = (allowQueryToken = false) => {
      const origin = req.headers.origin;
      if (origin && !sec.allowedOrigins.includes(origin)) { json(res, req, 403, { ok: false, error: 'forbidden origin' }); return true; }
      if (sec.token) {
        const presented = req.headers['x-petdeck-token'] ?? (allowQueryToken ? url.searchParams.get('token') : undefined);
        if (presented !== sec.token) { json(res, req, 401, { ok: false, error: 'unauthorised' }); return true; }
      }
      return false;
    };

    if (url.pathname === '/api/health') return json(res, req, 200, await healthPayload());
    if (url.pathname === '/api/runtime/status') {
      if (readGuard()) return;
      return json(res, req, 200, await healthPayload({ deep: true }));
    }
    if (url.pathname === '/api/diagnostics/export' && req.method === 'POST') {
      const payload = await readJsonWrite(req, res);
      if (!payload) return;
      if (!runtime) return runtimeUnavailable(res, req);
      try {
        const entries = adapters.map((a) => ({ id: a.id, name: a.name, tier: TIER[a.id] ?? 'observe-only', command: AGENT_CLI[a.id] ?? null }));
        const agents = await probe.list(entries, { deep: true });
        const pkg = await collectDiagnostics({
          version: APP_VERSION,
          port: server.address()?.port ?? null,
          authRequired: Boolean(sec.token),
          runtime,
          agents,
        });
        return json(res, req, 200, { ok: true, ...pkg });
      } catch (e) { return runtimeFailure(res, req, e, logger); }
    }
    if (url.pathname === '/api/storage') {
      if (readGuard()) return;
      const dir = runtime?.statusSnapshot?.().dataDir;
      if (!dir) return runtimeUnavailable(res, req);
      try { return json(res, req, 200, { ok: true, storage: storageUsage({ dir }) }); }
      catch (e) { return runtimeFailure(res, req, e, logger); }
    }
    if (url.pathname === '/api/storage/cleanup' && req.method === 'POST') {
      const payload = await readJsonWrite(req, res);
      if (!payload) return;
      const dir = runtime?.statusSnapshot?.().dataDir;
      if (!dir) return runtimeUnavailable(res, req);
      try {
        const days = Math.min(365, Math.max(1, Number(payload.days) || 30));
        const result = pruneRunTranscripts({ dir, keepDays: days });
        logger.info?.('storage.cleaned', { days, removed: result.removed, bytes: result.bytes });
        return json(res, req, 200, { ok: true, days, ...result });
      } catch (e) { return runtimeFailure(res, req, e, logger); }
    }
    if (url.pathname === '/api/agents') { if (readGuard()) return; return json(res, req, 200, adapters.filter((a) => a.id !== 'remote').map((a) => ({ id: a.id, name: a.name, form: 'cli', capability: TIER[a.id], status: 'idle', projectIds: [] }))); }
    if (url.pathname === '/api/sessions') { if (readGuard()) return; return json(res, req, 200, sessions); }
    if (url.pathname === '/api/events') {
      if (readGuard(true)) return;
      cors(res, req);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      // Flush headers immediately (an SSE comment line) so clients observe connection
      // success before the first event; without it the response headers are buffered.
      res.write(': sse connected\n\n');
      const un = bus.subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
      req.on('close', un);
      return;
    }
    if (url.pathname === '/api/inject' && req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && !sec.allowedOrigins.includes(origin)) return json(res, req, 403, { ok: false, error: 'forbidden origin' });
      if (!String(req.headers['content-type'] || '').includes('application/json')) return json(res, req, 415, { ok: false, error: 'json required' });
      if (sec.token && req.headers['x-petdeck-token'] !== sec.token) return json(res, req, 401, { ok: false, error: 'unauthorised' });
      if (inflight >= sec.maxInject) return json(res, req, 429, { ok: false, error: 'too many in-flight injections' });
      let body;
      try { body = await readBody(req, sec.maxBodyBytes); }
      catch (e) { return json(res, req, e.code === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: 'unreadable body' }); }
      let payload = {};
      try { payload = JSON.parse(body); } catch { return json(res, req, 400, { ok: false, error: 'invalid json' }); }
      const target = adapters.find((a) => a.id === payload.to);
      if (!target) return json(res, req, 400, { ok: false, error: 'unknown target' });
      inflight++;
      try {
        const result = await target.inject(payload);
        const decision = injectDecision(TIER[target.id], result, {
          from: payload.from, context: payload.context, instruction: payload.instruction, artifacts: payload.artifacts,
        });
        if (decision.mode === 'clipboard' && decision.fallbackReason === 'cli') {
          const code = safeCode(result?.summary);
          logger.error(`[petdeck-bridge] inject failed adapter=${target.id} reason=cli${code ? ` code=${code}` : ''}`);
        }
        return json(res, req, 200, { ok: true, ...decision });
      } catch (e) {
        const { name, code } = safeInjectErrorMeta(e);
        logger.error(`[petdeck-bridge] inject failed adapter=${target.id} error=${name} code=${code}`);
        return json(res, req, 500, { ok: false, error: 'inject failed', reason: 'bridge-error' });
      } finally { inflight--; }
    }
    // --- runtime: projects / tasks / runs / events -------------------------
    if (url.pathname === '/api/runtime/projects') {
      if (readGuard()) return;
      if (!runtime) return runtimeUnavailable(res, req);
      if (req.method === 'GET') return json(res, req, 200, { ok: true, projects: runtime.listProjects() });
      if (req.method === 'POST') {
        const payload = await readJsonWrite(req, res);
        if (!payload) return;
        try {
          const result = await runtime.registerProject({ projectPath: payload.path, name: payload.name ?? null });
          return json(res, req, result.created ? 201 : 200, { ok: true, ...result });
        } catch (e) { return runtimeFailure(res, req, e, logger); }
      }
      return json(res, req, 405, { ok: false, error: 'method not allowed' });
    }

    if (url.pathname === '/api/runtime/agents') {
      if (readGuard()) return;
      if (!runtime) return runtimeUnavailable(res, req);
      if (req.method === 'GET') return json(res, req, 200, { ok: true, agents: runtime.listAgents() });
      return json(res, req, 405, { ok: false, error: 'method not allowed' });
    }

    if (url.pathname === '/api/runtime/settings') {
      if (readGuard()) return;
      if (!runtime) return runtimeUnavailable(res, req);
      if (req.method === 'GET') return json(res, req, 200, { ok: true, settings: runtime.getSettings() });
      if (req.method === 'PUT') {
        const payload = await readJsonWrite(req, res);
        if (!payload) return;
        try { return json(res, req, 200, { ok: true, settings: runtime.updateSettings(payload) }); }
        catch (e) { return runtimeFailure(res, req, e, logger); }
      }
      return json(res, req, 405, { ok: false, error: 'method not allowed' });
    }

    if (url.pathname === '/api/runtime/manager/settings') {
      if (readGuard()) return;
      if (!runtime) return runtimeUnavailable(res, req);
      if (req.method === 'GET') return json(res, req, 200, { ok: true, manager: runtime.getManagerSettings() });
      if (req.method === 'PUT') {
        const payload = await readJsonWrite(req, res);
        if (!payload) return;
        try { return json(res, req, 200, { ok: true, manager: runtime.updateManagerSettings(payload) }); }
        catch (e) { return runtimeFailure(res, req, e, logger); }
      }
      return json(res, req, 405, { ok: false, error: 'method not allowed' });
    }

    if (url.pathname === '/api/runtime/manager/test' && req.method === 'POST') {
      const payload = await readJsonWrite(req, res);
      if (!payload) return;
      if (!runtime) return runtimeUnavailable(res, req);
      try { return json(res, req, 200, { ok: true, ...(await runtime.testManager()) }); }
      catch (e) { return runtimeFailure(res, req, e, logger); }
    }

    if (url.pathname === '/api/runtime/manager/messages') {
      if (readGuard()) return;
      if (!runtime) return runtimeUnavailable(res, req);
      if (req.method === 'GET') {
        const limit = Number(url.searchParams.get('limit'));
        return json(res, req, 200, { ok: true, messages: runtime.listManagerMessages({ limit: Number.isFinite(limit) && limit > 0 ? Math.min(500, limit) : 100 }) });
      }
      if (req.method === 'POST') {
        const payload = await readJsonWrite(req, res);
        if (!payload) return;
        try {
          const result = await runtime.sendManagerMessage({ content: payload.content ?? '', projectId: payload.projectId ?? null });
          return json(res, req, 200, { ok: true, ...result });
        } catch (e) { return runtimeFailure(res, req, e, logger); }
      }
      return json(res, req, 405, { ok: false, error: 'method not allowed' });
    }

    if (url.pathname === '/api/runtime/proposals') {
      if (readGuard()) return;
      if (!runtime) return runtimeUnavailable(res, req);
      if (req.method === 'GET') {
        return json(res, req, 200, { ok: true, proposals: runtime.listProposals(url.searchParams.get('status') || 'pending') });
      }
      return json(res, req, 405, { ok: false, error: 'method not allowed' });
    }

    const proposalRoute = url.pathname.match(/^\/api\/runtime\/proposals\/([^/]+)\/(confirm|reject|update)$/);
    if (proposalRoute) {
      if (req.method !== 'POST') return json(res, req, 405, { ok: false, error: 'method not allowed' });
      const payload = await readJsonWrite(req, res);
      if (!payload) return;
      if (!runtime) return runtimeUnavailable(res, req);
      try {
        let proposalId;
        try { proposalId = decodeURIComponent(proposalRoute[1]); } catch { return json(res, req, 400, { ok: false, error: 'invalid proposal id' }); }
        const action = proposalRoute[2];
        if (action === 'confirm') {
          const result = await runtime.confirmProposal(proposalId, { start: payload.start !== false });
          return json(res, req, 200, { ok: true, ...result });
        }
        if (action === 'reject') {
          return json(res, req, 200, { ok: true, proposal: runtime.rejectProposal(proposalId, { reason: payload.reason ?? '' }) });
        }
        return json(res, req, 200, { ok: true, proposal: runtime.updateProposal(proposalId, payload) });
      } catch (e) { return runtimeFailure(res, req, e, logger); }
    }

    if (url.pathname === '/api/runtime/reports/generate' && req.method === 'POST') {
      const payload = await readJsonWrite(req, res);
      if (!payload) return;
      if (!runtime) return runtimeUnavailable(res, req);
      try {
        const report = await runtime.generateDailyReport({ date: payload.date ?? null, projectId: payload.projectId ?? null });
        return json(res, req, 200, { ok: true, report });
      } catch (e) { return runtimeFailure(res, req, e, logger); }
    }

    if (url.pathname === '/api/runtime/reports') {
      if (readGuard()) return;
      if (!runtime) return runtimeUnavailable(res, req);
      if (req.method === 'GET') {
        const limit = Number(url.searchParams.get('limit'));
        return json(res, req, 200, {
          ok: true,
          reports: runtime.listReports({
            projectId: url.searchParams.get('projectId') || null,
            limit: Number.isFinite(limit) && limit > 0 ? Math.min(100, limit) : 30,
          }),
        });
      }
      return json(res, req, 405, { ok: false, error: 'method not allowed' });
    }

    const reportRoute = url.pathname.match(/^\/api\/runtime\/reports\/([^/]+)$/);
    if (reportRoute) {
      if (readGuard()) return;
      if (!runtime) return runtimeUnavailable(res, req);
      if (req.method !== 'GET') return json(res, req, 405, { ok: false, error: 'method not allowed' });
      try {
        let reportId;
        try { reportId = decodeURIComponent(reportRoute[1]); } catch { return json(res, req, 400, { ok: false, error: 'invalid report id' }); }
        return json(res, req, 200, { ok: true, report: runtime.getReport(reportId) });
      } catch (e) { return runtimeFailure(res, req, e, logger); }
    }

    if (url.pathname === '/api/runtime/decisions') {
      if (readGuard()) return;
      if (!runtime) return runtimeUnavailable(res, req);
      if (req.method === 'GET') return json(res, req, 200, { ok: true, decisions: runtime.listDecisions() });
      return json(res, req, 405, { ok: false, error: 'method not allowed' });
    }

    const decisionRoute = url.pathname.match(/^\/api\/runtime\/decisions\/([^/]+)\/answer$/);
    if (decisionRoute) {
      if (!runtime) return runtimeUnavailable(res, req);
      if (req.method !== 'POST') return json(res, req, 405, { ok: false, error: 'method not allowed' });
      const payload = await readJsonWrite(req, res);
      if (!payload) return;
      try {
        let decisionId;
        try { decisionId = decodeURIComponent(decisionRoute[1]); } catch { return json(res, req, 400, { ok: false, error: 'invalid decision id' }); }
        const result = await runtime.answerDecision(decisionId, { answer: payload.answer ?? null, optionIndex: payload.optionIndex ?? null });
        return json(res, req, 200, { ok: true, ...result });
      } catch (e) { return runtimeFailure(res, req, e, logger); }
    }

    if (url.pathname === '/api/runtime/tasks') {
      if (readGuard()) return;
      if (!runtime) return runtimeUnavailable(res, req);
      if (req.method === 'GET') {
        const projectId = url.searchParams.get('projectId') || null;
        return json(res, req, 200, { ok: true, tasks: runtime.listTasks(projectId) });
      }
      if (req.method === 'POST') {
        const payload = await readJsonWrite(req, res);
        if (!payload) return;
        try {
          const task = runtime.createTask({
            projectId: payload.projectId,
            title: payload.title,
            prompt: payload.prompt,
            agent: payload.agent,
            permissionMode: payload.permissionMode,
            dependsOn: payload.dependsOn,
            priority: payload.priority,
          });
          return json(res, req, 201, { ok: true, task });
        } catch (e) { return runtimeFailure(res, req, e, logger); }
      }
      return json(res, req, 405, { ok: false, error: 'method not allowed' });
    }

    const artifactRoute = url.pathname.match(/^\/api\/runtime\/artifacts\/([^/]+)(\/content)?$/);
    if (artifactRoute) {
      if (!runtime) return runtimeUnavailable(res, req);
      const isContent = Boolean(artifactRoute[2]);
      if (isContent) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, req, 405, { ok: false, error: 'method not allowed' });
        if (readGuard(true)) return;
        let artifactId;
        try { artifactId = decodeURIComponent(artifactRoute[1]); } catch { return json(res, req, 400, { ok: false, error: 'invalid artifact id' }); }
        const artifact = runtime.getArtifact(artifactId);
        if (!artifact) return json(res, req, 404, { ok: false, error: 'artifact not found' });
        let stat;
        try { stat = fs.statSync(artifact.stored_path); }
        catch { return json(res, req, 404, { ok: false, error: 'artifact file missing' }); }
        const total = stat.size;
        const range = req.headers.range;
        let start = 0;
        let end = total - 1;
        let partial = false;
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
          if (!match) {
            cors(res, req);
            res.writeHead(416, { 'Content-Range': 'bytes */' + total });
            return res.end();
          }
          if (match[1]) start = Number(match[1]);
          if (match[2]) end = Number(match[2]);
          if (!match[1] && match[2]) { start = Math.max(0, total - Number(match[2])); end = total - 1; }
          if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
            cors(res, req);
            res.writeHead(416, { 'Content-Range': 'bytes */' + total });
            return res.end();
          }
          end = Math.min(end, total - 1);
          partial = true;
        }
        const inline = ['image', 'video', 'audio', 'pdf'].includes(artifact.kind);
        const safeName = String(artifact.name || 'artifact').replace(/["\r\n]/g, '_');
        const headers = {
          'Content-Type': artifact.mime || 'application/octet-stream',
          'Content-Length': end - start + 1,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': (inline ? 'inline' : 'attachment') + '; filename="' + safeName + '"; filename*=UTF-8\'\'' + encodeURIComponent(safeName),
          ...(partial ? { 'Content-Range': 'bytes ' + start + '-' + end + '/' + total } : {}),
        };
        cors(res, req);
        res.writeHead(partial ? 206 : 200, headers);
        if (req.method === 'HEAD') return res.end();
        const stream = fs.createReadStream(artifact.stored_path, { start, end });
        stream.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
        return stream.pipe(res);
      }
      if (req.method === 'DELETE') {
        const payload = await readJsonWrite(req, res);
        if (payload === null) return;
        let artifactId;
        try { artifactId = decodeURIComponent(artifactRoute[1]); } catch { return json(res, req, 400, { ok: false, error: 'invalid artifact id' }); }
        try { return json(res, req, 200, { ok: true, ...runtime.removeArtifact(payload.taskId, artifactId) }); }
        catch (e) { return runtimeFailure(res, req, e, logger); }
      }
      return json(res, req, 405, { ok: false, error: 'method not allowed' });
    }

    const taskRoute = url.pathname.match(/^\/api\/runtime\/tasks\/([^/]+)(?:\/(start|stop|resume|pause|continue|accept|reject|merge|authorize-merge|abandon-merge|cleanup|events|stream|artifacts|merge-preview))?$/);
    if (taskRoute) {
      if (!runtime) return runtimeUnavailable(res, req);
      let taskId;
      try { taskId = decodeURIComponent(taskRoute[1]); } catch { return json(res, req, 400, { ok: false, error: 'invalid task id' }); }
      const action = taskRoute[2] || null;

      if (action === 'stream' && req.method === 'GET') {
        if (readGuard(true)) return;
        cors(res, req);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(': sse connected\n\n');
        let lastId = Number(url.searchParams.get('after') || 0) || 0;
        const unsubscribe = runtime.subscribe((event) => {
          if (event.taskId !== taskId || event.id <= lastId) return;
          lastId = event.id;
          sendEvent(res, event);
        });
        try {
          for (const event of runtime.listEvents(taskId, { after: lastId, limit: 5000 })) {
            if (event.id <= lastId) continue;
            lastId = event.id;
            sendEvent(res, event);
          }
        } catch {
          unsubscribe();
          res.write('event: error\ndata: ' + JSON.stringify({ error: 'task not found' }) + '\n\n');
          res.end();
          return;
        }
        const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);
        keepAlive.unref?.();
        req.on('close', () => { clearInterval(keepAlive); unsubscribe(); });
        return;
      }

      if (req.method === 'GET' && !action) {
        if (readGuard()) return;
        try { return json(res, req, 200, { ok: true, ...runtime.getTaskDetail(taskId) }); }
        catch (e) { return runtimeFailure(res, req, e, logger); }
      }
      if (req.method === 'GET' && action === 'events') {
        if (readGuard()) return;
        try {
          const after = Number(url.searchParams.get('after') || 0) || 0;
          const limit = Number(url.searchParams.get('limit') || 500) || 500;
          return json(res, req, 200, { ok: true, events: runtime.listEvents(taskId, { after, limit }) });
        } catch (e) { return runtimeFailure(res, req, e, logger); }
      }
      if (req.method === 'GET' && action === 'merge-preview') {
        if (readGuard()) return;
        try { return json(res, req, 200, { ok: true, preview: await runtime.mergePreviewForTask(taskId) }); }
        catch (e) { return runtimeFailure(res, req, e, logger); }
      }
      if (action === 'artifacts') {
        if (req.method === 'GET') {
          if (readGuard()) return;
          try { return json(res, req, 200, { ok: true, artifacts: runtime.listArtifacts(taskId) }); }
          catch (e) { return runtimeFailure(res, req, e, logger); }
        }
        if (req.method === 'POST') {
          const payload = await readJsonWrite(req, res);
          if (!payload) return;
          try { return json(res, req, 201, { ok: true, artifact: runtime.addArtifact(taskId, { path: payload.path }) }); }
          catch (e) { return runtimeFailure(res, req, e, logger); }
        }
        return json(res, req, 405, { ok: false, error: 'method not allowed' });
      }
      if (req.method === 'POST' && ['accept', 'reject', 'merge', 'authorize-merge', 'abandon-merge', 'cleanup'].includes(action)) {
        const payload = await readJsonWrite(req, res);
        if (!payload) return;
        try {
          if (action === 'accept') return json(res, req, 200, { ok: true, ...(await runtime.acceptTask(taskId)) });
          if (action === 'reject') return json(res, req, 200, { ok: true, ...(await runtime.rejectTask(taskId, { feedback: payload.feedback, agent: payload.agent ?? null })) });
          if (action === 'authorize-merge') return json(res, req, 200, { ok: true, ...(await runtime.authorizeMerge(taskId)) });
          if (action === 'merge') return json(res, req, 200, { ok: true, ...(await runtime.mergeTask(taskId, { token: payload.token })) });
          if (action === 'abandon-merge') return json(res, req, 200, { ok: true, ...(await runtime.abandonMerge(taskId)) });
          return json(res, req, 200, { ok: true, ...(await runtime.cleanupTask(taskId)) });
        } catch (e) { return runtimeFailure(res, req, e, logger); }
      }
      if (req.method === 'POST' && ['start', 'stop', 'resume', 'pause', 'continue'].includes(action)) {
        const payload = await readJsonWrite(req, res);
        if (!payload) return;
        try {
          if (action === 'start') return json(res, req, 202, { ok: true, run: await runtime.startTask(taskId, { permissionMode: payload.permissionMode ?? null }) });
          if (action === 'resume') return json(res, req, 202, { ok: true, run: await runtime.resumeTask(taskId, { prompt: payload.prompt ?? null, permissionMode: payload.permissionMode ?? null }) });
          if (action === 'pause') return json(res, req, 200, { ok: true, ...(await runtime.pauseTask(taskId)) });
          if (action === 'continue') return json(res, req, 200, { ok: true, ...(await runtime.resumePausedTask(taskId)) });
          return json(res, req, 200, { ok: true, ...(await runtime.stopTask(taskId)) });
        } catch (e) { return runtimeFailure(res, req, e, logger); }
      }
      return json(res, req, 405, { ok: false, error: 'method not allowed' });
    }

    return json(res, req, 404, { ok: false, error: 'not found' });
  });

  server.poll = poll;
  return server;
}

/** Start periodic polling with a fault-tolerant wrapper (carry: poll().catch). */
export function startPolling(server, intervalMs = 5000, logger = console) {
  const tick = () => Promise.resolve(server.poll()).catch((e) => logger.error?.('[petdeck-bridge] poll failed (kept last-known-good)', { reason: e?.name ?? 'unknown' }));
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}

/** Build production security from the environment (token mandatory; Origins merged with defaults). */
export function securityFromEnv(env = process.env) {
  const token = env.PETDECK_BRIDGE_TOKEN || '';
  const extraOrigins = String(env.PETDECK_BRIDGE_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    token,
    allowedHostnames: [...DEFAULT_ALLOWED_HOSTS],
    allowedOrigins: [...DEFAULT_ALLOWED_ORIGINS, ...extraOrigins],
  };
}

// Tests may inject {adapters, startPoll} to stay hermetic; production uses the defaults.
export function main({ adapters = REAL_ADAPTERS, startPoll = true, runtime } = {}) {
  const PORT = Number(process.env.PETDECK_BRIDGE_PORT || 5199);
  const security = securityFromEnv();
  // File logs live beside the runtime database, so a diagnostic package can collect
  // them and the desktop app's sidecar log stays the "bridge won't start" channel.
  const dataDir = resolveDataDir(process.env);
  const logger = createLogger({ dir: path.join(dataDir, 'logs'), scope: 'bridge' });
  logger.info('bridge.start', { version: APP_VERSION, node: process.version, port: PORT, dataDir });
  if (!security.token) {
    logger.error('bridge.config_error', { reason: 'PETDECK_BRIDGE_TOKEN missing' });
    console.error('[petdeck-bridge] configuration error: PETDECK_BRIDGE_TOKEN is required (refusing to start without inject auth). Set it and retry.');
    return null;
  }
  const rt = runtime === undefined ? createRuntimeService({ logger }) : runtime;
  const server = createApp({ adapters, security, runtime: rt, logger });
  const shutdown = async (signal) => {
    logger.info('bridge.shutdown', { signal });
    console.log('[petdeck-bridge] shutting down (' + signal + ')');
    server.close();
    try { await rt?.shutdown(); } catch (e) { logger.error('bridge.shutdown_failed', { reason: e?.name ?? 'unknown' }); }
  };
  process.once('SIGINT', () => { shutdown('SIGINT'); });
  process.once('SIGTERM', () => { shutdown('SIGTERM'); });
  server.listen(PORT, '127.0.0.1', () => {
    logger.info('bridge.listening', { port: PORT, home: os.homedir() });
    console.log(`[petdeck-bridge] listening on http://127.0.0.1:${PORT} (home=${os.homedir()}) auth=token`);
    if (startPoll) {
      startPolling(server, 5000, logger.child('poll'));
      // Live "running" status for opencode v2 comes from its SSE execution events.
      // Only the long-lived bridge starts the watcher (tests/verify-local stay short-lived).
      if (adapters.some((a) => a.id === 'opencode')) opencode.startEventWatcher();
    }
  });
  return server;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
