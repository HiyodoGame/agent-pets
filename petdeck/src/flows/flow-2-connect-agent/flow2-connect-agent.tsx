// =============================================
// FLOW: Connect Agent (4 screens + edge states)
// Edge 补全：empty-search / error-permission / loading-submit / error-rate-limit / error-server / boundary-null / offline / 截断
// =============================================
import { useEffect, useState } from 'react'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  PromptSuggestions,
  Input,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Tag,
  Button,
  Progress,
  Spinner,
  Separator,
  TypographyMuted,
} from 'sparkdesign'
import { Check, AlertTriangle, Plug, ArrowLeft, Terminal, Monitor, Globe, Settings, WifiOff } from 'lucide-react'
import type { Agent, AgentCatalogEntry, AgentForm, CapabilityTier } from '../shared/types'
import { mockCatalog } from '../shared/mock-data'
import { PetAvatar } from '../shared/pet-avatar'
import { EdgeAlert, Stepper } from '../shared/edge-kit'
import { decideLiveConnect, fmtRateLimitWait, type LiveConnectResult } from '../shared/ui-logic'
import { usePetData } from '../../adapters'
import { track, EVENT } from '../../telemetry'

const CAP_META: Record<CapabilityTier, { label: string; color: 'success' | 'info' | 'slate' }> = {
  full: { label: '观察+接力', color: 'success' },
  'observe-only': { label: '仅观察', color: 'info' },
  manual: { label: '手动', color: 'slate' },
}
const FORM_META: Record<AgentForm, { label: string; icon: typeof Terminal }> = {
  cli: { label: 'CLI', icon: Terminal },
  desktop: { label: '桌面', icon: Monitor },
  web: { label: '网页', icon: Globe },
}
const DETECT_STEPS = ['检测本地安装', '读取桥接 / 日志', '建立状态通道']

/* SCREEN 1 of 4: Cold Home（+ offline banner） */
function Screen1_ColdHome({ mock, quickItems, onStart, onQuick }: { mock: boolean; quickItems: { text: string; prompt: string }[]; onStart: () => void; onQuick: (id: string) => void }) {
  const [offline, setOffline] = useState(false)
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      {offline && <EdgeAlert variant="info" title="当前离线" desc="连接 Agent 需网络；可先查看本地缓存引导。" />}
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Plug className="h-6 w-6" />
          </EmptyMedia>
          <EmptyTitle>还没有连接任何 Agent</EmptyTitle>
          <EmptyDescription>连接第一个 Agent，宠物就会点亮并开始替你盯进度</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="primary" onClick={onStart}>
            <Plug className="mr-1 h-4 w-4" /> 连接第一个 Agent
          </Button>
          <PromptSuggestions items={quickItems} onSelect={(it) => onQuick(it.prompt)} />
        </EmptyContent>
      </Empty>
      {mock && (
        <Button variant="ghost" onClick={() => setOffline((o) => !o)}>
          <WifiOff className="mr-1 h-4 w-4" /> 模拟离线
        </Button>
      )}
    </div>
  )
}

