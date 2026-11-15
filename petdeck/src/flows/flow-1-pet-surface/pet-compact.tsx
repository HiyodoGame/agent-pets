import { useCallback, useEffect, useRef, useState } from 'react'
import { Inbox, PanelTop, RefreshCw, Settings2 } from 'lucide-react'
import { usePetData } from '../../adapters'
import type { PetEvent } from '../shared/types'
import { PetAvatar } from '../shared/pet-avatar'
import { STATUS_LABEL } from '../shared/status-tokens'
import { eventWatermark, newEventsAfter, routeDndArrivals, fmtCount, type EventWatermark } from '../shared/ui-logic'
import { compactPetStatus, summarizeSessions } from './pet-view'
import { hidePet, listenForDndChange, movePetBy, openMainPanel, persistPetPositionOnMove, quitPetDeck, savePetPosition, setDesktopDnd, setPetAlwaysOnTop, startPetDragging, updatePetWindowLayout, type PanelTarget } from '../../desktop/window'
import type { PetWindowMode } from '../../desktop/pet-layout'
import { updatePetSettings, type PetSettings } from '../shared/pet/pet-settings'
import { usePetBehavior } from './use-pet-behavior'
import { beginNativePetDrag, beginPetGesture, confirmPetDrag, endPetGesture, movePetGesture, type PetGesture } from './pet-gesture'
import { PetContextMenu, type PetMenuPoint } from './pet-context-menu'
import { PetEventCard } from './pet-event-card'
import { PetQuickSettings } from './pet-quick-settings'

