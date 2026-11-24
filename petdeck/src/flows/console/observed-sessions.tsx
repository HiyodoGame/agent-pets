import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Archive, ArchiveRestore, Check, Eye, Loader2, Pencil, RefreshCw, Undo2, X } from 'lucide-react'
import {
  getObservedSessions,
  getObservedTranscript,
  type ObservedSession,
  type ObservedTranscript,
} from '../../adapters/runtime-client.ts'
import { t, useLocale } from '../../i18n/index.ts'
import { formatRelative } from './format.ts'
import { useFocusTrap } from './focus-trap.ts'
import { runtimeErrorText } from './runtime-error.ts'
import { ObservedHandoff } from './observe/handoff-composer.tsx'
import {
  isObservedArchived, loadObservedViewState, observedKey, renameObserved,
  saveObservedViewState, setObservedArchived, titleForObserved,
  type ObservedViewState,
} from './observe/view-state.ts'

const VISIBLE = 5
const POLL_MS = 8000
const NOTICE_MS = 8000

function viewStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

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

function keyOf(session: ObservedSession): string {
  return observedKey(session.agent, session.session, session.host)
}

function shownTitle(session: ObservedSession, view: ObservedViewState): string {
  return titleForObserved(view, session.agent, session.session, session.host) ?? sessionTitle(session)
}

function archivedFlag(session: ObservedSession, view: ObservedViewState): boolean {
  return isObservedArchived(view, session.agent, session.session, session.host)
}

/** Read-only strip of sessions that belong to observe-only adapters. It never
 *  links into /tasks or /reports: those pages only read runtime tasks. */
