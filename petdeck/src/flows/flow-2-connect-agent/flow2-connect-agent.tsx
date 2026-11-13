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
import type { AgentCatalogEntry, AgentForm, CapabilityTier } from '../shared/types'
import { mockCatalog } from '../shared/mock-data'
import { PetAvatar } from '../flow-1-pet-surface/flow1-pet-surface'
import { EdgeAlert, Stepper } from '../shared/edge-kit'
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
function Screen1_ColdHome({ onStart, onQuick }: { onStart: () => void; onQuick: (id: string) => void }) {
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
          <PromptSuggestions
            items={[
              { text: '连接 Qoder', prompt: 'c1' },
              { text: '连接 Codex', prompt: 'c2' },
              { text: '连接 kimi work', prompt: 'c6' },
            ]}
            onSelect={(it) => onQuick(it.prompt)}
          />
        </EmptyContent>
      </Empty>
      <Button variant="ghost" onClick={() => setOffline((o) => !o)}>
        <WifiOff className="mr-1 h-4 w-4" /> 模拟离线
      </Button>
    </div>
  )
}

/* SCREEN 2 of 4: Select Agent（+ empty-search + 截断） */
function Screen2_SelectAgent({ onPick, onBack }: { onPick: (e: AgentCatalogEntry) => void; onBack: () => void }) {
  const [query, setQuery] = useState('')
  const [unsupported, setUnsupported] = useState<string | null>(null)
  const filtered = mockCatalog.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
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
      {/* empty-search：搜索无结果 */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>没找到「{query}」</EmptyTitle>
            <EmptyDescription>换个关键词，或清除搜索查看全部 Agent</EmptyDescription>
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

/* SCREEN 3 of 4: Detect & Authorize（+ permission / rate-limit / loading-submit） */
function Screen3_Detect({ entry, onBack, onSuccess }: { entry: AgentCatalogEntry; onBack: () => void; onSuccess: () => void }) {
  const manual = entry.capability === 'manual'
  const [step, setStep] = useState(0)
  const [error, setError] = useState(false)
  const [denied, setDenied] = useState(false)
  const [rateLimit, setRateLimit] = useState<number | null>(null)
  const [connecting, setConnecting] = useState(false)

  useEffect(() => { track('connect', EVENT.connectStarted, { form: entry.form, tier: entry.capability }) }, [entry.form, entry.capability])

  useEffect(() => {
    if (manual || error || denied || rateLimit !== null || step >= DETECT_STEPS.length) return
    const t = setTimeout(() => setStep((s) => s + 1), 600)
    return () => clearTimeout(t)
  }, [step, manual, error, denied, rateLimit])

  useEffect(() => {
    if (rateLimit === null || rateLimit <= 0) return
    const t = setTimeout(() => setRateLimit((r) => (r === null ? null : r - 1)), 1000)
    return () => clearTimeout(t)
  }, [rateLimit])

  const ready = !manual && !error && !denied && rateLimit === null && step >= DETECT_STEPS.length

  const connect = () => {
    setConnecting(true)
    setTimeout(() => {
      setConnecting(false)
      onSuccess()
    }, 600)
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
        <EdgeAlert variant="warning" title="请求过频" desc={`桥接限流，${rateLimit}s 后自动重试。`} />
      )}

      {manual ? (
        <EdgeAlert variant="warning" title="网页 Agent 无本地桥接" desc={`${entry.name} 为网页服务，使用浏览器扩展读取状态或手动 check-in；接力降级为剪贴板辅助。`} />
      ) : (
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
        {!manual && !error && <Button variant="ghost" onClick={() => setError(true)}>模拟检测失败</Button>}
        {!denied && <Button variant="ghost" onClick={() => setDenied(true)}>模拟拒绝授权</Button>}
        {rateLimit === null && <Button variant="ghost" onClick={() => setRateLimit(5)}>模拟限流</Button>}
      </div>
    </div>
  )
}

/* SCREEN 4 of 4: Success（+ error-server + boundary-null） */
function Screen4_Success({ entry, onDone, onMore }: { entry: AgentCatalogEntry; onDone: () => void; onMore: () => void }) {
  const [syncError, setSyncError] = useState(false)
  useEffect(() => { track('connect', EVENT.connectSuccess, { form: entry.form, tier: entry.capability }) }, [entry.form, entry.capability])
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
        <Button variant="ghost" onClick={() => setSyncError(true)}>
          模拟同步失败
        </Button>
      </div>
    </div>
  )
}

export function Flow2_ConnectAgent({ onConnected }: { onConnected?: () => void }) {
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
      {screen === 1 && <Screen1_ColdHome onStart={() => setScreen(2)} onQuick={(id) => pick(mockCatalog.find((c) => c.id === id)!)} />}
      {screen === 2 && <Screen2_SelectAgent onPick={pick} onBack={() => setScreen(1)} />}
      {screen === 3 && entry && <Screen3_Detect entry={entry} onBack={() => setScreen(2)} onSuccess={() => setScreen(4)} />}
      {screen === 4 && entry && <Screen4_Success entry={entry} onDone={() => onConnected?.()} onMore={() => setScreen(2)} />}
    </div>
  )
}

export default Flow2_ConnectAgent