export function CompactPet({ bridgeError = null }: { bridgeError?: string | null }) {
  const { sessions, unhandledEvents, connState, reconnect } = usePetData()
  const [expanded, setExpanded] = useState(false)
  const [dnd, setDnd] = useState(false)
  const [suppressed, setSuppressed] = useState<PetEvent[]>([])
  const [activeEvent, setActiveEvent] = useState<PetEvent | null>(null)
  const [menu, setMenu] = useState<PetMenuPoint | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [desktopError, setDesktopError] = useState(false)
  const watermarkRef = useRef<EventWatermark | null>(null)
  const initializedRef = useRef(false)
  const gestureRef = useRef<PetGesture | null>(null)
  const finishGestureRef = useRef<() => void>(() => {})
  const petButtonRef = useRef<HTMLButtonElement>(null)
  const events = unhandledEvents()
  const summary = summarizeSessions(sessions)
  const status = compactPetStatus(connState, summary)
  const attention = summary.waiting + summary.stuck
  const overlayOpen = expanded || settingsOpen || menu !== null || activeEvent !== null
  const onWalk = useCallback((direction: 'left' | 'right') => {
    movePetBy(direction).catch(() => setDesktopError(true))
  }, [])
  const behavior = usePetBehavior({ status, dnd, overlayOpen, onWalk })
  const { eventArrived, dragEnd, poke } = behavior
  const settings = behavior.settings
  const petSize = Math.round(128 * settings.scale)
  const windowMode: PetWindowMode = settingsOpen ? 'settings' : menu ? 'menu' : activeEvent ? 'event' : expanded ? 'quick' : 'compact'
  const previousScale = useRef(settings.scale)

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      watermarkRef.current = eventWatermark(events)
      return
    }
    const added = newEventsAfter(events, watermarkRef.current)
    watermarkRef.current = eventWatermark(events)
    if (added.length === 0) return
    eventArrived(added.some((event) => event.type === 'decision'))
    if (!dnd) {
      setActiveEvent(added[0])
      return
    }
    const { quiet, decision } = routeDndArrivals(added)
    if (quiet.length > 0) setSuppressed((current) => [...quiet, ...current])
    if (decision) setActiveEvent(decision)
  }, [events, dnd, eventArrived])

  useEffect(() => {
    const save = () => { void savePetPosition() }
    let active = true
    let stopPersisting: (() => void) | null = null
    persistPetPositionOnMove(() => {
      if (!gestureRef.current) return
      gestureRef.current = confirmPetDrag(gestureRef.current)
      finishGestureRef.current()
    }).then((stop) => {
      if (active) stopPersisting = stop
      else stop()
    }).catch(() => setDesktopError(true))
    window.addEventListener('pagehide', save)
    return () => {
      active = false
      stopPersisting?.()
      window.removeEventListener('pagehide', save)
    }
  }, [])

  useEffect(() => {
    const previous = previousScale.current
    previousScale.current = settings.scale
    updatePetWindowLayout(windowMode, settings.scale, previous).catch(() => setDesktopError(true))
  }, [windowMode, settings.scale])

  useEffect(() => {
    setPetAlwaysOnTop(settings.alwaysOnTop).catch(() => setDesktopError(true))
  }, [settings.alwaysOnTop])

  useEffect(() => {
    let active = true
    let unlisten: (() => void) | null = null
    listenForDndChange(setDnd).then((fn) => {
      if (active) unlisten = fn
      else fn()
    }).catch(() => setDesktopError(true))
    return () => {
      active = false
      unlisten?.()
    }
  }, [])

  const openPanel = async (target: PanelTarget = {}) => {
    try {
      await openMainPanel(target)
      setDesktopError(false)
      setActiveEvent(null)
      setExpanded(false)
      setMenu(null)
      setSettingsOpen(false)
    } catch {
      setDesktopError(true)
    }
  }

  const toggleDnd = () => {
    const next = !dnd
    setDnd(next)
    setDesktopDnd(next).catch(() => setDesktopError(true))
    if (!next && suppressed.length > 0) {
      setActiveEvent(suppressed[0])
      setSuppressed((current) => current.slice(1))
    }
  }

  const closeMenu = () => {
    setMenu(null)
    petButtonRef.current?.focus()
  }

  const finishGesture = useCallback(() => {
    const gesture = gestureRef.current
    gestureRef.current = null
    const result = endPetGesture(gesture)
    if (result === 'drag') {
      dragEnd()
      setExpanded(false)
      void savePetPosition()
    } else if (result === 'poke') {
      poke()
      setExpanded((value) => !value)
      setSettingsOpen(false)
      setMenu(null)
    }
  }, [dragEnd, poke])

  useEffect(() => { finishGestureRef.current = finishGesture }, [finishGesture])

  useEffect(() => {
    const finish = () => {
      if (gestureRef.current) finishGesture()
    }
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('mouseup', finish)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('mouseup', finish)
    }
  }, [finishGesture])

  const changeSettings = (patch: Partial<PetSettings>) => updatePetSettings(patch)

  return (
    <main
      className="pet-stage"
      data-dnd={dnd}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        setExpanded(false)
        setSettingsOpen(false)
        setMenu(null)
      }}
    >
      <div className="pet-character-zone">
        <button
          ref={petButtonRef}
          type="button"
          className="pet-character-button"
          style={{ width: petSize, height: petSize }}
          aria-label={expanded ? '收起宠物快捷面板' : '轻戳宠物展开快捷面板'}
          aria-expanded={expanded}
          onPointerDown={(event) => {
            if (event.button !== 0) return
            gestureRef.current = beginPetGesture({ button: event.button, x: event.clientX, y: event.clientY })
          }}
          onPointerMove={(event) => {
            if (!gestureRef.current) return
            const moved = movePetGesture(gestureRef.current, { x: event.clientX, y: event.clientY })
            gestureRef.current = moved
            if (moved.started) {
              beginNativePetDrag({
                showDrag: behavior.dragStart,
                startDragging: startPetDragging,
              }).catch(() => setDesktopError(true))
            }
          }}
          onPointerUp={finishGesture}
          onPointerCancel={finishGesture}
          onClick={(event) => {
            if (event.detail !== 0) return
            behavior.poke()
            setExpanded((value) => !value)
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            gestureRef.current = null
            setExpanded(false)
            setSettingsOpen(false)
            setMenu({ x: event.clientX, y: event.clientY })
          }}
        >
          <PetAvatar
            status={status}
            size={petSize}
            action={behavior.state.current}
            direction={behavior.direction}
            motion={settings.motion}
            onComplete={behavior.clipFinished}
          />
        </button>
        <div className="pet-status-pill" role="status" data-status={status}>
          <span className="pet-status-dot" aria-hidden="true" />
          <span>{dnd ? '安静陪伴' : STATUS_LABEL[status]}</span>
          {summary.running > 0 && <span className="tabular-nums">{fmtCount(summary.running)} 运行</span>}
          {attention > 0 && <span className="pet-attention-count tabular-nums">{fmtCount(attention)} 待处理</span>}
        </div>
      </div>

      {connState === 'offline' && !bridgeError && (
        <button type="button" className="pet-reconnect" onClick={reconnect}>
          <RefreshCw className="h-3 w-3" /> 重连 Agent
        </button>
      )}

      {expanded && (
        <section className="pet-popover pet-quick-panel" aria-label="宠物快捷面板">
          <div className="pet-panel-heading">
            <div>
              <strong>{dnd ? '我会安静陪着你' : '我在这里陪着你'}</strong>
              <span>{fmtCount(summary.running)} 运行 · {fmtCount(summary.done)} 完成 · {fmtCount(attention)} 待处理</span>
            </div>
            <button type="button" className="pet-icon-button" aria-label="打开宠物设置" onClick={() => { setExpanded(false); setSettingsOpen(true) }}>
              <Settings2 className="h-4 w-4" />
            </button>
          </div>
          {suppressed.length > 0 && (
            <button type="button" className="pet-inbox-button" onClick={() => {
              setActiveEvent(suppressed[0])
              setSuppressed((current) => current.slice(1))
              setExpanded(false)
            }}>
              <Inbox className="h-4 w-4" /> 查看 {fmtCount(suppressed.length)} 条静默事件
            </button>
          )}
          <button type="button" className="pet-primary-button" onClick={() => void openPanel({})}>
            <PanelTop className="h-4 w-4" /> 打开主面板
          </button>
          <label className="pet-check-field pet-dnd-field">
            <input type="checkbox" checked={dnd} onChange={toggleDnd} />
            <span>免打扰，仅重要事项轻拍</span>
          </label>
        </section>
      )}

      {activeEvent && (
        <PetEventCard
          event={activeEvent}
          onDismiss={() => setActiveEvent(null)}
          onOpen={() => void openPanel({ projectId: activeEvent.projectId, sessionId: activeEvent.sessionId })}
        />
      )}

      {menu && (
        <PetContextMenu
          point={menu}
          dnd={dnd}
          onClose={closeMenu}
          onOpenPanel={() => void openPanel({})}
          onToggleDnd={toggleDnd}
          onSettings={() => setSettingsOpen(true)}
          onHide={() => hidePet().catch(() => setDesktopError(true))}
          onQuit={() => quitPetDeck().catch(() => setDesktopError(true))}
        />
      )}

      {settingsOpen && <PetQuickSettings settings={settings} onChange={changeSettings} onClose={() => setSettingsOpen(false)} />}
      {bridgeError && <p className="pet-error" role="alert">{bridgeError}</p>}
      {desktopError && <p className="pet-error" role="alert">桌面窗口操作失败，请重试</p>}
    </main>
  )
}
