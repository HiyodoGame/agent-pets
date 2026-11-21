import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Loader2, Pause, Play, RotateCcw, Square, TerminalSquare, Trash2, Wrench } from 'lucide-react'
import {
  cleanupTask,
  continueTask,
  listAgents,
  listEvents,
  pauseTask,
  resumeTask,
  startTask,
  stopTask,
  subscribeTask,
  type AcceptResult,
  type AgentInfo,
  type RuntimeEvent,
  type TaskDetail,
} from '../../adapters/runtime-client.ts'
import { t, useLocale } from '../../i18n/index.ts'
import { useTaskDetail } from './runtime-hooks.ts'
import { eventText, formatClock, formatDuration, formatMs, formatRelative, shortPath, summarizeToolInput } from './format.ts'
import { DecisionCard } from './decision-card.tsx'
import { AcceptancePanel, ArtifactPanel, MergePanel } from './review-panels.tsx'
import { EmptyState, TaskStatusBadge, statusLabel } from './task-bits.tsx'
import { InterruptBanner } from './interrupt-banner.tsx'

type TaskAction = 'start' | 'stop' | 'resume' | 'pause' | 'continue'

/** Memory window for the transcript; older history is fetched on demand. */
const EVENTS_WINDOW = 2000
const EVENTS_PAGE = 200
const EVENT_FLUSH_MS = 50

