import type { PetDirection } from '../flows/shared/pet/skin-types'

export type PetWindowMode = 'compact' | 'quick' | 'event' | 'menu' | 'settings'
export type PetPanelPlacement = 'left' | 'right'
export interface PetPoint { x: number; y: number }
export interface PetSize { width: number; height: number }
export interface PetWorkArea extends PetPoint, PetSize {}
export interface PetLayout extends PetPoint, PetSize {
  placement: PetPanelPlacement | null
}

const COMPACT_SIZE = 180
const PANEL_GAP = 12
const PANEL_SIZE: Record<Exclude<PetWindowMode, 'compact'>, PetSize> = {
  quick: { width: 340, height: 340 },
  event: { width: 380, height: 300 },
  menu: { width: 224, height: 280 },
  settings: { width: 360, height: 560 },
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, Math.max(min, max)))
}

export function computePetLayout(input: {
  mode: PetWindowMode
  scale: number
  previousScale: number
  previousPlacement?: PetPanelPlacement
  pixelRatio?: number
  position: PetPoint
  currentSize: PetSize
  workArea: PetWorkArea
}): PetLayout {
  const ratio = input.pixelRatio ?? 1
  const previousPetSize = COMPACT_SIZE * input.previousScale * ratio
  const petSize = COMPACT_SIZE * input.scale * ratio
  let currentPetX = input.position.x
  let currentPetY = input.position.y
  if (input.previousPlacement) {
    currentPetX = input.previousPlacement === 'left'
      ? input.position.x + input.currentSize.width - previousPetSize
      : input.position.x
    currentPetY = input.position.y + (input.currentSize.height - previousPetSize) / 2
  }

  const centerX = currentPetX + previousPetSize / 2
  const centerY = currentPetY + previousPetSize / 2
  const workRight = input.workArea.x + input.workArea.width
  const workBottom = input.workArea.y + input.workArea.height

  if (input.mode === 'compact') {
    return {
      width: Math.round(petSize),
      height: Math.round(petSize),
      x: Math.round(clamp(centerX - petSize / 2, input.workArea.x, workRight - petSize)),
      y: Math.round(clamp(centerY - petSize / 2, input.workArea.y, workBottom - petSize)),
      placement: null,
    }
  }

  const panel = PANEL_SIZE[input.mode]
  const panelWidth = panel.width * ratio
  const panelHeight = panel.height * ratio
  const gap = PANEL_GAP * ratio
  const width = petSize + gap + panelWidth
  const height = Math.max(petSize, panelHeight)
  const petX = clamp(centerX - petSize / 2, input.workArea.x, workRight - petSize)
  const petY = clamp(centerY - petSize / 2, input.workArea.y, workBottom - petSize)
  const rightSpace = workRight - (petX + petSize)
  const leftSpace = petX - input.workArea.x
  const placement: PetPanelPlacement = rightSpace >= panelWidth + gap
    ? 'right'
    : leftSpace >= panelWidth + gap || leftSpace > rightSpace ? 'left' : 'right'
  const desiredX = placement === 'right' ? petX : petX - panelWidth - gap
  const desiredY = petY + petSize / 2 - height / 2

  return {
    width: Math.round(width),
    height: Math.round(height),
    x: Math.round(clamp(desiredX, input.workArea.x, workRight - width)),
    y: Math.round(clamp(desiredY, input.workArea.y, workBottom - height)),
    placement,
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
