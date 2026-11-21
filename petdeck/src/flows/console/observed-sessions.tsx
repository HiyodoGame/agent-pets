import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Eye, Loader2, RefreshCw, X } from 'lucide-react'
import {
  getObservedSessions,
  getObservedTranscript,
  type ObservedSession,
  type ObservedTranscript,
} from '../../adapters/runtime-client.ts'
import { t, useLocale } from '../../i18n/index.ts'
import { formatRelative } from './format.ts'
import { useFocusTrap } from './focus-trap.ts'

const VISIBLE = 5
const POLL_MS = 8000

function stateLabel(state: ObservedSession['state']): string {
  if (state === 'running') return t('console.observe.stateRunning')
  if (state === 'error') return t('console.observe.stateError')
  return t('console.observe.stateIdle')
}

function sessionTitle(session: ObservedSession): string {
  const title = session.title?.trim()
  return title ? title : t('console.observe.untitled')
}

function sessionProject(session: ObservedSession): string {
  return session.project?.trim() || t('console.observe.noProject')
}

function roleLabel(role: string): string {
  if (role === 'user') return t('console.observe.roleUser')
  if (role === 'assistant') return t('console.observe.roleAssistant')
  return t('console.observe.roleSystem')
}

/** Read-only strip of sessions that belong to observe-only adapters. It never
 *  links into /tasks or /reports: those pages only read runtime tasks. */
export function ObservedSessionsPanel() {
  const { locale } = useLocale()
  const [sessions, setSessions] = useState<ObservedSession[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [initialId, setInitialId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const snapshot = await getObservedSessions(20)
      setSessions(snapshot.sessions)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    let disposed = false
    load().finally(() => { if (!disposed) setLoading(false) })
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, POLL_MS)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [load])

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try { await load() } finally { setRefreshing(false) }
  }

  function openSession(session: ObservedSession) {
    setInitialId(session.agent + ':' + session.session)
    setOpen(true)
  }

  const visible = sessions.slice(0, VISIBLE)

  return (
    <section className="observed-sessions" aria-label={t('console.observe.title')}>
      <header className="observed-head">
        <div className="observed-heading">
          <Eye aria-hidden="true" />
          <h2>{t('console.observe.title')}</h2>
          <span className="observe-tag">{t('console.observe.readOnly')}</span>
        </div>
        <div className="observed-head-actions">
          <button type="button" className="button ghost icon-only" aria-label={t('console.settings.healthRefresh')} onClick={() => void refresh()}>
            {refreshing ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          </button>
          <button type="button" className="button ghost" onClick={() => { setInitialId(null); setOpen(true) }}>{t('console.observe.viewAll')}</button>
        </div>
      </header>

      {error ? (
        <p className="console-banner error" role="alert"><AlertTriangle aria-hidden="true" />{error}</p>
      ) : loading ? (
        <p className="observed-empty"><Loader2 className="spin" aria-hidden="true" />{t('console.observe.loading')}</p>
      ) : visible.length === 0 ? (
        <p className="observed-empty">{t('console.observe.empty')}</p>
      ) : (
        <div className="observed-strip">
          {visible.map((session) => (
            <button
              type="button"
              className="observed-card"
              key={session.agent + ':' + session.session}
              onClick={() => openSession(session)}
            >
              <span className="observed-card-top">
                <span className="observed-dot" data-state={session.state} aria-hidden="true" />
                <span className="observed-agent">{session.agentName || session.agent}</span>
                <span className="observed-state">{stateLabel(session.state)}</span>
              </span>
              <strong className="observed-title">{sessionTitle(session)}</strong>
              <span className="observed-meta">{sessionProject(session)} · {session.updatedAt ? formatRelative(session.updatedAt, locale) : t('console.observe.updated')}</span>
            </button>
          ))}
        </div>
      )}

      {open ? (
        <ObservedSessionsDialog
          sessions={sessions}
          initialId={initialId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  )
}

function ObservedSessionsDialog({ sessions, initialId, onClose }: {
  sessions: ObservedSession[]
  initialId: string | null
  onClose: () => void
}) {
  const { locale } = useLocale()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(initialId ?? (sessions[0] ? sessions[0].agent + ':' + sessions[0].session : null))
  const [transcript, setTranscript] = useState<ObservedTranscript | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useFocusTrap(dialogRef)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const selected = sessions.find((session) => session.agent + ':' + session.session === selectedKey) ?? sessions[0] ?? null
  const selectedAgent = selected?.agent
  const selectedSession = selected?.session

  useEffect(() => {
    if (!selectedAgent || !selectedSession) { setTranscript(null); return }
    let disposed = false
    setLoading(true)
    setError(null)
    getObservedTranscript(selectedAgent, selectedSession, 20)
      .then((data) => { if (!disposed) setTranscript(data) })
      .catch((cause) => { if (!disposed) { setTranscript(null); setError(cause instanceof Error ? cause.message : String(cause)) } })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [selectedAgent, selectedSession])

  return (
    <div className="console-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="console-dialog wide observed-dialog" role="dialog" aria-modal="true" aria-labelledby="observed-title">
        <header className="console-dialog-head">
          <div>
            <h2 id="observed-title"><Eye aria-hidden="true" />{t('console.observe.transcriptTitle')}</h2>
            <p>{selected ? sessionTitle(selected) + ' · ' + (selected.agentName || selected.agent) + ' · ' + sessionProject(selected) : t('console.observe.empty')}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}><X aria-hidden="true" /></button>
        </header>

        <div className="observed-dialog-body">
          <nav className="observed-list" aria-label={t('console.observe.title')}>
            {sessions.length === 0 ? <p className="observed-empty">{t('console.observe.empty')}</p> : sessions.map((session) => {
              const key = session.agent + ':' + session.session
              return (
                <button
                  type="button"
                  key={key}
                  className="observed-list-item"
                  data-active={key === selectedKey}
                  onClick={() => setSelectedKey(key)}
                >
                  <span className="observed-card-top">
                    <span className="observed-dot" data-state={session.state} aria-hidden="true" />
                    <span className="observed-agent">{session.agentName || session.agent}</span>
                  </span>
                  <strong>{sessionTitle(session)}</strong>
                  <span className="observed-meta">{sessionProject(session)} · {session.updatedAt ? formatRelative(session.updatedAt, locale) : t('console.observe.updated')}</span>
                </button>
              )
            })}
          </nav>

          <div className="observed-transcript">
            {loading ? (
              <p className="observed-empty"><Loader2 className="spin" aria-hidden="true" />{t('console.observe.loading')}</p>
            ) : error ? (
              <p className="console-banner error" role="alert"><AlertTriangle aria-hidden="true" />{error}</p>
            ) : transcript?.unsupported ? (
              <p className="observed-empty">{t('console.observe.transcriptUnsupported')}</p>
            ) : !transcript || transcript.lines.length === 0 ? (
              <p className="observed-empty">{t('console.observe.transcriptEmpty')}</p>
            ) : (
              <ol className="transcript-list">
                {transcript.lines.map((line, index) => (
                  <li className="transcript-line" key={index} data-role={line.role}>
                    <span className="transcript-role">{roleLabel(line.role)}</span>
                    <p>{line.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <footer className="console-dialog-actions">
          <p className="settings-note">{t('console.observe.readonlyNote')}</p>
        </footer>
      </div>
    </div>
  )
}
