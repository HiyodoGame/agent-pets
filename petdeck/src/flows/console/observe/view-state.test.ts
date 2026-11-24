import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  LEGACY_PANEL_VIEW_KEY, OBSERVED_VIEW_KEY,
  emptyObservedViewState, isObservedArchived, loadObservedViewState,
  migrateLegacyPanelView, renameObserved, saveObservedViewState,
  setObservedArchived, titleForObserved,
} from './view-state.ts'

function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    dump: () => Object.fromEntries(map),
  }
}

test('observed view: rename and archive are local overlays keyed by agent:session', () => {
  let state = emptyObservedViewState()
  state = renameObserved(state, 'cursor', 's1', '  改过的标题  ')
  assert.equal(titleForObserved(state, 'cursor', 's1'), '改过的标题')
  assert.equal(titleForObserved(state, 'cursor', 's2'), null)
  state = setObservedArchived(state, 'cursor', 's1', true)
  assert.equal(isObservedArchived(state, 'cursor', 's1'), true)
  assert.equal(isObservedArchived(state, 'cursor', 's2'), false)
  state = setObservedArchived(state, 'cursor', 's1', false)
  assert.equal(isObservedArchived(state, 'cursor', 's1'), false)
  state = renameObserved(state, 'cursor', 's1', '   ')
  assert.equal(titleForObserved(state, 'cursor', 's1'), null, 'an empty rename clears the title')
})

test('observed view: migration keeps legacy titles, archived overlays and locally hidden sessions', () => {
  const migrated = migrateLegacyPanelView({
    overlays: {
      s1: { title: '旧标题', status: 'archived' },
      s2: { title: '仅改名' },
      s3: { status: 'something-else' },
    },
    deleted: ['s4', 's4', 42],
  })
  assert.equal(migrated.titles.s1, '旧标题')
  assert.equal(migrated.titles.s2, '仅改名')
  assert.deepEqual(migrated.archived.sort(), ['s1', 's4'])
})

test('observed view: loading migrates the legacy key once and writes the new key', () => {
  const storage = fakeStorage({
    [LEGACY_PANEL_VIEW_KEY]: JSON.stringify({ overlays: { s1: { title: '迁移标题', status: 'archived' } }, deleted: ['s2'] }),
  })
  const state = loadObservedViewState(storage)
  assert.equal(titleForObserved(state, 'cursor', 's1'), '迁移标题', 'bare legacy id applies to an agent-qualified row')
  assert.equal(isObservedArchived(state, 'cursor', 's1'), true)
  assert.equal(isObservedArchived(state, 'ghost', 's2'), true)
  assert.ok(storage.dump()[OBSERVED_VIEW_KEY], 'migration persists to the new key')
})

test('observed view: the new key wins over an old legacy value', () => {
  const storage = fakeStorage({
    [OBSERVED_VIEW_KEY]: JSON.stringify({ titles: { 'cursor:s1': '新键' }, archived: ['cursor:s1'] }),
    [LEGACY_PANEL_VIEW_KEY]: JSON.stringify({ overlays: { s1: { title: '旧键' } }, deleted: [] }),
  })
  const state = loadObservedViewState(storage)
  assert.equal(titleForObserved(state, 'cursor', 's1'), '新键')
  assert.equal(isObservedArchived(state, 'cursor', 's1'), true)
})

test('observed view: corrupt legacy data and missing storage degrade to empty', () => {
  assert.deepEqual(loadObservedViewState(fakeStorage({ [LEGACY_PANEL_VIEW_KEY]: '{not json' })), emptyObservedViewState())
  assert.deepEqual(loadObservedViewState(null), emptyObservedViewState())
})

test('observed view: a remote host is part of the key', () => {
  let state = renameObserved(emptyObservedViewState(), 'claude', 's1', '远端标题', 'build-box')
  assert.equal(titleForObserved(state, 'claude', 's1', 'build-box'), '远端标题')
  assert.equal(titleForObserved(state, 'claude', 's1'), null, 'the local row is not renamed')
  state = setObservedArchived(state, 'claude', 's1', true, 'build-box')
  assert.equal(isObservedArchived(state, 'claude', 's1', 'build-box'), true)
  assert.equal(isObservedArchived(state, 'claude', 's1', 'dev2'), false)
})

test('observed view: saving sanitizes and caps what is persisted', () => {
  const storage = fakeStorage()
  const titles: Record<string, string> = {}
  for (let i = 0; i < 250; i += 1) titles['cursor:s' + i] = 't' + i
  const saved = saveObservedViewState(storage, { titles, archived: ['a', 'a', 1 as unknown as string] })
  assert.equal(Object.keys(saved.titles).length, 200)
  assert.deepEqual(saved.archived, ['a'])
  assert.ok(storage.dump()[OBSERVED_VIEW_KEY])
})
