// Crash-site reports: when the bridge dies without a clean shutdown, the next boot
// needs evidence (reason, stack, the tail of its own log, active task ids). One
// JSON file per crash under <dataDir>; startup consumes them (renames to *.seen)
// so the UI can show the newest one exactly once.
import fs from 'node:fs';
import path from 'node:path';

export const CRASH_FILE_RE = /^crash-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})\.json$/;

/** '2026-11-21T07-39-03-123' — filename-safe, lexicographically sortable UTC. */
export function crashStamp(ts = Date.now()) {
  const iso = new Date(ts).toISOString();
  return iso.slice(0, 10) + 'T' + iso.slice(11, 23).replace(/[:.]/g, '-');
}

export function crashFilePath(dataDir, ts = Date.now()) {
  return path.join(dataDir, 'crash-' + crashStamp(ts) + '.json');
}

export function writeCrashReport({ dataDir, reason, error, extra = {}, recentLines = [], now = Date.now() } = {}) {
  if (!dataDir) return null;
  try {
    let at = typeof now === 'function' ? now() : Number(now);
    let file = crashFilePath(dataDir, at);
    // Two crashes can land in the same millisecond (uncaught error followed by an
    // unhandled rejection). Keep both reports by advancing to the next free stamp.
    for (let bump = 0; bump < 1000 && fs.existsSync(file); bump += 1) {
      at += 1;
      file = crashFilePath(dataDir, at);
    }
    if (fs.existsSync(file)) return null;
    const payload = {
      at: new Date(at).toISOString(),
      reason: String(reason ?? 'unknown').slice(0, 120),
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      script: path.basename(process.argv[1] ?? ''),
      error: error
        ? {
            name: String(error.name ?? 'Error'),
            message: String(error.message ?? error).slice(0, 2000),
            stack: String(error.stack ?? '').split('\n').slice(0, 24),
          }
        : null,
      ...extra,
      recentLogs: Array.isArray(recentLines)
        ? recentLines.slice(-50).map((line) => String(line).slice(0, 500))
        : [],
    };
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    return file;
  } catch {
    return null;
  }
}

/**
 * Read every unconsumed crash report, mark them seen, and return the newest one.
 * Never throws: a broken/missing data dir simply means there is nothing to show.
 */
export function consumeCrashReports({ dataDir } = {}) {
  if (!dataDir) return null;
  let names;
  try { names = fs.readdirSync(dataDir); } catch { return null; }
  const files = names.filter((name) => CRASH_FILE_RE.test(name)).map((name) => path.join(dataDir, name)).sort();
  if (!files.length) return null;
  let newest = null;
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      newest = {
        file,
        at: typeof raw.at === 'string' ? raw.at : null,
        reason: typeof raw.reason === 'string' ? raw.reason : 'unknown',
        error: typeof raw.error?.message === 'string' ? raw.error.message.slice(0, 300) : null,
      };
    } catch {
      newest = { file, at: null, reason: 'unreadable', error: null };
    }
    try { fs.renameSync(file, file + '.seen'); } catch { /* keep it readable next boot */ }
  }
  return newest;
}

/**
 * Install process-level handlers once. Uncaught exceptions record and exit(1);
 * unhandled rejections record and keep running (Node would only warn anyway).
 */
export function installCrashHandlers({ dataDir, logger = null, getExtra = null, exit = (code) => process.exit(code) } = {}) {
  function report(reason, error) {
    let extra = {};
    try { extra = getExtra?.() ?? {}; } catch { /* diagnostics must not throw */ }
    let lines = [];
    try { lines = logger?.recentLines?.(50) ?? []; } catch { /* ignore */ }
    const file = writeCrashReport({ dataDir, reason, error, extra, recentLines: lines });
    if (file) { try { logger?.error?.('crash.report_written', { file, reason }); } catch { /* ignore */ } }
    return file;
  }
  const onUncaught = (error) => { report('uncaughtException', error); try { exit(1); } catch { /* ignore */ } };
  const onRejection = (reason) => {
    report('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
  };
  process.on('uncaughtException', onUncaught);
  process.on('unhandledRejection', onRejection);
  return function uninstall() {
    process.removeListener('uncaughtException', onUncaught);
    process.removeListener('unhandledRejection', onRejection);
  };
}