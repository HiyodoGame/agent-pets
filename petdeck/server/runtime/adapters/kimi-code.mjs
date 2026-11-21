// Kimi Code adapter — second real agent lane (M2 slice, also used to verify M1
// end-to-end while the local Claude gateway is unavailable).
// Spawn contract: kimi -p <prompt> --output-format stream-json [-S <sessionId>]
// Prompt mode auto-approves routine tools, so no permission flag is accepted with -p
// (--yolo/--auto are rejected by the CLI); permissionMode is therefore informational.
import { guardDash } from '../../adapters/exec.mjs';

export const id = 'kimi-code';
export const name = 'Kimi Code';
export const form = 'cli';
export const command = 'kimi';

export const PERMISSION_MODES = ['default'];
const DEFAULT_PERMISSION_MODE = 'default';

const MAX_TEXT = 8000;
const MAX_TOOL_RESULT = 8000;

function clip(value, max = MAX_TEXT) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (s == null) return '';
  return s.length > max ? s.slice(0, max) + '…[truncated ' + (s.length - max) + ' chars]' : s;
}

function parseArguments(raw) {
  if (typeof raw !== 'string') return raw ?? null;
  try { return JSON.parse(raw); } catch { return { raw: clip(raw, 1500) }; }
}

function clipValue(value, depth = 0) {
  if (typeof value === 'string') return clip(value, 1500);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 4) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 40).map((v) => clipValue(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, 40)) out[k] = clipValue(v, depth + 1);
  return out;
}

export function buildArgs({ prompt, sessionId = null } = {}) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt is required');
  const args = [];
  if (sessionId) args.push('-S', String(sessionId));
  args.push('-p', guardDash(prompt), '--output-format', 'stream-json');
  return args;
}

/**
 * Parse one Kimi stream-json line (already stripped of the newline).
 * Shapes seen in 2.3.0:
 *   {"role":"meta","type":"system.version","version":"..."}
 *   {"role":"assistant","content":"...","tool_calls":[{"id":"tool_x","function":{"name":"Write","arguments":"{...json...}"}}]}
 *   {"role":"tool","tool_call_id":"tool_x","content":"..."}
 *   {"role":"meta","type":"session.resume_hint","session_id":"session_...","command":"kimi -r ..."}
 * The final resume_hint is the only carrier of the session id, so it maps to
 * run.completed; a process that dies earlier is settled by supervisor run.exited.
 */
export function parseLine(line) {
  const raw = String(line ?? '').trim();
  if (!raw) return { events: [] };
  let msg;
  try { msg = JSON.parse(raw); } catch {
    return { events: [{ type: 'log.stdout', payload: { line: clip(raw, 2000) } }] };
  }
  if (!msg || typeof msg !== 'object') return { events: [] };

  if (msg.role === 'meta') {
    if (msg.type === 'session.resume_hint' && typeof msg.session_id === 'string' && msg.session_id) {
      return { events: [{
        type: 'run.completed',
        payload: { subtype: 'success', sessionId: msg.session_id, result: clip(msg.content ?? '') },
      }] };
    }
    if (msg.type === 'system.version') {
      return { events: [{ type: 'log.system', payload: { subtype: 'version', version: msg.version ?? null } }] };
    }
    return { events: [{ type: 'log.system', payload: { subtype: msg.type ?? null } }] };
  }

  if (msg.role === 'assistant') {
    const events = [];
    if (typeof msg.content === 'string' && msg.content.trim()) {
      events.push({ type: 'message.assistant', payload: { text: clip(msg.content) } });
    }
    for (const call of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
      const fn = call?.function ?? {};
      events.push({
        type: 'tool.started',
        payload: {
          toolUseId: call?.id ?? null,
          name: fn.name ?? 'tool',
          input: clipValue(parseArguments(fn.arguments)),
        },
      });
    }
    return { events };
  }

  if (msg.role === 'tool') {
    return { events: [{
      type: 'tool.completed',
      payload: {
        toolUseId: msg.tool_call_id ?? null,
        isError: /^error[:\s]/i.test(String(msg.content ?? '')),
        content: clip(msg.content ?? '', MAX_TOOL_RESULT),
      },
    }] };
  }

  if (msg.role === 'error' || msg.type === 'error') {
    return { events: [{ type: 'log.stderr', payload: { line: clip(JSON.stringify(msg.error ?? msg), 2000) } }] };
  }

  return { events: [{ type: 'log.raw', payload: { role: msg.role ?? null, type: msg.type ?? null } }] };
}

export function normalizePermissionMode() {
  return DEFAULT_PERMISSION_MODE;
}

export const capabilities = {
  host: true,
  stream: true,
  resume: true,
  suspend: true,
  decisions: true,
  permissionModes: PERMISSION_MODES,
};

export default { id, name, form, command, buildArgs, parseLine, normalizePermissionMode, PERMISSION_MODES, capabilities };
