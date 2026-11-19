// Project grouping normalization — bridge-side.
//
// Two noise sources found in the 2026-11-20 audit:
//   1. Relay/injection scratch sessions run inside %TEMP% and used to appear as a
//      "project" named after the scratch directory (petdeck-inject-*).
//   2. A session started in a subdirectory of a git repository was grouped separately
//      from the same repository (CatWanted vs CatWanted/app).
//
// This module canonicalizes observe rows before the bridge publishes them:
//   - local rows whose cwd lives in the OS temp dir are marked `temp` and lose their
//     fake project identity;
//   - local rows whose cwd is inside a git work tree are re-rooted at the work tree
//     root, so every session of one repository groups together;
//   - remote (SSH) rows are never rewritten: their paths belong to another machine.
// Pure w.r.t. injected fs; unit-tested without touching the real filesystem layout.
import fsImpl from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_ANCESTORS = 8;

function dirOf(p) {
  return path.dirname(p);
}

/** True when `cwd` is the OS temp directory or somewhere below it. */
export function isTempDirectory(cwd, tmpRoot = os.tmpdir()) {
  const normalize = (v) => String(v ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const value = normalize(cwd);
  if (!value) return false;
  const tmp = normalize(tmpRoot);
  if (tmp && (value === tmp || value.startsWith(tmp + '/'))) return true;
  return /^[a-z]:\/users\/[^/]+\/appdata\/local\/temp(\/|$)/.test(value) || /^\/tmp(\/|$)/.test(value);
}

/**
 * Build a cached cwd -> git work tree root resolver.
 * Walks at most MAX_ANCESTORS up; a `.git` file or directory marks the root.
 */
export function createRootResolver({ fs = fsImpl, maxAncestors = MAX_ANCESTORS } = {}) {
  const cache = new Map();
  return function resolveRoot(cwd) {
    const start = String(cwd ?? '').trim();
    if (!start) return start;
    if (cache.has(start)) return cache.get(start);
    let root = start;
    let dir = start;
    for (let depth = 0; depth < maxAncestors; depth += 1) {
      if (!dir) break;
      let marker = false;
      try {
        marker = fs.existsSync(path.join(dir, '.git'));
      } catch {
        marker = false;
      }
      if (marker) { root = dir; break; }
      const parent = dirOf(dir);
      if (!parent || parent === dir) break;
      dir = parent;
    }
    cache.set(start, root);
    return root;
  };
}

/**
 * Canonicalize observe rows for grouping; returns new row objects.
 * Injected resolver/isTemp make this testable without a real git checkout.
 */
export function canonicalizeRows(rows, {
  resolveRoot = createRootResolver(),
  isTemp = (cwd) => isTempDirectory(cwd),
  hasMarker = (dir) => {
    try { return fsImpl.existsSync(path.join(dir, '.git')); } catch { return false; }
  },
} = {}) {
  return (rows ?? []).map((row) => {
    if (!row || typeof row !== 'object') return row;
    if (row.host) return row; // remote filesystem: path is meaningful on the other host
    const cwd = typeof row.cwd === 'string' ? row.cwd.trim() : '';
    if (!cwd) return row;
    // A .git ancestor wins over the temp rule: a repository checked out under temp is
    // still a real project, while relay scratch dirs have no marker and fall through.
    const root = resolveRoot(cwd);
    if (root && root !== cwd) return { ...row, cwd: root, projectId: root, projectName: path.basename(root) };
    // A checkout whose root itself sits under temp (cloned into a scratch dir) is still
    // a project; only marker-less temp dirs (relay injection sandboxes) are flushed.
    if (isTemp(cwd) && !hasMarker(cwd)) return { ...row, cwd: '', projectId: '', projectName: '', temp: true };
    return row;
  });
}
