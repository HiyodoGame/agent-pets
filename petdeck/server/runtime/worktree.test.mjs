// Worktree disposal: a leftover directory git no longer registers must not pin
// cleanup at 409 forever (E2E: merge -> cleanup returned CLEANUP_FAILED because
// `.git/worktrees/<id>` was already gone while an empty directory remained).
// Run: node --test server/runtime/worktree.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanupWorktree, createWorktree, disposeWorktree, isWorktreeRegistered } from './worktree.mjs';

function gitSync(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' failed: ' + (r.stderr || r.stdout));
  return r.stdout;
}

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-wt-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  gitSync(['init', '-b', 'main'], repo);
  gitSync(['config', 'user.email', 'test@example.com'], repo);
  gitSync(['config', 'user.name', 'petdeck-test'], repo);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  gitSync(['add', '.'], repo);
  gitSync(['commit', '-m', 'init'], repo);
  return { root, repo, worktrees: path.join(root, 'worktrees') };
}

test('disposeWorktree: a live worktree is removed and reported as removed', async () => {
  const { root, repo, worktrees } = makeRepo();
  try {
    const wt = await createWorktree({ repoPath: repo, projectName: 'p', taskId: 't1', baseRef: 'main', root: worktrees });
    assert.equal(await isWorktreeRegistered(repo, wt.path), true);
    const result = await disposeWorktree({ repoPath: repo, worktreePath: wt.path });
    assert.deepEqual(result, { removed: true, cleaned: false });
    assert.equal(fs.existsSync(wt.path), false);
    assert.equal(await isWorktreeRegistered(repo, wt.path), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('disposeWorktree: an unregistered leftover directory is cleaned instead of failing', async () => {
  const { root, repo, worktrees } = makeRepo();
  try {
    const wt = await createWorktree({ repoPath: repo, projectName: 'p', taskId: 't2', baseRef: 'main', root: worktrees });
    // Simulate the E2E state: git dropped the registration (and the files) but the
    // directory survived - a plain empty dir that `git worktree remove` now refuses.
    await cleanupWorktree({ repoPath: repo, worktreePath: wt.path });
    fs.mkdirSync(wt.path, { recursive: true });
    assert.equal(await isWorktreeRegistered(repo, wt.path), false);
    const result = await disposeWorktree({ repoPath: repo, worktreePath: wt.path });
    assert.deepEqual(result, { removed: false, cleaned: true });
    assert.equal(fs.existsSync(wt.path), false);
    const listed = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout;
    assert.equal(listed.includes(wt.path), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
