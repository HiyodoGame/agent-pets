import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Inbox, PanelTop, RefreshCw, Settings2 } from 'lucide-react'
import { usePetData } from '../../adapters'
import type { PetEvent } from '../shared/types'
import { PetAvatar } from '../shared/pet-avatar'
import { statusLabel } from '../shared/status-tokens'
import { eventWatermark, newEventsAfter, routeDndArrivals, fmtCount, type EventWatermark } from '../shared/ui-logic'
import { compactPetStatus, petOverlayMode, shouldResetEventWatermark, summarizeSessions } from './pet-view'
import { hidePet, getDnd, listenForDndChange, movePetBy, openMainPanel, persistPetPositionOnMove, quitPetDeck, savePetPosition, setDesktopDnd, setPetAlwaysOnTop, startPetDragging, updatePetWindowLayout, type PanelTarget } from '../../desktop/window'
import { t } from '../../i18n/index.ts'
import { useI18n } from '../../i18n/context.ts'
import type { PetWindowMode } from '../../desktop/pet-layout'
import { updatePetSettings, type PetSettings } from '../shared/pet/pet-settings'
import { awardPetGrowth, awardTaskGrowth } from '../shared/pet/growth.ts'
import { useGrowth } from '../shared/pet/use-growth.ts'
import { usePetBehavior } from './use-pet-behavior'
import { beginNativePetDrag, beginPetGesture, confirmPetDrag, endPetGesture, movePetGesture, type PetGesture } from './pet-gesture'
import { PetContextMenu, type PetMenuPoint } from './pet-context-menu'
import { PetEventCard } from './pet-event-card'
import { PetQuickSettings } from './pet-quick-settings'
import { presentSession, prioritizeSessions } from '../shared/session-presentation.ts'
import { createNotificationDispatcher, sendPetSystemNotification } from '../../desktop/notifications'

