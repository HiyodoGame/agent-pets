// =============================================
// FLOW: Relay Handoff (4 screens + edge states) — 核心
// Edge 补全：error-validation / 截断 / loading-submit / error-rate-limit / offline暂存 / loading-stop / error-server
// =============================================
import { useEffect, useState } from 'react'
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
  Response,
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
import { usePetData, deriveTracking, type TrackingStatus } from '../../adapters'
import { track, EVENT } from '../../telemetry'
import { mockSessions, mockRelayDrafts } from '../shared/mock-data'
import { EdgeAlert, Stepper } from '../shared/edge-kit'

const DEFAULT_SOURCE = mockSessions.find((s) => s.id === 's1')!
const CAP_LABEL: Record<Agent['capability'], string> = {
  full: '观察+接力',
  'observe-only': '仅观察',
  manual: '手动',
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
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  draft: RelayDraft
  setDraft: (d: RelayDraft) => void
  onSend: () => void
}) {
  const { getAgent, getArtifact, agents: mockAgents } = usePetData()
  const target = getAgent(draft.targetAgentId)
  const [sending, setSending] = useState(false)
  const invalid = draft.instruction.trim().length === 0
  const confirm = () => {
    if (invalid) return
    track('relay', EVENT.relayPreviewConfirmed, { to: draft.targetAgentId })
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
            <ChatInput value={draft.instruction} onChange={(v) => setDraft({ ...draft, instruction: v })} placeholder="下一步要做什么…" maxRows={4} />
            {/* error-validation：inline 字段提示 */}
            {invalid && <span className="text-error text-sm">请填写下一步指令</span>}
          </div>
          <div className="flex flex-col gap-1">
            <TypographyMuted>目标 Agent</TypographyMuted>
            <Select value={draft.targetAgentId} onValueChange={(v) => setDraft({ ...draft, targetAgentId: v })}>
              <SelectTrigger>
                <SelectValue placeholder="选择目标 Agent" />
              </SelectTrigger>
              <SelectContent>
                {mockAgents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} · {CAP_LABEL[a.capability]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {target && <Tag color={target.capability === 'full' ? 'success' : target.capability === 'observe-only' ? 'info' : 'slate'}>{CAP_LABEL[target.capability]}</Tag>}
          </div>
        </div>
        <DrawerFooter>
          <Button variant="primary" disabled={invalid || sending} loading={sending} onClick={confirm}>
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

/* SCREEN 3 of 4: Send & Track（+ rate-limit + offline暂存 + stop） */
function Screen3_Tracking({
  source,
  target,
  error,
  isLive,
  liveStatus,
  onRetry,
  onCopy,
  onDone,
  onSimFail,
  onStop,
}: {
  source: Session
  target: Agent
  error: boolean
  isLive: boolean
  liveStatus: TrackingStatus
  onRetry: () => void
  onCopy: () => void
  onDone: () => void
  onSimFail: () => void
  onStop: () => void
}) {
  const [rateLimit, setRateLimit] = useState<number | null>(null)
  const [offline, setOffline] = useState(false)
  useEffect(() => {
    if (error || offline || rateLimit !== null) return
    if (isLive) {
      // live：由 SSE 派生的 liveStatus 驱动，done 才进入完成屏
      if (liveStatus === 'done') onDone()
      return
    }
    const t = setTimeout(onDone, 1200)
    return () => clearTimeout(t)
  }, [error, offline, rateLimit, onDone, isLive, liveStatus])
  useEffect(() => {
    if (rateLimit === null || rateLimit <= 0) return
    const t = setTimeout(() => setRateLimit((r) => (r === null ? null : r - 1)), 1000)
    return () => clearTimeout(t)
  }, [rateLimit])

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <EdgeAlert variant="info" title={`已接力给 ${target.name}`} desc={`源会话「${source.title}」的上下文与产物已交接，等待目标响应。`} />
      {offline && (
        <EdgeAlert
          variant="warning"
          title="离线 · 交接包已暂存"
          desc="网络中断，交接包已本地暂存不会丢；恢复后重试。"
          onRetry={() => setOffline(false)}
          retryLabel="恢复重试"
        />
      )}
      {rateLimit !== null && rateLimit > 0 && <EdgeAlert variant="warning" title="目标限流" desc={`${rateLimit}s 后自动重试。`} />}
      {isLive && liveStatus === 'stuck' && (
        <EdgeAlert
          variant="warning"
          title="目标执行中断"
          desc="SSE 收到 turn_aborted；可重试，或复制交接包手动粘贴（能力分级降级）。"
          onRetry={onRetry}
          extra={<Button variant="secondary" onClick={onCopy}><Copy className="mr-1 h-4 w-4" /> 复制交接包</Button>}
        />
      )}
      {error ? (
        <EdgeAlert
          title={`注入失败：${target.name} 无可用注入接口`}
          desc="可重试，或复制交接包手动粘贴到目标 Agent（能力分级降级）。"
          onRetry={onRetry}
          extra={
            <Button variant="secondary" onClick={onCopy}>
              <Copy className="mr-1 h-4 w-4" /> 复制交接包
            </Button>
          }
        />
      ) : (
        !offline &&
        rateLimit === null &&
        !(isLive && liveStatus === 'stuck') && (
          <Response
            phase="streaming"
            finalMarkdown={
              isLive
                ? liveStatus === 'running'
                  ? `${target.name} 正在执行指令…（SSE 实时）`
                  : liveStatus === 'done'
                    ? `${target.name} 已完成，正在拉取回执…`
                    : `正在注入交接包到 ${target.name}…`
                : `正在处理交接包：读取上下文 → 载入 ${target.name} → 执行指令…`
            }
            thinkingIndicator={<span className="text-text-secondary text-sm">思考中…</span>}
          />
        )
      )}
      <Separator />
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={onStop}>
          <StopCircle className="mr-1 h-4 w-4" /> 停止
        </Button>
        {!error && !offline && <Button variant="ghost" onClick={onSimFail}>模拟注入失败</Button>}
        {!offline && <Button variant="ghost" onClick={() => setOffline(true)}><WifiOff className="mr-1 h-4 w-4" />模拟断网</Button>}
        {rateLimit === null && <Button variant="ghost" onClick={() => setRateLimit(5)}>模拟限流</Button>}
      </div>
    </div>
  )
}

/* SCREEN 4 of 4: Complete + Loop（+ error-server） */
function Screen4_Complete({ target, onNext, onExit }: { target: Agent; onNext: () => void; onExit: () => void }) {
  const [receiptError, setReceiptError] = useState(false)
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="flex items-center gap-2 text-success">
        <Check className="h-5 w-5" />
        <span className="text-text font-semibold">接力完成 · {target.name} 已执行</span>
      </div>
      <Response
        phase="done"
        finalMarkdown="已接收交接包并完成部署：素材包上传、资源引用更新完毕。"
        thinkingIndicator={<span className="text-text-secondary text-sm">思考中…</span>}
      />
      {receiptError && <EdgeAlert title="回执拉取失败" desc="部署回执没拉下来，重试。" onRetry={() => setReceiptError(false)} />}
      <Card>
        <CardHeader>
          <CardTitle>
            <Package className="mr-1 inline h-4 w-4" /> 产物
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <FileCard filename="部署回执.log" size="2 KB" variant="attachment" />
          </div>
        </CardContent>
      </Card>
      <PromptSuggestions items={[{ text: '把部署结果交给 kimi work 写宣传', prompt: 'next' }]} onSelect={() => onNext()} />
      <div className="flex gap-2">
        <Button variant="primary" onClick={onNext}>
          <ArrowRightLeft className="mr-1 h-4 w-4" /> 继续接力
        </Button>
        <Button variant="secondary" onClick={onExit}>
          结束
        </Button>
        <Button variant="ghost" onClick={() => setReceiptError(true)}>
          模拟回执失败
        </Button>
      </div>
    </div>
  )
}

export function Flow4_Relay({ sourceSession, onExit }: { sourceSession?: Session; onExit?: () => void }) {
  const { getAgent, getArtifact, agents: mockAgents, inject, agentEvents, mode } = usePetData()
  const [source, setSource] = useState<Session>(sourceSession ?? DEFAULT_SOURCE)
  const [screen, setScreen] = useState<1 | 2 | 3 | 4>(1)
  const [error, setError] = useState(false)
  const [draft, setDraft] = useState<RelayDraft>(() => ({ ...mockRelayDrafts[0] }))
  const target = getAgent(draft.targetAgentId) ?? mockAgents[1]
  const liveStatus = deriveTracking(agentEvents, draft.targetAgentId)

  const copyPackage = () => {
    const text = `${draft.contextSummary}\n\n指令：${draft.instruction}\n\n产物：${draft.artifactIds.map((a) => getArtifact(a)?.name ?? a).join('、')}`
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast('交接包已复制到剪贴板'),
        () => toast('复制失败，请手动选择文本'),
      )
    } else {
      toast('当前环境不支持剪贴板，请手动复制')
    }
  }
  const nextHop = () => {
    const newSource = mockSessions.find((s) => s.id === 's2') ?? source
    setSource(newSource)
    setDraft({ ...mockRelayDrafts[0], sourceSessionId: newSource.id })
    setError(false)
    setScreen(1)
  }

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <Toaster />
      <h1 className="text-text text-lg font-semibold">接力交接</h1>
      <Stepper steps={['发起', '预览', '追踪', '完成']} current={screen - 1} />
      {screen === 1 && <Screen1_Trigger source={source} onOpen={() => { track('relay', EVENT.relayStarted, { from: source.agentId }); setScreen(2) }} />}
      <Screen2_Preview
        open={screen === 2}
        onOpenChange={(o) => !o && setScreen(1)}
        draft={draft}
        setDraft={setDraft}
        onSend={() => {
          setError(false)
          setScreen(3)
          inject({ from: source.agentId, to: draft.targetAgentId, context: draft.contextSummary, instruction: draft.instruction }).then((d) => {
            track('relay', EVENT.relayInjectResult, { mode: d.mode, ok: d.mode === 'inject', to: draft.targetAgentId })
            toast(d.mode === 'inject' ? '已接力注入目标 Agent' : '目标仅观察/手动，已生成交接包（剪贴板）')
          })
        }}
      />
      {screen === 3 && (
        <Screen3_Tracking
          source={source}
          target={target}
          error={error}
          isLive={mode === 'live'}
          liveStatus={liveStatus}
          onRetry={() => setError(false)}
          onCopy={copyPackage}
          onDone={() => { track('relay', EVENT.relayDone, { to: draft.targetAgentId }); setScreen(4) }}
          onSimFail={() => setError(true)}
          onStop={() => { track('relay', EVENT.relayStopped); setScreen(2) }}
        />
      )}
      {screen === 4 && <Screen4_Complete target={target} onNext={nextHop} onExit={() => onExit?.()} />}
    </div>
  )
}

export default Flow4_Relay