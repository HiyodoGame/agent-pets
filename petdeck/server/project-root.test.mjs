import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalizeRows, createRootResolver, isTempDirectory } from './project-root.mjs';

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-root-test-'));
}

function row(overrides = {}) {
  return { agent: 'codex', session: 's-1', status: 'done', lastMessage: '', cwd: '', ...overrides };
}

test('isTempDirectory: os temp dir and its children are temp, project paths are not', () => {
  const tmp = os.tmpdir();
  assert.equal(isTempDirectory(tmp), true);
  assert.equal(isTempDirectory(path.join(tmp, 'petdeck-inject-codex')), true);
  assert.equal(isTempDirectory('C:\\Users\\someone\\AppData\\Local\\Temp\\scratch'), true);
  assert.equal(isTempDirectory('C:\\Users\\someone\\AppData\\Local\\Temp'), true);
  assert.equal(isTempDirectory('/tmp/scratch'), true);
  assert.equal(isTempDirectory('F:\\WorkSpace\\AIProjects\\Agent_Pets'), false);
  assert.equal(isTempDirectory(''), false);
});

test('createRootResolver: subdirectory resolves to the work tree root, nested repo keeps itself', () => {
  const base = workspace();
  const repo = path.join(base, 'repo');
  const sub = path.join(repo, 'app');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(sub, { recursive: true });
  const resolve = createRootResolver();
  assert.equal(resolve(sub), repo);
  assert.equal(resolve(repo), repo);
  assert.equal(resolve(base), base);

  const nested = path.join(repo, 'packages', 'web');
  fs.mkdirSync(path.join(nested, '.git'), { recursive: true });
  assert.equal(resolve(nested), nested);
});

test('canonicalizeRows: temp sessions lose their fake project, repo subdirs are re-rooted', () => {
  const base = workspace();
  const repo = path.join(base, 'CatWanted');
  const sub = path.join(repo, 'app');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(sub, { recursive: true });
  const tmpScratch = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-inject-codex-final-'));

  const rows = canonicalizeRows([
    row({ session: 'a', cwd: sub }),
    row({ session: 'b', cwd: repo }),
    row({ session: 'c', cwd: tmpScratch }),
    row({ session: 'd', cwd: '' }),
    row({ session: 'e', cwd: '/remote/work/app', host: 'build-box' }),
  ]);

  assert.equal(rows[0].cwd, repo);
  assert.equal(rows[0].projectName, 'CatWanted');
  assert.equal(rows[1].cwd, repo);
  assert.equal(rows[2].cwd, '');
  assert.equal(rows[2].projectId, '');
  assert.equal(rows[2].temp, true);
  assert.equal(rows[3].cwd, '');
  assert.equal(rows[3].temp, undefined);
  assert.equal(rows[4].cwd, '/remote/work/app');
  assert.equal(rows[4].host, 'build-box');
});

test('canonicalizeRows: injected resolver/isTemp keep the function testable without a real layout', () => {
  const rows = canonicalizeRows(
    [row({ cwd: 'X:/projects/app/src', projectId: 'agent-key', projectName: 'src' }), row({ cwd: 'X:/scratch' })],
    {
      resolveRoot: (cwd) => (cwd.startsWith('X:/projects') ? 'X:/projects' : cwd),
      isTemp: (cwd) => cwd === 'X:/scratch',
    },
  );
  assert.equal(rows[0].cwd, 'X:/projects');
  assert.equal(rows[0].projectId, 'X:/projects');
  assert.equal(rows[0].projectName, 'projects');
  assert.equal(rows[1].temp, true);
});
