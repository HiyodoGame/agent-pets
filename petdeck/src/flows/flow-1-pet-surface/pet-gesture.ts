export interface PetGesture {
  x: number
  y: number
  dragging: boolean
}

export function beginPetGesture(input: { button: number; x: number; y: number }): PetGesture | null {
  return input.button === 0 ? { x: input.x, y: input.y, dragging: false } : null
}

export function movePetGesture(gesture: PetGesture, point: { x: number; y: number }): PetGesture & { started: boolean } {
  if (gesture.dragging) return { ...gesture, started: false }
  const dragging = Math.hypot(point.x - gesture.x, point.y - gesture.y) >= 5
  return { ...gesture, dragging, started: dragging }
}

export async function beginNativePetDrag(actions: {
  showDrag: () => void
  startDragging: () => Promise<void>
}): Promise<void> {
  actions.showDrag()
  await actions.startDragging()
}

export function confirmPetDrag(gesture: PetGesture): PetGesture {
  return { ...gesture, dragging: true }
}

export function endPetGesture(gesture: PetGesture | null): 'poke' | 'drag' | 'cancel' {
  if (!gesture) return 'cancel'
  return gesture.dragging ? 'drag' : 'poke'
}
