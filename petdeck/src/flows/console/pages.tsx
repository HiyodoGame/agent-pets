import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, AlertTriangle, Check, Eye, FolderGit2, FolderPlus, Loader2, Plus, Settings2, X } from 'lucide-react'
import {
  getObservedSessions,
  getSettings,
  listAgents,
  listProjects,
  updateSettings,
  type AgentCapabilities,
  type AgentInfo,
  type ObserveAgentStat,
  type Project,
  type RuntimeSettings,
} from '../../adapters/runtime-client.ts'
import { t, useLocale, type Locale } from '../../i18n/index.ts'
import { useRuntimeOverview } from './runtime-hooks.ts'
import { runtimeErrorText } from './runtime-error.ts'
import { formatRelative, isFinished } from './format.ts'
import { EmptyState, TaskStatusBadge } from './task-bits.tsx'
import { AddProjectDialog } from './add-project-dialog.tsx'
import { NewTaskDialog } from './new-task-dialog.tsx'
import { ReportsView } from './reports-view.tsx'
import { ManagerSettingsSection } from './manager-settings.tsx'
import { RuntimeStatusCard } from './runtime-status-card.tsx'
import { StorageCard } from './storage-card.tsx'
import { UpdateCard } from './update-card.tsx'

export function ProjectsPage() {
  const { locale } = useLocale()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let disposed = false
    setLoading(true)
    listProjects().then((next) => { if (!disposed) { setProjects(next); setError(null) } })
      .catch((cause) => { if (!disposed) setError(runtimeErrorText(cause)) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [tick])

  return (
    <section className="console-page">
      <header className="console-head">
        <div>
          <span className="console-kicker">{t('console.projects.kicker')}</span>
          <h1 className="console-title">{t('console.projects.title')}</h1>
          <p className="console-subtitle">{t('console.projects.subtitle')}</p>
        </div>
        <div className="console-actions">
          <button type="button" className="button primary" onClick={() => setDialogOpen(true)}><FolderPlus aria-hidden="true" />{t('console.addProject.title')}</button>
        </div>
      </header>
      {error && <p className="console-banner error" role="alert">{error}</p>}
      {loading ? <div className="page-loading"><Loader2 className="spin" aria-hidden="true" />{t('common.loading')}</div>
        : projects.length === 0 ? (
          <EmptyState icon={<FolderGit2 aria-hidden="true" />} title={t('console.projects.emptyTitle')} body={t('console.projects.emptyBody')}>
            <button type="button" className="button primary" onClick={() => setDialogOpen(true)}><FolderPlus aria-hidden="true" />{t('console.addProject.title')}</button>
          </EmptyState>
        ) : (
          <div className="project-grid">
            {projects.map((project) => (
              <article className="panel-card project-card" key={project.id}>
                <header className="project-card-head">
                  <div className="project-icon" data-kind={project.kind}><FolderGit2 aria-hidden="true" /></div>
                  <div>
                    <h2>{project.name}</h2>
                    <span>{project.kind === 'git' ? t('console.projects.git') : t('console.projects.dir')}</span>
                  </div>
                </header>
                <p className="project-path" title={project.path}>{project.path}</p>
                <footer className="project-card-foot">
                  <span>{t('console.projects.added')} {formatRelative(project.created_at, locale)}</span>
                  <span className="project-id" title={project.id}>{project.id.slice(0, 8)}</span>
                </footer>
              </article>
            ))}
          </div>
        )}
      {dialogOpen && <AddProjectDialog onClose={() => setDialogOpen(false)} onRegistered={() => { setDialogOpen(false); setTick((value) => value + 1) }} />}
    </section>
  )
}

interface BoardColumn {
  key: string
  label: string
  statuses: string[]
  dot: string
}

export function TasksPage() {
  const navigate = useNavigate()
  const { tasks, projects, loading, error, refresh } = useRuntimeOverview()
  const [dialogOpen, setDialogOpen] = useState(false)
  const columns: BoardColumn[] = [
    { key: 'ready', label: t('console.status.ready'), statuses: ['ready'], dot: 'ready' },
    { key: 'queued', label: t('console.status.queued'), statuses: ['queued'], dot: 'queued' },
    { key: 'running', label: t('console.status.running'), statuses: ['running'], dot: 'running' },
    { key: 'waiting', label: t('console.status.waiting'), statuses: ['waiting'], dot: 'waiting' },
    { key: 'paused', label: t('console.status.paused'), statuses: ['paused'], dot: 'paused' },
    { key: 'review', label: t('console.status.review'), statuses: ['review'], dot: 'review' },
    { key: 'pending_merge', label: t('console.status.pending_merge'), statuses: ['pending_merge'], dot: 'pending_merge' },
    { key: 'attention', label: t('console.tasks.columnAttention'), statuses: ['failed', 'stopped'], dot: 'failed' },
    { key: 'completed', label: t('console.tasks.columnDone'), statuses: ['completed', 'merged'], dot: 'completed' },
  ]

  return (
    <section className="console-page">
      <header className="console-head">
        <div>
          <span className="console-kicker">{t('console.tasks.kicker')}</span>
          <h1 className="console-title">{t('console.tasks.title')}</h1>
          <p className="console-subtitle">{t('console.tasks.subtitle')}</p>
        </div>
        <div className="console-actions">
          <button type="button" className="button primary" onClick={() => setDialogOpen(true)}><Plus aria-hidden="true" />{t('console.newTask.title')}</button>
        </div>
      </header>
      {error && <p className="console-banner error" role="alert">{error}</p>}
      {loading && tasks.length === 0 ? <div className="page-loading"><Loader2 className="spin" aria-hidden="true" />{t('common.loading')}</div> : (
        <div className="board board-wide">
          {columns.map((column) => {
            const items = tasks.filter((task) => column.statuses.includes(task.status))
            return (
              <section className="board-column" key={column.key} aria-label={column.label}>
                <header><span className="board-dot" data-status={column.dot} />{column.label}<span className="board-count">{items.length}</span></header>
                <div className="board-items">
                  {items.map((task) => (
                    <button type="button" className="board-card" key={task.id} onClick={() => navigate('/tasks/' + task.id)}>
                      <span className="board-card-title">{task.title}</span>
                      <span className="board-card-meta">{task.project_name ?? task.project_id.slice(0, 8)}</span>
                      <span className="board-card-foot"><span>{task.agent}</span>{isFinished(task.status) ? null : <TaskStatusBadge status={task.status} active />}</span>
                    </button>
                  ))}
                  {items.length === 0 && <p className="board-empty">{t('console.tasks.columnEmpty')}</p>}
                </div>
              </section>
            )
          })}
        </div>
      )}
      {dialogOpen && <NewTaskDialog projects={projects} tasks={tasks} onClose={() => setDialogOpen(false)} onCreated={(task) => { setDialogOpen(false); refresh(); navigate('/tasks/' + task.id) }} />}
    </section>
  )
}

const CAPABILITY_ROWS: { key: keyof AgentCapabilities; label: Parameters<typeof t>[0] }[] = [
  { key: 'host', label: 'console.agents.cap.host' },
  { key: 'stream', label: 'console.agents.cap.stream' },
  { key: 'resume', label: 'console.agents.cap.resume' },
  { key: 'suspend', label: 'console.agents.cap.suspend' },
  { key: 'decisions', label: 'console.agents.cap.decisions' },
]

function ObserveStats({ stat, locale }: { stat: ObserveAgentStat; locale: Locale }) {
  return (
    <div className="observe-stats">
      <dl>
        <div>
          <dt>{t('console.agents.observe.recentWrite')}</dt>
          <dd>{stat.lastWriteAt ? formatRelative(stat.lastWriteAt, locale) : '—'}</dd>
        </div>
        <div>
          <dt>{t('console.agents.observe.successFail')}</dt>
          <dd className="tabular-nums">{stat.okCount} / {stat.failCount}</dd>
        </div>
      </dl>
      {stat.lastError
        ? <p className="observe-error" title={stat.lastError.message}>{stat.lastError.code ? stat.lastError.code + ': ' : ''}{stat.lastError.message}</p>
        : <p className="observe-ok">{t('console.agents.observe.ok')}</p>}
    </div>
  )
}

export function AgentsPage() {
  const { locale } = useLocale()
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [observeAgents, setObserveAgents] = useState<ObserveAgentStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    listAgents()
      .then((next) => { if (!disposed) { setAgents(next); setError(null) } })
      .catch((cause) => { if (!disposed) setError(runtimeErrorText(cause)) })
      .finally(() => { if (!disposed) setLoading(false) })
    // Observe stats are advisory: a bridge without observe sources still renders
    // the runtime cards, so a failure here must not blank the page.
    getObservedSessions(20)
      .then((snapshot) => { if (!disposed) setObserveAgents(snapshot.agents) })
      .catch(() => { if (!disposed) setObserveAgents([]) })
    return () => { disposed = true }
  }, [])

  const runtimeIds = new Set(agents.map((agent) => agent.id))
  const observeOnly = observeAgents.filter((stat) => !runtimeIds.has(stat.id))

  return (
    <section className="console-page">
      <header className="console-head">
        <div>
          <span className="console-kicker">{t('console.agents.kicker')}</span>
          <h1 className="console-title">{t('console.agents.title')}</h1>
          <p className="console-subtitle">{t('console.agents.subtitle')}</p>
        </div>
      </header>
      {error && <p className="console-banner error" role="alert">{error}</p>}
      {loading ? <div className="page-loading"><Loader2 className="spin" aria-hidden="true" />{t('common.loading')}</div> : (
        <div className="agent-grid">
          {agents.map((agent) => {
            const stat = observeAgents.find((entry) => entry.id === agent.id)
            return (
              <article className="panel-card agent-card" key={agent.id} data-state="ready">
                <header><div className="agent-icon"><Bot aria-hidden="true" /></div><div><h2>{agent.name}</h2><span>{agent.id} · {agent.command}</span></div></header>
                <dl className="capability-grid">
                  {CAPABILITY_ROWS.map((row) => {
                    const value = Boolean(agent.capabilities[row.key])
                    return (
                      <div key={row.key} data-on={value}>
                        <dt>{t(row.label)}</dt>
                        <dd>{value ? <Check aria-label={t('console.agents.cap.yes')} /> : <X aria-label={t('console.agents.cap.no')} />}</dd>
                      </div>
                    )
                  })}
                  <div data-on={agent.capabilities.permissionModes.length > 0}>
                    <dt>{t('console.agents.cap.permissionModes')}</dt>
                    <dd className="capability-modes">{agent.capabilities.permissionModes.join(' · ') || '—'}</dd>
                  </div>
                </dl>
                {stat ? <ObserveStats stat={stat} locale={locale} /> : null}
                <footer><span className="agent-state">{t('console.agents.state.ready')}</span></footer>
              </article>
            )
          })}
          {observeOnly.map((stat) => (
            <article className="panel-card agent-card observe-card" key={stat.id} data-state={stat.ok ? 'ready' : 'blocked'}>
              <header><div className="agent-icon"><Eye aria-hidden="true" /></div><div><h2>{stat.name}</h2><span>{stat.id} · {t('console.observe.readOnly')}</span></div></header>
              <ObserveStats stat={stat} locale={locale} />
              <footer><span className="agent-state">{stat.ok ? t('console.agents.observe.ok') : t('console.agents.state.blocked')}</span></footer>
            </article>
          ))}
          <article className="panel-card agent-card" data-state="blocked">
            <header><div className="agent-icon"><Bot aria-hidden="true" /></div><div><h2>Codex</h2><span>codex</span></div></header>
            <p>{t('console.agents.codexNote')}</p>
            <footer><span className="agent-state">{t('console.agents.state.blocked')}</span></footer>
          </article>
        </div>
      )}
    </section>
  )
}

