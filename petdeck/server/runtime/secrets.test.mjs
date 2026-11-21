import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSecretBox, isDpapiValue, SecretError, DPAPI_PREFIX } from './secrets.mjs';

function fakeProvider() {
  return (script, input) => {
    const raw = Buffer.from(String(input).trim(), 'base64').toString('utf8');
    if (!script.includes('Unprotect')) {
      return { status: 0, stdout: Buffer.from('sealed:' + raw, 'utf8').toString('base64') };
    }
    return { status: 0, stdout: Buffer.from(raw.replace(/^sealed:/, ''), 'utf8').toString('base64') };
  };
}

test('dpapi: round-trips a unicode secret and never exposes plaintext in ciphertext', () => {
  const box = createSecretBox({ platform: 'win32', run: fakeProvider() });
  const cipher = box.encrypt('sk-live-秘密');
  assert.equal(cipher.startsWith(DPAPI_PREFIX), true);
  assert.equal(isDpapiValue(cipher), true);
  assert.equal(cipher.includes('sk-live'), false);
  assert.equal(box.decrypt(cipher), 'sk-live-秘密');
  assert.equal(box.decrypt('plain-value'), 'plain-value');
  assert.equal(box.available(), true);
});

test('dpapi: empty values stay empty and malformed ciphertext is rejected', () => {
  const box = createSecretBox({ platform: 'win32', run: fakeProvider() });
  assert.equal(box.encrypt(''), '');
  assert.equal(box.decrypt(''), '');
  assert.throws(() => box.decrypt(DPAPI_PREFIX), (error) => error instanceof SecretError && error.code === 'DPAPI_DECRYPT_FAILED');
});

test('dpapi: provider failure is explicit, keeps secrets out of the message and marks unavailable', () => {
  const box = createSecretBox({
    platform: 'win32',
    run: () => ({ status: 1, stdout: '', stderr: 'sk-live-should-not-leak' }),
  });
  assert.throws(() => box.encrypt('sk-live-should-not-leak'), (error) => {
    assert.equal(error instanceof SecretError, true);
    assert.equal(error.code, 'DPAPI_ENCRYPT_FAILED');
    assert.equal(error.message.includes('sk-live'), false);
    return true;
  });
  assert.equal(box.available(), false);
  assert.equal(box.lastError(), 'DPAPI_ENCRYPT_FAILED');
});

test('dpapi: non-windows platforms report unavailable instead of plaintext fallback', () => {
  const box = createSecretBox({ platform: 'linux' });
  assert.equal(box.available(), false);
  assert.throws(() => box.encrypt('sk-secret'), (error) => error.code === 'NOT_WINDOWS');
});
