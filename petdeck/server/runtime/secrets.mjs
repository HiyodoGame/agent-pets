// Windows DPAPI at rest for secrets that must be readable by the bridge process.
//
// The production bridge runs on the bundled Node runtime and cannot load native
// FFI modules (node_modules is not shipped with the desktop app). Instead of
// adding koffi, we call the inbox Windows PowerShell once per operation and pass
// the value over stdin, never over the command line. The cached plaintext key is
// kept in this process only; the database stores base64 DPAPI ciphertext.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export const DPAPI_PREFIX = 'dpapi:v1:';

const ENCRYPT_SCRIPT = [
  'Add-Type -AssemblyName System.Security',
  '$b64 = [Console]::In.ReadToEnd().Trim()',
  '$bytes = [Convert]::FromBase64String($b64)',
  '$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Convert]::ToBase64String($enc)',
].join('; ');

const DECRYPT_SCRIPT = [
  'Add-Type -AssemblyName System.Security',
  '$b64 = [Console]::In.ReadToEnd().Trim()',
  '$bytes = [Convert]::FromBase64String($b64)',
  '$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Convert]::ToBase64String($dec)',
].join('; ');

export class SecretError extends Error {
  constructor(code, message = 'secret storage operation failed') {
    super(message);
    this.name = 'SecretError';
    this.code = code;
  }
}

export function isDpapiValue(value) {
  return typeof value === 'string' && value.startsWith(DPAPI_PREFIX);
}

function powershellPath(env = process.env) {
  const root = env.SystemRoot || env.windir;
  return root ? path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
}

export function runDpapiPowerShell(script, input, { timeoutMs = 8000, env = process.env } = {}) {
  return spawnSync(powershellPath(env), [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script,
  ], {
    input: String(input ?? '') + '\n',
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

/**
 * Create a DPAPI-backed secret box. The provider is injectable for tests and for
 * a future non-Windows fallback; on non-Windows platforms it reports unavailable
 * instead of pretending to encrypt.
 */
export function createSecretBox({
  platform = process.platform,
  run = runDpapiPowerShell,
  timeoutMs = 8000,
} = {}) {
  let available = platform === 'win32' ? null : false;
  let lastCode = platform === 'win32' ? null : 'NOT_WINDOWS';

  function invoke(script, payload, code) {
    if (platform !== 'win32') {
      lastCode = 'NOT_WINDOWS';
      available = false;
      throw new SecretError('NOT_WINDOWS', 'Windows DPAPI is not available on this platform');
    }
    let result;
    try { result = run(script, payload, { timeoutMs }); }
    catch {
      lastCode = code;
      available = false;
      throw new SecretError(code, 'Windows DPAPI is unavailable');
    }
    if (!result || result.status !== 0) {
      lastCode = code;
      available = false;
      throw new SecretError(code, 'Windows DPAPI is unavailable');
    }
    const output = String(result.stdout ?? '').trim();
    if (!/^[A-Za-z0-9+/=]*$/.test(output)) {
      lastCode = code;
      available = false;
      throw new SecretError(code, 'Windows DPAPI returned an unreadable value');
    }
    available = true;
    lastCode = null;
    return output;
  }

  return {
    isEncrypted: isDpapiValue,
    available() { return available; },
    lastError() { return lastCode; },
    encrypt(plain) {
      const value = String(plain ?? '');
      if (!value) return '';
      const payload = Buffer.from(value, 'utf8').toString('base64');
      return DPAPI_PREFIX + invoke(ENCRYPT_SCRIPT, payload, 'DPAPI_ENCRYPT_FAILED');
    },
    decrypt(value) {
      if (!isDpapiValue(value)) return String(value ?? '');
      const payload = value.slice(DPAPI_PREFIX.length);
      if (!payload) throw new SecretError('DPAPI_DECRYPT_FAILED', 'Windows DPAPI ciphertext is empty');
      const output = invoke(DECRYPT_SCRIPT, payload, 'DPAPI_DECRYPT_FAILED');
      try { return Buffer.from(output, 'base64').toString('utf8'); }
      catch { throw new SecretError('DPAPI_DECRYPT_FAILED', 'Windows DPAPI returned an unreadable value'); }
    },
  };
}
