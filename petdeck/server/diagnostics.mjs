// M5 W1 — observability helpers behind the desktop status card and the diagnostics
// package: CLI probes (60s cache, 2s timeout), field-level redaction, environment
// facts, and a dependency-free ZIP writer (petdeck ships no archiver).
//
// Red line: the package is meant to be attached to a bug report, so it contains
// versions, paths, counts and structured logs — never prompts, tokens or API keys.
// collectDiagnostics() only reads whitelisted fields; redactObject() is a second
// line of defence for anything passed through wholesale.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { runCli } from './adapters/exec.mjs';

const PROBE_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 2_000;
const VERSION_RE = /(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.]+)?)/;
const SECRET_KEY_SUFFIXES = ['token', 'password', 'passwd', 'apikey', 'privatekey', 'secret'];

/** True for credential field names, but not status metadata such as apiKeySet/secrets. */
export function isSecretKey(key) {
  const normalized = String(key).replace(/[_-]/g, '').toLowerCase();
  if (normalized === 'authorization' || normalized === 'credential') return true;
  return SECRET_KEY_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/** Commands for the observation adapters; ids without a CLI (cursor/remote) stay null. */
export const AGENT_CLI = {
  codex: 'codex',
  claude: 'claude',
  opencode: 'opencode',
  kimi: 'kimi',
  'kimi-code': 'kimi',
  zcode: 'zcode',
  dsh: 'dsh',
  gemini: 'gemini',
};

/** Mask a secret, keeping only the last 4 chars so support can compare fingerprints. */
export function maskSecret(value) {
  const s = String(value ?? '');
  if (!s) return '';
  return s.length <= 4 ? '***' : '***' + s.slice(-4);
}

/** Walk a JSON-ish value and mask anything whose key looks like a credential. */
export function redactObject(value, depth = 0) {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return '[nested]';
  if (Array.isArray(value)) return value.map((v) => redactObject(v, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (isSecretKey(key)) {
      out[key] = item && typeof item === 'object' ? '[redacted]' : maskSecret(item);
    } else {
      out[key] = redactObject(item, depth + 1);
    }
  }
  return out;
}

/**
 * Probe one CLI: resolve it on PATH and run `--version`. Failures are data, not
 * errors — a missing agent is a legitimate state the status card must render.
 */
export async function probeCli(command, { timeout = PROBE_TIMEOUT_MS, run = runCli } = {}) {
  if (!command) return { command: null, detected: false, version: null };
  let result;
  try {
    const r = await run(command, ['--version'], { timeout });
    const text = String(r?.stdout || '').trim();
    const version = VERSION_RE.exec(text)?.[1] ?? null;
    result = { command, detected: !r?.error && (r?.status === 0 || Boolean(text)), version };
  } catch {
    result = { command, detected: false, version: null };
  }
  return result;
}

/**
 * Cache wrapper used by the bridge: `list(entries, { deep })` never spawns unless
 * deep (or the cache is missing and the caller opted in). The desktop status card
 * asks for deep once per minute; ordinary liveness pings stay cheap.
 */
export function createAgentProbe({ ttlMs = PROBE_TTL_MS, now = Date.now, probe = probeCli } = {}) {
  const cache = new Map(); // command -> { at, value }
  const inflight = new Map(); // command -> Promise<value>
  function cached(command) {
    const hit = cache.get(command);
    return hit && now() - hit.at < ttlMs ? hit.value : null;
  }
  function refresh(command) {
    if (!command) return Promise.resolve({ command: null, detected: false, version: null });
    const running = inflight.get(command);
    if (running) return running;
    const p = probe(command).then((value) => {
      cache.set(command, { at: now(), value });
      inflight.delete(command);
      return value;
    }, () => {
      const value = { command, detected: false, version: null };
      cache.set(command, { at: now(), value });
      inflight.delete(command);
      return value;
    });
    inflight.set(command, p);
    return p;
  }
  return {
    async list(entries, { deep = false } = {}) {
      return Promise.all((entries ?? []).map(async (entry) => {
        const command = entry.command ?? AGENT_CLI[entry.id] ?? null;
        if (!command) return { ...entry, command: null, detected: false, version: null };
        const cachedValue = cached(command);
        const value = deep ? (cachedValue ?? await refresh(command)) : cachedValue;
        if (value) return { ...entry, ...value };
        // Non-deep health is a liveness ping: never spawn from it. The settings card
        // asks /api/runtime/status (deep) and the probe cache then serves everyone.
        return { ...entry, command, detected: null, version: null };
      }));
    },
    /** Test/dev hook: forget cached probes. */
    reset() { cache.clear(); inflight.clear(); },
  };
}

/** Best-effort WebView2 runtime version (registry), null when unavailable. */
let webview2Cache;
export function webview2Version() {
  if (webview2Cache !== undefined) return webview2Cache;
  webview2Cache = null;
  if (process.platform !== 'win32') return webview2Cache;
  const key = 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  try {
    const r = spawnSync('reg', ['query', key, '/v', 'pv'], { encoding: 'utf8', timeout: 1500, windowsHide: true });
    const m = /pv\s+REG_SZ\s+(\S+)/.exec(String(r?.stdout || ''));
    webview2Cache = m?.[1] ?? null;
  } catch { /* registry unavailable: keep null */ }
  return webview2Cache;
}

/** OS / runtime facts that make a bug report reproducible. No usernames, no paths. */
export function environmentFacts({ version = null, node = process.version, now = Date.now() } = {}) {
  const cpus = os.cpus?.() ?? [];
  return {
    generatedAt: new Date(now).toISOString(),
    app: { version, node },
    os: { platform: process.platform, release: os.release(), arch: process.arch, version: os.version?.() ?? null },
    cpu: { model: cpus[0]?.model ?? null, cores: cpus.length },
    memoryBytes: os.totalmem(),
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    webview2: webview2Version(),
  };
}

// ---------------------------------------------------------------- ZIP writer --
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Minimal ZIP (deflate or store, no zip64, no encryption). Entries: [{name, data}] in
 * the order written; directory entries are implicitly created by their paths.
 */
export function buildZip(entries, { now = new Date() } = {}) {
  const { time, day } = dosDateTime(now);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries ?? []) {
    const name = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ''), 'utf8');
    const deflated = deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const body = useDeflate ? deflated : raw;
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, body);
    central.push({ name, crc, csize: body.length, usize: raw.length, method: useDeflate ? 8 : 0, offset });
    offset += local.length + name.length + body.length;
  }
  const directoryStart = offset;
  const dirChunks = [];
  for (const entry of central) {
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4); // version made by
    head.writeUInt16LE(20, 6); // version needed
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(entry.method, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(day, 14);
    head.writeUInt32LE(entry.crc, 16);
    head.writeUInt32LE(entry.csize, 20);
    head.writeUInt32LE(entry.usize, 24);
    head.writeUInt16LE(entry.name.length, 28);
    // 30..42: extra length, comment length, disk, internal attrs, external attrs = 0
    head.writeUInt32LE(entry.offset, 42);
    dirChunks.push(head, entry.name);
    offset += head.length + entry.name.length;
  }
  const directorySize = offset - directoryStart;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(directoryStart, 16);
  return Buffer.concat([...chunks, ...dirChunks, end]);
}

