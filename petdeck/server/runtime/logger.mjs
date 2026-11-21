// Structured JSON-lines logger for the bridge and runtime.
// One file per local day (petdeck-YYYY-MM-DD.log), rotated by size (default 5 MB)
// into petdeck-YYYY-MM-DD.1.log, petdeck-YYYY-MM-DD.2.log, ... . Files older than
// keepDays (default 7) are deleted when the logger opens and when the day rolls.
//
// Safety: log fields are sanitized before they are written. Prompt/text/payload
// shaped keys are dropped entirely (a CLI error message can echo the prompt), and
// token-like keys are masked. Callers must still pass structured ids, never free
// text they did not sanitize.
import fs from 'node:fs';
import path from 'node:path';

export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_KEEP_DAYS = 7;
const DAY_MS = 86_400_000;

const DROP_KEY = /^(prompt|text|content|stdout|stderr|line|lines|message|feedback|question|summary|result|body|payload|args|argv|script|code|output)$/i;
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|apikey|authorization|credential|private[_-]?key|cookie)/i;

/** Local calendar date (YYYY-MM-DD) for a timestamp. */
export function localDate(ts = Date.now()) {
  const d = new Date(ts);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + month + '-' + day;
}

function truncate(value, max) {
  const s = String(value);
  return s.length > max ? s.slice(0, max) + '…(' + s.length + ')' : s;
}

/** Turn arbitrary caller fields into JSON-safe, non-secret scalars. */
export function sanitizeFields(fields, { maxString = 300, maxDepth = 3 } = {}) {
  if (!fields || typeof fields !== 'object') return {};
  const out = {};
  let keys = 0;
  for (const [key, value] of Object.entries(fields)) {
    if (keys >= 40) break;
    if (DROP_KEY.test(key)) continue;
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') continue;
    if (SECRET_KEY.test(key)) { out[key] = '***'; keys += 1; continue; }
    out[key] = sanitizeValue(value, maxDepth, maxString);
    keys += 1;
  }
  return out;
}

function sanitizeValue(value, depth, maxString) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return truncate(value.replace(/\r?\n/g, ' '), maxString);
  if (Array.isArray(value)) {
    return depth <= 0 ? '<array>' : value.slice(0, 20).map((v) => sanitizeValue(v, depth - 1, maxString));
  }
  if (typeof value === 'object') {
    return depth <= 0 ? '<object>' : sanitizeFields(value, { maxString, maxDepth: depth - 1 });
  }
  return null;
}

function safeStatSize(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

/** Delete log files of this app older than keepDays (local-date prefix compare). */
export function pruneOldLogs(dir, { keepDays = LOG_KEEP_DAYS, now = Date.now(), appName = 'petdeck' } = {}) {
  let removed = 0;
  let names;
  try { names = fs.readdirSync(dir); } catch { return removed; }
  const cutoff = localDate(now - (keepDays - 1) * DAY_MS);
  const re = new RegExp('^' + appName + '-(\\d{4}-\\d{2}-\\d{2})(?:\\.\\d+)?\\.log$');
  for (const name of names) {
    const m = re.exec(name);
    if (!m || m[1] >= cutoff) continue;
    try { fs.unlinkSync(path.join(dir, name)); removed += 1; } catch { /* keep trying */ }
  }
  return removed;
}

/**
 * Create a logger writing <dir>/<appName>-YYYY-MM-DD[.N].log.
 * Never throws: a broken log path degrades to sink-only logging.
 */
export function createLogger({
  dir,
  scope = 'petdeck',
  now = Date.now,
  maxBytes = LOG_MAX_BYTES,
  keepDays = LOG_KEEP_DAYS,
  sink = console,
  echo = true,
  appName = 'petdeck',
  maxString = 300,
} = {}) {
  let currentDate = null;
  let currentPath = null;
  let currentSize = 0;
  let currentIndex = 0;
  let dirReady = false;
  let warning = null;
  // Ring buffer for crash reports: writeCrashReport needs the tail of the log even
  // when the file write itself is what failed.
  const RECENT_MAX = 300;
  const recent = [];

  function ensureDir() {
    if (dirReady) return true;
    if (!dir) return false;
    try { fs.mkdirSync(dir, { recursive: true }); dirReady = true; return true; }
    catch (e) { warning = e?.message ?? String(e); return false; }
  }

  function rollIfNeeded(date, lineLen) {
    if (date !== currentDate) {
      currentDate = date;
      currentIndex = 0;
      currentPath = null;
      currentSize = 0;
      pruneOldLogs(dir, { keepDays, now: now(), appName });
    }
    const base = appName + '-' + date;
    for (;;) {
      const candidate = path.join(dir, base + (currentIndex === 0 ? '' : '.' + currentIndex) + '.log');
      const size = currentPath === candidate ? currentSize : safeStatSize(candidate);
      if (size + lineLen <= maxBytes || currentIndex > 999) return candidate;
      currentIndex += 1;
    }
  }

  function writeFile(level, msg, fields, viewScope = scope) {
    const ts = now();
    const record = {
      ts: new Date(ts).toISOString(),
      level,
      scope: viewScope,
      msg: truncate(String(msg ?? ''), maxString).replace(/\r?\n/g, ' '),
      ...sanitizeFields(fields, { maxString }),
    };
    const line = JSON.stringify(record);
    recent.push(line);
    if (recent.length > RECENT_MAX) recent.shift();
    if (ensureDir()) {
      try {
        const file = rollIfNeeded(localDate(ts), line.length + 1);
        if (file !== currentPath) { currentPath = file; currentSize = safeStatSize(file); }
        fs.appendFileSync(file, line + '\n', 'utf8');
        currentSize += line.length + 1;
      } catch (e) {
        if (!warning) warning = e?.message ?? String(e);
      }
    }
    if (echo) {
      try { (sink?.[level] ?? sink?.log)?.(`[${viewScope}] ${record.msg}`, sanitizeFields(fields, { maxString })); }
      catch { /* a broken console must never break the caller */ }
    }
    return record;
  }

  // One writer, many scoped views: a child logger must append to the same file and
  // share the rotation cursor, otherwise every child would start its own file.
  function makeView(viewScope) {
    return {
      dir,
      scope: viewScope,
      log(level, msg, fields) { return writeFile(level, msg, fields, viewScope); },
      debug(msg, fields) { return writeFile('debug', msg, fields, viewScope); },
      info(msg, fields) { return writeFile('info', msg, fields, viewScope); },
      warn(msg, fields) { return writeFile('warn', msg, fields, viewScope); },
      error(msg, fields) { return writeFile('error', msg, fields, viewScope); },
      child(childScope) { return makeView(viewScope ? viewScope + ':' + childScope : childScope); },
      filePath() { return currentPath; },
      recentLines(count = 50) { return recent.slice(-Math.max(1, Math.min(RECENT_MAX, count))); },
      lastWarning() { return warning; },
      close() { /* appendFileSync: nothing buffered */ },
    };
  }
  return makeView(scope);
}
