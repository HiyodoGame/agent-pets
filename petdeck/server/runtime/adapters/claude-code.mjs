// Claude Code adapter — the first real agent lane for the M1 vertical slice.
// Spawn contract: claude -p --verbose --output-format stream-json [--resume <id>]
//                 --permission-mode <mode> <prompt>
// The prompt is stored in argv (never a shell); guardDash keeps it from being parsed
// as a CLI option. Stream-json events are mapped to the unified task event model.
import { guardDash } from '../../adapters/exec.mjs';

export const id = 'claude-code';
export const name = 'Claude Code';
export const form = 'cli';
export const command = 'claude';

export const PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'plan'];
const DEFAULT_PERMISSION_MODE = 'acceptEdits';

const MAX_TEXT = 8000;
const MAX_TOOL_RESULT = 8000;

function clip(value, max = MAX_TEXT) {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  if (s == null) return '';
  return s.length > max ? s.slice(0, max) + '\n…[truncated ' + (s.length - max) + ' chars]' : s;
}

/** Shrink tool input recursively so one Read of a huge file cannot bloat the event log. */
function clipValue(value, depth = 0) {
  if (typeof value === 'string') return clip(value, 1500);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 4) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 40).map((v) => clipValue(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value).slice(0, 40)) out[k] = clipValue(v, depth + 1);
  return out;
}

export function buildArgs({ prompt, sessionId = null, permissionMode = DEFAULT_PERMISSION_MODE } = {}) {
  const mode = PERMISSION_MODES.includes(permissionMode) ? permissionMode : DEFAULT_PERMISSION_MODE;
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('prompt is required');
  const args = ['-p', '--verbose', '--output-format', 'stream-json', '--permission-mode', mode];
  if (sessionId) args.push('--resume', String(sessionId));
  args.push(guardDash(prompt));
  return args;
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (block?.type === 'text') return String(block.text ?? '');
      if (block?.type === 'image') return '[image]';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

/**
 * Parse one stream-json line (already stripped of the newline).
 * Returns { events: Array<{type, payload}> }. Unknown/malformed lines become log
 * events instead of throwing: one noisy line must not kill a run.
 */
export function parseLine(line) {
  const raw = String(line ?? '').trim();
  if (!raw) return { events: [] };
  let msg;
  try { msg = JSON.parse(raw); } catch {
    return { events: [{ type: 'log.stdout', payload: { line: clip(raw, 2000) } }] };
  }
  if (!msg || typeof msg !== 'object') return { events: [] };
  const sessionId = typeof msg.session_id === 'string' ? msg.session_id : null;

  if (msg.type === 'system') {
    if (msg.subtype === 'init') {
      return { events: [{
        type: 'run.started',
        payload: {
          sessionId,
          model: msg.model ?? null,
          cwd: msg.cwd ?? null,
          permissionMode: msg.permissionMode ?? null,
          claudeVersion: msg.claude_code_version ?? null,
          tools: Array.isArray(msg.tools) ? msg.tools.length : 0,
        },
      }] };
    }
    return { events: [{ type: 'log.system', payload: { subtype: msg.subtype ?? null, sessionId } }] };
  }

  if (msg.type === 'assistant') {
    const message = msg.message ?? {};
    const events = [];
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type === 'text' && block.text) {
        events.push({ type: 'message.assistant', payload: { text: clip(block.text), messageId: message.id ?? null, model: message.model ?? null, stopReason: message.stop_reason ?? null } });
      } else if (block?.type === 'thinking' && block.thinking) {
        events.push({ type: 'message.thinking', payload: { text: clip(block.thinking), messageId: message.id ?? null } });
      } else if (block?.type === 'tool_use') {
        events.push({ type: 'tool.started', payload: { toolUseId: block.id ?? null, name: block.name ?? 'tool', input: clipValue(block.input ?? null) } });
      }
    }
    return { events };
  }

  if (msg.type === 'user') {
    const events = [];
    const content = msg.message?.content;
    const blocks = Array.isArray(content) ? content : [];
    for (const block of blocks) {
      if (block?.type !== 'tool_result') continue;
      events.push({
        type: 'tool.completed',
        payload: {
          toolUseId: block.tool_use_id ?? null,
          isError: Boolean(block.is_error),
          content: clip(textFromContent(block.content), MAX_TOOL_RESULT),
          parentToolUseId: msg.parent_tool_use_id ?? null,
        },
      });
    }
    // A plain user message (e.g. injected follow-up) is transcript material too.
    if (!events.length && typeof content === 'string') {
      events.push({ type: 'message.user', payload: { text: clip(content) } });
    }
    return { events };
  }

  if (msg.type === 'result') {
    const failed = Boolean(msg.is_error) || (typeof msg.subtype === 'string' && msg.subtype !== 'success');
    const payload = {
      subtype: msg.subtype ?? null,
      sessionId,
      result: clip(msg.result ?? '', 4000),
      durationMs: msg.duration_ms ?? null,
      durationApiMs: msg.duration_api_ms ?? null,
      numTurns: msg.num_turns ?? null,
      totalCostUsd: msg.total_cost_usd ?? null,
      usage: msg.usage ? clipValue(msg.usage) : null,
      permissionDenials: Array.isArray(msg.permission_denials) ? msg.permission_denials.length : 0,
    };
    return { events: [{ type: failed ? 'run.failed' : 'run.completed', payload }] };
  }

  return { events: [{ type: 'log.raw', payload: { type: msg.type ?? null } }] };
}

/** Normalize a task permission mode, falling back to the safe default. */
export function normalizePermissionMode(value) {
  return PERMISSION_MODES.includes(value) ? value : DEFAULT_PERMISSION_MODE;
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
