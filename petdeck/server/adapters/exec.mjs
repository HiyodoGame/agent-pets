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
// Windows shim handling: npm-installed CLIs (opencode, dsh) only exist as .cmd/.bat
// shims in %APPDATA%\npm. Node never applies PATHEXT (so 'opencode' is ENOENT) and
// Node >= 20.12 refuses to spawn .cmd/.bat with shell:false (EINVAL). resolve
// +ME resolves the real file and hosts scripts in cmd.exe explicitly.
import { spawn } from 'node:child_process';
import { accessSync, constants as FS } from 'node:fs';
import path from 'node:path';

const MAX_OUTPUT = 1024 * 1024; // keep the tail of each stream, drop older bytes
const WIN_CMD_EXTS = new Set(['.cmd', '.bat']);

function isFile(file) {
  try { accessSync(file, FS.F_OK); return true; } catch { return false; }
}

/**
 * Resolve a command name to the file Windows would actually run. Preference order is
 * .exe/.com before .cmd/.bat (an .exe is never a shim wrapper) and PATHEXT order
 * within each directory. Extensionless npm sh shims are ignored: Windows can't run
 * them, and treating them as executable is exactly the ENOENT bug this fixes.
 * Returns { file, viaCmd } where viaCmd means the file must be hosted by cmd.exe.
 */
export function resolveExecutable(cmd, { platform = process.platform, env = process.env, isFileImpl = isFile } = {}) {
  if (platform !== 'win32' || !cmd) return { file: cmd, viaCmd: false };
  const ext = path.extname(cmd).toLowerCase();
  if (/[\\/]/.test(cmd)) return { file: cmd, viaCmd: WIN_CMD_EXTS.has(ext) };
  if (WIN_CMD_EXTS.has(ext) || ext === '.exe' || ext === '.com') return { file: cmd, viaCmd: WIN_CMD_EXTS.has(ext) };

  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const pathext = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const ranked = ['.exe', '.com', ...pathext.filter((e) => e !== '.exe' && e !== '.com')];
  for (const name of ranked.map((e) => cmd + e)) {
    for (const dir of dirs) {
      const full = path.join(dir, name);
      if (isFileImpl(full)) return { file: full, viaCmd: WIN_CMD_EXTS.has(path.extname(full).toLowerCase()) };
    }
  }
  return { file: cmd, viaCmd: false }; // unresolved: let spawn report ENOENT as before
}

/** Quote one argv element for cmd.exe. Values reaching this path are CLI-controlled
 *  flags, but quoting stays conservative so no metacharacter is ever interpreted. */
export function quoteForCmd(value) {
  const s = String(value ?? '');
  return /[\s"&|<>^()%]/.test(s) ? '"' + s.replace(/"/g, '""').replace(/%/g, '%%') + '"' : s;
}

/**
 * @param {string} cmd  executable name (resolved via PATH/PATHEXT; never shell-interpreted)
 * @param {string[]} args  argv elements
 * @param {{input?: string, timeout?: number, spawnImpl?: Function, resolve?: boolean, env?: object, platform?: string, isFile?: Function}} [opts]
 * @returns {Promise<{status:number, stdout:string, stderr:string, error:boolean, summary:string}>}
 */
export function runCli(cmd, args = [], opts = {}) {
  const { input, timeout = 60000, spawnImpl = spawn, resolve = true, env = process.env } = opts;
  const target = resolve ? resolveExecutable(cmd, { platform: opts.platform, env, isFileImpl: opts.isFile }) : { file: cmd, viaCmd: false };
  // .cmd/.bat scripts can only be hosted by cmd.exe; their argv payload is quoted above.
  const spawnCmd = target.viaCmd ? (env.ComSpec || 'cmd.exe') : target.file;
  const spawnArgs = target.viaCmd ? ['/d', '/s', '/c', [target.file, ...args].map(quoteForCmd).join(' ')] : args;
  return new Promise((resolvePromise) => {
    let settled = false;
    let child = null;
    let timer = null;
    const finish = (r) => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolvePromise(r); } };
    const spawnSummary = (e) => (e && typeof e.code === 'string' && /^[A-Z0-9_]+$/.test(e.code) ? 'spawn-error:' + e.code : 'spawn-error');
    try {
      child = spawnImpl(spawnCmd, spawnArgs, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
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
      summary: code === 0 ? '' : 'exit:' + (code ?? -1),
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
  return s.trimStart().startsWith('-') ? ' ' + s : s;
}
