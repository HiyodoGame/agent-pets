// =============================================
// FLOW: Relay Handoff (4 screens + edge states) — 核心
// Edge 补全：error-validation / 截断 / loading-submit / error-rate-limit / offline暂存 / loading-stop / error-server
// =============================================
import { useEffect, useState, Suspense } from 'react'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  FileCard,
  ChatInput,
  Textarea,
  Tag,
  Button,
  PromptSuggestions,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Separator,
  TypographyMuted,
  Toaster,
  toast,
} from 'sparkdesign'
import { ArrowRightLeft, Copy, Check, Package, StopCircle, WifiOff } from 'lucide-react'
import type { Agent, RelayDraft, Session } from '../shared/types'
import { usePetData, deriveTracking, handoffPackageText, type TrackingStatus } from '../../adapters'
import { track, EVENT } from '../../telemetry'
import { mockSessions, mockRelayDrafts } from '../shared/mock-data'
import { EdgeAlert, Stepper } from '../shared/edge-kit'
import { LazyResponse } from '../shared/lazy-response'
import { fieldErrorState } from '../shared/ui-logic'
import { buildRelayDraft, resolveTarget, canSend, sendStateFromDecision, type RelaySendState } from './relay-draft'

const DEFAULT_SOURCE = mockSessions.find((s) => s.id === 's1')!
const CAP_LABEL: Record<Agent['capability'], string> = {
  full: '观察+接力',
  'observe-only': '仅观察',
  manual: '手动',
}

type SendState = RelaySendState

interface Attempt {
  sessionId: string
  startedAt: number
  response: string
  mode: 'inject' | 'clipboard'
  package?: string
}

/* SCREEN 1 of 4: Trigger Relay */
function Screen1_Trigger({ source, onOpen }: { source: Session; onOpen: () => void }) {
  const { getAgent, getArtifact } = usePetData()
  const agent = getAgent(source.agentId)
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>{source.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Tag color="success">已完成</Tag>
            <TypographyMuted>{agent?.name}</TypographyMuted>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {source.artifactIds.length === 0 ? (
              <TypographyMuted>无产物</TypographyMuted>
            ) : (
              source.artifactIds.map((aid) => (
                <FileCard key={aid} filename={getArtifact(aid)?.name ?? aid} size={getArtifact(aid)?.size} variant="attachment" />
              ))
            )}
          </div>
        </CardContent>
      </Card>
      <PromptSuggestions items={[{ text: '把素材交给 Qoder 部署', prompt: 'relay' }]} onSelect={() => onOpen()} />
      <Button variant="primary" onClick={onOpen}>
        <ArrowRightLeft className="mr-1 h-4 w-4" /> 接力
      </Button>
    </div>
  )
}

