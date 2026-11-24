import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryRedirect } from './entry-path.ts';

test('entryRedirect: production /index.html must collapse to /', () => {
  assert.equal(entryRedirect('/index.html'), '/');
});

test('entryRedirect: keeps query and hash', () => {
  assert.equal(entryRedirect('/index.html', '?a=1', '#/panel'), '/?a=1#/panel');
});

test('entryRedirect: nested dir keeps its trailing slash', () => {
  assert.equal(entryRedirect('/sub/index.html'), '/sub/');
});

test('entryRedirect: real routes are untouched', () => {
  assert.equal(entryRedirect('/'), null);
  assert.equal(entryRedirect('/today'), null);
  assert.equal(entryRedirect('/pet.html'), null);
  assert.equal(entryRedirect('/index.html.bak'), null);
});

test('entryRedirect: case-insensitive match on the file name', () => {
  assert.equal(entryRedirect('/INDEX.HTML'), '/');
});
