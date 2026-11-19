import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePetLayout, computeRoamPosition, type PetWindowMode } from './pet-layout.ts'

const workArea = { x: 0, y: 0, width: 1920, height: 1080 }
const compactSize = { width: 180, height: 180 }

function layout(mode: PetWindowMode, position = { x: 1000, y: 600 }, size = compactSize, previousPlacement?: 'left' | 'right') {
  return computePetLayout({ mode, scale: 1, previousScale: 1, previousPlacement, position, currentSize: size, workArea })
}

test('pet layout: compact mode stays at its current position', () => {
  assert.deepEqual(layout('compact'), { width: 180, height: 180, x: 1000, y: 600, placement: null })
})

test('pet layout: expanding and collapsing preserve the pet anchor without overlap', () => {
  const expanded = layout('quick')
  assert.deepEqual(expanded, { width: 532, height: 340, x: 1000, y: 520, placement: 'right' })
  assert.deepEqual(layout('compact', { x: expanded.x, y: expanded.y }, expanded, expanded.placement ?? undefined), {
    width: 180, height: 180, x: 1000, y: 600, placement: null,
  })
})

test('pet layout: right and bottom edges flip beside the pet inside the work area', () => {
  const result = layout('quick', { x: 1800, y: 900 })
  assert.equal(result.x + result.width, 1920)
  assert.equal(result.y + result.height, 1080)
  assert.equal(result.placement, 'left')
  assert.deepEqual({ x: result.x, y: result.y }, { x: 1388, y: 740 })
})

test('pet layout: negative monitor coordinates are supported', () => {
  const result = computePetLayout({
    mode: 'event', scale: 1, previousScale: 1,
    position: { x: -200, y: 400 }, currentSize: compactSize,
    workArea: { x: -1280, y: 0, width: 1280, height: 1024 },
  })
  assert.equal(result.width, 572)
  assert.equal(result.x, -592)
  assert.equal(result.y, 340)
  assert.equal(result.placement, 'left')
})

test('pet layout: settings reserve space beside the pet', () => {
  const settings = layout('settings')
  assert.deepEqual(settings, { width: 552, height: 560, x: 1000, y: 410, placement: 'right' })
})

test('pet layout: compact scaling preserves the pet center', () => {
  const scaled = computePetLayout({
    mode: 'compact', scale: 1.25, previousScale: 1,
    position: { x: 1000, y: 600 }, currentSize: compactSize, workArea,
  })
  assert.deepEqual(scaled, { width: 225, height: 225, x: 978, y: 578, placement: null })
})

test('pet layout: settings scaling and collapse retain the expanded pet anchor', () => {
  const settings = layout('settings')
  const compact = layout('compact', settings, settings, settings.placement ?? undefined)
  assert.deepEqual(compact, { width: 180, height: 180, x: 1000, y: 600, placement: null })
})

test('pet layout: every supported scale meets the horizontal panel CSS breakpoint', () => {
  for (const scale of [0.75, 1, 1.25]) {
    for (const mode of ['quick', 'event', 'menu', 'settings'] as const) {
      const result = computePetLayout({ mode, scale, previousScale: scale, position: { x: 1000, y: 600 }, currentSize: compactSize, workArea })
      assert.ok(result.width >= 352, `${mode} at ${scale} must use the horizontal layout`)
    }
  }
})

test('pet layout: roaming moves one short step and stops at the edge', () => {
  assert.deepEqual(computeRoamPosition({ position: { x: 1000, y: 600 }, size: compactSize, direction: 'left', workArea }), { x: 952, y: 600 })
  assert.deepEqual(computeRoamPosition({ position: { x: 1740, y: 600 }, size: compactSize, direction: 'right', workArea }), { x: 1740, y: 600 })
  assert.deepEqual(computeRoamPosition({ position: { x: 0, y: 600 }, size: compactSize, direction: 'left', workArea }), { x: 0, y: 600 })
})
