// petdeck local bridge — HTTP + SSE exposing real adapters to the browser app.
// Run: PETDECK_BRIDGE_TOKEN=... node server/bridge.mjs   (listens on 127.0.0.1:5199)
// Privacy: observe is read-only local fs; inject runs local CLIs (no shell); nothing leaves the machine.
// Import does NOT listen — call createApp()/main() so tests can inject fakes on an ephemeral port.
// main() requires PETDECK_BRIDGE_TOKEN (fails closed without it); PETDECK_BRIDGE_ORIGINS
// (comma-separated) is merged into the default allowed Origins.
import http from 'node:http';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import codex from './adapters/codex.mjs';
import claude from './adapters/claude.mjs';
import opencode from './adapters/opencode.mjs';
import kimi from './adapters/kimi.mjs';
import { TIER, injectDecision } from './tiers.mjs';
import { createBus } from './bus.mjs';
import { pollOnce } from './freshness.mjs';

const REAL_ADAPTERS = [codex, claude, opencode, kimi];
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
export function createApp({ adapters = REAL_ADAPTERS, security = {}, bus = createBus(100), logger = console } = {}) {
  const sec = withDefaults(security);
  let sessions = [];
  let sessionsKey = '';
  let lastGood = new Map();
  let sources = {};
  const lastStatus = new Map();
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
      const seenKeys = new Set();
      for (const r of res.sessions) {
        const key = `${r.agent}:${r.session}`;
        seenKeys.add(key);
        if (lastStatus.get(key) !== r.status) {
          lastStatus.set(key, r.status);
          const type = r.status === 'done' ? 'task_complete' : r.status === 'stuck' ? 'turn_aborted' : r.status === 'waiting' ? 'decision' : 'task_started';
          bus.emit({ agentId: r.agent, sessionId: r.session, type, petType: r.status === 'done' ? 'done' : r.status === 'stuck' ? 'stuck' : r.status === 'waiting' ? 'decision' : '', payload: { lastMessage: r.lastMessage } });
        }
      }
      // Prune status memory to sessions still present this round; a session that
      // vanishes and later returns re-emits its status event instead of being silent.
      for (const key of lastStatus.keys()) if (!seenKeys.has(key)) lastStatus.delete(key);
      if (res.key !== sessionsKey) {
        sessionsKey = res.key;
        bus.emit({ type: 'sessions', petType: 'sessions', payload: { sessions: res.sessions } });
      }
      sessions = res.sessions;
    } finally {
      pollInFlight = false;
    }
  }

  function cors(res, req) {
    const origin = req?.headers.origin;
    res.setHeader('Access-Control-Allow-Origin', origin && sec.allowedOrigins.includes(origin) ? origin : sec.allowedOrigins[0]);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Petdeck-Token');
    res.setHeader('Vary', 'Origin');
  }
  function json(res, req, code, obj) {
    cors(res, req);
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
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

    if (url.pathname === '/api/health') return json(res, req, 200, { ok: true, authRequired: Boolean(sec.token), agents: adapters.map((a) => ({ id: a.id, name: a.name, tier: TIER[a.id] })), sources });
    if (url.pathname === '/api/agents') { if (readGuard()) return; return json(res, req, 200, adapters.map((a) => ({ id: a.id, name: a.name, form: 'cli', capability: TIER[a.id], status: 'idle', projectIds: [] }))); }
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
    return json(res, req, 404, { ok: false, error: 'not found' });
  });

  server.poll = poll;
  return server;
}

/** Start periodic polling with a fault-tolerant wrapper (carry: poll().catch). */
export function startPolling(server, intervalMs = 5000) {
  const tick = () => Promise.resolve(server.poll()).catch((e) => console.error('[petdeck-bridge] poll failed (kept last-known-good):', e?.message ?? e));
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
export function main({ adapters = REAL_ADAPTERS, startPoll = true } = {}) {
  const PORT = Number(process.env.PETDECK_BRIDGE_PORT || 5199);
  const security = securityFromEnv();
  if (!security.token) {
    console.error('[petdeck-bridge] configuration error: PETDECK_BRIDGE_TOKEN is required (refusing to start without inject auth). Set it and retry.');
    return null;
  }
  const server = createApp({ adapters, security });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[petdeck-bridge] listening on http://127.0.0.1:${PORT} (home=${os.homedir()}) auth=token`);
    if (startPoll) startPolling(server);
  });
  return server;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