// ------------------------------------------------------- diagnostics package --
const SETTINGS_WHITELIST = ['maxConcurrent', 'decisionTimeoutMinutes', 'decisionSound'];
const MANAGER_WHITELIST = ['provider', 'baseUrl', 'model', 'temperature', 'timeoutMs', 'apiKeySet', 'apiKeySource', 'ready'];
const LOG_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const LOG_MAX_BYTES = 20 * 1024 * 1024;
const LOG_MAX_FILES = 20;

function pick(source, keys) {
  const out = {};
  for (const key of keys) if (source && source[key] !== undefined) out[key] = source[key];
  return out;
}

/** Newest log files from the last 7 days, capped by count and total size. */
export function readRecentLogs(logDir, { now = Date.now(), maxBytes = LOG_MAX_BYTES, maxFiles = LOG_MAX_FILES } = {}) {
  if (!logDir) return [];
  let names;
  try { names = fs.readdirSync(logDir); } catch { return []; }
  const cutoff = now - LOG_MAX_AGE_MS;
  const rows = [];
  for (const name of names) {
    if (!/\.(log|jsonl|txt)$/i.test(name)) continue;
    const file = path.join(logDir, name);
    let stat;
    try { stat = fs.statSync(file); } catch { continue; }
    if (!stat.isFile() || stat.mtimeMs < cutoff) continue;
    rows.push({ name, file, mtime: stat.mtimeMs, bytes: stat.size });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  const picked = [];
  let budget = maxBytes;
  for (const row of rows.slice(0, maxFiles)) {
    if (row.bytes > budget) break;
    budget -= row.bytes;
    picked.push(row);
  }
  return picked.map((row) => ({ name: 'logs/' + row.name, data: fs.readFileSync(row.file) }));
}

/**
 * Build the diagnostics zip. Returns { path, bytes, files } where path is inside the
 * OS temp dir; the bridge serves that path back to the desktop app, which reveals it
 * to the user. Throws only on filesystem errors.
 */
export async function collectDiagnostics({
  version = null, port = null, authRequired = false, runtime = null,
  agents = [], now = Date.now(), logDir: logDirOverride = null,
} = {}) {
  const snapshot = typeof runtime?.statusSnapshot === 'function' ? runtime.statusSnapshot() : null;
  const logDir = logDirOverride ?? (snapshot?.dataDir ? path.join(snapshot.dataDir, 'logs') : null);
  const settings = typeof runtime?.getSettings === 'function' ? pick(runtime.getSettings(), SETTINGS_WHITELIST) : {};
  const manager = typeof runtime?.getManagerSettings === 'function' ? pick(runtime.getManagerSettings(), MANAGER_WHITELIST) : {};
  const environment = environmentFacts({ version, now });
  const summary = redactObject({
    generatedAt: new Date(now).toISOString(),
    app: { version, node: process.version, port, authRequired },
    runtime: snapshot,
    logDir,
    agentProbeCount: Array.isArray(agents) ? agents.length : 0,
  });
  const files = [
    { name: 'summary.json', data: JSON.stringify(summary, null, 2) + '\n' },
    { name: 'settings.json', data: JSON.stringify(redactObject({ runtime: settings, manager }), null, 2) + '\n' },
    { name: 'agents.json', data: JSON.stringify(redactObject(agents), null, 2) + '\n' },
    { name: 'environment.json', data: JSON.stringify(environment, null, 2) + '\n' },
  ];
  for (const log of readRecentLogs(logDir, { now })) files.push(log);
  const zip = buildZip(files, { now: new Date(now) });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-diag-'));
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const target = path.join(dir, 'petdeck-diagnostics-' + stamp + '.zip');
  fs.writeFileSync(target, zip);
  return { path: target, bytes: zip.length, files: files.map((f) => f.name) };
}