/* SCREEN 2 of 4: Handoff Preview（+ validation + loading-submit + 截断） */
function Screen2_Preview({
  open,
  onOpenChange,
  draft,
  setDraft,
  onSend,
  canSubmit,
  target,
  live,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  draft: RelayDraft
  setDraft: (d: RelayDraft) => void
  onSend: () => void
  canSubmit: boolean
  target: Agent | null
  live: boolean
}) {
  const { getArtifact, agents } = usePetData()
  const [sending, setSending] = useState(false)
  // 交互后校验：错误仅在 blur 或 submit 尝试后出现，避免一开抽屉就报错。
  const [instructionTouched, setInstructionTouched] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const instructionError = fieldErrorState({
    value: draft.instruction,
    touched: instructionTouched,
    submitted: submitAttempted,
    errorId: 'relay-instruction-error',
  })
  const confirm = () => {
    if (!canSubmit) {
      setSubmitAttempted(true)
      return
    }
    track('relay', EVENT.relayPreviewConfirmed, { to: draft.targetAgentId, live })
    setSending(true)
    setTimeout(() => {
      setSending(false)
      onSend()
    }, 600)
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent side="right" className="w-full sm:max-w-md">
        <DrawerHeader>
          <DrawerTitle>交接预览</DrawerTitle>
          <DrawerDescription>宠物已打包上下文 + 产物 + 指令，确认即发送给下一个 Agent</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-auto px-4">
          <div className="flex flex-col gap-1">
            <TypographyMuted>上下文摘要（可编辑）</TypographyMuted>
            <Textarea value={draft.contextSummary} onChange={(e) => setDraft({ ...draft, contextSummary: e.target.value })} rows={3} />
          </div>
          <div className="flex flex-col gap-1">
            <TypographyMuted>产物（可移除）</TypographyMuted>
            {draft.artifactIds.length === 0 ? (
              <TypographyMuted>无产物</TypographyMuted>
            ) : (
              <div className="flex flex-wrap gap-2">
                {draft.artifactIds.map((aid) => (
                  <FileCard
                    key={aid}
                    filename={getArtifact(aid)?.name ?? aid}
                    size={getArtifact(aid)?.size}
                    variant="attachment"
                    onRemove={() => setDraft({ ...draft, artifactIds: draft.artifactIds.filter((x) => x !== aid) })}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <TypographyMuted>指令草稿（可编辑）</TypographyMuted>
            <ChatInput
              value={draft.instruction}
              onChange={(v) => setDraft({ ...draft, instruction: v })}
              placeholder="下一步要做什么…"
              maxRows={4}
              onBlur={() => setInstructionTouched(true)}
              aria-invalid={instructionError.ariaInvalid}
              aria-describedby={instructionError.describedBy ?? undefined}
            />
            {/* error-validation：inline 字段提示，仅在 blur/submit 后出现 */}
            {instructionError.showError && (
              <span id="relay-instruction-error" role="alert" className="text-error text-sm">请填写下一步指令</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <TypographyMuted>目标 Agent</TypographyMuted>
            <Select value={draft.targetAgentId} onValueChange={(v) => setDraft({ ...draft, targetAgentId: v })}>
              <SelectTrigger>
                <SelectValue placeholder="选择目标 Agent" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {CAP_LABEL[a.capability]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {target && <Tag color={target.capability === 'full' ? 'success' : target.capability === 'observe-only' ? 'info' : 'slate'}>{CAP_LABEL[target.capability]}</Tag>}
            {!target && draft.targetAgentId ? <span className="text-error text-sm">目标不存在，请重新选择</span> : null}
          </div>
        </div>
        <DrawerFooter>
          <Button variant="primary" disabled={!canSubmit} loading={sending} onClick={confirm}>
            确认发送
          </Button>
          <DrawerClose asChild>
            <Button variant="ghost">取消（草稿保存）</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

/* SCREEN 3 of 4: Send & Track — 真实态：注入中 / 已注入追踪 / 手动交接 / 失败 / 待确认 */
function Screen3_Tracking({
  source,
  target,
  isLive,
  sendState,
  liveStatus,
  stale,
  sessionId,
  packageText,
  onRetry,
  onCopy,
  onDone,
  onSimFail,
  onStop,
}: {
  source: Session
  target: Agent
  isLive: boolean
  sendState: SendState
  liveStatus: TrackingStatus
  stale: boolean
  /** inject 回传的会话 ID；空串 = 从一开始就无法自动确认。 */
  sessionId: string
  packageText: string
  onRetry: () => void
  onCopy: () => void
  onDone: () => void
  onSimFail: () => void
  onStop: () => void
}) {
  const [rateLimit, setRateLimit] = useState<number | null>(null)
  const [offline, setOffline] = useState(false)
  // Derived (not state): an injected live attempt whose completion can't be correlated —
  // either tracking already proved it, or the CLI never returned a sessionID (unconfirmable
  // from the start, never presented as auto-completable).
  const unconfirmed = isLive && sendState === 'injected' && (liveStatus === 'unconfirmed' || sessionId === '')

  // live 注入后由 attempt 归属的 SSE 事件驱动：done 才自动进入完成屏；无法关联 => 待确认，不谎报完成。
  useEffect(() => {
    if (!isLive || sendState !== 'injected' || unconfirmed) return
    if (liveStatus === 'done') onDone()
  }, [isLive, sendState, liveStatus, onDone, unconfirmed])

  // demo：模拟成功推进（演示专用，非实时）。
  useEffect(() => {
    if (isLive || sendState !== 'injected' || rateLimit !== null || offline) return
    const t = setTimeout(onDone, 1200)
    return () => clearTimeout(t)
  }, [isLive, sendState, rateLimit, offline, onDone])

  useEffect(() => {
    if (rateLimit === null || rateLimit <= 0) return
    const t = setTimeout(() => setRateLimit((r) => (r === null ? null : r - 1)), 1000)
    return () => clearTimeout(t)
  }, [rateLimit])

  const streaming =
    sendState !== 'failed' && sendState !== 'manual' && !unconfirmed && !offline && rateLimit === null &&
    !(isLive && sendState === 'injected' && liveStatus === 'stuck')

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <EdgeAlert variant="info" title={`已接力给 ${target.name}`} desc={`源会话「${source.title}」的上下文与产物已交接，等待目标响应。`} />
      {stale && <EdgeAlert variant="info" title="状态可能滞后" desc="目标 Agent 数据来自离线缓存，恢复连接后以实时状态为准。" />}

      {sendState === 'failed' ? (
        <EdgeAlert
          title={`注入失败：${target.name}`}
          desc="可重试（真正重新发送），或复制交接包手动粘贴到目标 Agent。"
          onRetry={onRetry}
          retryLabel="重试发送"
          extra={<Button variant="secondary" onClick={onCopy}><Copy className="mr-1 h-4 w-4" /> 复制交接包</Button>}
        />
      ) : sendState === 'manual' ? (
        <div className="flex flex-col gap-2">
          <EdgeAlert
            variant="warning"
            title="已生成交接包 · 目标仅观察/手动或 bridge 不可达"
            desc="复制下方完整交接包，粘贴到目标 Agent 即可（内容含上下文+指令+产物，不丢失）。"
            extra={<Button variant="secondary" onClick={onCopy}><Copy className="mr-1 h-4 w-4" /> 复制交接包</Button>}
          />
          <Textarea readOnly value={packageText} rows={8} aria-label="交接包内容" className="font-mono text-xs" />
          <Button variant="ghost" onClick={onRetry}>重试注入</Button>
        </div>
      ) : unconfirmed ? (
        <EdgeAlert
          variant="info"
          title="已发送 · 无法自动确认"
          desc="目标 CLI 未回传可关联的会话 ID，本次执行从开始即无法自动确认完成（不会谎报完成）。可稍后在面板查看，或复制交接包手动确认。"
          extra={<Button variant="secondary" onClick={onCopy}><Copy className="mr-1 h-4 w-4" /> 复制交接包</Button>}
          onRetry={onDone}
          retryLabel="标记完成"
        />
      ) : isLive && sendState === 'injected' && liveStatus === 'stuck' ? (
        <EdgeAlert
          variant="warning"
          title="目标执行中断"
          desc="SSE 收到 turn_aborted；可重试（真正重发），或复制交接包手动粘贴（能力分级降级）。"
          onRetry={onRetry}
          retryLabel="重试发送"
          extra={<Button variant="secondary" onClick={onCopy}><Copy className="mr-1 h-4 w-4" /> 复制交接包</Button>}
        />
      ) : rateLimit !== null && rateLimit > 0 ? (
        <EdgeAlert variant="warning" title="目标限流" desc={`${rateLimit}s 后自动重试。`} />
      ) : offline ? (
        <EdgeAlert variant="warning" title="离线 · 交接包已暂存" desc="网络中断，交接包已本地暂存不会丢；恢复后重试。" onRetry={() => setOffline(false)} retryLabel="恢复重试" />
      ) : streaming ? (
        <Suspense fallback={<span className="text-text-secondary text-sm">状态渲染中…</span>}>
          <LazyResponse
            phase="streaming"
            finalMarkdown={
              sendState === 'pending'
                ? `正在注入交接包到 ${target.name}…`
                : isLive && liveStatus === 'running'
                  ? `${target.name} 正在执行指令…（SSE 实时）`
                  : !isLive
                    ? `正在处理交接包：读取上下文 → 载入 ${target.name} → 执行指令…`
                    : `${target.name} 已接收，等待 SSE 反馈…`
            }
            thinkingIndicator={<span className="text-text-secondary text-sm">思考中…</span>}
          />
        </Suspense>
      ) : null}

      <Separator />
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onStop}><StopCircle className="mr-1 h-4 w-4" /> 停止</Button>
        {/* 演示模拟控制仅用于非实时模式，避免在真实链路伪造状态 */}
        {!isLive && <Button variant="ghost" onClick={onSimFail}>模拟注入失败</Button>}
        {!isLive && <Button variant="ghost" onClick={() => setOffline(true)}><WifiOff className="mr-1 h-4 w-4" />模拟断网</Button>}
        {!isLive && rateLimit === null && <Button variant="ghost" onClick={() => setRateLimit(5)}>模拟限流</Button>}
      </div>
    </div>
  )
}

/* SCREEN 4 of 4: Complete + Loop — live 只展示真实回执/产物 */
function Screen4_Complete({
  target,
  isLive,
  receipt,
  artifactNames,
  onNext,
  onExit,
}: {
  target: Agent
  isLive: boolean
  receipt: string
  artifactNames: string[]
  onNext: () => void
  onExit: () => void
}) {
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="flex items-center gap-2 text-success">
        <Check className="h-5 w-5" />
        <span className="text-text font-semibold">接力完成 · {target.name} 已执行</span>
      </div>
      <Suspense fallback={<span className="text-text-secondary text-sm">回执渲染中…</span>}>
        <LazyResponse
          phase="done"
          finalMarkdown={isLive ? receipt || `${target.name} 已完成本次指令。` : '已接收交接包并完成部署：素材包上传、资源引用更新完毕。'}
          thinkingIndicator={<span className="text-text-secondary text-sm">思考中…</span>}
        />
      </Suspense>
      <Card>
        <CardHeader>
          <CardTitle><Package className="mr-1 inline h-4 w-4" /> 产物</CardTitle>
        </CardHeader>
        <CardContent>
          {artifactNames.length === 0 ? (
            <TypographyMuted>无产物</TypographyMuted>
          ) : (
            <div className="flex flex-wrap gap-2">
              {artifactNames.map((n) => (<FileCard key={n} filename={n} variant="attachment" />))}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Button variant="primary" onClick={onNext}><ArrowRightLeft className="mr-1 h-4 w-4" /> 继续接力</Button>
        <Button variant="secondary" onClick={onExit}>结束</Button>
      </div>
    </div>
  )
}

export function Flow4_Relay({ sourceSession, onExit }: { sourceSession?: Session; onExit?: () => void }) {
  const { getArtifact, agents, inject, agentEvents, mode, sessions } = usePetData()
  const isLive = mode === 'live'
  const [source, setSource] = useState<Session | null>(sourceSession ?? (isLive ? null : DEFAULT_SOURCE))
  const [screen, setScreen] = useState<1 | 2 | 3 | 4>(1)
  const [draft, setDraft] = useState<RelayDraft | null>(() =>
    isLive ? buildRelayDraft(sourceSession ?? null, agents) : { ...mockRelayDrafts[0] },
  )
  const [sendState, setSendState] = useState<SendState>('pending')
  const [attempt, setAttempt] = useState<Attempt | null>(null)

  // live 且未从面板带入真实源会话 => 无法接力，给出去面板的选择提示（不回退 mock）。
  if (isLive && !source) {
    return (
      <div className="flex w-full max-w-md flex-col items-center gap-4 p-8">
        <h1 className="text-text text-lg font-semibold">接力交接</h1>
        <EdgeAlert variant="info" title="请先选择源会话" desc="从面板打开一个已完成会话，点「接力」即可自动打包上下文与产物。" />
        <Button variant="primary" onClick={() => onExit?.()}>去面板选择</Button>
      </div>
    )
  }

  const target: Agent | null = draft
    ? isLive
      ? resolveTarget(draft, agents)
      : agents.find((a) => a.id === draft.targetAgentId) ?? agents[1] ?? null
    : null
  const scope = attempt ? { sessionId: attempt.sessionId, startedAt: attempt.startedAt } : {}
  const liveStatus = deriveTracking(agentEvents, draft?.targetAgentId ?? '', scope)
  const targetStale = sessions.some((s) => s.agentId === draft?.targetAgentId && s.stale)
  const sendable = draft ? (isLive ? canSend(draft, target, source) : Boolean(target) && draft.instruction.trim().length > 0) : false

  const artifactNames = draft ? draft.artifactIds.map((a) => getArtifact(a)?.name ?? a) : []

  const packageText =
    attempt?.package ??
    (draft && source
      ? handoffPackageText({ from: source.agentId, context: draft.contextSummary, instruction: draft.instruction, artifacts: artifactNames })
      : '')

  const copyPackage = () => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(packageText).then(
        () => toast('交接包已复制到剪贴板'),
        () => toast('复制失败，请手动选择文本'),
      )
    } else {
      toast('当前环境不支持剪贴板，请手动复制')
    }
  }

  const send = () => {
    if (!draft || !source) return
    setScreen(3)
    setAttempt(null)
    setSendState('pending')
    const startedAt = Date.now()
    if (!isLive) {
      track('relay', EVENT.relayInjectResult, { mode: 'inject', ok: true, to: draft.targetAgentId, live: false })
      setAttempt({ sessionId: 'demo', startedAt, response: '', mode: 'inject' })
      setSendState('injected')
      return
    }
    inject({ from: source.agentId, to: draft.targetAgentId, context: draft.contextSummary, instruction: draft.instruction, artifacts: artifactNames })
      .then((d) => {
        const state = sendStateFromDecision(d.mode)
        track('relay', EVENT.relayInjectResult, {
          mode: d.mode,
          ok: state === 'injected',
          to: draft.targetAgentId,
          live: true,
          ...(d.fallbackReason ? { fallbackReason: d.fallbackReason } : {}),
        })
        if (state !== 'failed') {
          setAttempt({ sessionId: d.sessionID ?? '', startedAt, response: d.response ?? '', mode: d.mode, package: d.package })
        }
        setSendState(state)
      })
      .catch(() => {
        track('relay', EVENT.relayInjectResult, { ok: false, reason: 'bridge-error', to: draft.targetAgentId, live: true })
        setSendState('failed')
      })
  }

  const nextHop = () => {
    // 继续接力：live 下回面板重选新源会话（不伪造下一跳数据）。
    if (isLive) { onExit?.(); return }
    const newSource = mockSessions.find((s) => s.id === 's2') ?? source
    setSource(newSource ?? null)
    setDraft({ ...mockRelayDrafts[0], sourceSessionId: newSource?.id ?? '' })
    setSendState('pending')
    setAttempt(null)
    setScreen(1)
  }

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <Toaster />
      <h1 className="text-text text-lg font-semibold">接力交接</h1>
      <Stepper steps={['发起', '预览', '追踪', '完成']} current={screen - 1} />
      {screen === 1 && source && <Screen1_Trigger source={source} onOpen={() => { track('relay', EVENT.relayStarted, { from: source.agentId, live: isLive }); setScreen(2) }} />}
      {draft && (
        <Screen2_Preview
          open={screen === 2}
          onOpenChange={(o) => !o && setScreen(1)}
          draft={draft}
          setDraft={setDraft}
          canSubmit={sendable}
          target={target}
          live={isLive}
          onSend={send}
        />
      )}
      {screen === 3 && source && target && (
        <Screen3_Tracking
          source={source}
          target={target}
          isLive={isLive}
          sendState={sendState}
          liveStatus={liveStatus}
          stale={targetStale}
          sessionId={attempt?.sessionId ?? ''}
          packageText={packageText}
          onRetry={send}
          onCopy={copyPackage}
          onDone={() => { track('relay', EVENT.relayDone, { to: draft?.targetAgentId, live: isLive }); setScreen(4) }}
          onSimFail={() => setSendState('failed')}
          onStop={() => { track('relay', EVENT.relayStopped, { live: isLive }); setScreen(2) }}
        />
      )}
      {screen === 4 && target && (
        <Screen4_Complete target={target} isLive={isLive} receipt={attempt?.response ?? ''} artifactNames={artifactNames} onNext={nextHop} onExit={() => onExit?.()} />
      )}
    </div>
  )
}

export default Flow4_Relay