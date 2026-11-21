// Git worktree lifecycle. Worktrees live outside the repository
// (%LOCALAPPDATA%\\PetDeck\\worktrees\\<project>\\<task>) so an agent can never
// accidentally commit them into the project.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveWorktreesDir } from './db.mjs';

const execFileAsync = promisify(execFile);

export function slugify(value) {
  const s = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'project';
}

export async function git(args, { cwd, env = process.env, timeout = 15000 } = {}) {
  const { stdout, stderr } = await execFileAsync('git', args, { cwd, env, timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return String(stdout ?? '').trim() || String(stderr ?? '').trim();
}

/** True when dir is inside a git work tree. A repository root (or linked worktree)
 *  has .git on disk, which also keeps detection working where spawning git with
 *  piped stdio is blocked; nested directories fall back to git rev-parse. */
export async function isGitRepo(dir) {
  try {
    const st = fs.statSync(path.join(dir, '.git'));
    if (st.isDirectory() || st.isFile()) return true;
  } catch { /* not a repository root */ }
  try {
    const out = await git(['rev-parse', '--is-inside-work-tree'], { cwd: dir });
    return out === 'true';
  } catch {
    return false;
  }
}

export async function resolveRepoRoot(dir) {
  try { return await git(['rev-parse', '--show-toplevel'], { cwd: dir }); }
  catch { return null; }
}

export async function branchExists(repoPath, branch) {
  try {
    await git(['show-ref', '--verify', '--quiet', 'refs/heads/' + branch], { cwd: repoPath });
    return true;
  } catch { return false; }
}

export function worktreePathFor({ projectName, taskId, root = resolveWorktreesDir() }) {
  return path.join(root, slugify(projectName), String(taskId));
}

/** Create a worktree for one task. Refuses to reuse an existing path. */
export async function createWorktree({ repoPath, projectName, taskId, branch = 'petdeck/' + taskId, baseRef = 'HEAD', root = resolveWorktreesDir() }) {
  const worktreePath = worktreePathFor({ projectName, taskId, root });
  if (fs.existsSync(worktreePath)) throw new Error('worktree path already exists: ' + worktreePath);
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
  const args = ['-C', repoPath, 'worktree', 'add', '-b', branch, worktreePath, baseRef];
  // stdio:'ignore' avoids a piped-stdout dependency (and the bridge never needs git's
  // chatter); the exit status plus the directory check below are the contract.
  const result = spawnSync('git', args, { cwd: repoPath, stdio: 'ignore', windowsHide: true, timeout: 60000 });
  if (result.error) throw new Error('git worktree add failed: ' + String(result.error.message || result.error));
  if (result.status !== 0) throw new Error('git worktree add failed: exit ' + String(result.status));
  if (!fs.existsSync(worktreePath)) throw new Error('git worktree add succeeded but the worktree is missing');
  return { path: worktreePath, branch };
}

export async function removeWorktree({ repoPath, worktreePath, force = false }) {
  const args = ['-C', repoPath, 'worktree', 'remove', ...(force ? ['--force'] : []), worktreePath];
  try { await git(args); } catch { /* best effort */ }
}

/** Git with an exit code instead of an exception. Merge-tree uses exit 1 for
 *  "conflicts", which is a normal outcome we must inspect rather than throw. */
export async function gitResult(args, { cwd, env = process.env, timeout = 30000 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, { cwd, env, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') };
  } catch (e) {
    return {
      ok: false,
      code: typeof e?.code === 'number' ? e.code : 1,
      stdout: String(e?.stdout ?? ''),
      stderr: String(e?.stderr ?? e?.message ?? ''),
    };
  }
}

export async function currentBranch(repoPath) {
  const out = await gitResult(['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: repoPath });
  return out.ok ? out.stdout.trim() || null : null;
}

export async function statusPorcelain(repoPath) {
  const out = await gitResult(['status', '--porcelain=v1'], { cwd: repoPath });
  if (!out.ok) throw new Error('git status failed: ' + out.stderr.trim());
  return out.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Synchronous variant for run-completion side effects, which must settle the
 *  task in the same tick that writes the run.completed event. */
export function statusPorcelainSync(repoPath) {
  const out = spawnSync('git', ['status', '--porcelain=v1'], {
    cwd: repoPath, encoding: 'utf8', windowsHide: true, timeout: 15000,
  });
  if (out.status !== 0) throw new Error('git status failed: ' + String(out.stderr || '').trim());
  return String(out.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseConflictFiles(text) {
  const files = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(/CONFLICT \([^)]+\): (?:Merge conflict in )?(.+?)\s*$/);
    if (match) files.add(match[1]);
  }
  return [...files];
}

/** Conflict preflight without touching the working tree or index. */
export async function mergeTreeCheck(repoPath, baseBranch, branch) {
  const out = await gitResult(['merge-tree', '--write-tree', baseBranch, branch], { cwd: repoPath });
  const conflicts = parseConflictFiles(out.stdout + '\n' + out.stderr);
  if (out.ok) return { clean: true, conflicts: [] };
  if (conflicts.length || /CONFLICT/i.test(out.stdout + out.stderr)) return { clean: false, conflicts };
  throw new Error('git merge-tree failed: ' + (out.stderr || out.stdout).trim().slice(0, 500));
}

export async function mergePreview(repoPath, baseBranch, branch) {
  const [status, commits, diff, check] = await Promise.all([
    gitResult(['status', '--porcelain=v1'], { cwd: repoPath }),
    gitResult(['log', '--oneline', '--no-decorate', baseBranch + '..' + branch], { cwd: repoPath }),
    gitResult(['diff', '--stat', baseBranch + '...' + branch], { cwd: repoPath }),
    mergeTreeCheck(repoPath, baseBranch, branch),
  ]);
  const workingTreeClean = status.ok && status.stdout.trim() === '';
  return {
    base_branch: baseBranch,
    branch,
    // ready-to-merge: no conflicts and no uncommitted changes in the main tree
    clean: workingTreeClean && check.clean,
    working_tree_clean: workingTreeClean,
    merge_clean: check.clean,
    current_branch: await currentBranch(repoPath),
    commits: commits.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 50),
    diff_stat: diff.stdout.trim(),
    conflicts: check.conflicts,
  };
}

export async function mergeBranch(repoPath, branch, message) {
  const out = await gitResult(['merge', '--no-ff', branch, '-m', message], { cwd: repoPath });
  if (!out.ok) throw new Error((out.stderr || out.stdout || 'git merge failed').trim().slice(0, 800));
  return { stdout: out.stdout.trim() };
}

export async function deleteBranch(repoPath, branch) {
  const out = await gitResult(['branch', '-D', branch], { cwd: repoPath });
  if (!out.ok) throw new Error('git branch -D failed: ' + (out.stderr || out.stdout).trim());
  return true;
}

/** Remove a worktree and report failures instead of silently succeeding. */
export async function cleanupWorktree({ repoPath, worktreePath }) {
  const out = await gitResult(['worktree', 'remove', '--force', worktreePath], { cwd: repoPath });
  if (!out.ok) throw new Error('git worktree remove failed: ' + (out.stderr || out.stdout).trim());
  return true;
}
