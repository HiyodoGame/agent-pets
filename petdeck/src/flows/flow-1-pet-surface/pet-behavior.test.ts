import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canPetRoam,
  canPetSleep,
  reducePetBehavior,
  type PetBehaviorSnapshot,
} from './pet-behavior.ts'

function snapshot(current: PetBehaviorSnapshot['current'], status: PetBehaviorSnapshot['status'] = 'idle'): PetBehaviorSnapshot {
  return { current, status, pendingDecision: false }
}

test('behavior: drag preempts work and release plays drop before returning to work', () => {
  const working = snapshot('work', 'running')
  const dragging = reducePetBehavior(working, { type: 'DRAG_START' })
  assert.equal(dragging.current, 'drag')
  const dropped = reducePetBehavior(dragging, { type: 'DRAG_END' })
  assert.equal(dropped.current, 'drop')
  assert.equal(reducePetBehavior(dropped, { type: 'CLIP_FINISHED', action: 'drop' }).current, 'work')
})

test('behavior: poke plays once and returns to the unchanged real agent status', () => {
  const working = snapshot('work', 'running')
  const petted = reducePetBehavior(working, { type: 'POKE' })
  assert.equal(petted.current, 'pet')
  assert.equal(petted.status, 'running')
  const repeatedStatus = reducePetBehavior(petted, { type: 'STATUS_CHANGED', status: 'running' })
  assert.equal(repeatedStatus.current, 'pet')
  assert.equal(reducePetBehavior(repeatedStatus, { type: 'CLIP_FINISHED', action: 'pet' }).current, 'work')
})

test('behavior: a native drag that ends without movement can still become a poke', () => {
  const dragging = reducePetBehavior(snapshot('work', 'running'), { type: 'DRAG_START' })
  const petted = reducePetBehavior(dragging, { type: 'POKE' })
  assert.equal(petted.current, 'pet')
})

test('behavior: done and attention are one-shot entrances, not permanent loops', () => {
  const done = reducePetBehavior(snapshot('work', 'running'), { type: 'STATUS_CHANGED', status: 'done' })
  assert.equal(done.current, 'done')
  assert.equal(reducePetBehavior(done, { type: 'CLIP_FINISHED', action: 'done' }).current, 'idle')
  const attention = reducePetBehavior(snapshot('work', 'running'), { type: 'STATUS_CHANGED', status: 'stuck' })
  assert.equal(attention.current, 'attention')
  const settled = reducePetBehavior(attention, { type: 'CLIP_FINISHED', action: 'attention' })
  assert.equal(settled.current, 'idle')
  assert.equal(settled.status, 'stuck')
})

test('behavior: decisions preempt ordinary clips and stale completion cannot clear a newer action', () => {
  const petted = reducePetBehavior(snapshot('idle'), { type: 'POKE' })
  const notified = reducePetBehavior(petted, { type: 'EVENT_ARRIVED', decision: true })
  assert.equal(notified.current, 'notify')
  assert.equal(notified.pendingDecision, true)
  const stale = reducePetBehavior(notified, { type: 'CLIP_FINISHED', action: 'pet' })
  assert.equal(stale.current, 'notify')
  const finished = reducePetBehavior(notified, { type: 'CLIP_FINISHED', action: 'notify' })
  assert.equal(finished.current, 'idle')
  assert.equal(finished.pendingDecision, false)
})

test('behavior: offline wins and recovery restores the real status', () => {
  const offline = reducePetBehavior(snapshot('work', 'running'), { type: 'STATUS_CHANGED', status: 'offline' })
  assert.equal(offline.current, 'offline')
  assert.equal(reducePetBehavior(offline, { type: 'POKE' }).current, 'offline')
  const recovered = reducePetBehavior(offline, { type: 'STATUS_CHANGED', status: 'running' })
  assert.equal(recovered.current, 'work')
})

test('behavior: sleep requires 120 seconds of idle and wake plays a short transition', () => {
  assert.equal(canPetSleep({ status: 'idle', current: 'idle', idleForMs: 119_999 }), false)
  assert.equal(canPetSleep({ status: 'idle', current: 'idle', idleForMs: 120_000 }), true)
  assert.equal(canPetSleep({ status: 'running', current: 'work', idleForMs: 200_000 }), false)
  const sleeping = reducePetBehavior(snapshot('idle'), { type: 'IDLE_TIMEOUT' })
  assert.equal(sleeping.current, 'sleep')
  assert.equal(reducePetBehavior(sleeping, { type: 'WAKE' }).current, 'wake')
})

test('behavior: wake completion returns to idle after a sleep poke', () => {
  const sleeping = reducePetBehavior(snapshot('idle'), { type: 'IDLE_TIMEOUT' })
  const waking = reducePetBehavior(sleeping, { type: 'POKE' })
  assert.equal(waking.current, 'wake')
  assert.equal(reducePetBehavior(waking, { type: 'CLIP_FINISHED', action: 'wake' }).current, 'idle')
})

test('behavior: roaming is blocked by DND, reduced motion, overlays and background', () => {
  const base = {
    status: 'idle' as const,
    current: 'idle' as const,
    dnd: false,
    roaming: true,
    motion: 'auto' as const,
    pageVisible: true,
    overlayOpen: false,
    sinceLastRoamMs: 45_000,
  }
  assert.equal(canPetRoam(base), true)
  assert.equal(canPetRoam({ ...base, dnd: true }), false)
  assert.equal(canPetRoam({ ...base, roaming: false }), false)
  assert.equal(canPetRoam({ ...base, motion: 'reduced' }), false)
  assert.equal(canPetRoam({ ...base, motion: 'off' }), false)
  assert.equal(canPetRoam({ ...base, pageVisible: false }), false)
  assert.equal(canPetRoam({ ...base, overlayOpen: true }), false)
  assert.equal(canPetRoam({ ...base, sinceLastRoamMs: 44_999 }), false)
})
