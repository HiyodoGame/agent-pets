// =============================================
// FLOW: Pet Ambient Surface (3 screens + state variants + edge states)
// Scenario: AI Product（自定义环境化外壳）
// Edge 补全：offline重连 / 999+ / loading-refresh / DND收件箱 / 事件error+截断 / S3空态+截断+loading-submit+error
// =============================================
import { useEffect, useRef, useState } from 'react'
import {
  Tag,
  Tooltip,
  Button,
  Bubble,
  BubbleContent,
  Separator,
  TypographyMuted,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  Switch,
  Spinner,
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from 'sparkdesign'
import { Check, AlertTriangle, X, MessageCircle, RefreshCw, Inbox } from 'lucide-react'
import type { AgentStatus, PetEvent, Project } from '../shared/types'
import { usePetData } from '../../adapters'
import { track, EVENT } from '../../telemetry'
import { ClampText, EdgeAlert } from '../shared/edge-kit'
import { PetAvatar } from '../shared/pet-avatar'
import { STATUS_ORDER, statusLabel } from '../shared/status-tokens'
import { getMotionPref, setMotionPref, fmtCount, type MotionPref, type EventWatermark, eventWatermark, newEventsAfter, routeDndArrivals } from '../shared/ui-logic'
import { getPetSettings, subscribePetSettings, updatePetSettings } from '../shared/pet/pet-settings'
import { PetQuickSettings } from './pet-quick-settings'
import { t } from '../../i18n/index.ts'

function useAggregate() {
  const { sessions } = usePetData()
  const running = sessions.filter((s) => s.status === 'active').length
  const done = sessions.filter((s) => s.status === 'done').length
  const stuck = sessions.filter((s) => s.status === 'stuck' || s.status === 'waiting').length
  return { running, done, stuck }
}

/* ================================================
   FLOW: Pet Ambient Surface
   SCREEN 1 of 3: Ambient Idle（环境化常驻态 + edge）
   ENTRY: 应用启动常驻；EXIT: 戳→S3 / 事件→S2
   STATE: default / thinking / running / done / stuck / offline(error+重连)
   EDGE: offline-no-network(重连CTA) / boundary-zero / boundary-overflow / loading-refresh / dnd-silent-inbox
   ================================================ */
function Screen1_AmbientIdle({
  status,
  onPoke,
  onOffline,
  onReconnect,
  dnd,
  onDndChange,
  suppressed,
  onOpenInbox,
  refreshing,
  onRefresh,
}: {
  status: AgentStatus
  onPoke: () => void
  onOffline: () => void
  onReconnect: () => void
  dnd: boolean
  onDndChange: (v: boolean) => void
  suppressed: PetEvent[]
  onOpenInbox: () => void
  refreshing: boolean
  onRefresh: () => void
}) {
  const { running, done, stuck } = useAggregate()
  const [motion, setMotion] = useState<MotionPref>(getMotionPref())
  useEffect(() => { track('pet', EVENT.ambientGlance) }, [])
  const summary = t('petSurface.summary', { running: fmtCount(running), done: fmtCount(done), stuck: fmtCount(stuck) })
  return (
    <div className="flex flex-col items-center gap-3 p-6">
      <h1 className="sr-only">{t('petSurface.srTitle')}</h1>
      <button
        type="button"
        onClick={status === 'offline' ? onOffline : onPoke}
        className="rounded-full p-2 transition-colors hover:bg-bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
        aria-label={t('petSurface.pokeAria')}
      >
        <PetAvatar status={status} />
      </button>
      <Tooltip content={summary} side="top">
        <div className="flex items-center gap-2 tabular-nums">
          {refreshing && <Spinner className="h-3 w-3" />}
          <Tag color={running === 0 ? 'slate' : 'primary'}>{t('common.running', { n: fmtCount(running) })}</Tag>
          <Tag color={done === 0 ? 'slate' : 'success'}>{t('common.done', { n: fmtCount(done) })}</Tag>
          {stuck > 0 && <Tag color="warning">{t('common.pending', { n: fmtCount(stuck) })}</Tag>}
          {status === 'offline' && <Tag color="error">{t('status.offline')}</Tag>}
          {/* DND 静默收件箱：真实事件队列，点击可逐条查看/关闭 */}
          {suppressed.length > 0 && (
            <Tooltip content={t('petSurface.suppressedHint', { n: fmtCount(suppressed.length) })} side="top">
              <button
                type="button"
                onClick={onOpenInbox}
                aria-label={t('petSurface.openInbox')}
                className="rounded-full transition-colors hover:bg-bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Tag color="slate">
                  <Inbox className="mr-1 inline h-3 w-3" />
                  {t('petSurface.silentCount', { n: fmtCount(suppressed.length) })}
                </Tag>
              </button>
            </Tooltip>
          )}
        </div>
      </Tooltip>
      {/* offline：重连 CTA（保留缓存状态） */}
      {status === 'offline' && (
        <Button variant="secondary" onClick={onReconnect}>
          <RefreshCw className="mr-1 h-4 w-4" /> {t('petSurface.reconnectAgent')}
        </Button>
      )}
      <TypographyMuted>{t('petSurface.pokeHint')}</TypographyMuted>
      <div className="flex items-center gap-2">
        <Switch checked={dnd} onCheckedChange={onDndChange} aria-label={t('petSurface.dnd')} />
        <TypographyMuted>{t('petSurface.dndHint')}</TypographyMuted>
        <Button variant="ghost" onClick={onRefresh} aria-label={t('petSurface.refresh')}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={motion !== 'off'}
          onCheckedChange={(v) => { const p: MotionPref = v ? 'on' : 'off'; setMotion(p); setMotionPref(p) }}
          aria-label={t('petSurface.motion')}
        />
        <TypographyMuted>{t('petSurface.motionHint')}</TypographyMuted>
      </div>
    </div>
  )
}

/* ================================================
   SCREEN 2 of 3: Event Tap（事件轻拍 + edge）
   EDGE: error-network(inline+Retry) / boundary-long-text(截断+展开)
   ================================================ */
function Screen2_EventTap({
  event,
  onOpen,
  onDismiss,
  error,
  onRetry,
  fromSuppressed = false,
}: {
  event: PetEvent
  onOpen: (e: PetEvent) => void
  onDismiss: () => void
  error: boolean
  onRetry: () => void
  fromSuppressed?: boolean
}) {
  if (error) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-3 p-6">
        <EdgeAlert title={t('petSurface.eventErrorTitle')} desc={t('petSurface.eventErrorDesc')} onRetry={onRetry} />
      </div>
    )
  }
  const icon =
    event.type === 'done' || event.type === 'relay-ready' ? (
      <Check className="h-4 w-4" />
    ) : event.type === 'decision' ? (
      <MessageCircle className="h-4 w-4" />
    ) : (
      <AlertTriangle className="h-4 w-4" />
    )
  return (
    <div className="flex flex-col items-center gap-3 p-6">
      <h2 className="sr-only">{t('petSurface.eventTapSr')}</h2>
      <PetAvatar status={event.type === 'stuck' ? 'stuck' : 'done'} size={64} />
      <Bubble align="start">
        <BubbleContent variant={event.type === 'decision' ? 'received' : 'note'}>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-text-secondary">{icon}</span>
            <div className="flex flex-col gap-2">
              <ClampText text={event.text} />
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => onOpen(event)}>
                  {t('common.view')}
                </Button>
                <Button variant="ghost" onClick={onDismiss} aria-label={t('petSurface.ignore')}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </BubbleContent>
      </Bubble>
      <TypographyMuted>
        {event.type === 'decision' ? t('petSurface.decisionHint') : fromSuppressed ? t('petSurface.suppressedHint2') : t('petSurface.dismissHint')}
      </TypographyMuted>
    </div>
  )
}

