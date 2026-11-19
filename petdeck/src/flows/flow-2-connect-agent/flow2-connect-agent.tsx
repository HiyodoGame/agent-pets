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
import { loadConnectedAgentIds, recordConnectedAgent, resolveConnectedAgentIds, shouldPersistConnection } from '../../adapters/connected-agents.ts'
import { track, EVENT } from '../../telemetry'
import { t } from '../../i18n/index.ts'
import type { MessageKey } from '../../i18n/messages.ts'

const CAP_META: Record<CapabilityTier, { labelKey: MessageKey; color: 'success' | 'info' | 'slate' }> = {
  full: { labelKey: 'capability.full', color: 'success' },
  'observe-only': { labelKey: 'capability.observe', color: 'info' },
  manual: { labelKey: 'capability.manual', color: 'slate' },
}
const FORM_META: Record<AgentForm, { labelKey: MessageKey; icon: typeof Terminal }> = {
  cli: { labelKey: 'form.cli', icon: Terminal },
  desktop: { labelKey: 'form.desktop', icon: Monitor },
  web: { labelKey: 'form.web', icon: Globe },
}
const DETECT_STEPS: MessageKey[] = ['connect.detectLocal', 'connect.detectBridge', 'connect.detectChannel']

/* SCREEN 1 of 4: Cold Home（+ offline banner） */
function Screen1_ColdHome({ mock, quickItems, onStart, onQuick }: { mock: boolean; quickItems: { text: string; prompt: string }[]; onStart: () => void; onQuick: (id: string) => void }) {
  const [offline, setOffline] = useState(false)
  return (
    <div className="flex w-full max-w-xl flex-col gap-3">
      {offline && <EdgeAlert variant="info" title={t('connect.offlineTitle')} desc={t('connect.offlineDesc')} />}
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Plug className="h-6 w-6" />
          </EmptyMedia>
          <EmptyTitle>{t('connect.noAgents')}</EmptyTitle>
          <EmptyDescription>{t('connect.noAgentsDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="primary" onClick={onStart}>
            <Plug className="mr-1 h-4 w-4" /> {t('connect.connectFirst')}
          </Button>
          <PromptSuggestions items={quickItems} onSelect={(it) => onQuick(it.prompt)} />
        </EmptyContent>
      </Empty>
      {mock && (
        <Button variant="ghost" onClick={() => setOffline((o) => !o)}>
          <WifiOff className="mr-1 h-4 w-4" /> {t('connect.mockOffline')}
        </Button>
      )}
    </div>
  )
}

function Screen1_ConnectedHome({ connected, healthy, onAdd }: { connected: Agent[]; healthy: boolean; onAdd: () => void }) {
  return (
    <section className="connect-home" aria-label={t('connect.connectedTitle')}>
      <div className="connect-home-summary">
        <span className="connect-home-check"><Check className="h-5 w-5" /></span>
        <div>
          <h2>{t('connect.connectedTitle')}</h2>
          <p>{healthy ? t('connect.connectedDesc') : t('connect.connectedOffline')}</p>
        </div>
      </div>
      <ul className="connect-agent-list">
        {connected.map((agent) => (
          <li key={agent.id}>
            <span>{agent.name}</span>
            <Tag color={CAP_META[agent.capability].color}>{t(CAP_META[agent.capability].labelKey)}</Tag>
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={onAdd}>
        <Plug className="mr-1 h-4 w-4" /> {t('connect.addAnother')}
      </Button>
    </section>
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
        <Button variant="ghost" onClick={onBack} aria-label={t('connect.back')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-text font-semibold">{t('connect.selectAgent')}</span>
      </div>
      <Input placeholder={t('connect.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
      {unsupported && (
        <EdgeAlert variant="warning" title={t('connect.unsupportedTitle', { name: unsupported })} desc={t('connect.unsupportedDesc')} />
      )}
      {/* empty-search：搜索无结果 / live 未发现任何 Agent */}
      {filtered.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{query ? t('connect.notFound', { query }) : t('connect.noAgentsFound')}</EmptyTitle>
            <EmptyDescription>{query ? t('connect.notFoundDesc') : t('connect.noAgentsFoundDesc')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="secondary" onClick={() => setQuery('')}>
              {t('connect.clearSearch')}
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
                {t(FORM_META[form].labelKey)}
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
                          <Tag color={CAP_META[c.capability].color}>{t(CAP_META[c.capability].labelKey)}</Tag>
                          {!c.supported && <Tag color="slate">{t('connect.pendingAdapter')}</Tag>}
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
        <Button variant="ghost" onClick={onBack} aria-label={t('connect.back')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <span className="text-text font-semibold">{t('connect.connectTo', { name: entry.name })}</span>
        <Tag color={CAP_META[entry.capability].color}>{t(CAP_META[entry.capability].labelKey)}</Tag>
      </div>

      <EdgeAlert variant="info" title={t('connect.localFirst')} desc={t('connect.localFirstDesc')} />

      {denied && (
        <EdgeAlert
          variant="warning"
          title={t('connect.deniedTitle')}
          desc={t('connect.deniedDesc')}
          extra={
            <Button variant="secondary" onClick={() => setDenied(false)}>
              <Settings className="mr-1 h-4 w-4" /> {t('connect.openSettings')}
            </Button>
          }
        />
      )}
      {rateLimit !== null && rateLimit > 0 && (
        <EdgeAlert variant="warning" title={t('connect.rateLimitTitle')} desc={fmtRateLimitWait(rateLimit)} />
      )}
      {liveFail !== null && (
        <EdgeAlert
          variant="warning"
          title={liveFail === 'offline' ? t('connect.bridgeUnavailable') : t('connect.agentOffline')}
          desc={liveFail === 'offline' ? t('connect.bridgeUnavailableDesc') : t('connect.agentOfflineDesc', { name: entry.name })}
          onRetry={() => setLiveFail(null)}
          retryLabel={t('connect.gotIt')}
        />
      )}

      {manual ? (
        <EdgeAlert variant="warning" title={t('connect.webNoBridge')} desc={t('connect.webNoBridgeDesc', { name: entry.name })} />
      ) : mock ? (
        <>
          <div className="flex flex-col gap-2 rounded-md border border-border-tertiary bg-bg-container p-3">
            {DETECT_STEPS.map((labelKey, i) => (
              <div key={labelKey} className="flex items-center gap-2 text-sm">
                {error && i === step ? (
                  <AlertTriangle className="h-4 w-4 text-error" />
                ) : i < step ? (
                  <Check className="h-4 w-4 text-success" />
                ) : i === step ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <span className="h-4 w-4 rounded-full border border-border-secondary" />
                )}
                <span className={i <= step ? 'text-text' : 'text-text-secondary'}>{t(labelKey)}</span>
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
            <span className="text-text">{t('connect.bridgeConnected')}</span>
          </div>
          <TypographyMuted>{t('connect.discovered', { n: agentIds.length, name: entry.name })}</TypographyMuted>
        </div>
      ) : (
        <EdgeAlert
          variant="warning"
          title={t('connect.bridgeUnavailable')}
          desc={t('connect.bridgeUnavailableDesc')}
          onRetry={onReconnect}
          retryLabel={t('shell.reconnect')}
        />
      )}

      {error && (
        <EdgeAlert
          title={t('connect.detectFailed')}
          desc={t('connect.detectFailedDesc', { name: entry.name })}
          onRetry={() => {
            setError(false)
            setStep(0)
          }}
          extra={
            <Button variant="secondary" onClick={onSuccess}>
              {t('connect.manualConnect')}
            </Button>
          }
        />
      )}

      <Separator />
      <div className="flex flex-wrap gap-2">
        {manual ? (
          <Button variant="primary" loading={connecting} onClick={connect}>
            {t('connect.manualCheckIn')}
          </Button>
        ) : (
          <Button variant="primary" disabled={!ready || connecting} loading={connecting} onClick={connect}>
            {t('connect.authorize')}
          </Button>
        )}
        {mock && !manual && !error && <Button variant="ghost" onClick={() => setError(true)}>{t('connect.simFail')}</Button>}
        {mock && !denied && <Button variant="ghost" onClick={() => setDenied(true)}>{t('connect.simDeny')}</Button>}
        {mock && rateLimit === null && <Button variant="ghost" onClick={() => setRateLimit(5)}>{t('connect.simRateLimit')}</Button>}
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
        <span className="text-text font-semibold">{t('connect.connected', { name: entry.name || t('connect.unnamedAgent') })}</span>
      </div>
      <TypographyMuted>{t('connect.syncing')}</TypographyMuted>
      {syncError && <EdgeAlert title={t('connect.syncFailed')} desc={t('connect.syncFailedDesc')} onRetry={() => setSyncError(false)} />}
      <div className="flex gap-2">
        <Button variant="primary" onClick={onDone}>
          {t('connect.viewPanel')}
        </Button>
        <Button variant="secondary" onClick={onMore}>
          {t('connect.connectNext')}
        </Button>
        {mock && (
          <Button variant="ghost" onClick={() => setSyncError(true)}>
            {t('connect.simSyncFail')}
          </Button>
        )}
      </div>
    </div>
  )
}

export function Flow2_ConnectAgent({ onConnected }: { onConnected?: () => void }) {
  const { mode, connState, agents, sessions, reconnect } = usePetData()
  const mock = mode === 'mock'
  const healthy = connState === 'live'
  // live 目录 = bridge 真实发现的 Agent；mock 保留设计期完整目录（含未适配项）。
  const liveCatalog: AgentCatalogEntry[] = agents.map((a: Agent) => ({
    id: a.id,
    name: a.name,
    form: a.form,
    capability: a.capability,
    detectHint: t('connect.liveDiscovered'),
    supported: true,
  }))
  const catalog = mock ? mockCatalog : liveCatalog
  const agentIds = agents.map((a: Agent) => a.id)
  const quickItems = (mock
    ? [
        { text: t('connect.connectTo', { name: 'Qoder' }), prompt: 'c1' },
        { text: t('connect.connectTo', { name: 'Codex' }), prompt: 'c2' },
        { text: t('connect.connectTo', { name: 'kimi work' }), prompt: 'c6' },
      ]
    : catalog.slice(0, 3).map((c) => ({ text: t('connect.connectTo', { name: c.name }), prompt: c.id }))
  ).filter((q) => catalog.some((c) => c.id === q.prompt))
  const connectedIds = resolveConnectedAgentIds(loadConnectedAgentIds(), sessions.map((session) => session.agentId))
  const connected = agents.filter((agent) => connectedIds.includes(agent.id))
  const [screen, setScreen] = useState<1 | 2 | 3 | 4>(1)
  const [entry, setEntry] = useState<AgentCatalogEntry | null>(null)
  const pick = (e: AgentCatalogEntry) => {
    setEntry(e)
    setScreen(3)
  }
  return (
    <div className="flow-page">
      <header className="flow-page-header">
        <div className="flow-page-heading">
          <h1>{t('connect.title')}</h1>
          <p>{t('connect.subtitle')}</p>
        </div>
        <Stepper steps={[t('connect.stepSelect'), t('connect.stepDetect'), t('connect.stepAuthorize'), t('connect.stepDone')]} current={screen - 1} />
      </header>
      <div className="flow-page-body">
        {screen === 1 && (connected.length > 0 ? (
          <Screen1_ConnectedHome connected={connected} healthy={healthy} onAdd={() => setScreen(2)} />
        ) : (
          <Screen1_ColdHome mock={mock} quickItems={quickItems} onStart={() => setScreen(2)} onQuick={(id) => { const c = catalog.find((x) => x.id === id); if (c) pick(c) }} />
        ))}
        {screen === 2 && <Screen2_SelectAgent catalog={catalog} onPick={pick} onBack={() => setScreen(1)} />}
        {screen === 3 && entry && (
          <Screen3_Detect
            entry={entry}
            mock={mock}
            healthy={healthy}
            agentIds={agentIds}
            onReconnect={reconnect}
            onBack={() => setScreen(2)}
            onSuccess={() => {
              if (shouldPersistConnection(mock, entry.capability)) recordConnectedAgent(undefined, entry.id)
              setScreen(4)
            }}
          />
        )}
        {screen === 4 && entry && <Screen4_Success entry={entry} mock={mock} onDone={() => onConnected?.()} onMore={() => setScreen(2)} />}
      </div>
    </div>
  )
}

export default Flow2_ConnectAgent