/* SCREEN 2 of 4: Select Agent（+ empty-search + 截断；live 目录来自 usePetData().agents） */
function Screen2_SelectAgent({ catalog, onPick, onBack }: { catalog: AgentCatalogEntry[]; onPick: (e: AgentCatalogEntry) => void; onBack: () => void }) {
  const [query, setQuery] = useState('')
  const [unsupported, setUnsupported] = useState<string | null>(null)
  const filtered = catalog.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
  const forms: AgentForm[] = ['cli', 'desktop', 'web']
  return (
    <div className="flex w-full max-w-2xl flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack} aria-label="返回">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-text font-semibold">选择 Agent</span>
      </div>
      <Input placeholder="搜索 Agent…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {unsupported && (
        <EdgeAlert variant="warning" title={`${unsupported} 尚未支持`} desc="该 Agent 暂无桥接适配，已记录你的需求；可先连接其他 Agent。" />
      )}
      {/* empty-search：搜索无结果 / live 未发现任何 Agent */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{query ? `没找到「${query}」` : '未发现 Agent'}</EmptyTitle>
            <EmptyDescription>{query ? '换个关键词，或清除搜索查看全部 Agent' : '本地 bridge 在线但未发现任何 Agent；启动 Agent 后会自动出现在这里。'}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="secondary" onClick={() => setQuery('')}>
              清除搜索
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        forms.map((form) => {
          const items = filtered.filter((c) => c.form === form)
          if (items.length === 0) return null
          const FormIcon = FORM_META[form].icon
          return (
            <div key={form} className="flex flex-col gap-2">
              <TypographyMuted>
                <FormIcon className="mr-1 inline h-3 w-3" />
                {FORM_META[form].label}
              </TypographyMuted>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {items.map((c) => (
                  <button key={c.id} type="button" className="text-left" onClick={() => (c.supported ? onPick(c) : setUnsupported(c.name))}>
                    <Card className="transition-colors hover:bg-bg-elevated">
                      <CardHeader>
                        <CardTitle className="truncate">{c.name}</CardTitle>
                        <CardDescription className="truncate">{c.detectHint}</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="flex gap-2">
                          <Tag color={CAP_META[c.capability].color}>{CAP_META[c.capability].label}</Tag>
                          {!c.supported && <Tag color="slate">待适配</Tag>}
                        </div>
                      </CardContent>
                    </Card>
                  </button>
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

/* SCREEN 3 of 4: Detect & Authorize（+ permission / rate-limit / loading-submit）
   mock：保留模拟检测/授权/限流；live：连接结果由 connState + decideLiveConnect 真实决策。 */
function Screen3_Detect({
  entry,
  mock,
  healthy,
  agentIds,
  onReconnect,
  onBack,
  onSuccess,
}: {
  entry: AgentCatalogEntry
  mock: boolean
  healthy: boolean
  agentIds: string[]
  onReconnect: () => void
  onBack: () => void
  onSuccess: () => void
}) {
  const manual = entry.capability === 'manual'
  const [step, setStep] = useState(0)
  const [error, setError] = useState(false)
  const [denied, setDenied] = useState(false)
  const [rateLimit, setRateLimit] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [liveFail, setLiveFail] = useState<LiveConnectResult | null>(null)

  useEffect(() => { track('connect', EVENT.connectStarted, { form: entry.form, tier: entry.capability, live: !mock }) }, [entry.form, entry.capability, mock])

  // 模拟检测步进仅在 mock 模式跑；live 模式没有模拟检测，状态来自 connState。
  useEffect(() => {
    if (!mock || manual || error || denied || rateLimit !== null || step >= DETECT_STEPS.length) return
    const t = setTimeout(() => setStep((s) => s + 1), 600)
    return () => clearTimeout(t)
  }, [mock, step, manual, error, denied, rateLimit])

  useEffect(() => {
    if (rateLimit === null || rateLimit <= 0) return
    const t = setTimeout(() => setRateLimit((r) => (r === null || r <= 1 ? null : r - 1)), 1000)
    return () => clearTimeout(t)
  }, [rateLimit])

  const mockReady = !manual && !error && !denied && rateLimit === null && step >= DETECT_STEPS.length
  const ready = manual ? true : mock ? mockReady : healthy

  const connect = () => {
    setLiveFail(null)
    if (mock || manual) {
      setConnecting(true)
      setTimeout(() => {
        setConnecting(false)
        onSuccess()
      }, 600)
      return
    }
    const result = decideLiveConnect({ healthy, agentIds, selectedId: entry.id })
    if (result === 'ok') onSuccess()
    else setLiveFail(result)
  }

  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack} aria-label="返回">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-text font-semibold">连接 {entry.name}</span>
        <Tag color={CAP_META[entry.capability].color}>{CAP_META[entry.capability].label}</Tag>
      </div>

      <EdgeAlert variant="info" title="本地优先" desc="只读本地会话状态与产物，不上传你的代码；授权可随时在设置中撤销。" />

      {denied && (
        <EdgeAlert
          variant="warning"
          title="未授权"
          desc="你拒绝了本地读取授权。去系统设置开启后重试。"
          extra={
            <Button variant="secondary" onClick={() => setDenied(false)}>
              <Settings className="mr-1 h-4 w-4" /> 去系统设置
            </Button>
          }
        />
      )}
      {rateLimit !== null && rateLimit > 0 && (
        <EdgeAlert variant="warning" title="请求过频" desc={fmtRateLimitWait(rateLimit)} />
      )}
      {liveFail !== null && (
        <EdgeAlert
          variant="warning"
          title={liveFail === 'offline' ? '桥接不可用' : 'Agent 已离线'}
          desc={liveFail === 'offline' ? '无法连接本地 bridge，恢复后重试。' : `${entry.name} 已不在已发现的 Agent 列表中，请返回重新选择。`}
          onRetry={() => setLiveFail(null)}
          retryLabel="知道了"
        />
      )}

      {manual ? (
        <EdgeAlert variant="warning" title="网页 Agent 无本地桥接" desc={`${entry.name} 为网页服务，使用浏览器扩展读取状态或手动 check-in；接力降级为剪贴板辅助。`} />
      ) : mock ? (
        <>
          <div className="flex flex-col gap-2 rounded-md border border-border-tertiary bg-bg-container p-3">
            {DETECT_STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-2 text-sm">
                {error && i === step ? (
                  <AlertTriangle className="h-4 w-4 text-error" />
                ) : i < step ? (
                  <Check className="h-4 w-4 text-success" />
                ) : i === step ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-border-secondary" />
                )}
                <span className={i <= step ? 'text-text' : 'text-text-secondary'}>{label}</span>
              </div>
            ))}
          </div>
          <Progress value={Math.round((step / DETECT_STEPS.length) * 100)} />
        </>
      ) : healthy ? (
        // live：没有模拟检测步——bridge 连接状态是真实轮询结果，如实展示单条摘要，不谎报已完成的检测步骤。
        <div className="flex flex-col gap-2 rounded-md border border-border-tertiary bg-bg-container p-3">
          <div className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-success" />
            <span className="text-text">本地 bridge 已连接，状态通道就绪</span>
          </div>
          <TypographyMuted>发现 {agentIds.length} 个 Agent；检测由 bridge 后台持续完成，授权即接入真实的 {entry.name}。</TypographyMuted>
        </div>
      ) : (
        <EdgeAlert
          variant="warning"
          title="桥接不可用"
          desc="无法连接本地 bridge，恢复后才能接入真实 Agent。"
          onRetry={onReconnect}
          retryLabel="重连"
        />
      )}

      {error && (
        <EdgeAlert
          title="检测失败：未找到本地安装"
          desc={`请确认 ${entry.name} 已安装并在运行，或改用手动配置。`}
          onRetry={() => {
            setError(false)
            setStep(0)
          }}
          extra={
            <Button variant="secondary" onClick={onSuccess}>
              手动配置连接
            </Button>
          }
        />
      )}

      <Separator />
      <div className="flex flex-wrap gap-2">
        {manual ? (
          <Button variant="primary" loading={connecting} onClick={connect}>
            手动 check-in 连接
          </Button>
        ) : (
          <Button variant="primary" disabled={!ready || connecting} loading={connecting} onClick={connect}>
            授权并连接
          </Button>
        )}
        {mock && !manual && !error && <Button variant="ghost" onClick={() => setError(true)}>模拟检测失败</Button>}
        {mock && !denied && <Button variant="ghost" onClick={() => setDenied(true)}>模拟拒绝授权</Button>}
        {mock && rateLimit === null && <Button variant="ghost" onClick={() => setRateLimit(5)}>模拟限流</Button>}
      </div>
    </div>
  )
}

/* SCREEN 4 of 4: Success（+ error-server + boundary-null） */
function Screen4_Success({ entry, mock, onDone, onMore }: { entry: AgentCatalogEntry; mock: boolean; onDone: () => void; onMore: () => void }) {
  const [syncError, setSyncError] = useState(false)
  useEffect(() => { track('connect', EVENT.connectSuccess, { form: entry.form, tier: entry.capability, live: !mock }) }, [entry.form, entry.capability, mock])
  return (
    <div className="flex flex-col items-center gap-3 p-6">
      <PetAvatar status="done" size={80} />
      <div className="flex items-center gap-2 text-success">
        <Check className="h-5 w-5" />
        <span className="text-text font-semibold">已连接 {entry.name || '未命名 Agent'}</span>
      </div>
      <TypographyMuted>宠物已点亮，开始同步状态与产物</TypographyMuted>
      {syncError && <EdgeAlert title="首次同步失败" desc="状态没拉下来，重试同步。" onRetry={() => setSyncError(false)} />}
      <div className="flex gap-2">
        <Button variant="primary" onClick={onDone}>
          看项目面板
        </Button>
        <Button variant="secondary" onClick={onMore}>
          连接下一个
        </Button>
        {mock && (
          <Button variant="ghost" onClick={() => setSyncError(true)}>
            模拟同步失败
          </Button>
        )}
      </div>
    </div>
  )
}

export function Flow2_ConnectAgent({ onConnected }: { onConnected?: () => void }) {
  const { mode, connState, agents, reconnect } = usePetData()
  const mock = mode === 'mock'
  const healthy = connState === 'live'
  // live 目录 = bridge 真实发现的 Agent；mock 保留设计期完整目录（含未适配项）。
  const liveCatalog: AgentCatalogEntry[] = agents.map((a: Agent) => ({
    id: a.id,
    name: a.name,
    form: a.form,
    capability: a.capability,
    detectHint: '本地 bridge 已发现',
    supported: true,
  }))
  const catalog = mock ? mockCatalog : liveCatalog
  const agentIds = agents.map((a: Agent) => a.id)
  const quickItems = (mock
    ? [
        { text: '连接 Qoder', prompt: 'c1' },
        { text: '连接 Codex', prompt: 'c2' },
        { text: '连接 kimi work', prompt: 'c6' },
      ]
    : catalog.slice(0, 3).map((c) => ({ text: `连接 ${c.name}`, prompt: c.id }))
  ).filter((q) => catalog.some((c) => c.id === q.prompt))
  const [screen, setScreen] = useState<1 | 2 | 3 | 4>(1)
  const [entry, setEntry] = useState<AgentCatalogEntry | null>(null)
  const pick = (e: AgentCatalogEntry) => {
    setEntry(e)
    setScreen(3)
  }
  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <h1 className="text-text text-lg font-semibold">接入 Agent</h1>
      <Stepper steps={['选择', '检测', '授权', '完成']} current={screen - 1} />
      {screen === 1 && <Screen1_ColdHome mock={mock} quickItems={quickItems} onStart={() => setScreen(2)} onQuick={(id) => { const c = catalog.find((x) => x.id === id); if (c) pick(c) }} />}
      {screen === 2 && <Screen2_SelectAgent catalog={catalog} onPick={pick} onBack={() => setScreen(1)} />}
      {screen === 3 && entry && (
        <Screen3_Detect
          entry={entry}
          mock={mock}
          healthy={healthy}
          agentIds={agentIds}
          onReconnect={reconnect}
          onBack={() => setScreen(2)}
          onSuccess={() => setScreen(4)}
        />
      )}
      {screen === 4 && entry && <Screen4_Success entry={entry} mock={mock} onDone={() => onConnected?.()} onMore={() => setScreen(2)} />}
    </div>
  )
}

export default Flow2_ConnectAgent