// Process supervisor for long-running agent CLI runs.
// Owns: spawn (Windows-aware for .cmd shims), incremental line splitting, stderr
// capture, process-tree stop, and a single close callback. It does NOT persist
// events — the runtime service assigns ids and writes transcript/db.
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { resolveExecutable, quoteForCmd } from '../adapters/exec.mjs';
import { suspendProcessTree, resumeProcessTree } from './process-control.mjs';

const MAX_PENDING_LINE = 2 * 1024 * 1024;
const MAX_STDERR = 32 * 1024;

export function createSupervisor({ onEvent = () => {}, onExit = () => {}, platform = process.platform, spawnImpl = spawn, env = process.env, killTimeoutMs = 5000, logger = console, suspendImpl = suspendProcessTree, resumeImpl = resumeProcessTree, killGroupImpl = (pid, signal) => process.kill(-pid, signal) } = {}) {
  const handles = new Map();

  function killTree(pid, child) {
    return new Promise((resolve) => {
      if (!pid || platform !== 'win32') {
        // POSIX children are started in their own process group. Signal the group
        // so Agent-spawned tools cannot outlive the direct CLI process.
        if (pid && platform !== 'win32') {
          try { killGroupImpl(pid, 'SIGTERM'); }
          catch { try { child.kill('SIGTERM'); } catch { /* already gone */ } }
        } else {
          try { child.kill('SIGTERM'); } catch { /* already gone */ }
        }
        resolve();
        return;
      }
      // taskkill /T kills the whole tree: claude may spawn tool subprocesses.
      let killer;
      try {
        killer = spawnImpl('taskkill', ['/PID', String(pid), '/T', '/F'], { shell: false, stdio: 'ignore', windowsHide: true });
      } catch {
        try { child.kill(); } catch { /* ignore */ }
        resolve();
        return;
      }
      killer.on('error', () => { try { child.kill(); } catch { /* ignore */ } resolve(); });
      killer.on('close', () => resolve());
    });
  }

  function start({ runId, taskId, command, args = [], cwd, env: extraEnv = {}, parseLine }) {
    if (handles.has(runId)) throw new Error('run already started');
    // spawn(cwd) changes the OS working directory but does not rewrite inherited
    // shell variables. OpenCode on Windows trusts PWD; a stale value from the shell
    // that launched PetDeck otherwise redirects tools into that shell's repository.
    const mergedEnv = { ...env, ...extraEnv, PWD: cwd, OLDPWD: cwd };
    const target = resolveExecutable(command, { platform, env: mergedEnv });
    // preface is the shim's own argument (a node-script entry), never user text.
    const preface = target.preface ?? [];
    let spawnCmd = target.file;
    let spawnArgs = [...preface, ...args];
    if (target.viaCmd) {
      spawnCmd = mergedEnv.ComSpec || process.env.ComSpec || 'cmd.exe';
      spawnArgs = ['/d', '/s', '/c', [target.file, ...preface, ...args].map(quoteForCmd).join(' ')];
    }

    let child;
    try {
      child = spawnImpl(spawnCmd, spawnArgs, {
        cwd, env: mergedEnv, shell: false, windowsHide: true,
        // A POSIX process group gives stopAll/timeout one boundary for the CLI and
        // every tool descendant. Windows uses taskkill /T below instead.
        detached: platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      const code = typeof e?.code === 'string' ? e.code : 'spawn-error';
      logger.warn?.('proc.spawn_failed', { runId, taskId, errCode: code });
      onEvent('run.failed', { error: 'spawn-error', code }, { runId, taskId });
      onExit({ runId, taskId, code: -1, signal: null, stopped: false, spawnError: code });
      return null;
    }

    const startedAt = Date.now();
    // The command name only: args carry the prompt and must never reach a log.
    const exeName = String(target.file ?? command).split(/[\\/]/).pop();
    logger.debug?.('proc.spawn', { runId, taskId, pid: child.pid ?? null, exe: exeName, viaCmd: Boolean(target.viaCmd) });

    const handle = {
      runId, taskId, pid: child.pid ?? null, child, stopped: false, paused: false,
      stop: () => stopHandle(handle),
      suspend: () => {
        if (closed || !handle.pid) return { ok: false, code: 'not-running', detail: 'process is not running' };
        const result = suspendImpl(handle.pid, { platform });
        if (result?.ok) handle.paused = true;
        return result ?? { ok: false, code: 'control-failed', detail: 'no result' };
      },
      resume: () => {
        if (closed || !handle.pid) return { ok: false, code: 'not-running', detail: 'process is not running' };
        const result = resumeImpl(handle.pid, { platform });
        if (result?.ok) handle.paused = false;
        return result ?? { ok: false, code: 'control-failed', detail: 'no result' };
      },
    };
    handles.set(runId, handle);

    const decoder = new StringDecoder('utf8');
    let pending = '';
    let stderr = '';
    let closed = false;
    let stderrTimer = null;
    let stopResolve = null;

    const emit = (type, payload) => {
      try { onEvent(type, payload, { runId, taskId }); }
      catch (e) { logger.error?.('[petdeck-runtime] event handler failed:', e?.message ?? e); }
    };

    function flushPending(force = false) {
      if (!pending) return;
      if (!force && pending.length < MAX_PENDING_LINE) return;
      const line = pending;
      pending = '';
      if (force) {
        // A pathological unterminated line: surface it as log output, never drop silently.
        emit('log.stdout', { line: line.slice(0, 4000), truncated: line.length > 4000 });
        return;
      }
      for (const part of line.split('\n')) {
        const text = part.endsWith('\r') ? part.slice(0, -1) : part;
        if (text.trim()) dispatch(text);
      }
    }

    function dispatch(line) {
      let parsed;
      try { parsed = parseLine(line); }
      catch {
        emit('log.stdout', { line: line.slice(0, 4000), parseError: true });
        return;
      }
      for (const ev of parsed?.events ?? []) emit(ev.type, ev.payload);
    }

    function flushStderr() {
      if (!stderr) return;
      const text = stderr.slice(-4000);
      stderr = '';
      emit('log.stderr', { text });
    }

    child.stdout?.on('data', (chunk) => {
      pending += decoder.write(chunk);
      if (pending.length > MAX_PENDING_LINE) {
        const cut = pending.lastIndexOf('\n');
        if (cut >= 0) {
          const done = pending.slice(0, cut);
          pending = pending.slice(cut + 1);
          for (const part of done.split('\n')) {
            const text = part.endsWith('\r') ? part.slice(0, -1) : part;
            if (text.trim()) dispatch(text);
          }
        } else {
          flushPending(true);
        }
      }
      let idx;
      while ((idx = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, idx).replace(/\r$/, '');
        pending = pending.slice(idx + 1);
        if (line.trim()) dispatch(line);
      }
    });

    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + decoder.write(chunk)).slice(-MAX_STDERR);
      if (!stderrTimer) {
        stderrTimer = setTimeout(() => { stderrTimer = null; flushStderr(); }, 300);
        stderrTimer.unref?.();
      }
    });

    child.on('error', (e) => {
      const code = typeof e?.code === 'string' ? e.code : 'spawn-error';
      emit('run.failed', { error: 'spawn-error', code });
      finish(-1, null, code);
    });

    child.on('close', (code, signal) => {
      finish(code, signal);
    });

    function finish(code, signal, spawnError = null) {
      if (closed) return;
      closed = true;
      if (stderrTimer) clearTimeout(stderrTimer);
      const tail = decoder.end();
      if (tail) pending += tail;
      flushStderr();
      if (pending.trim()) {
        for (const part of pending.split('\n')) {
          const text = part.endsWith('\r') ? part.slice(0, -1) : part;
          if (text.trim()) dispatch(text);
        }
      }
      pending = '';
      handles.delete(runId);
      logger.info?.('proc.exit', {
        runId,
        taskId,
        exitCode: typeof code === 'number' ? code : null,
        signal: signal ?? null,
        stopped: handle.stopped,
        durationMs: Date.now() - startedAt,
        ...(spawnError ? { errCode: spawnError } : {}),
      });
      emit('run.exited', { code, signal, stopped: handle.stopped });
      try {
        onExit({ runId, taskId, code, signal, stopped: handle.stopped, spawnError });
      } catch (e) {
        logger.error?.('[petdeck-runtime] exit handler failed:', e?.message ?? e);
      } finally {
        if (stopResolve) { const resolveStop = stopResolve; stopResolve = null; resolveStop(); }
      }
    }

    function stopHandle(h) {
      if (closed) return Promise.resolve();
      h.stopped = true;
      if (h.paused) {
        try { resumeImpl(h.pid, { platform }); } catch { /* best effort */ }
        h.paused = false;
      }
      return new Promise((resolve) => {
        stopResolve = resolve;
        killTree(h.pid, child).catch(() => {});
        const timer = setTimeout(() => {
          if (platform !== 'win32' && h.pid) {
            try { killGroupImpl(h.pid, 'SIGKILL'); } catch { /* group already gone */ }
          }
          try { child.kill('SIGKILL'); } catch { /* ignore */ }
          resolve();
        }, killTimeoutMs);
        timer.unref?.();
      });
    }

    return handle;
  }

  return {
    start,
    get(runId) { return handles.get(runId) ?? null; },
    list() { return [...handles.values()]; },
    async stopAll() { await Promise.all([...handles.values()].map((h) => h.stop())); },
  };
}