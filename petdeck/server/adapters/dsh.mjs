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

/** Decode a multi-frame session.v4.jsonl.zstd: every frame is one JSON event line.
 *  Streaming decompressor natively handles concatenated frames. */
export function decodeDshEvents(buf) {
  return decodeStream(zlib.createZstdDecompress(), buf);
}

function decodeStream(decompressor, buf) {
  return new Promise((resolve, reject) => {
    const out = [];
    decompressor.on('data', (d) => out.push(d));
    decompressor.on('error', reject);
    decompressor.on('end', () => {
      const text = Buffer.concat(out).toString('utf8');
      const events = [];
      for (const ln of text.split('\n')) {
        if (!ln.trim()) continue;
        try { events.push(JSON.parse(ln)); } catch { /* skip malformed line */ }
      }
      resolve(events);
    });
    decompressor.end(buf);
  });
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
    try { events = await decodeDshEvents(buf); }
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