export function TaskPage() {
  const { taskId = '' } = useParams()
  const navigate = useNavigate()
  const { locale } = useLocale()
  const { detail, loading, error, applyDetail, refresh } = useTaskDetail(taskId)
  const [events, setEvents] = useState<RuntimeEvent[]>([])
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [unread, setUnread] = useState(0)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState<TaskAction | null>(null)
  const [cleanupBusy, setCleanupBusy] = useState(false)
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [mergeToken, setMergeToken] = useState<string | null>(null)
  const [mergeExpires, setMergeExpires] = useState<number | null>(null)
  const [follow, setFollow] = useState(true)
  const streamRef = useRef<HTMLDivElement>(null)
  const lastIdRef = useRef(0)
  const followRef = useRef(true)
  const flushRef = useRef<() => void>(() => {})
  const loadingOlderRef = useRef(false)

  useEffect(() => {
    setEvents([])
    setHasOlder(false)
    setUnread(0)
    setLoadingOlder(false)
    loadingOlderRef.current = false
    lastIdRef.current = 0
    if (!taskId) return
    let disposed = false
    let close: (() => void) | null = null
    let flushTimer: number | null = null
    const pending: RuntimeEvent[] = []

    function flushNow() {
      if (disposed || pending.length === 0) return
      const batch = pending.splice(0, pending.length)
      setEvents((current) => {
        const seen = new Set(current.map((event) => event.id))
        const next = current.concat(batch.filter((event) => !seen.has(event.id)))
        return next.length > EVENTS_WINDOW ? next.slice(next.length - EVENTS_WINDOW) : next
      })
      setUnread(0)
    }
    flushRef.current = flushNow

    function schedule() {
      if (flushTimer !== null) return
      flushTimer = window.setTimeout(() => {
        flushTimer = null
        if (disposed) return
        if (!followRef.current) { setUnread(pending.length); return }
        flushNow()
      }, EVENT_FLUSH_MS)
    }

    async function attach() {
      try {
        // Latest window first: finished long transcripts open at the end, and
        // older pages arrive through ?before=<id> as the user scrolls up.
        const initial = await listEvents(taskId, { before: Number.MAX_SAFE_INTEGER, limit: 500 })
        if (disposed) return
        const synced = dedupe(initial)
        setEvents(synced.length > EVENTS_WINDOW ? synced.slice(-EVENTS_WINDOW) : synced)
        setHasOlder(initial.length >= 500)
        lastIdRef.current = synced.reduce((max, event) => Math.max(max, event.id), 0)
        close = subscribeTask(taskId, lastIdRef.current, {
          onEvent: (event) => {
            if (event.id <= lastIdRef.current) return
            lastIdRef.current = event.id
            pending.push(event)
            schedule()
            if (event.type === 'decision.requested' || event.type === 'decision.answered') refresh()
          },
          onOpen: () => setStreamError(null),
          onError: () => setStreamError(t('console.task.streamLost')),
        })
      } catch (cause) {
        if (!disposed) setStreamError(cause instanceof Error ? cause.message : String(cause))
      }
    }
    void attach()
    return () => {
      disposed = true
      flushRef.current = () => {}
      if (flushTimer !== null) window.clearTimeout(flushTimer)
      close?.()
    }
  }, [taskId, refresh])

  useEffect(() => {
    if (!follow) return
    flushRef.current()
    setUnread(0)
    const node = streamRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [events, follow])

  async function loadOlder() {
    if (!taskId || loadingOlderRef.current || !hasOlder) return
    const oldest = events[0]?.id
    if (!oldest) return
    loadingOlderRef.current = true
    setLoadingOlder(true)
    setFollow(false)
    followRef.current = false
    const node = streamRef.current
    const prevHeight = node?.scrollHeight ?? 0
    const prevTop = node?.scrollTop ?? 0
    try {
      const older = await listEvents(taskId, { before: oldest, limit: EVENTS_PAGE })
      setHasOlder(older.length >= EVENTS_PAGE)
      if (older.length === 0) return
      setEvents((current) => {
        const seen = new Set(current.map((event) => event.id))
        const merged = older.filter((event) => !seen.has(event.id)).concat(current)
        // Browsing backwards keeps the oldest edge of the window; the newest
        // events stay buffered until the user jumps back to the bottom.
        return merged.length > EVENTS_WINDOW ? merged.slice(0, EVENTS_WINDOW) : merged
      })
      window.requestAnimationFrame(() => {
        const view = streamRef.current
        if (view) view.scrollTop = prevTop + (view.scrollHeight - prevHeight)
      })
    } catch (cause) {
      setStreamError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      loadingOlderRef.current = false
      setLoadingOlder(false)
    }
  }

  useEffect(() => {
    let disposed = false
    listAgents().then((list) => { if (!disposed) setAgents(list) }).catch(() => { /* agent cards fall back to the current agent */ })
    return () => { disposed = true }
  }, [])

  async function runAction(kind: TaskAction) {
    if (!detail || busy) return
    if (kind === 'stop' && !window.confirm(t('console.task.stopConfirm'))) return
    if (kind === 'pause' && !window.confirm(t('console.task.pauseConfirm'))) return
    setBusy(kind)
    setActionError(null)
    try {
      if (kind === 'start') await startTask(taskId)
      else if (kind === 'resume') await resumeTask(taskId)
      else if (kind === 'stop') applyDetail(await stopTask(taskId))
      else if (kind === 'pause') applyDetail(await pauseTask(taskId))
      else applyDetail(await continueTask(taskId))
      refresh()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  function handleAccepted(result: AcceptResult) {
    setActionError(null)
    setMergeToken(result.merge_token)
    setMergeExpires(result.merge_token_expires)
    refresh()
  }

  function handleDetail(next: TaskDetail) {
    applyDetail(next)
    setMergeToken(null)
    setMergeExpires(null)
  }

  async function cleanup() {
    if (cleanupBusy || !canCleanup) return
    if (!window.confirm(t('console.cleanup.confirm'))) return
    setCleanupBusy(true)
    setActionError(null)
    try { applyDetail(await cleanupTask(taskId)) }
    catch (cause) { setActionError(t('console.cleanup.failed', { message: cause instanceof Error ? cause.message : String(cause) })) }
    finally { setCleanupBusy(false) }
  }

  const task = detail?.task
  const runs = detail?.runs ?? []
  const decisions = detail?.decisions ?? []
  const pendingDecision = decisions.find((decision) => decision.status === 'pending') ?? null
  const canStart = task ? task.status === 'ready' || task.status === 'stopped' || task.status === 'failed' : false
  const canResume = Boolean(task?.session_id) && !task?.active && (task?.status === 'stopped' || task?.status === 'failed')
  const canCleanup = Boolean(task && (task.status === 'merged' || task.status === 'completed' || task.status === 'stopped') && (task.branch || task.worktree_path))
  const meta = useMemo(() => {
    if (!detail) return [] as [string, string][]
    const run = detail.runs.find((item) => item.active) ?? detail.runs[0] ?? null
    const item = detail.task
    return [
      [t('console.meta.project'), detail.project?.name ?? '—'],
      [t('console.meta.path'), detail.project?.path ?? '—'],
      [t('console.meta.branch'), item?.branch ?? '—'],
      [t('console.meta.worktree'), item?.worktree_path ?? '—'],
      [t('console.meta.agent'), item?.agent ?? '—'],
      [t('console.meta.permission'), item?.permission_mode ?? '—'],
      [t('console.meta.session'), item?.session_id ?? '—'],
      [t('console.meta.depends'), item?.depends_on?.length ? String(item.depends_on.length) : '—'],
      [t('console.meta.decisions'), String(detail.decisions.length)],
      [t('console.meta.created'), item ? formatClock(item.created_at, locale) : '—'],
      [t('console.meta.duration'), run ? formatDuration(run.started_at, run.ended_at) : '—'],
      [t('console.meta.runs'), String(detail.runs.length)],
    ] as [string, string][]
  }, [detail, locale])

  if (loading && !detail) {
    return <section className="console-page"><div className="page-loading"><Loader2 className="spin" aria-hidden="true" />{t('common.loading')}</div></section>
  }

  if (!detail || !task) {
    return (
      <section className="console-page">
        <button type="button" className="console-back" onClick={() => navigate('/today')}><ArrowLeft aria-hidden="true" />{t('console.task.back')}</button>
        <EmptyState icon={<TerminalSquare aria-hidden="true" />} title={t('console.task.missingTitle')} body={error ?? t('console.task.missingBody')}>
          <Link className="button primary" to="/today">{t('console.task.back')}</Link>
        </EmptyState>
      </section>
    )
  }

  return (
    <section className="console-page task-page">
      <header className="task-page-head">
        <div className="task-page-heading">
          <button type="button" className="console-back" onClick={() => navigate('/today')}><ArrowLeft aria-hidden="true" />{t('console.task.back')}</button>
          <div className="task-title-row">
            <h1 className="console-title">{task.title}</h1>
            <TaskStatusBadge status={task.status} active={task.active} />
          </div>
          <p className="console-subtitle">{task.project_name ?? task.project_id} · {task.agent} · {t('console.task.updated')} {formatRelative(task.updated_at, locale)}</p>
        </div>
        <div className="console-actions">
          {task.status === 'running' ? (
            <>
              <button type="button" className="button ghost" disabled={busy !== null} onClick={() => void runAction('pause')} title={t('console.task.pause')}>
                {busy === 'pause' ? <Loader2 className="spin" aria-hidden="true" /> : <Pause aria-hidden="true" />}{t('console.task.pause')}
              </button>
              <button type="button" className="button danger" disabled={busy !== null} onClick={() => void runAction('stop')}>
                {busy === 'stop' ? <Loader2 className="spin" aria-hidden="true" /> : <Square aria-hidden="true" />}{t('console.task.stop')}
              </button>
            </>
          ) : task.status === 'paused' ? (
            <>
              <button type="button" className="button primary" disabled={busy !== null} onClick={() => void runAction('continue')}>
                {busy === 'continue' ? <Loader2 className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}{t('console.task.continue')}
              </button>
              <button type="button" className="button danger" disabled={busy !== null} onClick={() => void runAction('stop')}>
                {busy === 'stop' ? <Loader2 className="spin" aria-hidden="true" /> : <Square aria-hidden="true" />}{t('console.task.stop')}
              </button>
            </>
          ) : task.status === 'queued' ? (
            <button type="button" className="button danger" disabled={busy !== null} onClick={() => void runAction('stop')}>
              {busy === 'stop' ? <Loader2 className="spin" aria-hidden="true" /> : <Square aria-hidden="true" />}{t('console.task.stop')}
            </button>
          ) : task.status === 'review' || task.status === 'pending_merge' ? null : task.status === 'merged' || task.status === 'completed' ? (
            canCleanup ? (
              <button type="button" className="button ghost" disabled={cleanupBusy} onClick={() => void cleanup()}>
                {cleanupBusy ? <Loader2 className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}{t('console.cleanup.action')}
              </button>
            ) : null
          ) : (
            <>
              {canStart ? (
                <button type="button" className="button primary" disabled={busy !== null} onClick={() => void runAction('start')}>
                  {busy === 'start' ? <Loader2 className="spin" aria-hidden="true" /> : <Play aria-hidden="true" />}{task.status === 'ready' ? t('console.task.start') : t('console.task.retry')}
                </button>
              ) : null}
              <button type="button" className="button ghost" disabled={busy !== null || !canResume} onClick={() => void runAction('resume')} title={canResume ? undefined : t('console.task.noSession')}>
                {busy === 'resume' ? <Loader2 className="spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}{t('console.task.resume')}
              </button>
              {canCleanup ? (
                <button type="button" className="button ghost" disabled={cleanupBusy} onClick={() => void cleanup()}>
                  {cleanupBusy ? <Loader2 className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}{t('console.cleanup.action')}
                </button>
              ) : null}
            </>
          )}
        </div>
      </header>

      {(error || actionError || streamError) && <p className="console-banner error" role="alert">{actionError ?? error ?? streamError}</p>}
      {task.status === 'queued' ? <p className="console-banner">{t('console.task.queuedNotice')}</p> : null}
      <InterruptBanner task={task} busy={busy === 'resume'} canResume={canResume} onResume={() => void runAction('resume')} />

      {task.status === 'review' ? (
        <AcceptancePanel
          task={task}
          artifacts={detail.artifacts}
          agents={agents}
          onAccepted={handleAccepted}
          onRejected={() => refresh()}
        />
      ) : null}

      <p className="visually-hidden" role="status" aria-live="polite">
        {t('console.task.statusAnnounce', { status: statusLabel(task.status) })}
      </p>

      {task.status === 'pending_merge' ? (
        <MergePanel
          task={task}
          token={task.status === 'pending_merge' ? mergeToken : null}
          expiresAt={task.status === 'pending_merge' ? mergeExpires : null}
          onToken={handleAccepted}
          onChanged={handleDetail}
        />
      ) : null}

      {pendingDecision ? (
        <section className="task-decision-strip">
          <DecisionCard decision={pendingDecision} onAnswered={() => refresh()} />
        </section>
      ) : null}

      <div className="task-layout">
        <div className="task-stream-pane">
          <header className="pane-head">
            <div>
              <h2>{t('console.task.streamTitle')}</h2>
              <span>{events.length} {t('console.task.events')}</span>
            </div>
            {!follow && events.length > 0 && (
              <button type="button" className="button ghost small" onClick={() => { flushRef.current(); followRef.current = true; setFollow(true); const node = streamRef.current; if (node) node.scrollTop = node.scrollHeight }}>
                <ChevronDown aria-hidden="true" />{t('console.task.jumpLatest')}
                {unread > 0 ? <span className="stream-unread">{t('console.task.newEvents', { n: String(unread) })}</span> : null}
              </button>
            )}
          </header>
          <div
            ref={streamRef}
            className="task-stream"
            onScroll={(event) => {
              const node = event.currentTarget
              const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80
              followRef.current = atBottom
              setFollow(atBottom)
              if (node.scrollTop < 48 && hasOlder && !loadingOlderRef.current) void loadOlder()
            }}
          >
            {hasOlder || loadingOlder ? (
              <div className="stream-older">
                <button type="button" className="button ghost small" disabled={loadingOlder} onClick={() => void loadOlder()}>
                  {loadingOlder ? <Loader2 className="spin" aria-hidden="true" /> : null}
                  {loadingOlder ? t('console.task.olderLoading') : t('console.task.olderLoad')}
                </button>
              </div>
            ) : null}
            {events.length === 0
              ? <div className="stream-empty"><TerminalSquare aria-hidden="true" /><p>{t('console.task.waiting')}</p></div>
              : events.map((event) => <EventItem key={event.id} event={event} />)}
          </div>
        </div>

        <aside className="task-meta-pane">
          <section className="panel-card">
            <header className="panel-card-head"><h2>{t('console.task.promptTitle')}</h2></header>
            <p className="meta-prompt">{task.prompt}</p>
          </section>
          <ArtifactPanel taskId={task.id} artifacts={detail.artifacts} onChanged={() => refresh()} />
          <section className="panel-card">
            <header className="panel-card-head"><h2>{t('console.task.metaTitle')}</h2></header>
            <dl className="meta-grid">
              {meta.map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd title={value}>{label === t('console.meta.path') || label === t('console.meta.worktree') ? shortPath(value, 52) : value}</dd></div>
              ))}
            </dl>
          </section>
          <section className="panel-card">
            <header className="panel-card-head"><h2>{t('console.task.runsTitle')}</h2></header>
            {runs.length === 0 ? <p className="preview-muted">{t('console.task.noRuns')}</p> : (
              <ul className="run-list">
                {runs.map((run) => (
                  <li key={run.id}>
                    <div><strong>{run.status}</strong><span>{formatClock(run.started_at, locale)}</span></div>
                    <div><span>{t('console.task.exit')} {run.exit_code ?? '—'}</span><span>{formatDuration(run.started_at, run.ended_at)}</span></div>
                    {run.error && <p className="form-error">{run.error}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </section>
  )
}

function dedupe(events: RuntimeEvent[]): RuntimeEvent[] {
  const seen = new Set<number>()
  return events.filter((event) => {
    if (seen.has(event.id)) return false
    seen.add(event.id)
    return true
  })
}

const EventItem = memo(function EventItem({ event }: { event: RuntimeEvent }) {
  const { locale } = useLocale()
  const { payload } = event
  if (event.type === 'message.assistant') {
    return <article className="stream-item assistant"><header><span className="stream-dot" />{t('console.event.assistant')}<time>{formatClock(event.ts, locale)}</time></header><p>{eventText(payload, 'text')}</p></article>
  }
  if (event.type === 'message.thinking') {
    return <details className="stream-item thinking"><summary><ChevronDown aria-hidden="true" />{t('console.event.thinking')}</summary><p>{eventText(payload, 'text')}</p></details>
  }
  if (event.type === 'message.user') {
    return <article className="stream-item user"><header>{t('console.event.user')}</header><p>{eventText(payload, 'text')}</p></article>
  }
  if (event.type === 'tool.started') {
    return (
      <article className="stream-item tool">
        <header><Wrench aria-hidden="true" />{t('console.event.tool')}<strong>{eventText(payload, 'name')}</strong></header>
        <pre>{summarizeToolInput(payload.input)}</pre>
      </article>
    )
  }
  if (event.type === 'tool.completed') {
    const content = summarizeToolInput(payload.content)
    return (
      <details className={`stream-item tool-result${payload.isError ? ' is-error' : ''}`}>
        <summary>{payload.isError ? t('console.event.toolFailed') : t('console.event.toolDone')}{content ? <span className="tool-result-preview">{content.slice(0, 120)}</span> : null}</summary>
        <pre>{content}</pre>
      </details>
    )
  }
  if (event.type === 'run.starting') {
    return <p className="stream-system"><Play aria-hidden="true" />{t('console.event.running', { model: eventText(payload, 'agent') || eventText(payload, 'model') || '—' })}</p>
  }
  if (event.type === 'run.completed') {
    const turns = Number(payload.numTurns)
    return <p className="stream-system done"><span className="stream-dot" />{t('console.event.doneDetail', { turns: Number.isFinite(turns) ? String(turns) : '—', duration: formatMs(Number(payload.durationMs)) })}</p>
  }
  if (event.type === 'run.failed') {
    return <p className="stream-system failed"><span className="stream-dot" />{t('console.event.failDetail')} {eventText(payload, 'result')}</p>
  }
  if (event.type === 'run.paused') {
    return <p className="stream-system paused"><Pause aria-hidden="true" />{t('console.event.paused')}</p>
  }
  if (event.type === 'run.resumed') {
    return <p className="stream-system"><Play aria-hidden="true" />{t('console.event.resumed')}</p>
  }
  if (event.type === 'task.queued') {
    return <p className="stream-system queued"><span className="stream-dot" />{t('console.event.queued')}</p>
  }
  if (event.type === 'decision.requested') {
    return <p className="stream-system decision"><span className="stream-dot" />{t('console.event.decision')}<strong>{eventText(payload, 'question')}</strong></p>
  }
  if (event.type === 'decision.answered') {
    return <p className="stream-system done"><span className="stream-dot" />{t('console.event.decisionAnswered')}</p>
  }
  if (event.type === 'task.review_requested') {
    return <p className="stream-system review"><span className="stream-dot" />{t('console.event.review')}</p>
  }
  if (event.type === 'task.accepted') {
    return <p className="stream-system done"><span className="stream-dot" />{t('console.event.accepted')}</p>
  }
  if (event.type === 'task.rejected') {
    return <p className="stream-system queued"><span className="stream-dot" />{t('console.event.rejected')}</p>
  }
  if (event.type === 'task.merged') {
    return <p className="stream-system done"><span className="stream-dot" />{t('console.event.merged')}</p>
  }
  if (event.type === 'task.merge_authorized') {
    return <p className="stream-system"><span className="stream-dot" />{t('console.event.mergeAuthorized')}</p>
  }
  if (event.type === 'task.merge_abandoned') {
    return <p className="stream-system"><span className="stream-dot" />{t('console.event.mergeAbandoned')}</p>
  }
  if (event.type === 'task.cleaned') {
    return <p className="stream-system"><span className="stream-dot" />{t('console.event.cleaned')}</p>
  }
  if (event.type === 'artifacts.collected') {
    return <p className="stream-system"><span className="stream-dot" />{t('console.event.artifacts', { n: String(payload.count ?? 0) })}</p>
  }
  if (event.type === 'artifact.added' || event.type === 'artifact.removed') {
    return <p className="stream-system"><span className="stream-dot" />{t(event.type === 'artifact.added' ? 'console.event.artifactAdded' : 'console.event.artifactRemoved', { name: eventText(payload, 'name') })}</p>
  }
  if (event.type === 'log.stderr' || event.type === 'log.stdout') {
    // Supervisor stderr chunks use `text`; adapters use `line`. Accept both.
    const text = eventText(payload, 'line') || eventText(payload, 'text')
    if (!text.trim()) return null
    return <pre className={'stream-log' + (event.type === 'log.stderr' ? ' error' : '')}>{text}</pre>
  }
  return null
})
