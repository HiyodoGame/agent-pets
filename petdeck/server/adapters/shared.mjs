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
 * Read the FIRST n lines of a file with BOUNDED memory.
 * Rollout-style jsonl files carry a header record on line 1 (codex session_meta
 * with the session cwd) and the record is never repeated later, so a tail-only
 * window loses it on long sessions.
 *
 * Reads in chunks and stops as soon as n complete lines (newlines) were seen, so a
 * single huge line (codex writes the whole AGENTS.md system prompt as one ~100 KB
 * jsonl record) no longer eats the whole budget and truncates the window to 2 lines.
 * maxBytes is a hard ceiling; a line cut by it is dropped, never returned partial.
 * ENOENT (file vanished) => []; other errors throw (freshness marks the source stale).
 */
export function headLines(file, n = 8, maxBytes = 1024 * 1024) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const cap = Math.max(1, Math.min(size, maxBytes));
    const CHUNK = 64 * 1024;
    const chunks = [];
    let offset = 0;
    let newlines = 0;
    while (offset < cap && newlines < n) {
      const want = Math.min(CHUNK, cap - offset);
      const buf = Buffer.alloc(want);
      const got = fs.readSync(fd, buf, 0, want, offset);
      if (got <= 0) break;
      chunks.push(buf.subarray(0, got));
      for (let i = 0; i < got; i += 1) if (buf[i] === 10) newlines += 1;
      offset += got;
    }
    let lines = Buffer.concat(chunks).toString('utf8').split('\n');
    if (offset < size) lines = lines.slice(0, -1); // trailing line cut by the byte cap
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.slice(0, n);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* ignore */ } }
  }
}

/**
 * Directory-entry cache: dir path -> { mtimeMs, files, subdirs, checkedAt }.
 * Unchanged mtime skips readdir only inside a short 2s coalescing window. NTFS can
 * leave directory mtime in the same time slice after file creation, so an immortal
 * mtime-only cache would hide a new session forever; the next 5s poll revalidates.
 * Cached subdirs still drive descent inside that short window. Candidate files
 * are ALWAYS stat-ed below, so content/mtime changes and vanishes remain visible
 * even when no directory mtime moved. Bounded: cleared wholesale past the cap.
 */
const dirCache = new Map();
const DIR_CACHE_MAX = 2000;
const DIR_CACHE_TTL_MS = 2000;
const SOURCE_READ_FAULTS = new Set(['EACCES', 'EPERM', 'EIO', 'EBUSY', 'EMFILE', 'ENFILE']);

/** Corrupt session content may be skipped; real filesystem/I/O failures must reach
 *  freshness.mjs so last-good is marked stale instead of replaced by an empty list. */
export function rethrowReadFault(error) {
  if (SOURCE_READ_FAULTS.has(error?.code)) throw error;
}

/**
 * Walk dir, collect files matching pred, newest-first, up to limit.
 * Base dir missing (ENOENT) => [] (adapter source not installed — legit empty);
 * a real fault (EACCES/ENOTDIR/...) => throw so the source is marked stale, not empty.
 */
export function latestFiles(dir, pred, limit = 20, now = Date.now()) {
  if (dirCache.size > DIR_CACHE_MAX) dirCache.clear();
  const candidates = [];
  const walk = (d) => {
    let st;
    try {
      st = fs.statSync(d);
    } catch (e) {
      dirCache.delete(d);
      if (e.code === 'ENOENT') return; // absent at this level: skip (root absent => [])
      throw e; // EACCES/ENOTDIR/etc => genuine failure, must surface
    }
    const cached = dirCache.get(d);
    const cacheAge = cached ? now - cached.checkedAt : Infinity;
    if (cached && cached.mtimeMs === st.mtimeMs && cacheAge >= 0 && cacheAge < DIR_CACHE_TTL_MS) {
      candidates.push(...cached.files);
      for (const sub of cached.subdirs) walk(sub);
      return;
    }
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    const files = [];
    const subdirs = [];
    for (const en of ents) {
      const p = path.join(d, en.name);
      if (en.isDirectory()) { subdirs.push(p); walk(p); }
      else if (pred(en.name)) { files.push(p); candidates.push(p); }
    }
    dirCache.set(d, { mtimeMs: st.mtimeMs, files, subdirs, checkedAt: now });
  };
  walk(dir);
  const found = [];
  for (const p of candidates) {
    try { found.push({ p, mtime: fs.statSync(p).mtimeMs }); }
    catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      // Vanished mid-walk: a normal filesystem race, not a fresh empty source.
    }
  }
  // newest-first；mtime 打平时按路径升序 tiebreak——排序必须跨平台确定（CI 的 ext4
  // 与本地 NTFS 的 mtime 粒度不同，靠「恰好打平 + 稳定排序」的断言会抖）。
  return found.sort((a, b) => b.mtime - a.mtime || (a.p < b.p ? -1 : a.p > b.p ? 1 : 0)).slice(0, limit).map((x) => x.p);
}

export function safeJson(line) {
  try { return JSON.parse(line); } catch { return null; }
}

/** Basename that understands both Windows and POSIX separators. Adapter records can
 *  carry a Windows cwd while the test/CI process runs on POSIX (and vice versa), so
 *  path.basename alone would return the whole string instead of the last segment. */
export function basenameAny(value) {
  return path.posix.basename(String(value ?? '').replace(/\\/g, '/'));
}