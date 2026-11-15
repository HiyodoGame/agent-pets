import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { AgentStatus } from '../shared/types'
import type { PetDirection } from '../shared/pet/skin-types'
import { getPetSettings, subscribePetSettings } from '../shared/pet/pet-settings'
import { canPetRoam, canPetSleep, createPetBehavior, reducePetBehavior } from './pet-behavior'

export function usePetBehavior({ status, dnd, overlayOpen, onWalk }: {
  status: AgentStatus
  dnd: boolean
  overlayOpen: boolean
  onWalk?: (direction: PetDirection) => void
}) {
  const [state, dispatch] = useReducer(reducePetBehavior, status, createPetBehavior)
  const [direction, setDirection] = useState<PetDirection>('right')
  const [settings, setSettings] = useState(getPetSettings)
  const [pageVisible, setPageVisible] = useState(() => typeof document === 'undefined' || !document.hidden)
  const lastInteraction = useRef(0)
  const lastRoam = useRef(0)
  const onWalkRef = useRef(onWalk)

  useEffect(() => {
    const now = Date.now()
    lastInteraction.current = now
    lastRoam.current = now
  }, [])
  useEffect(() => { onWalkRef.current = onWalk }, [onWalk])
  useEffect(() => subscribePetSettings(setSettings), [])
  useEffect(() => { dispatch({ type: 'STATUS_CHANGED', status }) }, [status])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const update = () => setPageVisible(!document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    const remaining = Math.max(0, 120_000 - (Date.now() - lastInteraction.current))
    const timer = window.setTimeout(() => {
      if (canPetSleep({ status, current: state.current, idleForMs: Date.now() - lastInteraction.current })) {
        dispatch({ type: 'IDLE_TIMEOUT' })
      }
    }, remaining)
    return () => window.clearTimeout(timer)
  }, [status, state])

  useEffect(() => {
    const eligible = canPetRoam({
      status,
      current: state.current,
      dnd,
      roaming: settings.roaming,
      motion: settings.motion,
      pageVisible,
      overlayOpen,
      sinceLastRoamMs: 45_000,
    })
    if (!eligible) return
    const elapsed = Date.now() - lastRoam.current
    const delay = Math.max(1000, 45_000 + Math.random() * 45_000 - elapsed)
    let stopTimer: number | undefined
    const timer = window.setTimeout(() => {
      if (!canPetRoam({
        status,
        current: state.current,
        dnd,
        roaming: settings.roaming,
        motion: settings.motion,
        pageVisible,
        overlayOpen,
        sinceLastRoamMs: Date.now() - lastRoam.current,
      })) return
      const nextDirection: PetDirection = Math.random() > 0.5 ? 'left' : 'right'
      lastRoam.current = Date.now()
      setDirection(nextDirection)
      dispatch({ type: 'WANDER' })
      onWalkRef.current?.(nextDirection)
      stopTimer = window.setTimeout(() => dispatch({ type: 'CLIP_FINISHED', action: 'walk' }), 1800)
    }, delay)
    return () => {
      window.clearTimeout(timer)
      if (stopTimer !== undefined) window.clearTimeout(stopTimer)
    }
  }, [status, state, dnd, settings.motion, settings.roaming, pageVisible, overlayOpen])

  const interact = useCallback(() => { lastInteraction.current = Date.now() }, [])
  const poke = useCallback(() => { interact(); dispatch({ type: 'POKE' }) }, [interact])
  const wake = useCallback(() => { interact(); dispatch({ type: 'WAKE' }) }, [interact])
  const dragStart = useCallback(() => { interact(); dispatch({ type: 'DRAG_START' }) }, [interact])
  const dragEnd = useCallback(() => { interact(); dispatch({ type: 'DRAG_END' }) }, [interact])
  const eventArrived = useCallback((decision: boolean) => {
    interact()
    dispatch({ type: 'EVENT_ARRIVED', decision })
  }, [interact])
  const clipFinished = useCallback(() => {
    dispatch({ type: 'CLIP_FINISHED', action: state.current })
  }, [state])

  return { state, direction, settings, poke, wake, dragStart, dragEnd, eventArrived, clipFinished }
}
