import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function desktopConfig() {
  return JSON.parse(readFileSync(`${root}/src-tauri/tauri.conf.json`, 'utf8'));
}

test('desktop: pet is a transparent always-on-top frameless window and main starts hidden', () => {
  const config = desktopConfig();
  const pet = config.app.windows.find((w) => w.label === 'pet');
  const main = config.app.windows.find((w) => w.label === 'main');
  assert.ok(pet);
  assert.equal(pet.url, '/pet.html');
  assert.equal(pet.transparent, true);
  assert.equal(pet.decorations, false);
  assert.equal(pet.alwaysOnTop, true);
  assert.equal(pet.skipTaskbar, true);
  assert.equal(pet.resizable, false);
  assert.equal(pet.width, 280);
  assert.equal(pet.height, 220);
  assert.ok(main);
  assert.equal(main.url, '/index.html');
  assert.equal(main.visible, false);
});

test('desktop: Tauri and its Vite dev server use one strict port', () => {
  const config = desktopConfig();
  assert.equal(config.build.devUrl, 'http://localhost:5183');
  assert.match(config.build.beforeDevCommand, /--port 5183/);
  assert.match(config.build.beforeDevCommand, /--strictPort/);
});

test('desktop: bridge resources preserve the server directory tree', () => {
  const config = desktopConfig();
  assert.equal(config.bundle.resources['../server/'], 'server/');
});

test('desktop: Vite builds both the pet and main HTML entries', async () => {
  const { default: config } = await import('../vite.config.js');
  const input = config.build?.rollupOptions?.input;
  assert.ok(input);
  assert.match(input.main, /index\.html$/);
  assert.match(input.pet, /pet\.html$/);
  assert.notEqual(input.main, input.pet);
});
