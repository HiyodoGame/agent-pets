// M5 W1 — diagnostics: probe cache, redaction, and the dependency-free ZIP writer.
// Run: node --test server/diagnostics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import {
  buildZip, collectDiagnostics, createAgentProbe, crc32, maskSecret, redactObject,
} from './diagnostics.mjs';

function readZip(buf) {
  // Minimal reader for our own writer: walk the central directory.
  const eocd = buf.length - 22;
  assert.equal(buf.readUInt32LE(eocd), 0x06054b50, 'EOCD signature');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(offset), 0x02014b50, 'central header signature');
    const method = buf.readUInt16LE(offset + 10);
    const csize = buf.readUInt32LE(offset + 20);
    const usize = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const body = buf.subarray(dataStart, dataStart + csize);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, usize, 'uncompressed size for ' + name);
    entries.push({ name, data, method });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

test('crc32 matches the standard check vector', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('buildZip round-trips names and content (deflate and stored)', () => {
  const big = 'x'.repeat(4096); // compressible => deflate
  const tiny = 'hi';
  const zip = buildZip([
    { name: 'summary.json', data: JSON.stringify({ ok: true }) },
    { name: 'logs/big.log', data: big },
    { name: 'tiny.txt', data: tiny },
  ], { now: new Date('2026-11-21T08:00:00Z') });
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'local header signature');
  const entries = readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ['summary.json', 'logs/big.log', 'tiny.txt']);
  assert.equal(entries[0].data.toString('utf8'), JSON.stringify({ ok: true }));
  assert.equal(entries[1].data.toString('utf8'), big);
  assert.equal(entries[1].method, 8, 'large text is deflated');
  assert.equal(entries[2].data.toString('utf8'), tiny);
});

test('maskSecret keeps a 4-char fingerprint and never returns the full value', () => {
  assert.equal(maskSecret('sk-abcdef1234'), '***1234');
  assert.equal(maskSecret('abcd'), '***');
  assert.equal(maskSecret(''), '');
});

test('redactObject masks credential-looking keys at any depth', () => {
  const out = redactObject({
    safe: 'keep',
    apiKey: 'sk-abcdef1234',
    nested: { token: 'bridge-token-9999', password: 'hunter2' },
    list: [{ authorization: 'Bearer xyz-9876' }],
  });
  assert.equal(out.safe, 'keep');
  assert.equal(out.apiKey, '***1234');
  assert.equal(out.nested.token, '***9999');
  assert.equal(out.nested.password, '***ter2');
  assert.equal(out.list[0].authorization, '***9876');
  assert.equal(JSON.stringify(out).includes('sk-abcdef1234'), false);
});

test('redaction masks credentials but preserves status metadata', () => {
  const out = redactObject({
    apiKey: 'sk-abcdef1234',
    apiKeySet: true,
    apiKeySource: 'settings',
    secrets: { mode: 'dpapi', available: true, provider: 'windows-dpapi' },
    nested: { accessToken: 'bridge-token-9999', refresh_token: 'refresh-1234' },
  });
  assert.equal(out.apiKey, '***1234');
  assert.equal(out.apiKeySet, true, 'boolean status must stay a boolean');
  assert.equal(out.apiKeySource, 'settings', 'source is metadata, not the key');
  assert.deepEqual(out.secrets, { mode: 'dpapi', available: true, provider: 'windows-dpapi' });
  assert.equal(out.nested.accessToken, '***9999');
  assert.equal(out.nested.refresh_token, '***1234');
});

test('redaction replaces a credential object instead of stringifying it', () => {
  const out = redactObject({ secret: { nested: 'value' }, token: 'abcd' });
  assert.equal(out.secret, '[redacted]');
  assert.equal(out.token, '***');
});

test('probe cache: deep probes once per TTL, non-deep never spawns', async () => {
  let calls = 0;
  const probe = createAgentProbe({
    now: () => 1000,
    probe: async (command) => { calls += 1; return { command, detected: true, version: '9.9.9' }; },
  });
  const entries = [{ id: 'opencode', name: 'opencode', command: 'opencode' }];
  const cold = await probe.list(entries, { deep: false });
  assert.equal(calls, 0, 'non-deep must not spawn');
  assert.equal(cold[0].detected, null);
  const deep = await probe.list(entries, { deep: true });
  assert.equal(calls, 1);
  assert.equal(deep[0].version, '9.9.9');
  await probe.list(entries, { deep: true });
  assert.equal(calls, 1, 'second deep call inside the TTL uses the cache');
  const warm = await probe.list(entries, { deep: false });
  assert.equal(warm[0].detected, true);
});

test('collectDiagnostics writes whitelisted settings and recent logs, no secrets', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-diag-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs);
  fs.writeFileSync(path.join(logs, 'petdeck-2026-11-21.log'), 'level=info msg=started task=abc\n');
  fs.writeFileSync(path.join(logs, 'old.log'), 'stale');
  const old = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  fs.utimesSync(path.join(logs, 'old.log'), old, old);
  const runtime = {
    statusSnapshot: () => ({ dataDir: dir, dbVersion: 4, counts: { running: 0 }, startedAt: '2026-11-21T00:00:00.000Z', secrets: { mode: 'dpapi', available: true } }),
    getSettings: () => ({ maxConcurrent: 2, decisionTimeoutMinutes: 10, decisionSound: true, promptText: 'SECRET PROMPT' }),
    getManagerSettings: () => ({ provider: 'openai', baseUrl: 'https://x', model: 'm', apiKeySet: true, apiKeySource: 'settings', apiKey: 'sk-live-should-never-appear' }),
  };
  const pkg = await collectDiagnostics({
    version: '0.2.0', port: 5199, authRequired: true, runtime,
    agents: [{ id: 'opencode', command: 'opencode', detected: true, version: '2.0.30' }],
    now: Date.now(),
  });
  t.after(() => fs.rmSync(path.dirname(pkg.path), { recursive: true, force: true }));
  assert.equal(fs.existsSync(pkg.path), true);
  assert.ok(pkg.files.includes('summary.json'));
  assert.ok(pkg.files.includes('logs/petdeck-2026-11-21.log'), 'recent log included');
  assert.equal(pkg.files.includes('logs/old.log'), false, 'log older than 7 days dropped');
  const entries = readZip(fs.readFileSync(pkg.path));
  const byName = Object.fromEntries(entries.map((e) => [e.name, e.data.toString('utf8')]));
  assert.equal('promptText' in JSON.parse(byName['settings.json']).runtime, false, 'unlisted setting dropped');
  assert.equal(JSON.parse(byName['settings.json']).manager.apiKey, undefined, 'manager key dropped');
  assert.equal(JSON.parse(byName['settings.json']).manager.apiKeySet, true, 'apiKeySet stays a boolean');
  assert.equal(JSON.parse(byName['settings.json']).manager.apiKeySource, 'settings');
  assert.deepEqual(JSON.parse(byName['summary.json']).runtime.secrets, { mode: 'dpapi', available: true });
  const whole = Buffer.concat(entries.map((e) => e.data)).toString('utf8');
  assert.equal(whole.includes('sk-live-should-never-appear'), false);
  assert.equal(whole.includes('SECRET PROMPT'), false);
});