export function ObservedSessionsPanel() {
  const { locale } = useLocale()
  const [searchParams, setSearchParams] = useSearchParams()
  const focusParam = searchParams.get('observe')
  const [sessions, setSessions] = useState<ObservedSession[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [initialId, setInitialId] = useState<string | null>(null)
  const [initialShowArchived, setInitialShowArchived] = useState(false)
  const [view, setView] = useState<ObservedViewState>(() => loadObservedViewState(viewStorage()))
  const [notice, setNotice] = useState<{ text: string; undo: () => void } | null>(null)

  const mutate = useCallback((next: (previous: ObservedViewState) => ObservedViewState) => {
    setView((previous) => saveObservedViewState(viewStorage(), next(previous)))
  }, [])

  const load = useCallback(async () => {
    try {
      const snapshot = await getObservedSessions(20)
      setSessions(snapshot.sessions)
      setError(null)
    } catch (cause) {
      setError(runtimeErrorText(cause))
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

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try { await load() } finally { setRefreshing(false) }
  }

  function openSession(session: ObservedSession | null, showArchived = false) {
    setInitialId(session ? keyOf(session) : null)
    setInitialShowArchived(showArchived)
    setOpen(true)
  }

  function rename(session: ObservedSession, title: string) {
    mutate((previous) => renameObserved(previous, session.agent, session.session, title, session.host))
  }

  function archive(session: ObservedSession, archived: boolean) {
    mutate((previous) => setObservedArchived(previous, session.agent, session.session, archived, session.host))
    if (archived) {
      setNotice({
        text: t('console.observe.archivedNotice', { title: shownTitle(session, view) }),
        undo: () => {
          mutate((previous) => setObservedArchived(previous, session.agent, session.session, false, session.host))
          setNotice(null)
        },
      })
    } else {
      setNotice(null)
    }
  }

  const archivedCount = sessions.filter((session) => archivedFlag(session, view)).length
  const visible = sessions.filter((session) => !archivedFlag(session, view)).slice(0, VISIBLE)

  // Desktop pet / tray deep link: /today?observe=<session or agent:session>.
  useEffect(() => {
    if (!focusParam || loading) return
    const match = sessions.find((session) => session.session === focusParam
      || observedKey(session.agent, session.session) === focusParam
      || keyOf(session) === focusParam)
    if (match) openSession(match)
    const next = new URLSearchParams(searchParams)
    next.delete('observe')
    setSearchParams(next, { replace: true })
  }, [focusParam, loading, sessions, searchParams, setSearchParams])

  return (
    <section className="observed-sessions" aria-label={t('console.observe.title')}>
      <header className="observed-head">
        <div className="observed-heading">
          <Eye aria-hidden="true" />
          <h2>{t('console.observe.title')}</h2>
          <span className="observe-tag">{t('console.observe.readOnly')}</span>
        </div>
        <div className="observed-head-actions">
          {archivedCount > 0 ? (
            <button type="button" className="button ghost" onClick={() => openSession(null, true)}>
              <Archive aria-hidden="true" />{t('console.observe.showArchived', { n: archivedCount })}
            </button>
          ) : null}
          <button type="button" className="button ghost icon-only" aria-label={t('console.settings.healthRefresh')} onClick={() => void refresh()}>
            {refreshing ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          </button>
          <button type="button" className="button ghost" onClick={() => openSession(null)}>{t('console.observe.viewAll')}</button>
        </div>
      </header>

      {notice ? (
        <div className="observed-notice" role="status">
          <span>{notice.text}</span>
          <button type="button" className="button ghost small" onClick={notice.undo}><Undo2 aria-hidden="true" />{t('console.observe.undo')}</button>
        </div>
      ) : null}

      {error ? (
        <div className="observed-error">
          <p className="console-banner error" role="alert"><AlertTriangle aria-hidden="true" />{error}</p>
          <button type="button" className="button ghost" onClick={() => void refresh()}>{t('common.retry')}</button>
        </div>
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
              key={keyOf(session)}
              onClick={() => openSession(session)}
            >
              <span className="observed-card-top">
                <span className="observed-dot" data-state={session.state} aria-hidden="true" />
                <span className="observed-agent">{session.agentName || session.agent}</span>
                <span className="observed-state">{stateLabel(session.state)}</span>
              </span>
              <strong className="observed-title">{shownTitle(session, view)}</strong>
              <span className="observed-meta">{sessionProject(session)} · {session.updatedAt ? formatRelative(session.updatedAt, locale) : t('console.observe.updated')}</span>
            </button>
          ))}
        </div>
      )}

      {open ? (
        <ObservedSessionsDialog
          sessions={sessions}
          view={view}
          initialId={initialId}
          initialShowArchived={initialShowArchived}
          onRename={rename}
          onArchive={archive}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </section>
  )
}

function ObservedSessionsDialog({ sessions, view, initialId, initialShowArchived, onRename, onArchive, onClose }: {
  sessions: ObservedSession[]
  view: ObservedViewState
  initialId: string | null
  initialShowArchived: boolean
  onRename: (session: ObservedSession, title: string) => void
  onArchive: (session: ObservedSession, archived: boolean) => void
  onClose: () => void
}) {
  const { locale } = useLocale()
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstKey = sessions[0] ? keyOf(sessions[0]) : null
  const [selectedKey, setSelectedKey] = useState<string | null>(initialId ?? firstKey)
  const [showArchived, setShowArchived] = useState(initialShowArchived)
  const [transcript, setTranscript] = useState<ObservedTranscript | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<'transcript' | 'handoff'>('transcript')
  const [renaming, setRenaming] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  useFocusTrap(dialogRef)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => { dialogRef.current?.focus() }, [])

  const selected = sessions.find((session) => keyOf(session) === selectedKey)
    ?? sessions.find((session) => !archivedFlag(session, view))
    ?? sessions[0]
    ?? null
  const selectedAgent = selected?.agent
  const selectedSession = selected?.session
  const selectedArchived = selected ? archivedFlag(selected, view) : false
  const selectedTitle = selected ? shownTitle(selected, view) : ''

  useEffect(() => {
    if (!selectedAgent || !selectedSession) { setTranscript(null); return }
    let disposed = false
    setLoading(true)
    setError(null)
    getObservedTranscript(selectedAgent, selectedSession, 20)
      .then((data) => { if (!disposed) setTranscript(data) })
      .catch((cause) => { if (!disposed) { setTranscript(null); setError(runtimeErrorText(cause)) } })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [selectedAgent, selectedSession, reloadTick])

  useEffect(() => { setMode('transcript'); setRenaming(false) }, [selectedKey])

  const displayed = sessions.filter((session) => showArchived || !archivedFlag(session, view) || keyOf(session) === selectedKey)
  const archivedCount = sessions.filter((session) => archivedFlag(session, view)).length

  function beginRename() {
    if (!selected) return
    setDraftTitle(selectedTitle)
    setRenaming(true)
  }

  function commitRename() {
    if (!selected) return
    onRename(selected, draftTitle)
    setRenaming(false)
  }

  return (
    <div className="console-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} tabIndex={-1} className="console-dialog wide observed-dialog" role="dialog" aria-modal="true" aria-labelledby="observed-title">
        <header className="console-dialog-head">
          <div className="observed-dialog-heading">
            <h2 id="observed-title"><Eye aria-hidden="true" />{t('console.observe.transcriptTitle')}</h2>
            {renaming ? (
              <div className="observed-rename">
                <input
                  value={draftTitle}
                  maxLength={200}
                  aria-label={t('console.observe.rename')}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); commitRename() }
                    if (event.key === 'Escape') { event.preventDefault(); setRenaming(false) }
                  }}
                  autoFocus
                />
                <button type="button" className="button primary small" onClick={commitRename}><Check aria-hidden="true" />{t('console.observe.save')}</button>
                <button type="button" className="button ghost small" onClick={() => setRenaming(false)}>{t('common.cancel')}</button>
              </div>
            ) : (
              <p>
                {selected ? selectedTitle + ' · ' + (selected.agentName || selected.agent) + ' · ' + sessionProject(selected) : t('console.observe.empty')}
                {selectedArchived ? <span className="observed-archived-badge">{t('console.observe.archivedBadge')}</span> : null}
              </p>
            )}
          </div>
          <div className="observed-dialog-actions">
            {selected && !renaming ? (
              <>
                <button type="button" className="icon-button" aria-label={t('console.observe.rename')} title={t('console.observe.rename')} onClick={beginRename}><Pencil aria-hidden="true" /></button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={selectedArchived ? t('console.observe.unarchive') : t('console.observe.archive')}
                  title={selectedArchived ? t('console.observe.unarchive') : t('console.observe.archive')}
                  onClick={() => onArchive(selected, !selectedArchived)}
                >
                  {selectedArchived ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                </button>
              </>
            ) : null}
            <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}><X aria-hidden="true" /></button>
          </div>
        </header>

        <div className="observed-dialog-body">
          <nav className="observed-list" aria-label={t('console.observe.title')}>
            {archivedCount > 0 ? (
              <button type="button" className="observed-archived-toggle" aria-pressed={showArchived} onClick={() => setShowArchived((value) => !value)}>
                {showArchived ? t('console.observe.hideArchived') : t('console.observe.showArchived', { n: archivedCount })}
              </button>
            ) : null}
            {displayed.length === 0 ? <p className="observed-empty">{t('console.observe.empty')}</p> : displayed.map((session) => {
              const key = keyOf(session)
              const archived = archivedFlag(session, view)
              return (
                <button
                  type="button"
                  key={key}
                  className="observed-list-item"
                  data-active={key === selectedKey}
                  data-archived={archived}
                  onClick={() => setSelectedKey(key)}
                >
                  <span className="observed-card-top">
                    <span className="observed-dot" data-state={session.state} aria-hidden="true" />
                    <span className="observed-agent">{session.agentName || session.agent}</span>
                    {archived ? <span className="observed-archived-badge">{t('console.observe.archivedBadge')}</span> : null}
                  </span>
                  <strong>{shownTitle(session, view)}</strong>
                  <span className="observed-meta">{sessionProject(session)} · {session.updatedAt ? formatRelative(session.updatedAt, locale) : t('console.observe.updated')}</span>
                </button>
              )
            })}
          </nav>

          <div className="observed-pane">
            {mode === 'handoff' && selected ? (
              <ObservedHandoff
                agent={selected.agentName || selected.agent}
                sessionTitle={selectedTitle}
                lastMessage={selected.lastMessage}
                lines={transcript?.lines}
                onClose={() => setMode('transcript')}
              />
            ) : (
              <>
                <div className="observed-transcript-actions">
                  <button type="button" className="button ghost small" disabled={!selected} onClick={() => setMode('handoff')}>
                    <Pencil aria-hidden="true" />{t('console.observe.handoffOpen')}
                  </button>
                </div>
                <div className="observed-transcript">
                  {loading ? (
                    <p className="observed-empty"><Loader2 className="spin" aria-hidden="true" />{t('console.observe.loading')}</p>
                  ) : error ? (
                    <div className="observed-error">
                      <p className="console-banner error" role="alert"><AlertTriangle aria-hidden="true" />{error}</p>
                      <button type="button" className="button ghost" onClick={() => setReloadTick((value) => value + 1)}>{t('common.retry')}</button>
                    </div>
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
              </>
            )}
          </div>
        </div>

        <footer className="console-dialog-actions">
          <p className="settings-note">{t('console.observe.readonlyNote')}</p>
          <p className="settings-note">{t('console.observe.localOnly')}</p>
        </footer>
      </div>
    </div>
  )
}
