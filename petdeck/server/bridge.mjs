// petdeck local bridge — HTTP + SSE exposing real adapters to the browser app.
// Run: node server/bridge.mjs   (listens on 5199, CORS for Vite 5173)
// Privacy: observe is read-only local fs; inject runs local CLIs; nothing leaves the machine.
import http from 'node:http';
import os from 'node:os';
import codex from './adapters/codex.mjs';
import claude from './adapters/claude.mjs';
import opencode from './adapters/opencode.mjs';
import kimi from './adapters/kimi.mjs';
import { TIER, injectDecision } from './tiers.mjs';
import { createBus } from './bus.mjs';

const ADAPTERS = [codex, claude, opencode, kimi];
const PORT = Number(process.env.PETDECK_BRIDGE_PORT || 5199);
const bus = createBus(100);
let sessions = [];
let sessionsKey = '';
const lastStatus = new Map();

async function poll() {
  const next = [];
  for (const a of ADAPTERS) {
    try {
      const rows = await Promise.resolve(a.observe());
      for (const r of rows) {
        next.push(r);
        const key = `${r.agent}:${r.session}`;
        const prev = lastStatus.get(key);
        if (prev !== r.status) {
          lastStatus.set(key, r.status);
          const type = r.status === 'done' ? 'task_complete' : r.status === 'stuck' ? 'turn_aborted' : 'task_started';
          bus.emit({
            agentId: r.agent,
            sessionId: r.session,
            type,
            petType: r.status === 'done' ? 'done' : r.status === 'stuck' ? 'stuck' : '',
            payload: { lastMessage: r.lastMessage },
          });
        }
      }
    } catch { /* adapter offline => skip */ }
  }
  const key = JSON.stringify(next.map((r) => [r.agent, r.session, r.status, r.lastMessage]));
  if (key !== sessionsKey) {
    sessionsKey = key;
    bus.emit({ type: 'sessions', petType: 'sessions', payload: { sessions: next } });
  }
  sessions = next;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  if (url.pathname === '/api/health') {
    return json(res, 200, { ok: true, agents: ADAPTERS.map((a) => ({ id: a.id, name: a.name, tier: TIER[a.id] })) });
  }
  if (url.pathname === '/api/agents') {
    return json(res, 200, ADAPTERS.map((a) => ({ id: a.id, name: a.name, form: 'cli', capability: TIER[a.id], status: 'idle', projectIds: [] })));
  }
  if (url.pathname === '/api/sessions') {
    return json(res, 200, sessions);
  }
  if (url.pathname === '/api/events') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const un = bus.subscribe((e) => res.write(`data: ${JSON.stringify(e)}\n\n`));
    req.on('close', un);
    return;
  }
  if (url.pathname === '/api/inject' && req.method === 'POST') {
    let body = '';
    for await (const c of req) body += c;
    let payload = {};
    try { payload = JSON.parse(body); } catch {}
    const target = ADAPTERS.find((a) => a.id === payload.to);
    if (!target) return json(res, 400, { ok: false, error: 'unknown target' });
    const result = await Promise.resolve(target.inject(payload));
    const decision = injectDecision(TIER[target.id], { ...result, context: payload.context });
    return json(res, 200, { ok: true, ...decision });
  }
  return json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[petdeck-bridge] listening on http://127.0.0.1:${PORT} (home=${os.homedir()})`);
  poll();
  setInterval(poll, 5000);
});