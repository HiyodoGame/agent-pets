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
  ChatInput,
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
import { Bell, Check, AlertTriangle, X, MessageCircle, RefreshCw, Inbox } from 'lucide-react'
import type { AgentStatus, PetEvent, Project } from '../shared/types'
import { usePetData } from '../../adapters'
import { track, EVENT } from '../../telemetry'
import { ClampText, EdgeAlert } from '../shared/edge-kit'
import { PetAvatar } from '../shared/pet-avatar'
import { STATUS_LABEL } from '../shared/status-tokens'
import { getMotionPref, setMotionPref, fmtCount, type MotionPref } from '../shared/ui-logic'

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
  refreshing,
  onRefresh,
}: {
  status: AgentStatus
  onPoke: () => void
  onOffline: () => void
  onReconnect: () => void
  dnd: boolean
  onDndChange: (v: boolean) => void
  suppressed: number
  refreshing: boolean
  onRefresh: () => void
}) {
  const { running, done, stuck } = useAggregate()
  const [motion, setMotion] = useState<MotionPref>(getMotionPref())
  useEffect(() => { track('pet', EVENT.ambientGlance) }, [])
  const summary = `${fmtCount(running)} 运行 · ${fmtCount(done)} 完成 · ${fmtCount(stuck)} 待处理`
  return (
    <div className="flex flex-col items-center gap-3 p-6">
      <h1 className="sr-only">桌宠环境化主形态</h1>
      <button
        type="button"
        onClick={status === 'offline' ? onOffline : onPoke}
        className="rounded-full p-2 transition-colors hover:bg-bg-elevated focus-visible:outline-2 focus-visible:outline-primary"
        aria-label="戳宠物展开面板"
      >
        <PetAvatar status={status} />
      </button>
      <Tooltip content={summary} side="top">
        <div className="flex items-center gap-2 tabular-nums">
          {refreshing && <Spinner className="h-3 w-3" />}
          <Tag color={running === 0 ? 'slate' : 'slate'}>{fmtCount(running)} 运行</Tag>
          <Tag color={done === 0 ? 'slate' : 'success'}>{fmtCount(done)} 完成</Tag>
          {stuck > 0 && <Tag color="warning">{fmtCount(stuck)} 待处理</Tag>}
          {status === 'offline' && <Tag color="error">离线</Tag>}
          {/* DND 静默收件箱计数 */}
          {suppressed > 0 && (
            <Tooltip content={`${suppressed} 条事件免打扰静默，点击查看`} side="top">
              <Tag color="slate">
                <Inbox className="mr-1 inline h-3 w-3" />
                {fmtCount(suppressed)} 静默
              </Tag>
            </Tooltip>
          )}
        </div>
      </Tooltip>
      {/* offline：重连 CTA（保留缓存状态） */}
      {status === 'offline' && (
        <Button variant="secondary" onClick={onReconnect}>
          <RefreshCw className="mr-1 h-4 w-4" /> 重连 Agent
        </Button>
      )}
      <TypographyMuted>戳我展开面板 · 有事我会轻拍你</TypographyMuted>
      <div className="flex items-center gap-2">
        <Switch checked={dnd} onCheckedChange={onDndChange} aria-label="免打扰" />
        <TypographyMuted>免打扰 · 仅「需拍板」轻拍，其余静默</TypographyMuted>
        <Button variant="ghost" onClick={onRefresh} aria-label="刷新状态">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={motion !== 'off'}
          onCheckedChange={(v) => { const p: MotionPref = v ? 'on' : 'off'; setMotion(p); setMotionPref(p) }}
          aria-label="动效开关"
        />
        <TypographyMuted>动效 · 可关可减弱（尊重系统减少动效）</TypographyMuted>
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
}: {
  event: PetEvent
  onOpen: (e: PetEvent) => void
  onDismiss: () => void
  error: boolean
  onRetry: () => void
}) {
  if (error) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-3 p-6">
        <EdgeAlert title="事件没拉取到" desc="网络好像不太通，重试或稍后再看。" onRetry={onRetry} />
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
      <h2 className="sr-only">事件轻拍</h2>
      <PetAvatar status={event.type === 'stuck' ? 'stuck' : 'done'} size={64} />
      <Bubble align="start">
        <BubbleContent variant={event.type === 'decision' ? 'received' : 'note'}>
          <div className="flex items-start gap-2">
            <span className="mt-0.5 text-text-secondary">{icon}</span>
            <div className="flex flex-col gap-2">
              <ClampText text={event.text} />
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => onOpen(event)}>
                  查看
                </Button>
                <Button variant="ghost" onClick={onDismiss} aria-label="忽略事件">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </BubbleContent>
      </Bubble>
      <TypographyMuted>{event.type === 'decision' ? '需你拍板 · 会保留到收件箱' : '忽略后淡出为圆点，不打断你'}</TypographyMuted>
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
  onCommand,
}: {
  projects: Project[]
  onOpenPanel: (projectId: string) => void
  onClose: () => void
  onCommand: (text: string) => void
}) {
  const [cmd, setCmd] = useState('')
  const [emptyDemo, setEmptyDemo] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [failNext, setFailNext] = useState(false)
  const list = emptyDemo ? [] : projects

  const send = (v: string) => {
    setSending(true)
    setSendError(false)
    setTimeout(() => {
      setSending(false)
      if (failNext) {
        setFailNext(false)
        setSendError(true)
      } else {
        onCommand(v)
        setCmd('')
      }
    }, 600)
  }

  if (list.length === 0) {
    return (
      <div className="w-full max-w-sm p-4">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>还没有项目</EmptyTitle>
            <EmptyDescription>连接 Agent 并创建第一个项目</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="primary" onClick={() => onOpenPanel('')}>
              连接 Agent
            </Button>
            <Button variant="ghost" onClick={() => setEmptyDemo(false)}>
              恢复示例
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-border-secondary bg-bg-container p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-text font-semibold">项目</h1>
        <div className="flex gap-1">
          <Button variant="ghost" onClick={() => setEmptyDemo(true)}>
            模拟无项目
          </Button>
          <Button variant="ghost" onClick={onClose} aria-label="收起面板">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <Separator />
      <div className="flex flex-col gap-2">
        {list.map((p) => (
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
      <Separator />
      {sendError && <EdgeAlert title="发送失败" desc="指令没送出去，重试不会丢失已填内容。" onRetry={() => send(cmd)} />}
      <ChatInput
        value={cmd}
        onChange={setCmd}
        onSend={send}
        placeholder="快速下指令…"
        maxRows={3}
        sendButtonStatus={sending ? 'generating' : 'normal'}
        disabled={sending}
      />
      <Button variant="ghost" onClick={() => setFailNext(true)}>
        模拟发送失败
      </Button>
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
  const [suppressed, setSuppressed] = useState(0)
  const [eventError, setEventError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const { projects, unhandledEvents, connState } = usePetData()
  const events = unhandledEvents()
  const [eventIdx, setEventIdx] = useState(0)
  const event = events[eventIdx % Math.max(events.length, 1)]

  // 真实联动：新未处理事件到来时，非 DND 自动轻拍展开，DND 下非「需拍板」计入静默收件箱。
  const seenEventsRef = useRef(events.length)
  useEffect(() => {
    const added = events.length - seenEventsRef.current
    if (added <= 0) { seenEventsRef.current = events.length; return }
    seenEventsRef.current = events.length
    const newest = events[0] // newest-first
    if (!newest) return
    if (dnd && newest.type !== 'decision') {
      setSuppressed((s) => s + added)
      track('pet', EVENT.notificationSuppressed)
    } else if (screen === 1) {
      setEventIdx(0)
      setEventError(false)
      setScreen(2)
    }
  }, [events.length, dnd, screen, events])

  // 真实离线覆盖预览状态：断连时宠物灰化 + 重连 CTA（edge offline-no-network 态）
  const effectiveStatus: AgentStatus = connState === 'offline' ? 'offline' : status

  const openPanel = (projectId: string, sessionId?: string) => onOpenPanel?.(projectId, sessionId)

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-tertiary bg-bg-layout p-2">
        <TypographyMuted>预览控制</TypographyMuted>
        <div className="flex flex-wrap gap-1" role="group" aria-label="宠物状态预览">
          {(Object.keys(STATUS_LABEL) as AgentStatus[]).map((s) => (
            <Button key={s} variant={status === s ? 'secondary' : 'ghost'} aria-pressed={status === s} onClick={() => setStatus(s)}>
              {STATUS_LABEL[s]}
            </Button>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            if (events.length === 0) return
            const next = events[(eventIdx + 1) % events.length]
            if (!next) return
            if (dnd && next.type !== 'decision') {
              setSuppressed((s) => s + 1)
              track('pet', EVENT.notificationSuppressed)
              return
            }
            setEventIdx((i) => i + 1)
            setEventError(false)
            setScreen(2)
          }}
        >
          <Bell className="mr-1 h-4 w-4" /> 模拟事件
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setEventError(true)
            setScreen(2)
          }}
        >
          模拟事件失败
        </Button>
      </div>

      {screen === 1 && (
        <Screen1_AmbientIdle
          status={effectiveStatus}
          onPoke={() => { track('pet', EVENT.petPoke); setScreen(3) }}
          onOffline={() => openPanel('p1')}
          onReconnect={() => onReconnect?.()}
          dnd={dnd}
          onDndChange={(v) => { setDnd(v); track('pet', EVENT.dndToggle, { on: v }) }}
          suppressed={suppressed}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true)
            setTimeout(() => setRefreshing(false), 600)
          }}
        />
      )}
      {screen === 2 && event && (event.type === 'decision' || !dnd) && (
        <Screen2_EventTap
          event={event}
          onOpen={(e) => openPanel(e.projectId, e.sessionId)}
          onDismiss={() => setScreen(1)}
          error={eventError}
          onRetry={() => setEventError(false)}
        />
      )}
      {screen === 3 && (
        <Screen3_PokeExpand
          projects={projects}
          onOpenPanel={(pid) => openPanel(pid)}
          onClose={() => setScreen(1)}
          onCommand={() => openPanel('p1')}
        />
      )}
    </div>
  )
}

export default Flow1_PetSurface