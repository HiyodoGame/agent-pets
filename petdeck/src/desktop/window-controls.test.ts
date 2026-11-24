import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  closeMainWindow, isMainWindowMaximized, minimizeMainWindow,
  onMainWindowResized, toggleMainWindowMaximize, windowControlsSupported,
} from './window-controls.ts'

test('window controls: all helpers are inert without Tauri', async () => {
  assert.equal(windowControlsSupported(), false)
  await minimizeMainWindow()
  await toggleMainWindowMaximize()
  await closeMainWindow()
  assert.equal(await isMainWindowMaximized(), false)
  const unlisten = await onMainWindowResized(() => {})
  assert.equal(typeof unlisten, 'function')
  unlisten()
})