/* ================================================
   SCREEN 3 of 3: Poke Expand（戳展开 + edge）
   EDGE: empty-collection / boundary-long-text / loading-submit / error-network
   ================================================ */
function Screen3_PokeExpand({
  projects,
  onOpenPanel,
  onClose,
}: {
  projects: Project[]
  onOpenPanel: (projectId: string) => void
  onClose: () => void
}) {
  if (projects.length === 0) {
    return (
      <div className="w-full max-w-sm p-4">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('petSurface.noProjects')}</EmptyTitle>
            <EmptyDescription>{t('petSurface.noProjectsDesc')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="primary" onClick={() => onOpenPanel('')}>
              {t('petSurface.connectAgent')}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-border-secondary bg-bg-container p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-text font-semibold">{t('petSurface.projects')}</h1>
        <Button variant="ghost" onClick={onClose} aria-label={t('petSurface.collapse')}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <Separator />
      <div className="flex flex-col gap-2">
        {projects.map((p) => (
          <button key={p.id} type="button" onClick={() => onOpenPanel(p.id)} className="text-left">
            <Card className="transition-colors hover:bg-bg-elevated">
              <CardHeader>
                <Tooltip content={p.name} side="top">
                  <CardTitle className="truncate">{p.name}</CardTitle>
                </Tooltip>
                <CardDescription className="truncate">{p.description}</CardDescription>
              </CardHeader>
            </Card>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Flow 根组件 ──
export function Flow1_PetSurface({
  onOpenPanel,
  onReconnect,
}: {
  onOpenPanel?: (projectId: string, sessionId?: string) => void
  onReconnect?: () => void
}) {
  const [screen, setScreen] = useState<1 | 2 | 3>(1)
  const [status, setStatus] = useState<AgentStatus>('running')
  const [dnd, setDnd] = useState(false)
  // DND 抑制的是真实事件对象（不是计数），关闭免打扰后逐条补提示，绝不静默丢弃。
  const [suppressed, setSuppressed] = useState<PetEvent[]>([])
  const [replay, setReplay] = useState<PetEvent[]>([])
  const [inboxOpen, setInboxOpen] = useState(false)
  const [eventError, setEventError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [settings, setSettings] = useState(getPetSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { projects, unhandledEvents, connState } = usePetData()
  const events = unhandledEvents()
  const [eventIdx, setEventIdx] = useState(0)
  const event = events[eventIdx % Math.max(events.length, 1)]
  const replayHead = replay[0]
  const activeEvent = replayHead ?? event
  useEffect(() => subscribePetSettings(setSettings), [])

  // 真实联动：以 (timestamp, 同毫秒 id 集合) 水位线识别新事件 —— 事件列表恒被截断到 50 条时也不会漏检。
  // 首次运行只播种水位线（与旧实现一致：挂载时的存量事件不弹轻拍）。
  const watermarkRef = useRef<EventWatermark | null>(null)
  const didInitRef = useRef(false)
  useEffect(() => {
    if (!didInitRef.current) {
      didInitRef.current = true
      watermarkRef.current = eventWatermark(events)
      return
    }
    const added = newEventsAfter(events, watermarkRef.current)
    watermarkRef.current = eventWatermark(events)
    if (added.length === 0) return
    if (dnd) {
      // DND：非「需拍板」的逐条进入静默收件箱；decision 仍走轻拍——无论用户当前身处哪个 screen，
      // 否则水位线已推进、事件又不入队，拍板事件会被静默丢弃。
      const { quiet, decision } = routeDndArrivals(added)
      if (quiet.length > 0) {
        setSuppressed((s) => [...quiet, ...s])
        track('pet', EVENT.notificationSuppressed, { count: quiet.length })
      }
      if (decision) {
        const idx = events.findIndex((e) => e.id === decision.id)
        setEventIdx(idx >= 0 ? idx : 0)
        setEventError(false)
        setScreen(2)
      }
    } else if (screen === 1) {
      setEventIdx(0)
      setEventError(false)
      setScreen(2)
    }
  }, [events, dnd, screen])

  // 真实离线覆盖预览状态：断连时宠物灰化 + 重连 CTA（edge offline-no-network 态）
  const effectiveStatus: AgentStatus = connState === 'offline' ? 'offline' : status

  const openPanel = (projectId: string, sessionId?: string) => onOpenPanel?.(projectId, sessionId)

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-tertiary bg-bg-layout p-2">
        <TypographyMuted>{t('petSurface.preview')}</TypographyMuted>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('petSurface.statusPreview')}>
          {STATUS_ORDER.map((s) => (
            <Button key={s} variant={status === s ? 'secondary' : 'ghost'} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {statusLabel(s)}
            </Button>
          ))}
        </div>
        <Button variant="secondary" onClick={() => setSettingsOpen((value) => !value)} aria-expanded={settingsOpen}>
          {t('petSurface.skinSettings')}
        </Button>
      </div>

      {settingsOpen && (
        <div className="pet-preview-settings">
          <PetQuickSettings settings={settings} onChange={(patch) => updatePetSettings(patch)} onClose={() => setSettingsOpen(false)} />
        </div>
      )}

      {screen === 1 && (
        <Screen1_AmbientIdle
          status={effectiveStatus}
          onPoke={() => { track('pet', EVENT.petPoke); setScreen(3) }}
          onOffline={() => openPanel('p1')}
          onReconnect={() => onReconnect?.()}
          dnd={dnd}
          onDndChange={(v) => {
            setDnd(v)
            track('pet', EVENT.dndToggle, { on: v })
            if (!v && suppressed.length > 0) {
              // 关闭免打扰：积压事件转入逐条补提示队列，不清空、不丢弃。
              setReplay(suppressed)
              setSuppressed([])
              setInboxOpen(false)
              setEventError(false)
              setScreen(2)
            }
          }}
          suppressed={suppressed}
          onOpenInbox={() => setInboxOpen(true)}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true)
            setTimeout(() => setRefreshing(false), 600)
          }}
        />
      )}
      {screen === 2 && activeEvent && (replayHead || activeEvent.type === 'decision' || !dnd) && (
        <Screen2_EventTap
          event={activeEvent}
          fromSuppressed={Boolean(replayHead)}
          onOpen={(e) => {
            if (replayHead) {
              setReplay((r) => r.slice(1))
              if (replay.length <= 1) setScreen(1)
            } else {
              setScreen(1)
            }
            openPanel(e.projectId, e.sessionId)
          }}
          onDismiss={() => {
            if (replayHead) {
              setReplay((r) => r.slice(1))
              if (replay.length <= 1) setScreen(1)
            } else {
              setScreen(1)
            }
          }}
          error={eventError}
          onRetry={() => setEventError(false)}
        />
      )}
      {screen === 3 && (
        <Screen3_PokeExpand
          projects={projects}
          onOpenPanel={(pid) => openPanel(pid)}
          onClose={() => setScreen(1)}
        />
      )}
      {/* DND 静默收件箱：逐条查看/关闭；收起不清空，关闭免打扰会逐条补提示 */}
      {inboxOpen && (
        <div className="flex w-full max-w-sm flex-col gap-2 rounded-md border border-border-secondary bg-bg-container p-3">
          <div className="flex items-center justify-between">
            <TypographyMuted>{t('petSurface.inboxCount', { n: fmtCount(suppressed.length) })}</TypographyMuted>
            <Button variant="ghost" onClick={() => setInboxOpen(false)} aria-label={t('petSurface.collapse')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Separator />
          {suppressed.length === 0 ? (
            <TypographyMuted>{t('petSurface.inboxEmpty')}</TypographyMuted>
          ) : (
            <>
              {suppressed.map((e) => (
                <div key={e.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <ClampText text={e.text || t('petSurface.eventFallback', { type: e.type })} />
                  </span>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSuppressed((s) => s.filter((x) => x.id !== e.id))
                      openPanel(e.projectId, e.sessionId)
                    }}
                  >
                    {t('common.view')}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setSuppressed((s) => s.filter((x) => x.id !== e.id))}
                    aria-label={t('petSurface.closeEvent')}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="ghost" onClick={() => setSuppressed([])}>
                {t('petSurface.closeAll')}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default Flow1_PetSurface