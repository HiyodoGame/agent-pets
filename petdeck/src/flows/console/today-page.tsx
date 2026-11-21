import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowUpRight, FolderPlus, Loader2, Pause, Play, Plus, Square, ListChecks, TerminalSquare } from 'lucide-react'
import {
  continueTask,
  listEvents,
  pauseTask,
  resumeTask,
  startTask,
  stopTask,
  type RuntimeEvent,
  type Task,
} from '../../adapters/runtime-client.ts'
import { t, useLocale } from '../../i18n/index.ts'
import { usePendingDecisions, useRuntimeOverview } from './runtime-hooks.ts'
import { formatRelative, groupTasks, eventText } from './format.ts'
import { DecisionCard } from './decision-card.tsx'
import { ManagerPanel } from './manager-panel.tsx'
import { EmptyState, TaskRow, TaskStatusBadge } from './task-bits.tsx'
import { InterruptBanner } from './interrupt-banner.tsx'
import { NewTaskDialog } from './new-task-dialog.tsx'
import { AddProjectDialog } from './add-project-dialog.tsx'

type TodayAction = 'start' | 'stop' | 'resume' | 'pause' | 'continue'

export function TodayPage() {
  const navigate = useNavigate()
  const { locale } = useLocale()
  const { tasks, projects, loading, error, refresh } = useRuntimeOverview()
  const decisions = usePendingDecisions(4000)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [addProjectOpen, setAddProjectOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [preview, setPreview] = useState<RuntimeEvent[]>([])

  const grouped = useMemo(() => groupTasks(tasks), [tasks])
  const selected = tasks.find((task) => task.id === selectedId) ?? tasks[0] ?? null

  useEffect(() => {
    if (selectedId && tasks.some((task) => task.id === selectedId)) return
    if (tasks.length > 0) setSelectedId(tasks[0].id)
  }, [tasks, selectedId])

  useEffect(() => {
    if (!selected) { setPreview([]); return }
    let disposed = false
    async function load() {
      try {
        const events = await listEvents(selected.id, 0, 200)
        if (!disposed) setPreview(events.slice(-7))
      } catch {
        if (!disposed) setPreview([])
      }
    }
    void load()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 4000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [selected?.id, selected?.status])

  function refreshAll() {
    refresh()
    decisions.refresh()
  }

  async function runAction(kind: TodayAction, task: Task) {
    if (busy) return
    setBusy(task.id)
    setActionError(null)
    try {
      if (kind === 'start') await startTask(task.id)
      else if (kind === 'stop') await stopTask(task.id)
      else if (kind === 'resume') await resumeTask(task.id)
      else if (kind === 'pause') await pauseTask(task.id)
      else await continueTask(task.id)
      refreshAll()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const today = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date())
  const counts = {
    running: tasks.filter((task) => task.status === 'running').length,
    queued: tasks.filter((task) => task.status === 'ready' || task.status === 'queued').length,
    attention: tasks.filter((task) => task.status === 'waiting' || task.status === 'failed').length,
    review: tasks.filter((task) => task.status === 'review').length,
    merge: tasks.filter((task) => task.status === 'pending_merge').length,
    paused: tasks.filter((task) => task.status === 'paused').length,
    done: grouped.finished.length,
  }
  const banner = decisions.decisions.slice(0, 2)

  const rail = (
    <aside className="task-rail" aria-label={t('console.today.railTitle')}>
      <header className="task-rail-head">
        <div>
          <h2>{t('console.today.railTitle')}</h2>
          <span className="task-rail-count">{tasks.length}</span>
        </div>
        <button type="button" className="icon-button" aria-label={t('console.newTask.title')} onClick={() => setNewTaskOpen(true)}><Plus aria-hidden="true" /></button>
      </header>
      {loading && tasks.length === 0 ? (
        <div className="rail-loading"><Loader2 className="spin" aria-hidden="true" /> {t('common.loading')}</div>
      ) : tasks.length === 0 ? (
        <div className="rail-empty">
          <p>{t('console.today.noTasks')}</p>
          <button type="button" className="button ghost" onClick={() => setNewTaskOpen(true)}><Plus aria-hidden="true" />{t('console.newTask.title')}</button>
        </div>
      ) : (
        <div className="task-list">
          {grouped.active.length > 0 && <div className="task-group-label">{t('console.today.groupRunning')}</div>}
          {grouped.active.map((task) => <TaskRow key={task.id} task={task} selected={selected?.id === task.id} onSelect={() => setSelectedId(task.id)} />)}
          {grouped.queued.length > 0 && <div className="task-group-label">{t('console.today.groupQueue')}</div>}
          {grouped.queued.map((task) => <TaskRow key={task.id} task={task} selected={selected?.id === task.id} onSelect={() => setSelectedId(task.id)} />)}
          {grouped.attention.length > 0 && <div className="task-group-label">{t('console.today.groupAttention')}</div>}
          {grouped.attention.map((task) => <TaskRow key={task.id} task={task} selected={selected?.id === task.id} onSelect={() => setSelectedId(task.id)} />)}
          {grouped.finished.length > 0 && <div className="task-group-label">{t('console.today.groupFinished')}</div>}
          {grouped.finished.map((task) => <TaskRow key={task.id} task={task} selected={selected?.id === task.id} onSelect={() => setSelectedId(task.id)} />)}
        </div>
      )}
    </aside>
  )

  const canStart = selected ? selected.status === 'ready' || selected.status === 'stopped' || selected.status === 'failed' : false
  const canResume = selected ? Boolean(selected.session_id) && (selected.status === 'stopped' || selected.status === 'failed') : false

  return (
    <section className="console-page">
      <header className="console-head">
        <div>
          <span className="console-kicker">{today}</span>
          <h1 className="console-title">{t('console.today.title')}</h1>
          <p className="console-subtitle">{t('console.today.subtitle')}</p>
        </div>
        <div className="console-actions">
          <button type="button" className="button ghost" onClick={() => setAddProjectOpen(true)}><FolderPlus aria-hidden="true" />{t('console.addProject.title')}</button>
          <button type="button" className="button primary" onClick={() => setNewTaskOpen(true)}><Plus aria-hidden="true" />{t('console.newTask.title')}</button>
        </div>
      </header>

      {banner.length > 0 ? (
        <section className="today-decisions" aria-label={t('console.today.decisionTitle')}>
          <header className="today-decisions-head">
            <span>{t('console.today.decisionTitle')}</span>
            {decisions.decisions.length > banner.length ? <span className="today-decisions-count">{t('console.today.decisionsMore', { n: String(decisions.decisions.length - banner.length) })}</span> : null}
          </header>
          <div className="today-decisions-list">
            {banner.map((decision) => (
              <DecisionCard
                key={decision.id}
                decision={decision}
                compact
                onAnswered={() => { refreshAll(); if (decision.task_id) setSelectedId(decision.task_id) }}
              />
            ))}
          </div>
        </section>
      ) : null}

      <div className="today-stats" role="list">
        <div className="today-stat" role="listitem"><strong className="tabular-nums">{counts.running}</strong><span>{t('console.status.running')}</span></div>
        <div className="today-stat" role="listitem"><strong className="tabular-nums">{counts.queued}</strong><span>{t('console.status.queued')}</span></div>
        <div className="today-stat" role="listitem"><strong className="tabular-nums" data-attention={counts.attention > 0}>{counts.attention}</strong><span>{t('console.today.attention')}</span></div>
        <div className="today-stat" role="listitem"><strong className="tabular-nums">{counts.review}</strong><span>{t('console.status.review')}</span></div>
        <div className="today-stat" role="listitem"><strong className="tabular-nums">{counts.merge}</strong><span>{t('console.status.pending_merge')}</span></div>
        <div className="today-stat" role="listitem"><strong className="tabular-nums">{counts.paused}</strong><span>{t('console.status.paused')}</span></div>
        <div className="today-stat" role="listitem"><strong className="tabular-nums">{counts.done}</strong><span>{t('console.status.completed')}</span></div>
      </div>

      <div className="today-workbench">
        <ManagerPanel projects={projects} onDispatched={refreshAll} />
        <div className="today-main">
          {error && <p className="console-banner error" role="alert">{error}</p>}
          {decisions.error && <p className="console-banner error" role="alert">{decisions.error}</p>}

          <div className="today-grid">
            {rail}
            <div className="detail-pane">
          {!selected ? (
            <EmptyState
              icon={<TerminalSquare aria-hidden="true" />}
              title={t('console.today.emptyTitle')}
              body={projects.length === 0 ? t('console.today.emptyNoProject') : t('console.today.emptyBody')}
            >
              {projects.length === 0
                ? <button type="button" className="button primary" onClick={() => setAddProjectOpen(true)}><FolderPlus aria-hidden="true" />{t('console.addProject.title')}</button>
                : <button type="button" className="button primary" onClick={() => setNewTaskOpen(true)}><Plus aria-hidden="true" />{t('console.newTask.title')}</button>}
            </EmptyState>
          ) : (
            <article className="panel-card today-preview">
              <header className="panel-card-head">
                <div className="today-preview-title">
                  <TaskStatusBadge status={selected.status} active />
                  <h2>{selected.title}</h2>
                  <span className="today-preview-meta">{selected.project_name ?? selected.project_id} · {selected.agent} · {t('console.today.updated')} {formatRelative(selected.updated_at, locale)}</span>
                </div>
                <div className="today-preview-actions">
                  {selected.status === 'running' ? (
                    <>
                      <button type="button" className="button ghost" disabled={busy === selected.id} onClick={() => { if (window.confirm(t('console.task.pauseConfirm'))) void runAction('pause', selected) }}>
                        {busy === selected.id ? <Loader2 className="spin" aria-hidden="true" /> : <Pause aria-hidden="true" />}{t('console.task.pause')}
                      </button>
                      <button type="button" className="button ghost" disabled={busy === selected.id} onClick={() => void runAction('stop', selected)}>
                        {busy === selected.id ? <Loader2 className="spin" aria-hidden="true" /> : <Square aria-hidden="true" />}{t('console.task.stop')}
                      </button>
                    </>
                  ) : selected.status === 'paused' ? (
                    <>
                      <button type="button" className="button ghost" disabled={busy === selected.id} onClick={() => void runAction('continue', selected)}>
                        {busy === selected.id ? <Loader2 className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}{t('console.task.continue')}
                      </button>
                      <button type="button" className="button ghost" disabled={busy === selected.id} onClick={() => void runAction('stop', selected)}>
                        {busy === selected.id ? <Loader2 className="spin" aria-hidden="true" /> : <Square aria-hidden="true" />}{t('console.task.stop')}
                      </button>
                    </>
                  ) : selected.status === 'review' || selected.status === 'pending_merge' || selected.status === 'merged' || selected.status === 'completed' ? null : canResume ? (
                    <button type="button" className="button ghost" disabled={busy === selected.id} onClick={() => void runAction('resume', selected)}>
                      {busy === selected.id ? <Loader2 className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}{t('console.task.resume')}
                    </button>
                  ) : (
                    <button type="button" className="button ghost" disabled={busy === selected.id || !canStart} onClick={() => void runAction('start', selected)}>
                      {busy === selected.id ? <Loader2 className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}{selected.status === 'ready' ? t('console.task.start') : t('console.task.retry')}
                    </button>
                  )}
                  <button type="button" className="button primary" onClick={() => navigate('/tasks/' + selected.id)}><ArrowUpRight aria-hidden="true" />{t('console.today.openTask')}</button>
                </div>
              </header>

              {actionError && <p className="console-banner error" role="alert">{actionError}</p>}
              <InterruptBanner task={selected} busy={busy === selected.id} canResume={canResume} onResume={() => void runAction('resume', selected)} />

              <div className="today-preview-body">
                <section className="preview-block">
                  <h3>{t('console.today.prompt')}</h3>
                  <p className="preview-prompt">{selected.prompt}</p>
                </section>
                {selected.status === 'queued' ? <p className="console-banner">{t('console.task.queuedNotice')}</p> : null}
                <section className="preview-block">
                  <h3><ListChecks aria-hidden="true" />{t('console.today.latest')}</h3>
                  {preview.length === 0
                    ? <p className="preview-muted">{selected.status === 'merged' || selected.status === 'completed' ? t('console.today.finishedNoEvents') : t('console.today.noEvents')}</p>
                    : <ol className="preview-events">
                        {preview.map((event) => <PreviewEvent key={event.id} event={event} />)}
                      </ol>}
                </section>
              </div>
            </article>
          )}
            </div>
          </div>
        </div>
      </div>

      {newTaskOpen && (
        <NewTaskDialog
          projects={projects}
          tasks={tasks}
          defaultProjectId={selected?.project_id ?? null}
          onClose={() => setNewTaskOpen(false)}
          onCreated={(task) => { setNewTaskOpen(false); navigate('/tasks/' + task.id) }}
        />
      )}
      {addProjectOpen && (
        <AddProjectDialog
          onClose={() => setAddProjectOpen(false)}
          onRegistered={() => { setAddProjectOpen(false); refresh() }}
        />
      )}
    </section>
  )
}

function PreviewEvent({ event }: { event: RuntimeEvent }) {
  const { payload } = event
  if (event.type === 'message.assistant') {
    const text = eventText(payload, 'text').replace(/\s+/g, ' ').trim()
    return <li><span className="preview-event-kind">{t('console.event.assistant')}</span><p>{text.length > 180 ? text.slice(0, 180) + '…' : text}</p></li>
  }
  if (event.type === 'tool.started') {
    return <li><span className="preview-event-kind">{t('console.event.tool')}</span><p>{eventText(payload, 'name')}</p></li>
  }
  if (event.type === 'run.started') {
    return <li><span className="preview-event-kind">{t('console.event.started')}</span><p>{eventText(payload, 'model') || eventText(payload, 'sessionId')}</p></li>
  }
  if (event.type === 'run.completed' || event.type === 'run.failed') {
    return <li><span className="preview-event-kind">{event.type === 'run.completed' ? t('console.event.completed') : t('console.event.failed')}</span><p>{eventText(payload, 'result').slice(0, 180)}</p></li>
  }
  if (event.type === 'decision.requested') {
    return <li><span className="preview-event-kind">{t('console.event.decision')}</span><p>{eventText(payload, 'question').slice(0, 180)}</p></li>
  }
  if (event.type === 'task.review_requested' || event.type === 'task.accepted' || event.type === 'task.rejected' || event.type === 'task.merged' || event.type === 'task.merge_authorized') {
    const key = event.type === 'task.review_requested' ? 'console.event.review' : event.type === 'task.accepted' ? 'console.event.accepted' : event.type === 'task.rejected' ? 'console.event.rejected' : event.type === 'task.merged' ? 'console.event.merged' : 'console.event.mergeAuthorized'
    return <li><span className="preview-event-kind">{t('console.event.status')}</span><p>{t(key)}</p></li>
  }
  if (event.type === 'run.paused' || event.type === 'run.resumed' || event.type === 'task.queued') {
    const key = event.type === 'run.paused' ? 'console.event.paused' : event.type === 'run.resumed' ? 'console.event.resumed' : 'console.event.queued'
    return <li><span className="preview-event-kind">{t('console.event.status')}</span><p>{t(key)}</p></li>
  }
  if (event.type === 'log.stderr') {
    const text = eventText(payload, 'line') || eventText(payload, 'text')
    if (!text.trim()) return null
    return <li><span className="preview-event-kind">{t('console.event.error')}</span><p>{text.slice(0, 180)}</p></li>
  }
  return null
}
