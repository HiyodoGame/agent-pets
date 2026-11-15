import { test } from 'node:test'
import assert from 'node:assert/strict'
import { beginNativePetDrag, beginPetGesture, confirmPetDrag, endPetGesture, movePetGesture } from './pet-gesture.ts'

test('pet gesture: a left click below 5px is a poke', () => {
  const start = beginPetGesture({ button: 0, x: 100, y: 100 })
  assert.ok(start)
  const moved = movePetGesture(start, { x: 103, y: 103 })
  assert.equal(moved.dragging, false)
  assert.equal(endPetGesture(moved), 'poke')
})

test('pet gesture: reaching 5px starts exactly one drag and release is not a poke', () => {
  const start = beginPetGesture({ button: 0, x: 100, y: 100 })!
  const below = movePetGesture(start, { x: 103, y: 103 })
  assert.equal(below.started, false)
  const dragging = movePetGesture(below, { x: 105, y: 100 })
  assert.equal(dragging.dragging, true)
  assert.equal(dragging.started, true)
  const continued = movePetGesture(dragging, { x: 120, y: 100 })
  assert.equal(continued.started, false)
  assert.equal(endPetGesture(continued), 'drag')
})

test('pet gesture: a real window move confirms drag even without web pointermove', () => {
  const gesture = beginPetGesture({ button: 0, x: 10, y: 10 })!
  const confirmed = confirmPetDrag(gesture)
  assert.equal(confirmed.dragging, true)
  assert.equal(endPetGesture(confirmed), 'drag')
})

test('pet gesture: native drag starts after the threshold without capturing the pointer', async () => {
  const order: string[] = []
  await beginNativePetDrag({
    showDrag: () => { order.push('pose') },
    startDragging: async () => { order.push('native') },
  })
  assert.deepEqual(order, ['pose', 'native'])
})

test('pet gesture: right click and non-primary pointers never poke or drag', () => {
  assert.equal(beginPetGesture({ button: 2, x: 100, y: 100 }), null)
  assert.equal(endPetGesture(null), 'cancel')
})
