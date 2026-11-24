import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveInside, storeArtifact } from './artifacts.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-artifacts-'));
  const root = path.join(dir, 'workspace');
  const outside = path.join(dir, 'outside');
  const artifactDir = path.join(dir, 'store');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(root, 'inside.txt'), 'inside');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside');
  const created = [];
  const db = {
    createArtifact(row) { created.push(row); return { id: 'artifact-1', ...row }; },
  };
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return { dir, root, outside, artifactDir, db, created };
}

test('artifacts: lexical traversal and symlink/junction escapes are rejected', (t) => {
  const { root, outside, artifactDir, db, created } = fixture(t);
  assert.equal(resolveInside(root, '../outside/secret.txt'), null);
  assert.equal(storeArtifact({ db, taskId: 'task', root, candidate: '../outside/secret.txt', artifactDir }), null);

  const link = path.join(root, 'linked-outside');
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('creating a symlink requires additional Windows privilege');
      return;
    }
    throw error;
  }
  assert.equal(resolveInside(root, 'linked-outside/secret.txt'), null);
  assert.equal(storeArtifact({ db, taskId: 'task', root, candidate: 'linked-outside/secret.txt', artifactDir }), null);
  assert.equal(created.length, 0);
});

test('artifacts: a regular workspace file is still copied', (t) => {
  const { root, artifactDir, db, created } = fixture(t);
  const artifact = storeArtifact({ db, taskId: 'task', root, candidate: 'inside.txt', artifactDir });
  assert.equal(artifact.name, 'inside.txt');
  assert.equal(fs.readFileSync(artifact.storedPath, 'utf8'), 'inside');
  assert.equal(created.length, 1);
});
