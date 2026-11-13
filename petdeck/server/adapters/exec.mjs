// Async CLI runner for adapter inject. Never uses a shell (prompt stays a literal
// argv/stdin payload, not shell-interpreted), enforces a timeout, and cleans up.
import { spawn } from 'node:child_process';

/**
 * @param {string} cmd  executable name (resolved via PATH, no shell)
 * @param {string[]} args  argv elements (metacharacters are inert without a shell)
 * @param {{input?: string, timeout?: number, spawnImpl?: Function, shell?: boolean}} [opts]
 * @returns {Promise<{status:number, stdout:string, stderr:string, error:boolean}>}
 */
export function runCli(cmd, args = [], opts = {}) {
  const { input, timeout = 60000, spawnImpl = spawn } = opts;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; clearTimeout(timer); resolve(r); } };
    let child;
    try {
      child = spawnImpl(cmd, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return finish({ status: -1, stdout: '', stderr: String(e?.message ?? e), error: true });
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ status: -1, stdout, stderr, error: true });
    }, timeout);
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', (e) => finish({ status: -1, stdout, stderr: String(e?.message ?? e), error: true }));
    child.on('close', (code) => finish({ status: code ?? -1, stdout, stderr, error: false }));
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
