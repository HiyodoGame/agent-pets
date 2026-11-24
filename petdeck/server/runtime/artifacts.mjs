import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

export const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;
export const MAX_AUTO_ARTIFACTS = 30;

const KIND_BY_EXT = new Map([
  ...['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].map((ext) => [ext, 'image']),
  ...['mp4', 'mov', 'webm', 'm4v'].map((ext) => [ext, 'video']),
  ...['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].map((ext) => [ext, 'audio']),
  ...['pdf'].map((ext) => [ext, 'pdf']),
  ...['zip', 'tar', 'gz', 'tgz', '7z', 'rar'].map((ext) => [ext, 'archive']),
]);

const MIME_BY_EXT = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'], ['gif', 'image/gif'],
  ['webp', 'image/webp'], ['svg', 'image/svg+xml'], ['bmp', 'image/bmp'], ['avif', 'image/avif'],
  ['mp4', 'video/mp4'], ['mov', 'video/quicktime'], ['webm', 'video/webm'], ['m4v', 'video/x-m4v'],
  ['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['m4a', 'audio/mp4'], ['aac', 'audio/aac'],
  ['ogg', 'audio/ogg'], ['flac', 'audio/flac'],
  ['pdf', 'application/pdf'],
  ['zip', 'application/zip'], ['tar', 'application/x-tar'], ['gz', 'application/gzip'],
  ['tgz', 'application/gzip'], ['7z', 'application/x-7z-compressed'], ['rar', 'application/vnd.rar'],
  ['txt', 'text/plain'], ['md', 'text/markdown'], ['json', 'application/json'],
  ['html', 'text/html'], ['csv', 'text/csv'],
]);

export function extensionOf(filePath) {
  const ext = path.extname(String(filePath || '')).slice(1).toLowerCase();
  return ext;
}

export function artifactKindFor(filePath) {
  return KIND_BY_EXT.get(extensionOf(filePath)) ?? 'file';
}

export function mimeFor(filePath) {
  return MIME_BY_EXT.get(extensionOf(filePath)) ?? 'application/octet-stream';
}

export function isPreviewable(kind) {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf';
}

/** Resolve a candidate inside root; returns null when it escapes the root.
 *  Both lexical paths and real paths are checked so a symlink/junction inside the
 *  workspace cannot copy an external file into the artifact store. */
export function resolveInside(root, candidate) {
  if (!candidate || typeof candidate !== 'string') return null;
  const clean = candidate.trim().replace(/^["']|["']$/g, '');
  if (!clean) return null;
  const absolute = path.resolve(root, clean);
  const normalizedRoot = path.resolve(root);
  if (absolute !== normalizedRoot && !absolute.startsWith(normalizedRoot + path.sep)) return null;
  try {
    const realRoot = fs.realpathSync.native(normalizedRoot);
    const realCandidate = fs.realpathSync.native(absolute);
    const relative = path.relative(realRoot, realCandidate);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return null;
    return absolute;
  } catch {
    return null;
  }
}

function inputPath(input) {
  if (!input) return null;
  let value = input;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.startsWith('{')) return trimmed;
    try { value = JSON.parse(trimmed); } catch { return null; }
  }
  if (!value || typeof value !== 'object') return null;
  for (const key of ['path', 'file_path', 'filePath', 'notebook_path', 'notebookPath']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key];
  }
  return null;
}

/** Extract workspace-relative paths from tool.started events written by the runtime. */
export function extractArtifactPaths(events) {
  const seen = new Set();
  const out = [];
  for (const event of events ?? []) {
    if (event?.type !== 'tool.started') continue;
    const payload = event.payload ?? {};
    const tool = String(payload.tool ?? payload.name ?? '');
    if (/^(read|ls|glob|grep|search|list|web|fetch)$/i.test(tool)) continue;
    const candidate = inputPath(payload.input);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

function storageName(id, filePath) {
  const base = path.basename(filePath).replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_').slice(0, 90) || 'artifact';
  return id + '-' + base;
}

/**
 * Copy one file into the artifact store and create its DB row.
 * Returns null when the path is outside the workspace, missing, a directory,
 * or larger than MAX_ARTIFACT_BYTES.
 */
export function storeArtifact({ db, taskId, runId = null, root, candidate, artifactDir, source = 'auto' }) {
  const absolute = resolveInside(root, candidate);
  if (!absolute) return null;
  let info;
  try { info = fs.statSync(absolute); } catch { return null; }
  if (!info.isFile() || info.size <= 0 || info.size > MAX_ARTIFACT_BYTES) return null;
  fs.mkdirSync(artifactDir, { recursive: true });
  const storageId = randomBytes(8).toString('hex');
  const storedPath = path.join(artifactDir, storageName(storageId, absolute));
  try { fs.copyFileSync(absolute, storedPath); } catch { return null; }
  const name = path.basename(absolute);
  return db.createArtifact({
    taskId,
    runId,
    name,
    kind: artifactKindFor(absolute),
    mime: mimeFor(absolute),
    bytes: info.size,
    storedPath,
    source,
  });
}

export function removeStoredArtifact(db, artifact) {
  if (!artifact) return;
  try { fs.unlinkSync(artifact.stored_path); } catch { /* already gone */ }
  db.deleteArtifact(artifact.id);
}

/** Media files newly produced in a git worktree, used as a fallback when the
 *  agent edited files through a shell command instead of a structured tool. */
export function mediaCandidatesFromStatus(lines) {
  const out = [];
  for (const line of lines ?? []) {
    const raw = line.slice(3).trim();
    const file = raw.includes(' -> ') ? raw.split(' -> ').pop().trim() : raw;
    if (!file) continue;
    if (artifactKindFor(file) === 'file') continue;
    out.push(file.replace(/^"|"$/g, ''));
  }
  return out;
}
