// opencode runtime adapter — hosted in a worktree, JSON event stream.
// Contract verified against opencode 2.0.30:
//   opencode run --format json --auto --standalone [--session <id>] <prompt>
// Events are one JSON object per line; the first step_start carries the sessionID.
// --standalone pins the run to a private server instead of the background service
// daemon: the daemon keeps the run's worktree as its working directory, and on
// Windows a directory that is some process's cwd cannot be deleted - which made
// `git worktree remove` fail with 'failed to delete ...: Permission denied' long
// after the run exited (E2E: merge succeeded, cleanup returned CLEANUP_FAILED).
// Completion is settled by process exit (run.exited) so multi-step runs are not cut
// short; the service still gets a final assistant text for decision detection.
import { guardDash } from '../../adapters/exec.mjs';

export const id = 'opencode';
export const name = 'opencode';
export const form = 'cli';
export const command = 'opencode';

export const PERMISSION_MODES = ['default'];
const DEFAULT_PERMISSION_MODE = 'default';

const MAX_TEXT = 8000;
const MAX_TOOL_RESULT = 8000;

export const capabilities = {
  host: true,
  stream: true,
  resume: true,
  suspend: true,
  decisions: true,
  permissionModes: PERMISSION_MODES,
};

function clip(value, max = MAX_TEXT) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (s == null) return '';
  return s.length > max ? s.slice(0, max) + '\n…[truncated ' + (s.length - max) + ' chars]' : s;
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
  // --standalone: never hand the worktree to the shared background daemon (see header).
  const args = ['run', '--format', 'json', '--auto', '--standalone'];
  if (sessionId) args.push('--session', String(sessionId));
  args.push(guardDash(prompt));
  return args;
}

function toolFromPart(part) {
  const state = part?.state ?? {};
  return {
    toolUseId: part?.callID ?? part?.callId ?? part?.id ?? null,
    name: part?.tool ?? part?.name ?? 'tool',
    input: clipValue(state.input ?? part?.input ?? null),
  };
}

function parseEvent(msg, announced) {
  const events = [];
  const sessionId = typeof msg.sessionID === 'string' && msg.sessionID ? msg.sessionID : null;

  if (msg.type === 'step_start') {
    if (!announced) {
      events.push({
        type: 'run.started',
        payload: {
          sessionId,
          model: msg.part?.model ?? msg.model ?? null,
          agent: msg.part?.agent ?? null,
        },
      });
    }
    return events;
  }

  if (msg.type === 'text') {
    const text = msg.part?.text ?? msg.text;
    if (typeof text === 'string' && text.trim()) events.push({ type: 'message.assistant', payload: { text: clip(text), sessionId } });
    return events;
  }

  if (msg.type === 'reasoning' || msg.type === 'thinking') {
    const text = msg.part?.text ?? msg.text;
    if (typeof text === 'string' && text.trim()) events.push({ type: 'message.thinking', payload: { text: clip(text) } });
    return events;
  }

  if (msg.type === 'tool_use' || msg.type === 'tool') {
    events.push({ type: 'tool.started', payload: toolFromPart(msg.part ?? msg) });
    return events;
  }

  if (msg.type === 'tool_result') {
    const part = msg.part ?? msg;
    const output = part?.state?.output ?? part?.output ?? part?.content ?? '';
    events.push({
      type: 'tool.completed',
      payload: {
        toolUseId: part?.callID ?? part?.callId ?? part?.id ?? null,
        isError: Boolean(part?.state?.status === 'error' || part?.isError),
        content: clip(typeof output === 'string' ? output : JSON.stringify(output), MAX_TOOL_RESULT),
      },
    });
    return events;
  }

  if (msg.type === 'error') {
    const detail = msg.error ?? msg;
    const message = detail?.message ?? detail?.data?.message ?? JSON.stringify(detail);
    return [{ type: 'run.failed', payload: { subtype: detail?.type ?? 'error', error: clip(message, 2000), sessionId } }];
  }

  return [{ type: 'log.raw', payload: { type: msg.type ?? null, sessionId } }];
}

/** Stateful parser: run.started is emitted once even when opencode emits several steps. */
export function createParser() {
  let announced = false;
  return {
    parseLine(line) {
      const raw = String(line ?? '').trim();
      if (!raw) return { events: [] };
      let msg;
      try { msg = JSON.parse(raw); } catch {
        return { events: [{ type: 'log.stdout', payload: { line: clip(raw, 2000) } }] };
      }
      if (!msg || typeof msg !== 'object') return { events: [] };
      const events = parseEvent(msg, announced);
      if (events.some((e) => e.type === 'run.started')) announced = true;
      return { events };
    },
  };
}

const defaultParser = createParser();
export function parseLine(line) { return defaultParser.parseLine(line); }

export function normalizePermissionMode() {
  return DEFAULT_PERMISSION_MODE;
}

export default {
  id, name, form, command, capabilities, buildArgs, parseLine, createParser, normalizePermissionMode, PERMISSION_MODES,
};
