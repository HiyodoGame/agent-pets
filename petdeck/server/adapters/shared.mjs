// Shared read-only fs helpers for observe adapters.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Read the last n lines of a file with BOUNDED memory: only the tail window
 * (up to maxBytes) is read, never the whole file — jsonl rollouts can be large
 * and observe runs every 5s. ENOENT (file vanished) => []; other errors throw so
 * the source is marked stale. A partial leading line (when starting mid-file) is dropped.
 */
export function tailLines(file, n = 400, maxBytes = 512 * 1024) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    let lines = buf.toString('utf8').split('\n');
    if (start > 0) lines = lines.slice(1); // first chunk may be a partial line
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (!lines.length) return [];
    return lines.slice(-n);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

/**
 * Walk dir, collect files matching pred, newest-first, up to limit.
 * Base dir missing (ENOENT) => [] (adapter source not installed — legit empty);
 * a real fault (EACCES/ENOTDIR/...) => throw so the source is marked stale, not empty.
 */
export function latestFiles(dir, pred, limit = 20) {
  const found = [];
  const walk = (d) => {
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return; // absent at this level: skip (root absent => [])
      throw e; // EACCES/ENOTDIR/etc => genuine failure, must surface
    }
    for (const en of ents) {
      const p = path.join(d, en.name);
      if (en.isDirectory()) walk(p);
      else if (pred(en.name)) {
        try { found.push({ p, mtime: fs.statSync(p).mtimeMs }); } catch { /* vanished mid-walk */ }
      }
    }
  };
  walk(dir);
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map((x) => x.p);
}

export function safeJson(line) {
  try { return JSON.parse(line); } catch { return null; }
}