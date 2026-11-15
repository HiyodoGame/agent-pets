import type { PetDirection } from '../flows/shared/pet/skin-types'

export type PetWindowMode = 'compact' | 'quick' | 'event' | 'menu' | 'settings'
export interface PetPoint { x: number; y: number }
export interface PetSize { width: number; height: number }
export interface PetWorkArea extends PetPoint, PetSize {}

export function computePetLayout(input: {
  mode: PetWindowMode
  scale: number
  previousScale: number
  pixelRatio?: number
  position: PetPoint
  currentSize: PetSize
  workArea: PetWorkArea
}): PetPoint & PetSize {
  const base: Record<PetWindowMode, PetSize> = {
    compact: { width: 180 * input.scale, height: 180 * input.scale },
    quick: { width: 360, height: 340 },
    event: { width: 380, height: 300 },
    menu: { width: 240, height: 260 },
    settings: { width: 380, height: 520 },
  }
  const ratio = input.pixelRatio ?? 1
  const target = { width: base[input.mode].width * ratio, height: base[input.mode].height * ratio }
  const anchorX = input.position.x + input.currentSize.width / 2
  const anchorY = input.position.y + (8 + 64 * input.previousScale) * ratio
  const x = anchorX - target.width / 2
  const y = anchorY - (8 + 64 * input.scale) * ratio
  return {
    width: Math.round(target.width),
    height: Math.round(target.height),
    x: Math.round(Math.max(input.workArea.x, Math.min(x, input.workArea.x + input.workArea.width - target.width))),
    y: Math.round(Math.max(input.workArea.y, Math.min(y, input.workArea.y + input.workArea.height - target.height))),
  }
}

export function computeRoamPosition(input: {
  position: PetPoint
  size: PetSize
  direction: PetDirection
  workArea: PetWorkArea
  distance?: number
  pixelRatio?: number
}): PetPoint {
  const distance = (input.distance ?? 48) * (input.pixelRatio ?? 1)
  const desired = { x: input.position.x + (input.direction === 'right' ? distance : -distance), y: input.position.y }
  return {
    x: Math.max(input.workArea.x, Math.min(desired.x, input.workArea.x + input.workArea.width - input.size.width)),
    y: Math.max(input.workArea.y, Math.min(desired.y, input.workArea.y + input.workArea.height - input.size.height)),
  }
}
