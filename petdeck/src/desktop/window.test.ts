import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTauri, listenForPanelNavigation, openMainPanel, persistPetPositionOnMove, resizePetWindow, savePetPosition, startPetDragging } from './window.ts'

test('desktop window: browser/test environments safely no-op without Tauri', async () => {
  assert.equal(isTauri(), false)
  await startPetDragging()
  await resizePetWindow(false, false)
  await savePetPosition()
  const stopPersisting = await persistPetPositionOnMove()
  stopPersisting()
  await openMainPanel({ projectId: 'p1', sessionId: 's1' })
  const unlisten = await listenForPanelNavigation(() => {})
  assert.equal(typeof unlisten, 'function')
  unlisten()
})
