// DeepSeek Harness adapter — observe: ~/.dsh/sessions/<workspaceSlug>/<sessionId>/session.v4.jsonl.zstd
// (multi-frame zstd, one event per frame). inject: dsh CLI exists but headless syntax is
// UNVERIFIED => tier observe-only (clipboard relay), see docs/agent-会话存储勘察.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { latestFiles } from './shared.mjs';

export const id = 'dsh';
export const name = 'DeepSeek Harness';
export const tier = 'observe-only';

/** Zstd frame magic (little-endian 0xFD2FB528). */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

/** Decode a multi-frame session.v4.jsonl.zstd: every frame is one JSON event line.
 *
 *  Node's zstd decompressor stops after the first frame when a whole concatenated
 *  buffer is fed at once (verified on Node 24.18: both `zstdDecompressSync(buf)` and
 *  `createZstdDecompress().end(buf)` silently drop later frames), so split on the
 *  frame magic and decompress each frame separately. If a magic sequence occurs
 *  inside a compressed payload, that candidate segment fails to decode and is
 *  folded into the next one; a bogus leading magic is skipped. Corrupt frames are
 *  ignored without failing the whole file (freshness contract). */
export function decodeDshEvents(buf) {
  const offsets = [];
  for (let i = buf.indexOf(ZSTD_MAGIC); i !== -1; i = buf.indexOf(ZSTD_MAGIC, i + ZSTD_MAGIC.length)) offsets.push(i);

  const events = [];
  let i = 0;
  while (i < offsets.length) {
    let text = null;
    let consumedTo = i;
    for (let j = i + 1; j <= offsets.length; j++) {
      const end = j < offsets.length ? offsets[j] : buf.length;
      try { text = zlib.zstdDecompressSync(buf.subarray(offsets[i], end)).toString('utf8'); consumedTo = j; break; }
      catch { /* truncated by a bogus boundary — extend and retry */ }
    }
    if (text === null) { i++; continue; } // no frame starts here (bogus magic)
    for (const ln of text.split('\n')) {
      if (!ln.trim()) continue;
      try { events.push(JSON.parse(ln)); } catch { /* skip malformed line */ }
    }
    i = consumedTo;
  }
  return events;
}

/**
 * Pure: derive status/title/lastMessage from the ordered event list.
 * Contract (勘察实测): turn/start 未闭合 => running；turn/end reason.kind=completed => done、
 * interrupted => stuck；未决 approval/asked => waiting（优先级最高，等拍板）；
 * 无任何回合信号 => unknown（绝不编造）。
 */
export function parseDshEvents(events, _now = Date.now()) {
  let status = 'unknown', lastMessage = '', title = '', turn = '', session = '';
  let pendingApproval = false;
  for (const e of events) {
    const t = e?.type;
    if (t === 'session/title') title = e.data?.title ?? title;
    else if (t === 'session') session = e.data?.id || session;
    else if (t === 'turn/start') { turn = e.data?.turn ?? turn; status = 'running'; }
    else if (t === 'turn/end') {
      const kind = e.data?.reason?.kind;
      status = kind === 'completed' ? 'done' : (kind === 'interrupted' ? 'stuck' : 'unknown');
    }
    else if (t === 'approval/asked') pendingApproval = true;
    else if (t === 'approval/decided') pendingApproval = false;
    else if (t === 'assistant/message') {
      const c = e.data?.message?.content;
      if (Array.isArray(c)) { const txt = c.find((x) => x.type === 'text'); if (txt?.text) lastMessage = txt.text; }
    }
  }
  if (pendingApproval) status = 'waiting';
  return { status, lastMessage, title, turn, session };
}

/** Observe newest sessions (cap 5). Injectable home for tests. Throws on real faults. */
export async function observe({ home = process.env.PETDECK_OBSERVE_HOME || os.homedir(), now = Date.now() } = {}) {
  const dir = path.join(home, '.dsh', 'sessions');
  const files = latestFiles(dir, (n) => n === 'session.v4.jsonl.zstd', 5);
  const out = [];
  for (const f of files) {
    let buf;
    try { buf = fs.readFileSync(f); } catch { continue; }
    let events;
    try { events = decodeDshEvents(buf); }
    catch { continue; } // 单文件损坏只跳过该会话，不让整个适配器故障（freshness 契约保留）
    const r = parseDshEvents(events, now);
    if (r.status === 'unknown' && !r.lastMessage && !r.title) continue;
    out.push({ agent: id, source: 'dsh-zstd', session: r.session || path.basename(path.dirname(f)), title: r.title, status: r.status, lastMessage: r.lastMessage.slice(0, 200), turn: r.turn });
  }
  return out;
}

export function inject() {
  // Headless inject syntax unverified on real CLI => never pretend; always clipboard.
  return { ok: false, response: '' };
}

export default { id, name, tier, observe, inject };
