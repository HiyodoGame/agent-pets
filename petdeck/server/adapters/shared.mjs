// Shared read-only fs helpers for observe adapters.
import fs from 'node:fs';
import path from 'node:path';

/** Read last n lines of a file (tolerant of missing file). */
export function tailLines(file, n = 400) {
  try {
    const txt = fs.readFileSync(file, 'utf8').trim();
    if (!txt) return [];
    return txt.split('\n').slice(-n);
  } catch {
    return [];
  }
}

/** Walk dir, collect files matching pred, newest-first, up to limit. */
export function latestFiles(dir, pred, limit = 20) {
  const found = [];
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (pred(e.name)) {
        try { found.push({ p, mtime: fs.statSync(p).mtimeMs }); } catch {}
      }
    }
  };
  walk(dir);
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map((x) => x.p);
}

export function safeJson(line) {
  try { return JSON.parse(line); } catch { return null; }
}