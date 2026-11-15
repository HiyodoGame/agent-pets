import type { AgentStatus } from '../shared/types'
import type { MotionPref } from '../shared/ui-logic'

export type PetBehaviorState = 'idle' | 'walk' | 'sleep' | 'drag' | 'drop' | 'pet' | 'work' | 'think' | 'done' | 'attention' | 'offline' | 'greet' | 'wake' | 'notify'

export interface PetBehaviorSnapshot {
  current: PetBehaviorState
  status: AgentStatus
  pendingDecision: boolean
}

export type PetBehaviorEvent =
  | { type: 'POKE' }
  | { type: 'DRAG_START' }
  | { type: 'DRAG_END' }
  | { type: 'STATUS_CHANGED'; status: AgentStatus }
  | { type: 'EVENT_ARRIVED'; decision: boolean }
  | { type: 'CLIP_FINISHED'; action: PetBehaviorState }
  | { type: 'IDLE_TIMEOUT' }
  | { type: 'WAKE' }
  | { type: 'WANDER' }

function entranceAction(status: AgentStatus): PetBehaviorState {
  if (status === 'running') return 'work'
  if (status === 'thinking') return 'think'
  if (status === 'done') return 'done'
  if (status === 'stuck') return 'attention'
  if (status === 'offline') return 'offline'
  return 'idle'
}

function settledAction(status: AgentStatus): PetBehaviorState {
  if (status === 'done' || status === 'stuck') return 'idle'
  return entranceAction(status)
}

export function createPetBehavior(status: AgentStatus): PetBehaviorSnapshot {
  return { current: entranceAction(status), status, pendingDecision: false }
}

export function reducePetBehavior(state: PetBehaviorSnapshot, event: PetBehaviorEvent): PetBehaviorSnapshot {
  switch (event.type) {
    case 'STATUS_CHANGED': {
      if (event.status === state.status) return state
      const next = { ...state, status: event.status }
      if (event.status === 'offline') return { ...next, current: 'offline' }
      if (state.pendingDecision) return { ...next, current: 'notify' }
      return { ...next, current: entranceAction(event.status) }
    }
    case 'DRAG_START':
      return { ...state, current: 'drag' }
    case 'DRAG_END':
      if (state.current !== 'drag') return state
      if (state.status === 'offline') return { ...state, current: 'offline' }
      if (state.pendingDecision) return { ...state, current: 'notify' }
      return { ...state, current: 'drop' }
    case 'POKE':
      if (state.status === 'offline' || state.current === 'notify') return state
      if (state.current === 'sleep') return { ...state, current: 'wake' }
      return { ...state, current: 'pet' }
    case 'EVENT_ARRIVED': {
      if (!event.decision) {
        if (state.current === 'drag' || state.current === 'notify' || state.status === 'offline') return state
        if (state.current === 'pet' || state.current === 'drop' || state.current === 'done' || state.current === 'attention') return state
        return { ...state, current: 'notify' }
      }
      if (state.current === 'drag' || state.status === 'offline') return { ...state, pendingDecision: true }
      return { ...state, current: 'notify', pendingDecision: true }
    }
    case 'CLIP_FINISHED':
      if (event.action !== state.current) return state
      if (state.current === 'notify') return { ...state, current: settledAction(state.status), pendingDecision: false }
      if (state.current === 'walk') return { ...state, current: 'idle' }
      if (state.current === 'idle' || state.current === 'work' || state.current === 'think' || state.current === 'sleep' || state.current === 'offline') return state
      return { ...state, current: settledAction(state.status) }
    case 'IDLE_TIMEOUT':
      return canPetSleep({ status: state.status, current: state.current, idleForMs: 120_000 }) ? { ...state, current: 'sleep' } : state
    case 'WAKE':
      return state.current === 'sleep' ? { ...state, current: 'wake' } : state
    case 'WANDER':
      return state.status === 'idle' && state.current === 'idle' ? { ...state, current: 'walk' } : state
  }
}

export function canPetSleep(input: { status: AgentStatus; current: PetBehaviorState; idleForMs: number }): boolean {
  return input.status === 'idle' && input.current === 'idle' && input.idleForMs >= 120_000
}

export function canPetRoam(input: {
  status: AgentStatus
  current: PetBehaviorState
  dnd: boolean
  roaming: boolean
  motion: MotionPref
  pageVisible: boolean
  overlayOpen: boolean
  sinceLastRoamMs: number
}): boolean {
  return input.status === 'idle'
    && input.current === 'idle'
    && !input.dnd
    && input.roaming
    && input.motion !== 'off'
    && input.motion !== 'reduced'
    && input.pageVisible
    && !input.overlayOpen
    && input.sinceLastRoamMs >= 45_000
}
