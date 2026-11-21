// Disk retention and usage for runtime data.
// - runs/<runId>/events.jsonl is the canonical transcript; keep 30 days after the
//   run ends (mtime), the SQLite event index is NOT pruned (it stays queryable).
// - artifacts/ and the database are only measured here; deleting artifacts is an
//   explicit per-task action in the UI, never automatic.
// - logs/ files are rotated by runtime/logger.mjs (7 days), measured here.
import fs from 'node:fs';
import path from 'node:path';

const DAY_MS = 86_400_000;
export const RUN_KEEP_DAYS = 30;

function sizeOf(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

/** Recursive byte size of a directory (symlinks and unreadable entries skipped). */
export function dirSize(dir) {
  let total = 0;
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const entry of names) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += sizeOf(full);
  }
  return total;
}

/** Usage snapshot for the settings "storage" card. */
export function storageUsage({ dir } = {}) {
  if (!dir) throw new Error('dir is required');
  const runsDir = path.join(dir, 'runs');
  const artifactsDir = path.join(dir, 'artifacts');
  const logsDir = path.join(dir, 'logs');
  let runCount = 0;
  let oldestRunMs = null;
  try {
    for (const name of fs.readdirSync(runsDir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      runCount += 1;
      const mtime = runMtime(path.join(runsDir, name.name));
      if (mtime != null && (oldestRunMs == null || mtime < oldestRunMs)) oldestRunMs = mtime;
    }
  } catch { /* no runs yet */ }
  const dbBytes = sizeOf(path.join(dir, 'petdeck.sqlite'))
    + sizeOf(path.join(dir, 'petdeck.sqlite-wal'))
    + sizeOf(path.join(dir, 'petdeck.sqlite-shm'));
  const logsBytes = dirSize(logsDir);
  const runsBytes = dirSize(runsDir);
  const artifactsBytes = dirSize(artifactsDir);
  return {
    dataDir: dir,
    logsBytes,
    runsBytes,
    artifactsBytes,
    dbBytes,
    totalBytes: logsBytes + runsBytes + artifactsBytes + dbBytes,
    runCount,
    oldestRunMs,
    runKeepDays: RUN_KEEP_DAYS,
  };
}

function runMtime(runDir) {
  const events = path.join(runDir, 'events.jsonl');
  try { return fs.statSync(events).mtimeMs; }
  catch {
    try { return fs.statSync(runDir).mtimeMs; } catch { return null; }
  }
}

/**
 * Delete run transcript directories whose newest file is older than keepDays.
 * Only direct child directories of <dir>/runs are touched. Returns counts so the
 * bridge can log exactly what happened.
 */
export function pruneRunTranscripts({ dir, keepDays = RUN_KEEP_DAYS, now = Date.now() } = {}) {
  if (!dir) throw new Error('dir is required');
  const runsDir = path.join(dir, 'runs');
  const cutoff = now - keepDays * DAY_MS;
  const result = { removed: 0, bytes: 0, kept: 0 };
  let entries;
  try { entries = fs.readdirSync(runsDir, { withFileTypes: true }); }
  catch { return result; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const full = path.join(runsDir, entry.name);
    const mtime = runMtime(full);
    if (mtime == null || mtime >= cutoff) { result.kept += 1; continue; }
    const bytes = dirSize(full);
    try {
      fs.rmSync(full, { recursive: true, force: true });
      result.removed += 1;
      result.bytes += bytes;
    } catch { result.kept += 1; }
  }
  return result;
}
