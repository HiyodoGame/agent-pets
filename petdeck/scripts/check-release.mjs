import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Validate a release manifest (`latest.json`) before announcing it: structure,
// signature presence, and that the advertised version matches this checkout.
//
//   npm run release:check                     # remote endpoint from tauri.conf.json
//   npm run release:check -- --expect 0.2.0   # require a specific version
//   npm run release:check -- --file latest.json
//   npm run release:check -- --allow-any-version   # structure only (pre-release smoke)
//
// Exit code 0 = manifest is shippable, 1 = something a user would hit is wrong.

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);

function argValue(name) {
  const hit = args.find((value) => value === name || value.startsWith(name + '='));
  if (!hit) return null;
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const index = args.indexOf(hit);
  return args[index + 1] ?? '';
}
const hasFlag = (name) => args.includes(name);

const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const tauriConfig = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const endpoint = tauriConfig?.plugins?.updater?.endpoints?.[0];
const file = argValue('--file');
const url = argValue('--url') || process.env.PETDECK_UPDATE_URL || endpoint;
const expect = argValue('--expect') || packageVersion;
const allowAnyVersion = hasFlag('--allow-any-version');

const errors = [];
const notes = [];

function fail(message) {
  errors.push(message);
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

async function readManifest() {
  if (file) {
    return JSON.parse(readFileSync(file, 'utf8'));
  }
  if (!url) {
    throw new Error('no updater endpoint in tauri.conf.json (pass --url or --file)');
  }
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'petdeck-release-check' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return await response.json();
}

function validate(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    fail('manifest is not an object');
    return;
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+([-+].+)?$/.test(manifest.version)) {
    fail(`manifest.version is not semver: ${String(manifest.version)}`);
  }
  if (manifest.pub_date != null && typeof manifest.pub_date !== 'string') {
    fail('manifest.pub_date must be a string when present');
  }
  if (typeof manifest.notes === 'string' && manifest.notes.length > 80_000) {
    fail('manifest.notes is too long (> 80000 chars); the updater dialog would be unreadable');
  }
  const platforms = manifest.platforms;
  if (!platforms || typeof platforms !== 'object' || Object.keys(platforms).length === 0) {
    fail('manifest.platforms is missing or empty');
    return;
  }
  const windows = platforms['windows-x86_64'];
  if (!windows) {
    fail('manifest.platforms["windows-x86_64"] is missing (PetDeck ships NSIS only)');
  } else {
    if (typeof windows.url !== 'string' || !isHttpUrl(windows.url)) {
      fail('windows-x86_64.url is not an http(s) URL');
    }
    if (typeof windows.signature !== 'string' || windows.signature.trim().length < 64) {
      fail('windows-x86_64.signature is missing or implausibly short');
    }
  }
  if (!allowAnyVersion && typeof manifest.version === 'string' && manifest.version !== expect) {
    fail(`manifest.version ${manifest.version} does not match expected ${expect}`);
  }
}

try {
  const manifest = await readManifest();
  validate(manifest);
  if (errors.length === 0) {
    notes.push(`version ${manifest.version} (expected ${allowAnyVersion ? 'any' : expect})`);
    const platforms = Object.keys(manifest.platforms ?? {});
    notes.push(`platforms: ${platforms.join(', ') || 'none'}`);
    if (manifest.pub_date) notes.push(`published ${manifest.pub_date}`);
    notes.push(file ? `source: ${file}` : `source: ${url}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (errors.length > 0) {
  console.error('release:check failed');
  for (const message of errors) console.error(`  - ${message}`);
  process.exitCode = 1;
} else {
  console.log('release:check ok');
  for (const note of notes) console.log(`  ${note}`);
}
