import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTauri, listenForDndChange, listenForPanelNavigation, openMainPanel, persistPetPositionOnMove, quitPetDeck, resizePetWindow, savePetPosition, setDesktopDnd, startPetDragging } from './window.ts'

test('desktop window: browser/test environments safely no-op without Tauri', async () => {
  assert.equal(isTauri(), false)
  await startPetDragging()
  await resizePetWindow(false, false)
  await savePetPosition()
  const stopPersisting = await persistPetPositionOnMove()
  stopPersisting()
  await quitPetDeck()
  await openMainPanel({ projectId: 'p1', sessionId: 's1' })
  const unlisten = await listenForPanelNavigation(() => {})
  assert.equal(typeof unlisten, 'function')
  unlisten()
  const stopDnd = await listenForDndChange(() => {})
  stopDnd()
  await setDesktopDnd(true)
})
