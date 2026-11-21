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
// resolves the real file behind a shim: a shim wrapping a concrete .exe is spawned
// directly (its argv — prompt included — survives byte for byte), a node-script shim
// resolves to node.exe + script (preface), and only an unparseable shim is hosted in
// cmd.exe. cmd.exe ends its /c command at the first newline even inside quotes, so
// quoteForCmd folds CR/LF into spaces for that remaining path: without the fold a
// multi-line prompt silently reaches the CLI as its first line only.
import { spawn } from 'node:child_process';
import { accessSync, constants as FS, readFileSync } from 'node:fs';
import path from 'node:path';

const MAX_OUTPUT = 1024 * 1024; // keep the tail of each stream, drop older bytes
const WIN_CMD_EXTS = new Set(['.cmd', '.bat']);
const SHIM_MAX_BYTES = 64 * 1024;
const DP0_REF = /%[~]?dp0%?/i;
const SCRIPT_EXTS = new Set(['.js', '.cjs', '.mjs']);

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
  if (/[\\/]/.test(cmd)) {
    if (!WIN_CMD_EXTS.has(ext)) return { file: cmd, viaCmd: false };
    return resolveShimTarget(cmd, { env, platform, isFileImpl }) ?? { file: cmd, viaCmd: true };
  }
  if (WIN_CMD_EXTS.has(ext)) return resolveShimTarget(cmd, { env, platform, isFileImpl }) ?? { file: cmd, viaCmd: true };
  if (ext === '.exe' || ext === '.com') return { file: cmd, viaCmd: false };

  const dirs = String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const pathext = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD')
    .split(';').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const ranked = ['.exe', '.com', ...pathext.filter((e) => e !== '.exe' && e !== '.com')];
  for (const name of ranked.map((e) => cmd + e)) {
    for (const dir of dirs) {
      const full = path.join(dir, name);
      if (!isFileImpl(full)) continue;
      if (!WIN_CMD_EXTS.has(path.extname(full).toLowerCase())) return { file: full, viaCmd: false };
      return resolveShimTarget(full, { env, platform, isFileImpl }) ?? { file: full, viaCmd: true };
    }
  }
  return { file: cmd, viaCmd: false }; // unresolved: let spawn report ENOENT as before
}

/** Expand a %dp0% / %~dp0 / %~dp0% reference into the shim's own directory. */
function expandDp0(token, dir) {
  let expanded = token.replace(/%dp0%/gi, dir).replace(/%~dp0/gi, dir).replace(/%$/, '');
  // Tests exercise Windows shims while the host process can be POSIX (CI). The
  // shim's own separators are Windows-style, so translate them before the host
  // path.normalize; on a real Windows host this is a no-op.
  if (process.platform !== 'win32') expanded = expanded.replace(/\\/g, '/');
  return path.normalize(expanded);
}

/**
 * npm writes two shim shapes:
 *   "%dp0%\node_modules\<pkg>\bin\<name>.exe" %*        -> a concrete executable
 *   "%_prog%" "%dp0%\node_modules\<pkg>\<entry>.js" %*   -> node + script
 * Resolving either drops cmd.exe from the path, which is what keeps a multi-line
 * prompt intact: cmd.exe treats a newline in its /c string as a command separator.
 * Returns { file, viaCmd:false[, preface] } or null when the shim needs cmd.exe.
 */
function resolveShimTarget(shimFile, { env = process.env, platform = process.platform, isFileImpl = isFile } = {}) {
  let text;
  try { text = readFileSync(shimFile, 'utf8').slice(0, SHIM_MAX_BYTES); } catch { return null; }
  if (!DP0_REF.test(text)) return null;
  const dir = path.dirname(shimFile);
  const candidates = [...text.matchAll(/"([^"\r\n]*%[~]?dp0%?[^"\r\n]*)"/gi)]
    .map((m) => expandDp0(m[1], dir))
    .filter((file) => isFileImpl(file));
  // A script entry wins over a bare exe: npm emits `"%_prog%" "<entry>" %*`, so the
  // first quoted path can be the interpreter itself. A shim with only an .exe is the
  // shim-wraps-a-native-binary shape (opencode) and spawns that binary alone.
  const script = candidates.find((file) => SCRIPT_EXTS.has(path.extname(file).toLowerCase()));
  if (script) {
    const localNode = path.join(dir, 'node.exe');
    const node = isFileImpl(localNode) ? { file: localNode } : resolveExecutable('node', { platform, env, isFileImpl });
    if (node && !node.viaCmd && isFileImpl(node.file)) return { file: node.file, viaCmd: false, preface: [script] };
  }
  const exe = candidates.find((file) => ['.exe', '.com'].includes(path.extname(file).toLowerCase()));
  return exe ? { file: exe, viaCmd: false } : null;
}

/** Quote one argv element for cmd.exe. Values reaching this path are CLI-controlled
 *  flags, but quoting stays conservative so no metacharacter is ever interpreted.
 *  CR/LF are folded into spaces: cmd.exe ends the /c command at a newline even inside
 *  quotes, so the alternative is silent truncation of everything after line 1. */
export function quoteForCmd(value) {
  const s = String(value ?? '').replace(/\r\n?|\n/g, ' ');
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
  // preface is the shim's own argument (a node-script entry), never user text.
  const preface = target.preface ?? [];
  // .cmd/.bat scripts that could not be resolved to a real target can only be hosted
  // by cmd.exe; their argv payload is quoted (and newline-folded) above.
  const spawnCmd = target.viaCmd ? (env.ComSpec || 'cmd.exe') : target.file;
  const spawnArgs = target.viaCmd
    ? ['/d', '/s', '/c', [target.file, ...preface, ...args].map(quoteForCmd).join(' ')]
    : [...preface, ...args];
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
