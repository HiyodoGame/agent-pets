// RED tests: inject catch-log must only carry allowlisted structured error metadata.
// Adapter-thrown e.name/e.code are free text (they can echo the prompt payload),
// so the log line must never contain them verbatim unless they match a strict allowlist.
// Run: node --test server/bridge-inject-log.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './bridge.mjs';

const SECRET = 'PROMPT-ECHO-SECRET-7f3a';

function captureLogger() {
  const errors = [];
  return { errors, logger: { error: (msg) => errors.push(String(msg)) } };
}

async function injectWith(adapters, logger) {
  const app = createApp({ adapters, security: {}, logger });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const port = app.address().port;
  try {
    return await fetch(`http://127.0.0.1:${port}/api/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'codex', context: 'c', instruction: 'i' }),
    });
  } finally {
    app.closeAllConnections?.();
    app.close();
  }
}

test('inject catch-log: free-text name/code echoing the prompt never reaches the log', async () => {
  const { errors, logger } = captureLogger();
  const evil = new Error('boom');
  evil.name = `TypeError: ${SECRET}`;
  evil.code = SECRET;
  const adapters = [{ id: 'codex', name: 'Codex', tier: 'full', observe: () => [], inject: () => Promise.reject(evil) }];
  const res = await injectWith(adapters, logger);
  assert.equal(res.status, 500);
  assert.equal(errors.length, 1);
  assert.ok(!errors[0].includes(SECRET), 'log must never echo adapter-thrown free text');
  assert.ok(errors[0].includes('error=unknown'), 'non-allowlisted name must collapse to the unknown constant');
  assert.ok(errors[0].includes('code=unknown'), 'non-allowlisted code must collapse to the unknown constant');
});

test('inject catch-log: allowlisted structured name/code are logged as-is', async () => {
  const { errors, logger } = captureLogger();
  const err = new Error('boom');
  err.code = 'ETIMEDOUT';
  const adapters = [{ id: 'codex', name: 'Codex', tier: 'full', observe: () => [], inject: () => Promise.reject(err) }];
  const res = await injectWith(adapters, logger);
  assert.equal(res.status, 500);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('error=Error'), 'allowlisted name logged');
  assert.ok(errors[0].includes('code=ETIMEDOUT'), 'allowlisted code logged');
});

test('inject catch-log: missing name/code collapse to the unknown constant, no undefined leakage', async () => {
  const { errors, logger } = captureLogger();
  const adapters = [{ id: 'codex', name: 'Codex', tier: 'full', observe: () => [], inject: () => Promise.reject({}) }];
  await injectWith(adapters, logger);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('error=unknown'));
  assert.ok(errors[0].includes('code=unknown'));
  assert.ok(!errors[0].includes('undefined'));
});
