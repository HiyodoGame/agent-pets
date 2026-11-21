// At-rest manager key handling: migrate plaintext once, never re-encrypt unrelated saves,
// degrade to plaintext when DPAPI is unavailable, and surface unreadable ciphertext.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openRuntimeDb } from './db.mjs';
import { createRuntimeService } from './service.mjs';

function tempDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-' + tag + '-')); }

const quiet = (() => {
  const log = { debug() {}, info() {}, warn() {}, error() {} };
  log.child = () => log;
  return log;
})();

function makeBox({ failEncrypt = false, failDecrypt = false } = {}) {
  let available = true;
  return {
    isEncrypted: (value) => typeof value === 'string' && value.startsWith('dpapi:v1:'),
    available: () => available,
    lastError: () => (available ? null : 'DPAPI_UNAVAILABLE'),
    encrypt(value) {
      if (failEncrypt) { available = false; throw new Error('DPAPI unavailable'); }
      return 'dpapi:v1:' + Buffer.from('sealed:' + String(value), 'utf8').toString('base64');
    },
    decrypt(value) {
      if (failDecrypt) { available = false; throw new Error('DPAPI unreadable'); }
      const raw = Buffer.from(String(value).slice('dpapi:v1:'.length), 'base64').toString('utf8');
      return raw.replace(/^sealed:/, '');
    },
  };
}

function makeService(dataDir, worktreesRoot, secretBox, managerClient = null) {
  return createRuntimeService({
    dataDir,
    worktreesRoot,
    adapters: {},
    supervisor: () => ({ start() { throw new Error('supervisor should not start'); }, async stopAll() {} }),
    logger: quiet,
    secretBox,
    managerClient,
  });
}

function seedManager(dataDir, manager) {
  const db = openRuntimeDb({ dataDir });
  db.setSetting('manager', manager);
  db.close();
}

test('manager key is stored as DPAPI ciphertext and survives a restart', async (t) => {
  const dataDir = tempDir('sec-a');
  const worktreesRoot = tempDir('sec-a-wt');
  const box = makeBox();
  let first = makeService(dataDir, worktreesRoot, box);
  let second = null;
  t.after(async () => {
    try { if (second) await second.shutdown(); } catch { /* already closed */ }
    try { if (first) await first.shutdown(); } catch { /* already closed */ }
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(worktreesRoot, { recursive: true, force: true });
  });

  first.updateManagerSettings({ provider: 'openai', baseUrl: 'https://api.example.test/v1', model: 'm1', apiKey: 'sk-live-秘密' });
  const stored = first.db.getSetting('manager', null);
  assert.equal(stored.apiKey.startsWith('dpapi:v1:'), true);
  assert.equal(stored.apiKey.includes('sk-live'), false);
  assert.equal(first.getManagerSettings().apiKeySet, true);
  assert.equal(first.statusSnapshot().secrets.mode, 'dpapi');
  await first.shutdown();
  first = null;

  const calls = [];
  second = makeService(dataDir, worktreesRoot, box, { chat: async () => { calls.push(1); return { model: 'm1', content: 'OK' }; } });
  assert.equal(second.getManagerSettings().apiKeySet, true);
  assert.equal(second.statusSnapshot().secrets.mode, 'dpapi');
  assert.equal((await second.testManager()).reply, 'OK');
  assert.equal(calls.length, 1);
});

test('plaintext from an older build is migrated on startup', async (t) => {
  const dataDir = tempDir('sec-b');
  const worktreesRoot = tempDir('sec-b-wt');
  seedManager(dataDir, { provider: 'openai', baseUrl: 'https://api.example.test/v1', model: 'm1', apiKey: 'sk-plain-old' });
  const service = makeService(dataDir, worktreesRoot, makeBox());
  t.after(async () => { await service.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(worktreesRoot, { recursive: true, force: true }); });

  const stored = service.db.getSetting('manager', null);
  assert.equal(stored.apiKey.startsWith('dpapi:v1:'), true);
  assert.equal(stored.apiKey.includes('sk-plain-old'), false);
  assert.equal(service.getManagerSettings().apiKeySet, true);
  assert.equal(service.statusSnapshot().secrets.mode, 'dpapi');
});

test('unrelated manager saves preserve the stored ciphertext', async (t) => {
  const dataDir = tempDir('sec-c');
  const worktreesRoot = tempDir('sec-c-wt');
  const service = makeService(dataDir, worktreesRoot, makeBox());
  t.after(async () => { await service.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(worktreesRoot, { recursive: true, force: true }); });

  service.updateManagerSettings({ provider: 'openai', baseUrl: 'https://api.example.test/v1', model: 'm1', apiKey: 'sk-live' });
  const before = service.db.getSetting('manager', null).apiKey;
  service.updateManagerSettings({ model: 'm2', temperature: 0.7 });
  const after = service.db.getSetting('manager', null);
  assert.equal(after.apiKey, before);
  assert.equal(after.model, 'm2');
  assert.equal(after.temperature, 0.7);
});

test('DPAPI failure falls back to plaintext with an explicit status', async (t) => {
  const dataDir = tempDir('sec-d');
  const worktreesRoot = tempDir('sec-d-wt');
  seedManager(dataDir, { provider: 'openai', baseUrl: 'https://api.example.test/v1', model: 'm1', apiKey: 'sk-fallback' });
  const service = makeService(dataDir, worktreesRoot, makeBox({ failEncrypt: true }));
  t.after(async () => { await service.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(worktreesRoot, { recursive: true, force: true }); });

  assert.equal(service.db.getSetting('manager', null).apiKey, 'sk-fallback');
  assert.equal(service.statusSnapshot().secrets.mode, 'plaintext');
  assert.equal(service.statusSnapshot().secrets.available, false);
  assert.equal(service.getManagerSettings().apiKeySet, true);
});

test('unreadable ciphertext does not crash startup and reports unreadable', async (t) => {
  const dataDir = tempDir('sec-e');
  const worktreesRoot = tempDir('sec-e-wt');
  seedManager(dataDir, { provider: 'openai', baseUrl: 'https://api.example.test/v1', model: 'm1', apiKey: 'dpapi:v1:AAAA' });
  const service = makeService(dataDir, worktreesRoot, makeBox({ failDecrypt: true }));
  t.after(async () => { await service.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(worktreesRoot, { recursive: true, force: true }); });

  assert.equal(service.statusSnapshot().secrets.mode, 'unreadable');
  assert.equal(service.statusSnapshot().secrets.error, 'DPAPI_UNREADABLE');
  assert.equal(service.getManagerSettings().apiKeySet, false);
  assert.equal(service.db.getSetting('manager', null).apiKey, 'dpapi:v1:AAAA');
});

test('clearing the manager key returns the secret state to none', async (t) => {
  const dataDir = tempDir('sec-f');
  const worktreesRoot = tempDir('sec-f-wt');
  const service = makeService(dataDir, worktreesRoot, makeBox());
  t.after(async () => { await service.shutdown(); fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(worktreesRoot, { recursive: true, force: true }); });

  service.updateManagerSettings({ provider: 'openai', baseUrl: 'https://api.example.test/v1', model: 'm1', apiKey: 'sk-live' });
  assert.equal(service.statusSnapshot().secrets.mode, 'dpapi');
  service.updateManagerSettings({ clearApiKey: true });
  assert.equal(service.db.getSetting('manager', null).apiKey, '');
  assert.equal(service.getManagerSettings().apiKeySet, false);
  assert.equal(service.statusSnapshot().secrets.mode, 'none');
});
