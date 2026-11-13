// petdeck local bridge — HTTP + SSE exposing real adapters to the browser app.
// Run: node server/bridge.mjs   (listens on 127.0.0.1:5199, CORS for Vite 5173)
// Privacy: observe is read-only local fs; inject runs local CLIs (no shell); nothing leaves the machine.
// Import does NOT listen — call createApp()/main() so tests can inject fakes on an ephemeral port.
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
const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function withDefaults(security = {}) {
  return {
    token: security.token ?? '',
    allowedHostnames: security.allowedHostnames ?? DEFAULT_ALLOWED_HOSTS,
    allowedOrigins: security.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS,
    maxBodyBytes: security.maxBodyBytes ?? 64 * 1024,
    maxInject: security.maxInject ?? 4,
  };
}

function hostAllowed(req, sec) {
  const hostname = String(req.headers.host || '').replace(/:\d+$/, '');
  return sec.allowedHostnames.includes(hostname);
}

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; let settled = false; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max && !settled) { settled = true; const e = new Error('body too large'); e.code = 'BODY_TOO_LARGE'; reject(e); }
      else if (!settled) chunks.push(c);
    });
    req.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
  });
}

/** Build the bridge HTTP server (not listening). Pure w.r.t. injected adapters/security/bus. */
export function createApp({ adapters = REAL_ADAPTERS, security = {}, bus = createBus(100) } = {}) {
  const sec = withDefaults(security);
  let sessions = [];
  let sessionsKey = '';
  let lastGood = new Map();
  let sources = {};
  const lastStatus = new Map();
  let inflight = 0;

  async function poll() {
    const res = await pollOnce(adapters, lastGood, Date.now());
    lastGood = res.lastGood;
    sources = res.sources;
    for (const r of res.sessions) {
      const key = `${r.agent}:${r.session}`;
      if (lastStatus.get(key) !== r.status) {
        lastStatus.set(key, r.status);
        const type = r.status === 'done' ? 'task_complete' : r.status === 'stuck' ? 'turn_aborted' : 'task_started';
        bus.emit({ agentId: r.agent, sessionId: r.session, type, petType: r.status === 'done' ? 'done' : r.status === 'stuck' ? 'stuck' : '', payload: { lastMessage: r.lastMessage } });
      }
    }
    if (res.key !== sessionsKey) {
      sessionsKey = res.key;
      bus.emit({ type: 'sessions', petType: 'sessions', payload: { sessions: res.sessions } });
    }
    sessions = res.sessions;
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

    if (url.pathname === '/api/health') return json(res, req, 200, { ok: true, agents: adapters.map((a) => ({ id: a.id, name: a.name, tier: TIER[a.id] })), sources });
    if (url.pathname === '/api/agents') return json(res, req, 200, adapters.map((a) => ({ id: a.id, name: a.name, form: 'cli', capability: TIER[a.id], status: 'idle', projectIds: [] })));
    if (url.pathname === '/api/sessions') return json(res, req, 200, sessions);
    if (url.pathname === '/api/events') {
      cors(res, req);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
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
          from: payload.from, context: payload.context, instruction: payload.instruction,
        });
        return json(res, req, 200, { ok: true, ...decision });
      } catch {
        return json(res, req, 500, { ok: false, error: 'inject failed' });
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
  return setInterval(tick, intervalMs);
}

export function main() {
  const PORT = Number(process.env.PETDECK_BRIDGE_PORT || 5199);
  const token = process.env.PETDECK_BRIDGE_TOKEN || '';
  const server = createApp({ adapters: REAL_ADAPTERS, security: { token, allowedHostnames: ['127.0.0.1', 'localhost', '::1'] } });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[petdeck-bridge] listening on http://127.0.0.1:${PORT} (home=${os.homedir()}) auth=${token ? 'token' : 'host+origin only'}`);
    if (!token) console.log('[petdeck-bridge] warning: set PETDECK_BRIDGE_TOKEN to also require a shared token on inject.');
    startPolling(server);
  });
  return server;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();
