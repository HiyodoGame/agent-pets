// =============================================
// FLOW: Relay Handoff (4 screens + edge states) — 核心
// Edge 补全：error-validation / 截断 / loading-submit / error-rate-limit / 离线手动交接 / loading-stop / error-server
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
import { fieldErrorState, nextRateLimit, rateLimitPhase } from '../shared/ui-logic'
import { buildRelayDraft, resolveTarget, canSend, sendStateFromDecision, type RelaySendState } from './relay-draft'
import { t } from '../../i18n/index.ts'
import type { MessageKey } from '../../i18n/messages.ts'

const DEFAULT_SOURCE = mockSessions.find((s) => s.id === 's1')!
const CAP_LABEL: Record<Agent['capability'], MessageKey> = {
  full: 'capability.full',
  'observe-only': 'capability.observe',
  manual: 'capability.manual',
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
            <Tag color="success">{t('relay.done')}</Tag>
            <TypographyMuted>{agent?.name}</TypographyMuted>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {source.artifactIds.length === 0 ? (
              <TypographyMuted>{t('common.noArtifacts')}</TypographyMuted>
            ) : (
              source.artifactIds.map((aid) => (
                <FileCard key={aid} filename={getArtifact(aid)?.name ?? aid} size={getArtifact(aid)?.size} variant="attachment" />
              ))
            )}
          </div>
        </CardContent>
      </Card>
      <PromptSuggestions items={[{ text: t('relay.suggestion'), prompt: 'relay' }]} onSelect={() => onOpen()} />
      <Button variant="primary" onClick={onOpen}>
        <ArrowRightLeft className="mr-1 h-4 w-4" /> {t('relay.relay')}
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
          <DrawerTitle>{t('relay.previewTitle')}</DrawerTitle>
          <DrawerDescription>{t('relay.previewDesc')}</DrawerDescription>
        </DrawerHeader>
        <div className="flex flex-1 flex-col gap-3 overflow-auto px-4">
          <div className="flex flex-col gap-1">
            <TypographyMuted>{t('relay.context')}</TypographyMuted>
            <Textarea value={draft.contextSummary} onChange={(e) => setDraft({ ...draft, contextSummary: e.target.value })} rows={3} />
          </div>
          <div className="flex flex-col gap-1">
            <TypographyMuted>{t('relay.artifacts')}</TypographyMuted>
            {draft.artifactIds.length === 0 ? (
              <TypographyMuted>{t('common.noArtifacts')}</TypographyMuted>
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
            <TypographyMuted>{t('relay.instruction')}</TypographyMuted>
            <ChatInput
              value={draft.instruction}
              onChange={(v) => setDraft({ ...draft, instruction: v })}
              placeholder={t('relay.instructionPlaceholder')}
              maxRows={4}
              onBlur={() => setInstructionTouched(true)}
              aria-invalid={instructionError.ariaInvalid}
              aria-describedby={instructionError.describedBy ?? undefined}
            />
            {/* error-validation：inline 字段提示，仅在 blur/submit 后出现 */}
            {instructionError.showError && (
              <span id="relay-instruction-error" role="alert" className="text-error text-sm">{t('relay.instructionRequired')}</span>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <TypographyMuted>{t('relay.target')}</TypographyMuted>
            <Select value={draft.targetAgentId} onValueChange={(v) => setDraft({ ...draft, targetAgentId: v })}>
              <SelectTrigger>
                <SelectValue placeholder={t('relay.selectTarget')} />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {t(CAP_LABEL[a.capability])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {target && <Tag color={target.capability === 'full' ? 'success' : target.capability === 'observe-only' ? 'info' : 'slate'}>{t(CAP_LABEL[target.capability])}</Tag>}
            {!target && draft.targetAgentId ? <span className="text-error text-sm">{t('relay.targetMissing')}</span> : null}
          </div>
        </div>
        <DrawerFooter>
          <Button variant="primary" disabled={!canSubmit} loading={sending} onClick={confirm}>
            {t('relay.confirm')}
          </Button>
          <DrawerClose asChild>
            <Button variant="ghost">{t('relay.cancelSave')}</Button>
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
  const limitPhase = rateLimitPhase(rateLimit)
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
    const t = setTimeout(() => setRateLimit(nextRateLimit), 1000)
    return () => clearTimeout(t)
  }, [rateLimit])

  const streaming =
    sendState !== 'failed' && sendState !== 'manual' && !unconfirmed && !offline && rateLimit === null &&
    !(isLive && sendState === 'injected' && liveStatus === 'stuck')

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <EdgeAlert variant="info" title={t('relay.relayedTo', { name: target.name })} desc={t('relay.relayedDesc', { title: source.title })} />
      {stale && <EdgeAlert variant="info" title={t('relay.staleTitle')} desc={t('relay.staleDesc')} />}

      {sendState === 'failed' ? (
        <EdgeAlert
          title={t('relay.failedTitle', { name: target.name })}
          desc={t('relay.failedDesc')}
          onRetry={onRetry}
          retryLabel={t('relay.retrySend')}
          extra={<Button variant="secondary" onClick={onCopy}><Copy className="mr-1 h-4 w-4" /> {t('relay.copyPackage')}</Button>}
        />
      ) : sendState === 'manual' ? (
        <div className="flex flex-col gap-2">
          <EdgeAlert
            variant="warning"
            title={t('relay.manualTitle')}
            desc={t('relay.manualDesc')}
            extra={<Button variant="secondary" onClick={onCopy}><Copy className="mr-1 h-4 w-4" /> {t('relay.copyPackage')}</Button>}
          />
          <Textarea readOnly value={packageText} rows={8} aria-label={t('relay.packageAria')} className="font-mono text-xs" />
          <Button variant="ghost" onClick={onRetry}>{t('relay.retryInject')}</Button>
        </div>
      ) : unconfirmed ? (
        <EdgeAlert
          variant="info"
          title={t('relay.unconfirmedTitle')}
          desc={t('relay.unconfirmedDesc')}
          extra={<Button variant="secondary" onClick={onCopy}><Copy className="mr-1 h-4 w-4" /> {t('relay.copyPackage')}</Button>}
          onRetry={onDone}
          retryLabel={t('relay.markDone')}
        />
      ) : isLive && sendState === 'injected' && liveStatus === 'stuck' ? (
        <EdgeAlert
          variant="warning"
          title={t('relay.interruptedTitle')}
          desc={t('relay.interruptedDesc')}
          onRetry={onRetry}
          retryLabel={t('relay.retrySend')}
          extra={<Button variant="secondary" onClick={onCopy}><Copy className="mr-1 h-4 w-4" /> {t('relay.copyPackage')}</Button>}
        />
      ) : limitPhase !== null ? (
        <EdgeAlert
          variant="warning"
          title={t(limitPhase === 'ready' ? 'relay.rateLimitReadyTitle' : 'relay.rateLimitTitle')}
          desc={limitPhase === 'ready' ? t('relay.rateLimitReadyDesc') : t('relay.rateLimitDesc', { seconds: rateLimit ?? 0 })}
          onRetry={limitPhase === 'ready' ? () => { setRateLimit(null); onRetry() } : undefined}
          retryLabel={t('relay.retrySend')}
        />
      ) : offline ? (
        <EdgeAlert variant="warning" title={t('relay.offlineTitle')} desc={t('relay.offlineDesc')} onRetry={() => setOffline(false)} retryLabel={t('relay.recoverRetry')} />
      ) : streaming ? (
        <Suspense fallback={<span className="text-text-secondary text-sm">{t('relay.statusRendering')}</span>}>
          <LazyResponse
            phase="streaming"
            finalMarkdown={
              sendState === 'pending'
                ? t('relay.injecting', { name: target.name })
                : isLive && liveStatus === 'running'
                  ? t('relay.executing', { name: target.name })
                  : !isLive
                    ? t('relay.processing', { name: target.name })
                    : t('relay.received', { name: target.name })
            }
            thinkingIndicator={<span className="text-text-secondary text-sm">{t('common.thinking')}</span>}
          />
        </Suspense>
      ) : null}

      <Separator />
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onStop}><StopCircle className="mr-1 h-4 w-4" /> {t('relay.stop')}</Button>
        {/* 演示模拟控制仅用于非实时模式，避免在真实链路伪造状态 */}
        {!isLive && <Button variant="ghost" onClick={onSimFail}>{t('relay.simFail')}</Button>}
        {!isLive && <Button variant="ghost" onClick={() => setOffline(true)}><WifiOff className="mr-1 h-4 w-4" />{t('relay.simOffline')}</Button>}
        {!isLive && rateLimit === null && <Button variant="ghost" onClick={() => setRateLimit(5)}>{t('relay.simRateLimit')}</Button>}
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
        <span className="text-text font-semibold">{t('relay.complete', { name: target.name })}</span>
      </div>
      <Suspense fallback={<span className="text-text-secondary text-sm">{t('relay.receiptRendering')}</span>}>
        <LazyResponse
          phase="done"
          finalMarkdown={isLive ? receipt || t('relay.receiptFallback', { name: target.name }) : t('relay.demoReceipt')}
          thinkingIndicator={<span className="text-text-secondary text-sm">{t('common.thinking')}</span>}
        />
      </Suspense>
      <Card>
        <CardHeader>
          <CardTitle><Package className="mr-1 inline h-4 w-4" /> {t('relay.artifactsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {artifactNames.length === 0 ? (
            <TypographyMuted>{t('common.noArtifacts')}</TypographyMuted>
          ) : (
            <div className="flex flex-wrap gap-2">
              {artifactNames.map((n) => (<FileCard key={n} filename={n} variant="attachment" />))}
            </div>
          )}
        </CardContent>
      </Card>
      <div className="flex gap-2">
        <Button variant="primary" onClick={onNext}><ArrowRightLeft className="mr-1 h-4 w-4" /> {t('relay.continue')}</Button>
        <Button variant="secondary" onClick={onExit}>{t('relay.exit')}</Button>
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
        <h1 className="text-text text-lg font-semibold">{t('relay.title')}</h1>
        <EdgeAlert variant="info" title={t('relay.noSource')} desc={t('relay.noSourceDesc')} />
        <Button variant="primary" onClick={() => onExit?.()}>{t('relay.goToPanel')}</Button>
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
        () => toast(t('relay.copied')),
        () => toast(t('relay.copyFailed')),
      )
    } else {
      toast(t('relay.copyUnsupported'))
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
      <h1 className="text-text text-lg font-semibold">{t('relay.title')}</h1>
      <Stepper steps={[t('relay.stepStart'), t('relay.stepPreview'), t('relay.stepTrack'), t('relay.stepDone')]} current={screen - 1} />
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