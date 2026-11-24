import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Inbox, PanelTop, RefreshCw, Settings2 } from 'lucide-react'
import { usePetData } from '../../adapters'
import type { AgentStatus, PetEvent } from '../shared/types'
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
import { usePendingDecisions, useRuntimeOverview } from '../console/runtime-hooks.ts'
import { DecisionCard } from '../console/decision-card.tsx'
import { getSettings } from '../../adapters/runtime-client.ts'

export function CompactPet({ bridgeError = null }: { bridgeError?: string | null }) {
  useI18n()
  const { sessions, unhandledEvents, connState, reconnect, mode, agents, projects } = usePetData()
  const [expanded, setExpanded] = useState(false)
  const [dnd, setDnd] = useState(false)
  const [suppressed, setSuppressed] = useState<PetEvent[]>([])
  const [activeEvent, setActiveEvent] = useState<PetEvent | null>(null)
  const [decisionReplay, setDecisionReplay] = useState<PetEvent[]>([])
  const visibleEvent = decisionReplay[0] ?? activeEvent
  const [menu, setMenu] = useState<PetMenuPoint | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [desktopError, setDesktopError] = useState(false)
  const [decisionSound, setDecisionSound] = useState(true)
  const lastDecisionRef = useRef<string | null>(null)
  const decisionPrimedRef = useRef(false)
  const dispatchNotification = useMemo(() => createNotificationDispatcher(sendPetSystemNotification), [])
  const watermarkRef = useRef<EventWatermark | null>(null)
  const initializedRef = useRef(false)
  const eventModeRef = useRef(mode)
  const gestureRef = useRef<PetGesture | null>(null)
  const finishGestureRef = useRef<() => void>(() => {})
  const petButtonRef = useRef<HTMLButtonElement>(null)
  const events = unhandledEvents()
  const summary = summarizeSessions(sessions)
  const runtime = useRuntimeOverview(4000, mode === 'live')
  const decisions = usePendingDecisions(4000, mode === 'live')
  const decision = decisions.decisions[0] ?? null
  const runtimeTasks = mode === 'live'
    ? runtime.tasks.filter((task) => ['running', 'paused', 'waiting', 'queued', 'ready'].includes(task.status))
    : []
  const runtimeRunning = runtimeTasks.filter((task) => task.status === 'running' || task.status === 'paused').length
  const runningCount = Math.max(summary.running, runtimeRunning)
  const quickSessions = prioritizeSessions(sessions)
    .filter((session) => session.status === 'waiting' || session.status === 'stuck' || session.status === 'active')
    .slice(0, 3)
  const status: AgentStatus = runtimeRunning > 0 ? 'running' : compactPetStatus(connState, summary)
  const growth = useGrowth()
  const attention = summary.waiting + summary.stuck
  const hasError = Boolean(bridgeError || desktopError)
  const overlayOpen = expanded || settingsOpen || menu !== null || visibleEvent !== null || hasError
  const onWalk = useCallback((direction: 'left' | 'right') => {
    movePetBy(direction).catch(() => setDesktopError(true))
  }, [])
  const behavior = usePetBehavior({ status, dnd, overlayOpen, onWalk })
  const { eventArrived, dragEnd, poke } = behavior
  const settings = behavior.settings
  const petSize = Math.round(128 * settings.scale)
  const windowMode: PetWindowMode = petOverlayMode({ settingsOpen, menuOpen: menu !== null, activeEvent: visibleEvent !== null, expanded, hasError })
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
      setDecisionReplay([])
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
    const { quiet, decisions } = routeDndArrivals(added)
    if (quiet.length > 0) setSuppressed((current) => [...quiet, ...current])
    if (decisions.length > 0) setDecisionReplay((current) => [...current, ...decisions])
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

  useEffect(() => {
    let active = true
    getSettings().then((next) => { if (active) setDecisionSound(next.decisionSound) }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    const next = decision?.id ?? null
    if (!next) {
      lastDecisionRef.current = null
      // Empty is a real idle state, not a new mount. Keep priming complete so the
      // next genuinely new decision after an empty interval still plays sound.
      decisionPrimedRef.current = true
      return
    }
    if (lastDecisionRef.current === next) return
    lastDecisionRef.current = next
    if (!decisionPrimedRef.current) {
      decisionPrimedRef.current = true
      return
    }
    if (dnd || !decisionSound) return
    playDecisionChime()
  }, [decision, dnd, decisionSound])

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
          {runningCount > 0 && <span className="tabular-nums">{t('common.running', { n: fmtCount(runningCount) })}</span>}
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
          {decision && (
            <div className="pet-decision-block">
              <span className="pet-task-shortlist-label">{t('pet.decisionsTitle')}</span>
              <DecisionCard decision={decision} compact onAnswered={() => void decisions.refresh()} />
              {decisions.decisions.length > 1 && (
                <button type="button" className="pet-more-button" onClick={() => void openPanel({})}>
                  {t('pet.decisionMore', { n: fmtCount(decisions.decisions.length - 1) })}
                </button>
              )}
            </div>
          )}
          {runtimeTasks.length > 0 && (
            <div className="pet-task-shortlist">
              <span className="pet-task-shortlist-label">{t('pet.runtimeTasks', { n: fmtCount(runtimeRunning) })}</span>
              <ul>
                {runtimeTasks.slice(0, 3).map((task) => (
                  <li key={task.id}>
                    <button type="button" onClick={() => void openPanel({ taskId: task.id })}>
                      <span className="pet-task-status" data-status={petTaskTone(task.status)}>
                        {petTaskLabel(task.status)}
                      </span>
                      <span className="pet-task-copy">
                        <strong>{task.title}</strong>
                        <span>{task.project_name ?? '—'} · {task.agent}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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

      {windowMode === 'event' && visibleEvent && (
        <PetEventCard
          event={visibleEvent}
          onDismiss={() => {
            setExpanded(false)
            setSettingsOpen(false)
            setMenu(null)
            if (decisionReplay.length > 0) setDecisionReplay((current) => current.slice(1))
            else setActiveEvent(null)
          }}
          onOpen={() => {
            if (decisionReplay.length > 0) setDecisionReplay((current) => current.slice(1))
            void openPanel({ projectId: visibleEvent.projectId, sessionId: visibleEvent.sessionId })
          }}
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
      {windowMode === 'event' && hasError && !visibleEvent && (
        <div className="pet-popover pet-error-panel" role="alert">
          {bridgeError && <p className="pet-error">{bridgeError}</p>}
          {desktopError && <p className="pet-error">{t('pet.desktopError')}</p>}
        </div>
      )}
    </main>
  )
}


function petTaskTone(status: string): string {
  if (status === 'running') return 'active'
  if (status === 'paused') return 'paused'
  return 'waiting'
}

function petTaskLabel(status: string): string {
  if (status === 'running') return t('console.status.running')
  if (status === 'queued') return t('pet.taskQueued')
  if (status === 'waiting') return t('pet.taskWaiting')
  if (status === 'paused') return t('pet.taskPaused')
  return t('console.status.ready')
}

let decisionAudio: AudioContext | null = null

function playDecisionChime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    decisionAudio ??= new Ctor()
    const ctx = decisionAudio
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    for (const [offset, frequency] of [[0, 880], [0.16, 1174.7]] as const) {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16)
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      oscillator.start(now + offset)
      oscillator.stop(now + offset + 0.18)
    }
  } catch {
    // Audio is a nicety; autoplay policy or a missing device must not break the pet.
  }
}
