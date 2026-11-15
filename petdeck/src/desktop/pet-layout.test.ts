import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePetLayout, computeRoamPosition, type PetWindowMode } from './pet-layout.ts'

const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
const compactSize = { width: 180, height: 180 }

function layout(mode: PetWindowMode, position = { x: 1000, y: 600 }, size = compactSize) {
  return computePetLayout({ mode, scale: 1, previousScale: 1, position, currentSize: size, workArea })
}

test('pet layout: compact mode stays at its current position', () => {
  assert.deepEqual(layout('compact'), { width: 180, height: 180, x: 1000, y: 600 })
})

test('pet layout: expanding and collapsing preserve the pet anchor', () => {
  const expanded = layout('quick')
  assert.deepEqual(expanded, { width: 360, height: 340, x: 910, y: 600 })
  assert.deepEqual(layout('compact', { x: expanded.x, y: expanded.y }, expanded), {
    width: 180, height: 180, x: 1000, y: 600,
  })
})

test('pet layout: right and bottom edges flip expansion into the work area', () => {
  const result = layout('quick', { x: 1800, y: 900 })
  assert.equal(result.x + result.width, 1920)
  assert.equal(result.y + result.height, 1080)
  assert.equal(result.x, 1560)
  assert.equal(result.y, 740)
})

test('pet layout: negative monitor coordinates are supported', () => {
  const result = computePetLayout({
    mode: 'event', scale: 1, previousScale: 1,
    position: { x: -200, y: 400 }, currentSize: compactSize,
    workArea: { x: -1280, y: 0, width: 1280, height: 1024 },
  })
  assert.equal(result.width, 380)
  assert.equal(result.x, -380)
  assert.equal(result.y, 400)
})

test('pet layout: settings and scale remain inside the work area', () => {
  const settings = layout('settings')
  assert.deepEqual(settings, { width: 380, height: 520, x: 900, y: 560 })
  const scaled = computePetLayout({
    mode: 'compact', scale: 1.25, previousScale: 1,
    position: { x: 1000, y: 600 }, currentSize: compactSize, workArea,
  })
  assert.deepEqual(scaled, { width: 225, height: 225, x: 978, y: 584 })
})

test('pet layout: roaming moves one short step and stops at the edge', () => {
  assert.deepEqual(computeRoamPosition({ position: { x: 1000, y: 600 }, size: compactSize, direction: 'left', workArea }), { x: 952, y: 600 })
  assert.deepEqual(computeRoamPosition({ position: { x: 1740, y: 600 }, size: compactSize, direction: 'right', workArea }), { x: 1740, y: 600 })
  assert.deepEqual(computeRoamPosition({ position: { x: 0, y: 600 }, size: compactSize, direction: 'left', workArea }), { x: 0, y: 600 })
})