export function ReportsPage() {
  return (
    <section className="console-page">
      <header className="console-head">
        <div>
          <span className="console-kicker">{t('console.reports.kicker')}</span>
          <h1 className="console-title">{t('console.reports.title')}</h1>
          <p className="console-subtitle">{t('console.reports.subtitle')}</p>
        </div>
      </header>
      <ReportsView />
    </section>
  )
}

export function SettingsPage() {
  const [settings, setSettings] = useState<RuntimeSettings | null>(null)
  const [draft, setDraft] = useState<RuntimeSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadTick, setLoadTick] = useState(0)

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setLoadError(null)
    getSettings()
      .then((next) => { if (!disposed) { setSettings(next); setDraft(next); setError(null) } })
      .catch((cause) => { if (!disposed) setLoadError(runtimeErrorText(cause)) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [loadTick])

  async function save() {
    if (!draft || busy) return
    setBusy(true)
    setSaved(false)
    setError(null)
    try {
      const next = await updateSettings(draft)
      setSettings(next)
      setDraft(next)
      setSaved(true)
    } catch (cause) {
      setError(runtimeErrorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const dirty = Boolean(draft && settings && (
    draft.maxConcurrent !== settings.maxConcurrent ||
    draft.decisionTimeoutMinutes !== settings.decisionTimeoutMinutes ||
    draft.decisionSound !== settings.decisionSound
  ))

  return (
    <section className="console-page">
      <header className="console-head">
        <div>
          <span className="console-kicker">{t('console.settings.kicker')}</span>
          <h1 className="console-title">{t('console.settings.title')}</h1>
          <p className="console-subtitle">{t('console.settings.subtitle')}</p>
        </div>
      </header>
      {error && <p className="console-banner error" role="alert">{error}</p>}
      <div className="settings-stack">
        <RuntimeStatusCard />
        <StorageCard />
        <section className="panel-card">
          <header className="panel-card-head"><h2><Settings2 aria-hidden="true" />{t('console.settings.schedulerTitle')}</h2></header>
          {loading && !draft ? <div className="page-loading"><Loader2 className="spin" aria-hidden="true" />{t('common.loading')}</div> : !draft ? (
            <div className="settings-load-failed">
              <p className="console-banner error" role="alert"><AlertTriangle aria-hidden="true" />{loadError ?? t('console.error.unknown')}</p>
              <button type="button" className="button ghost" onClick={() => setLoadTick((value) => value + 1)}>{t('common.retry')}</button>
            </div>
          ) : (
            <div className="settings-form">
              <label className="field">
                <span>{t('console.settings.maxConcurrent')}</span>
                <input
                  type="number"
                  min={1}
                  max={8}
                  value={draft.maxConcurrent}
                  onChange={(event) => setDraft({ ...draft, maxConcurrent: Number(event.target.value) })}
                />
                <span className="field-hint">{t('console.settings.maxConcurrentHint')}</span>
              </label>
              <label className="field">
                <span>{t('console.settings.decisionTimeout')}</span>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={draft.decisionTimeoutMinutes}
                  onChange={(event) => setDraft({ ...draft, decisionTimeoutMinutes: Number(event.target.value) })}
                />
              </label>
              <label className="toggle-row">
                <input
                  className="pd-switch"
                  type="checkbox"
                  checked={draft.decisionSound}
                  onChange={(event) => setDraft({ ...draft, decisionSound: event.target.checked })}
                />
                <span>{t('console.settings.decisionSound')}</span>
              </label>
              <div className="settings-actions">
                <button type="button" className="button primary" disabled={!dirty || busy} onClick={() => void save()}>
                  {busy ? <Loader2 className="spin" aria-hidden="true" /> : null}
                  {busy ? t('console.settings.saving') : t('console.settings.save')}
                </button>
                {saved && !dirty ? <span className="settings-saved">{t('console.settings.saved')}</span> : null}
              </div>
            </div>
          )}
        </section>
        <ManagerSettingsSection />
        <UpdateCard />
      </div>
    </section>
  )
}
