// Async CLI runner for adapter inject. Never uses a shell (prompt stays a literal
// argv/stdin payload, not shell-interpreted), enforces a timeout, and cleans up.
// A synchronous spawn failure (missing CLI) resolves a normal error result instead
// of rejecting. stdout/stderr each retain only the last 1 MiB so a chatty CLI can
// never exhaust bridge memory. The timeout kill targets the spawned child only —
// no cross-platform process-tree kill is claimed or attempted.
// Every result carries `summary`: a STRUCTURED outcome code only ('exit:<code>',
// 'timeout', 'spawn-error[:<CODE>]'). It never carries stderr/error-message text —
// CLIs may echo the prompt there, so free text is a payload-echo channel, not a
// summary.
import { spawn } from 'node:child_process';

const MAX_OUTPUT = 1024 * 1024; // keep the tail of each stream, drop older bytes

/**
 * @param {string} cmd  executable name (resolved via PATH, no shell)
 * @param {string[]} args  argv elements (metacharacters are inert without a shell)
 * @param {{input?: string, timeout?: number, spawnImpl?: Function, shell?: boolean}} [opts]
 * @returns {Promise<{status:number, stdout:string, stderr:string, error:boolean, summary:string}>}
 */
export function runCli(cmd, args = [], opts = {}) {
  const { input, timeout = 60000, spawnImpl = spawn } = opts;
  return new Promise((resolve) => {
    let settled = false;
    let child = null;
    let timer = null;
    const finish = (r) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(r); } };
    const spawnSummary = (e) => (e && typeof e.code === 'string' && /^[A-Z0-9_]+$/.test(e.code) ? `spawn-error:${e.code}` : 'spawn-error');
    try {
      child = spawnImpl(cmd, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return finish({ status: -1, stdout: '', stderr: String(e?.message ?? e), error: true, summary: spawnSummary(e) });
    }
    let stdout = '';
    let stderr = '';
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ status: -1, stdout, stderr, error: true, summary: 'timeout' });
    }, timeout);
    child.stdout?.on('data', (d) => { stdout = (stdout + d).slice(-MAX_OUTPUT); });
    child.stderr?.on('data', (d) => { stderr = (stderr + d).slice(-MAX_OUTPUT); });
    child.on('error', (e) => finish({ status: -1, stdout, stderr, error: true, summary: spawnSummary(e) }));
    child.on('close', (code) => finish({
      status: code ?? -1, stdout, stderr, error: false,
      summary: code === 0 ? '' : `exit:${code ?? -1}`,
    }));
    if (child.stdin) {
      child.stdin.on('error', () => { /* EPIPE when CLI exits early */ });
      if (input != null) child.stdin.end(input);
      else child.stdin.end();
    }
  });
}

/** Neutralise leading-dash so a user prompt is never parsed as a CLI option. */
export function guardDash(value) {
  const s = String(value ?? '');
  return s.trimStart().startsWith('-') ? ` ${s}` : s;
}
