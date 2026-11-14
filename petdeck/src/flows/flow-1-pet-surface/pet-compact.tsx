import { useEffect, useRef, useState } from 'react'
import { Bell, Inbox, Move, RefreshCw, X } from 'lucide-react'
import { usePetData } from '../../adapters'
import type { PetEvent } from '../shared/types'
import { PetAvatar } from '../shared/pet-avatar'
import { STATUS_LABEL } from '../shared/status-tokens'
import { eventWatermark, newEventsAfter, routeDndArrivals, fmtCount, type EventWatermark } from '../shared/ui-logic'
import { compactPetStatus, summarizeSessions } from './pet-view'
import { openMainPanel, persistPetPositionOnMove, resizePetWindow, savePetPosition, startPetDragging, type PanelTarget } from '../../desktop/window'

export function CompactPet() {
  const { sessions, projects, unhandledEvents, connState, reconnect } = usePetData()
  const [expanded, setExpanded] = useState(false)
  const [dnd, setDnd] = useState(false)
  const [suppressed, setSuppressed] = useState<PetEvent[]>([])
  const [activeEvent, setActiveEvent] = useState<PetEvent | null>(null)
  const [desktopError, setDesktopError] = useState(false)
  const watermarkRef = useRef<EventWatermark | null>(null)
  const initializedRef = useRef(false)
  const events = unhandledEvents()
  const summary = summarizeSessions(sessions)
  const status = compactPetStatus(connState, summary)
  const attention = summary.waiting + summary.stuck

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true
      watermarkRef.current = eventWatermark(events)
      return
    }
    const added = newEventsAfter(events, watermarkRef.current)
    watermarkRef.current = eventWatermark(events)
    if (added.length === 0) return
    if (!dnd) {
      setActiveEvent(added[0])
      return
    }
    const { quiet, decision } = routeDndArrivals(added)
    if (quiet.length > 0) setSuppressed((current) => [...quiet, ...current])
    if (decision) setActiveEvent(decision)
  }, [events, dnd])

  useEffect(() => {
    const save = () => { void savePetPosition() }
    let active = true
    let stopPersisting: (() => void) | null = null
    persistPetPositionOnMove().then((stop) => {
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
    resizePetWindow(expanded, activeEvent !== null).catch(() => setDesktopError(true))
  }, [expanded, activeEvent])

  const openPanel = async (target: PanelTarget) => {
    try {
      await openMainPanel(target)
      setDesktopError(false)
      setActiveEvent(null)
    } catch {
      setDesktopError(true)
    }
  }

  const toggleDnd = () => {
    const next = !dnd
    setDnd(next)
    if (!next && suppressed.length > 0) {
      setActiveEvent(suppressed[0])
      setSuppressed((current) => current.slice(1))
    }
  }

  return (
    <main className="relative flex h-screen flex-col items-center justify-between overflow-hidden p-3 text-text select-none">
      <button
        type="button"
        className="flex h-7 w-16 cursor-grab items-center justify-center self-start rounded-full border border-border-secondary bg-bg-container/90 text-text-secondary shadow-sm active:cursor-grabbing"
        aria-label="拖拽宠物"
        title="拖拽移动宠物"
        onMouseDown={(event) => {
          if (event.button === 0) startPetDragging().catch(() => setDesktopError(true))
        }}
      >
        <Move className="h-4 w-4" />
      </button>

      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-2">
        <button
          type="button"
          className="rounded-full p-1 focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={expanded ? '收起项目摘要' : '展开项目摘要'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <PetAvatar status={status} size={expanded ? 72 : 104} />
        </button>

        <div className="flex items-center gap-1.5 rounded-full border border-border-secondary bg-bg-container/95 px-3 py-1 text-xs shadow-sm" role="status">
          <span>{STATUS_LABEL[status]}</span>
          <span aria-hidden="true">·</span>
          <span>{fmtCount(summary.running)} 运行</span>
          {attention > 0 && <span className="text-warning">{fmtCount(attention)} 待处理</span>}
        </div>

        {connState === 'offline' && (
          <button type="button" className="inline-flex items-center gap-1 rounded-full bg-bg-container px-3 py-1 text-xs text-error shadow-sm" onClick={reconnect}>
            <RefreshCw className="h-3 w-3" /> 重连 Agent
          </button>
        )}

        {activeEvent && (
          <section className="w-full rounded-2xl border border-border-secondary bg-bg-container p-3 text-left shadow-lg" aria-label="事件轻拍">
            <div className="flex items-start gap-2">
              <Bell className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="min-w-0 flex-1 text-sm break-words">{activeEvent.text}</p>
              <button type="button" aria-label="忽略事件" onClick={() => setActiveEvent(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              className="mt-2 w-full rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              onClick={() => void openPanel({ projectId: activeEvent.projectId, sessionId: activeEvent.sessionId })}
            >
              查看并处理
            </button>
          </section>
        )}

        {expanded && (
          <section className="min-h-0 w-full overflow-y-auto rounded-2xl border border-border-secondary bg-bg-container p-3 text-left shadow-lg" aria-label="项目摘要">
            <div className="mb-2 flex items-center justify-between">
              <h1 className="text-sm font-semibold">Agent 项目</h1>
              <div className="flex items-center gap-2">
                <button type="button" className="text-xs text-primary" onClick={() => void openPanel({})}>打开主面板</button>
                <button type="button" aria-label="收起项目摘要" onClick={() => setExpanded(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            {projects.length === 0 ? (
              <p className="py-3 text-center text-xs text-text-secondary">尚未发现 Agent 会话</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {projects.map((project) => (
                  <button
                    type="button"
                    key={project.id}
                    className="rounded-lg border border-border-secondary bg-bg-elevated px-3 py-2 text-left hover:border-primary"
                    onClick={() => void openPanel({ projectId: project.id })}
                  >
                    <span className="block truncate text-sm font-medium">{project.name}</span>
                    <span className="text-xs text-text-secondary">{fmtCount(project.sessionIds.length)} 个会话</span>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-border-secondary pt-2 text-xs">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={dnd} onChange={toggleDnd} />
                免打扰
              </label>
              <span className="inline-flex items-center gap-1 text-text-secondary">
                <Inbox className="h-3.5 w-3.5" /> {fmtCount(suppressed.length)} 静默
              </span>
            </div>
            {suppressed.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {suppressed.map((event) => (
                  <button
                    type="button"
                    key={event.id}
                    className="truncate rounded-md px-2 py-1 text-left text-xs hover:bg-bg-elevated"
                    onClick={() => void openPanel({ projectId: event.projectId, sessionId: event.sessionId })}
                  >
                    {event.text}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {desktopError && <p className="text-xs text-error" role="alert">桌面窗口操作失败，请重试</p>}
      </div>
    </main>
  )
}