export function CompactPet({ bridgeError = null }: { bridgeError?: string | null }) {
  useI18n()
  const { sessions, unhandledEvents, connState, reconnect, mode, agents, projects } = usePetData()
  const [expanded, setExpanded] = useState(false)
  const [dnd, setDnd] = useState(false)
  const [suppressed, setSuppressed] = useState<PetEvent[]>([])
  const [activeEvent, setActiveEvent] = useState<PetEvent | null>(null)
  const [menu, setMenu] = useState<PetMenuPoint | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [desktopError, setDesktopError] = useState(false)
  const dispatchNotification = useMemo(() => createNotificationDispatcher(sendPetSystemNotification), [])
  const watermarkRef = useRef<EventWatermark | null>(null)
  const initializedRef = useRef(false)
  const eventModeRef = useRef(mode)
  const gestureRef = useRef<PetGesture | null>(null)
  const finishGestureRef = useRef<() => void>(() => {})
  const petButtonRef = useRef<HTMLButtonElement>(null)
  const events = unhandledEvents()
  const summary = summarizeSessions(sessions)
  const quickSessions = prioritizeSessions(sessions)
    .filter((session) => session.status === 'waiting' || session.status === 'stuck' || session.status === 'active')
    .slice(0, 3)
  const status = compactPetStatus(connState, summary)
  const growth = useGrowth()
  const attention = summary.waiting + summary.stuck
  const hasError = Boolean(bridgeError || desktopError)
  const overlayOpen = expanded || settingsOpen || menu !== null || activeEvent !== null || hasError
  const onWalk = useCallback((direction: 'left' | 'right') => {
    movePetBy(direction).catch(() => setDesktopError(true))
  }, [])
  const behavior = usePetBehavior({ status, dnd, overlayOpen, onWalk })
  const { eventArrived, dragEnd, poke } = behavior
  const settings = behavior.settings
  const petSize = Math.round(128 * settings.scale)
  const windowMode: PetWindowMode = petOverlayMode({ settingsOpen, menuOpen: menu !== null, activeEvent: activeEvent !== null, expanded, hasError })
  const previousScale = useRef(settings.scale)

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      watermarkRef.current = eventWatermark(events)
      return
    }
    if (shouldResetEventWatermark(eventModeRef.current, mode)) {
      eventModeRef.current = mode
      watermarkRef.current = eventWatermark(events)
      setActiveEvent(null)
      setSuppressed([])
      return
    }
    const added = newEventsAfter(events, watermarkRef.current)
    watermarkRef.current = eventWatermark(events)
    if (added.length === 0) return
    // Usage-driven growth: completed tasks (and completed relays) grant XP. Only the
    // persistent pet window awards, so an open main panel cannot double-count.
    const completed = added.filter((event) => event.type === 'done' || event.type === 'relay-ready').length
    if (completed > 0) awardTaskGrowth(completed)
    const behaviorEvent = added.find((item) => item.type === 'decision')
      ?? added.find((item) => item.type === 'stuck')
      ?? added.find((item) => item.type === 'done' || item.type === 'relay-ready')
      ?? added[0]
    eventArrived(behaviorEvent.type)
    for (const item of added) {
      dispatchNotification(item, dnd).catch(() => setDesktopError(true))
    }
    if (!dnd) {
      setActiveEvent(added[0])
      return
    }
    const { quiet, decision } = routeDndArrivals(added)
    if (quiet.length > 0) setSuppressed((current) => [...quiet, ...current])
    if (decision) setActiveEvent(decision)
  }, [events, dnd, eventArrived, mode, dispatchNotification])

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
    // DND 持久化（P2-11）：挂载时先取 Rust 侧持久化状态，再订阅变更事件，
    // 保证托盘勾选态、宠物 UI 与配置文件三处一致（不依赖事件时序）。
    getDnd().then((v) => { if (active) setDnd(v) }).catch(() => setDesktopError(true))
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
      setActiveEvent(null)
      setExpanded(false)
      setMenu(null)
      setSettingsOpen(false)
      await updatePetWindowLayout('compact', settings.scale, settings.scale)
      await openMainPanel(target)
      setDesktopError(false)
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
      awardPetGrowth()
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
          aria-label={expanded ? t('pet.ariaCollapse') : t('pet.ariaExpand')}
          aria-expanded={windowMode === 'quick'}
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
          <span>{dnd ? t('pet.quietCompanion') : statusLabel(status)}</span>
          {summary.running > 0 && <span className="tabular-nums">{t('common.running', { n: fmtCount(summary.running) })}</span>}
          {attention > 0 && <span className="pet-attention-count tabular-nums">{t('pet.pendingCount', { n: fmtCount(attention) })}</span>}
        </div>
        {connState === 'offline' && !bridgeError && (
          <button type="button" className="pet-reconnect" onClick={reconnect}>
            <RefreshCw className="h-3 w-3" /> {t('pet.reconnect')}
          </button>
        )}
      </div>

      {windowMode === 'quick' && expanded && (
        <section className="pet-popover pet-quick-panel" aria-label={t('pet.quickPanel')}>
          <div className="pet-panel-heading">
            <div>
              <strong>{dnd ? t('pet.quietTitle') : t('pet.hereTitle')}</strong>
              <span>{t('pet.summary', { running: fmtCount(summary.running), done: fmtCount(summary.done), pending: fmtCount(attention) })}</span>
            </div>
            <button type="button" className="pet-icon-button" aria-label={t('pet.openSettings')} onClick={() => { setExpanded(false); setSettingsOpen(true) }}>
              <Settings2 className="h-4 w-4" />
            </button>
          </div>
          {quickSessions.length > 0 && (
            <div className="pet-task-shortlist">
              <span className="pet-task-shortlist-label">{attention > 0 ? t('pet.priorityTitle') : t('pet.runningTitle')}</span>
              <ul>
                {quickSessions.map((session) => {
                  const view = presentSession(session, agents, projects)
                  return (
                    <li key={session.id}>
                      <button type="button" onClick={() => void openPanel({ projectId: session.projectId, sessionId: session.id })}>
                        <span className="pet-task-status" data-status={session.status}>{view.statusLabel}</span>
                        <span className="pet-task-copy">
                          <strong>{view.title}</strong>
                          <span>{view.agentName} · {view.projectName}{view.host ? ` · @${view.host}` : ''}</span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          <div className="pet-growth">
            <div className="pet-growth-head">
              <strong key={growth.progress.level}>{t('growth.level', { level: growth.progress.level })} · {t(growth.progress.titleKey)}</strong>
              <span>{t('growth.streak', { days: growth.state.streakDays })}</span>
            </div>
            <div
              className="pet-growth-bar"
              role="progressbar"
              aria-label={t('growth.progressAria')}
              aria-valuenow={growth.progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${growth.progress.percent}%` }} />
            </div>
            <span className="pet-growth-xp">
              {growth.progress.nextMinXp !== null
                ? t('growth.xp', { current: growth.progress.xpIntoLevel, next: growth.progress.xpForNext })
                : t('growth.max')}
              {' · '}
              {t('growth.tasks', { n: growth.state.tasks })}
            </span>
          </div>
          {suppressed.length > 0 && (
            <button type="button" className="pet-inbox-button" onClick={() => {
              setActiveEvent(suppressed[0])
              setSuppressed((current) => current.slice(1))
              setExpanded(false)
            }}>
              <Inbox className="h-4 w-4" /> {t('pet.inboxButton', { n: fmtCount(suppressed.length) })}
            </button>
          )}
          <button type="button" className="pet-primary-button" onClick={() => void openPanel({})}>
            <PanelTop className="h-4 w-4" /> {t('pet.openPanel')}
          </button>
          <label className="pet-check-field pet-dnd-field">
            <input type="checkbox" checked={dnd} onChange={toggleDnd} />
            <span>{t('pet.dnd')}</span>
          </label>
        </section>
      )}

      {windowMode === 'event' && activeEvent && (
        <PetEventCard
          event={activeEvent}
          onDismiss={() => {
            setExpanded(false)
            setSettingsOpen(false)
            setMenu(null)
            setActiveEvent(null)
          }}
          onOpen={() => void openPanel({ projectId: activeEvent.projectId, sessionId: activeEvent.sessionId })}
        />
      )}

      {windowMode === 'menu' && menu && (
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

      {windowMode === 'settings' && settingsOpen && <PetQuickSettings settings={settings} onChange={changeSettings} onClose={() => { setSettingsOpen(false); petButtonRef.current?.focus() }} />}
      {windowMode === 'event' && hasError && !activeEvent && (
        <div className="pet-popover pet-error-panel" role="alert">
          {bridgeError && <p className="pet-error">{bridgeError}</p>}
          {desktopError && <p className="pet-error">{t('pet.desktopError')}</p>}
        </div>
      )}
    </main>
  )
}
