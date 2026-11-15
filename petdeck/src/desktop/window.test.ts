import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hidePet, isTauri, listenForDndChange, listenForPanelNavigation, movePetBy, openMainPanel, persistPetPositionOnMove, quitPetDeck, resizePetWindow, savePetPosition, setDesktopDnd, setPetAlwaysOnTop, startPetDragging, updatePetWindowLayout } from './window.ts'

test('desktop window: browser/test environments safely no-op without Tauri', async () => {
  assert.equal(isTauri(), false)
  await startPetDragging()
  await resizePetWindow(false, false)
  await updatePetWindowLayout('compact', 1)
  await setPetAlwaysOnTop(false)
  await movePetBy('left')
  await savePetPosition()
  const stopPersisting = await persistPetPositionOnMove()
  stopPersisting()
  await quitPetDeck()
  await hidePet()
  await openMainPanel({ projectId: 'p1', sessionId: 's1' })
  const unlisten = await listenForPanelNavigation(() => {})
  assert.equal(typeof unlisten, 'function')
  unlisten()
  const stopDnd = await listenForDndChange(() => {})
  stopDnd()
  await setDesktopDnd(true)
})
