import { useEffect, useState } from 'react'
import { FileText, Image as ImageIcon, Loader2, Plus, Send, ShieldCheck, Trash2, TriangleAlert, Video } from 'lucide-react'
import {
  abandonMerge,
  acceptTask,
  addArtifact,
  artifactContentUrl,
  authorizeMerge,
  getMergePreview,
  mergeTask,
  rejectTask,
  removeArtifact,
  RuntimeClientError,
  type AcceptResult,
  type AgentInfo,
  type Artifact,
  type MergePreview,
  type Task,
  type TaskDetail,
} from '../../adapters/runtime-client.ts'
import { t, useLocale } from '../../i18n/index.ts'
import { formatBytes, formatClock } from './format.ts'

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function detailsOf(cause: unknown): Record<string, unknown> | null {
  return cause instanceof RuntimeClientError ? cause.details : null
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function ArtifactGallery({ artifacts, compact = false }: { artifacts: Artifact[]; compact?: boolean }) {
  if (artifacts.length === 0) return <p className="preview-muted">{t('console.artifacts.empty')}</p>
  return (
    <div className={`artifact-grid${compact ? ' compact' : ''}`}>
      {artifacts.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} />)}
    </div>
  )
}

export function ArtifactCard({ artifact }: { artifact: Artifact }) {
  const { locale } = useLocale()
  const url = artifactContentUrl(artifact.id)
  const meta = `${formatBytes(artifact.bytes)} · ${artifact.source === 'auto' ? t('console.artifacts.sourceAuto') : t('console.artifacts.sourceManual')}`
  return (
    <figure className="artifact-card" data-kind={artifact.kind}>
      <div className="artifact-preview">
        {artifact.kind === 'image' ? (
          <a href={url} target="_blank" rel="noreferrer" title={artifact.name}><img src={url} alt={artifact.name} loading="lazy" /></a>
        ) : artifact.kind === 'video' ? (
          <video src={url} controls preload="metadata" />
        ) : artifact.kind === 'audio' ? (
          <audio src={url} controls preload="metadata" />
        ) : (
          <a className="artifact-file" href={url} target="_blank" rel="noreferrer">
            {artifact.kind === 'pdf' ? <FileText aria-hidden="true" /> : <ImageIcon aria-hidden="true" />}
            <span>{artifact.name}</span>
          </a>
        )}
      </div>
      <figcaption>
        <span className="artifact-name" title={artifact.name}>{artifact.name}</span>
        <span className="artifact-meta">{meta} · {formatClock(artifact.created_at, locale)}</span>
        <a className="artifact-link" href={url} download={artifact.name}>{t('console.artifacts.download')}</a>
      </figcaption>
    </figure>
  )
}

export function AcceptancePanel({
  task,
  artifacts,
  agents,
  onAccepted,
  onRejected,
}: {
  task: Task
  artifacts: Artifact[]
  agents: AgentInfo[]
  onAccepted: (result: AcceptResult) => void
  onRejected: () => void
}) {
  const [rejecting, setRejecting] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [agent, setAgent] = useState(task.agent)
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setAgent(task.agent)
  }, [task.agent])

  async function accept() {
    if (busy) return
    setBusy('accept')
    setError(null)
    try {
      onAccepted(await acceptTask(task.id))
    } catch (cause) {
      setError(t('console.review.acceptFailed', { message: messageOf(cause) }))
    } finally {
      setBusy(null)
    }
  }

  async function reject() {
    if (busy) return
    if (!feedback.trim()) {
      setError(t('console.review.feedbackRequired'))
      return
    }
    setBusy('reject')
    setError(null)
    try {
      await rejectTask(task.id, feedback.trim(), agent)
      setRejecting(false)
      setFeedback('')
      onRejected()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(null)
    }
  }

  const optionAgents = agents.length > 0 ? agents : [{ id: task.agent, name: task.agent } as AgentInfo]

  return (
    <section className="panel-card review-panel" aria-label={t('console.review.title')}>
      <header className="review-head">
        <div>
          <span className="review-kicker"><ShieldCheck aria-hidden="true" />{t('console.review.title')}</span>
          <h2>{t('console.review.summaryTitle')}</h2>
        </div>
        <div className="review-head-meta">
          {Number(task.reject_count ?? 0) > 0 ? <span>{t('console.review.rejectCount', { n: String(task.reject_count) })}</span> : null}
        </div>
      </header>
      <p className="review-summary">{task.summary?.trim() || t('console.review.summaryFallback')}</p>
      {task.last_feedback ? (
        <div className="review-feedback-history">
          <span>{t('console.review.lastFeedback')}</span>
          <p>{task.last_feedback}</p>
        </div>
      ) : null}
      <ArtifactGallery artifacts={artifacts} compact />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {rejecting ? (
        <div className="review-reject-form">
          <label className="field">
            <span>{t('console.review.feedback')}</span>
            <textarea rows={4} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder={t('console.review.feedbackPlaceholder')} autoFocus />
          </label>
          <label className="field">
            <span>{t('console.review.agent')}</span>
            <select value={agent} onChange={(event) => setAgent(event.target.value)}>
              {optionAgents.map((item) => <option key={item.id} value={item.id}>{item.name}{item.id === task.agent ? ' · ' + t('console.review.currentAgent') : ''}</option>)}
            </select>
          </label>
          <p className="field-hint">{t('console.review.rejectHint')}</p>
          <div className="review-actions">
            <button type="button" className="button ghost" disabled={busy !== null} onClick={() => { setRejecting(false); setError(null) }}>{t('console.review.cancel')}</button>
            <button type="button" className="button danger" disabled={busy !== null} onClick={() => void reject()}>
              {busy === 'reject' ? <Loader2 className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}{t('console.review.submitReject')}
            </button>
          </div>
        </div>
      ) : (
        <div className="review-actions">
          <button type="button" className="button ghost" disabled={busy !== null} onClick={() => setRejecting(true)}>{t('console.review.reject')}</button>
          <button type="button" className="button primary" disabled={busy !== null} onClick={() => void accept()}>
            {busy === 'accept' ? <Loader2 className="spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{t('console.review.accept')}
          </button>
        </div>
      )}
    </section>
  )
}

export function MergePanel({
  task,
  token,
  expiresAt,
  onToken,
  onChanged,
}: {
  task: Task
  token: string | null
  expiresAt: number | null
  onToken: (result: AcceptResult) => void
  onChanged: (detail: TaskDetail) => void
}) {
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'authorize' | 'merge' | 'abandon' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<string[]>([])
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(null)
    setConflicts([])
    getMergePreview(task.id)
      .then((next) => { if (!disposed) setPreview(next) })
      .catch((cause) => { if (!disposed) setError(t('console.merge.previewFailed', { message: messageOf(cause) })) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [task.id])

  useEffect(() => {
    if (!expiresAt) { setExpired(false); return }
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) { setExpired(true); return }
    setExpired(false)
    const timer = window.setTimeout(() => setExpired(true), remaining)
    return () => window.clearTimeout(timer)
  }, [expiresAt])

  async function authorize() {
    if (busy) return
    setBusy('authorize')
    setError(null)
    try { onToken(await authorizeMerge(task.id)) }
    catch (cause) { setError(messageOf(cause)) }
    finally { setBusy(null) }
  }

  async function merge() {
    if (busy || !token || expired) return
    const base = preview?.base_branch ?? '—'
    if (!window.confirm(t('console.merge.confirmPrompt', { branch: task.branch ?? '—', base }))) return
    setBusy('merge')
    setError(null)
    setConflicts([])
    try {
      onChanged(await mergeTask(task.id, token))
    } catch (cause) {
      setError(t('console.merge.mergeFailed', { message: messageOf(cause) }))
      setConflicts(stringsOf(detailsOf(cause)?.conflicts))
      if (cause instanceof RuntimeClientError && cause.code === 'MERGE_TOKEN_EXPIRED') setExpired(true)
    } finally {
      setBusy(null)
    }
  }

  async function abandon() {
    if (busy) return
    if (!window.confirm(t('console.merge.abandonConfirm'))) return
    setBusy('abandon')
    setError(null)
    try { onChanged(await abandonMerge(task.id)) }
    catch (cause) { setError(messageOf(cause)) }
    finally { setBusy(null) }
  }

  const blocked = preview ? !preview.merge_clean : false
  const dirty = preview ? !preview.working_tree_clean : false
  const wrongBranch = Boolean(preview && preview.current_branch && preview.current_branch !== preview.base_branch)

  return (
    <section className="panel-card merge-panel" aria-label={t('console.merge.title')}>
      <header className="merge-head">
        <div>
          <span className="review-kicker"><ShieldCheck aria-hidden="true" />{t('console.merge.title')}</span>
          <h2>{task.branch ?? '—'}</h2>
        </div>
        {expired ? <span className="merge-token expired">{t('console.merge.expired')}</span> : token ? <span className="merge-token">{t('console.merge.authorized')}</span> : null}
      </header>
      <p className="review-summary">{t('console.merge.description')}</p>
      {loading ? <p className="preview-muted"><Loader2 className="spin" aria-hidden="true" /> {t('console.merge.loading')}</p> : null}
      {preview ? (
        <dl className="merge-facts">
          <div><dt>{t('console.merge.branch')}</dt><dd>{preview.branch}</dd></div>
          <div><dt>{t('console.merge.base')}</dt><dd>{preview.base_branch}</dd></div>
          <div><dt>{t('console.merge.commits')}</dt><dd>{preview.commits.length}</dd></div>
          <div className="merge-diff"><dt>{t('console.merge.diff')}</dt><dd><pre>{preview.diff_stat || '—'}</pre></dd></div>
        </dl>
      ) : null}
      {blocked || conflicts.length > 0 ? (
        <div className="merge-warning">
          <strong><TriangleAlert aria-hidden="true" />{t('console.merge.conflictTitle')}</strong>
          <p>{t('console.merge.conflictHint')}</p>
          {(conflicts.length > 0 ? conflicts : preview?.conflicts ?? []).length > 0 ? (
            <ul>{(conflicts.length > 0 ? conflicts : preview?.conflicts ?? []).map((file) => <li key={file}>{file}</li>)}</ul>
          ) : null}
        </div>
      ) : null}
      {dirty ? <p className="console-banner">{t('console.merge.dirtyHint')}</p> : null}
      {wrongBranch ? <p className="console-banner">{t('console.merge.wrongBranch')}</p> : null}
      {preview && !blocked && !dirty && !wrongBranch ? <p className="merge-ok">{t('console.merge.cleanHint')}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="review-actions">
        <button type="button" className="button ghost" disabled={busy !== null} onClick={() => void abandon()}>
          {busy === 'abandon' ? <Loader2 className="spin" aria-hidden="true" /> : null}{t('console.merge.abandon')}
        </button>
        {!token || expired ? (
          <button type="button" className="button primary" disabled={busy !== null} onClick={() => void authorize()}>
            {busy === 'authorize' ? <Loader2 className="spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{t('console.merge.authorize')}
          </button>
        ) : (
          <button type="button" className="button primary" disabled={busy !== null || blocked || dirty || wrongBranch} onClick={() => void merge()}>
            {busy === 'merge' ? <Loader2 className="spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}{t('console.merge.confirm')}
          </button>
        )}
      </div>
    </section>
  )
}

export function ArtifactPanel({ taskId, artifacts, onChanged }: { taskId: string; artifacts: Artifact[]; onChanged: () => void }) {
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState<'add' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (busy || !path.trim()) return
    setBusy('add')
    setError(null)
    try {
      await addArtifact(taskId, path.trim())
      setPath('')
      onChanged()
    } catch (cause) {
      setError(t('console.artifacts.addFailed', { message: messageOf(cause) }))
    } finally {
      setBusy(null)
    }
  }

  async function remove(artifact: Artifact) {
    if (busy) return
    if (!window.confirm(t('console.artifacts.removeConfirm', { name: artifact.name }))) return
    setBusy('remove')
    setError(null)
    try { await removeArtifact(taskId, artifact.id); onChanged() }
    catch (cause) { setError(t('console.artifacts.removeFailed', { message: messageOf(cause) })) }
    finally { setBusy(null) }
  }

  return (
    <section className="panel-card artifact-panel">
      <header className="panel-card-head"><h2>{t('console.artifacts.title')}</h2><span className="panel-count">{artifacts.length}</span></header>
      {artifacts.length === 0 ? <p className="preview-muted">{t('console.artifacts.empty')}</p> : (
        <ul className="artifact-list">
          {artifacts.map((artifact) => (
            <li key={artifact.id}>
              <span className="artifact-list-icon" data-kind={artifact.kind}>{artifact.kind === 'video' ? <Video aria-hidden="true" /> : artifact.kind === 'image' ? <ImageIcon aria-hidden="true" /> : <FileText aria-hidden="true" />}</span>
              <a href={artifactContentUrl(artifact.id)} target="_blank" rel="noreferrer" title={artifact.name}>{artifact.name}</a>
              <span className="artifact-list-meta">{formatBytes(artifact.bytes)}</span>
              <button type="button" className="icon-button" aria-label={t('console.artifacts.remove')} disabled={busy !== null} onClick={() => void remove(artifact)}><Trash2 aria-hidden="true" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="artifact-add">
        <input value={path} onChange={(event) => setPath(event.target.value)} placeholder={t('console.artifacts.placeholder')} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void add() } }} />
        <button type="button" className="button ghost small" disabled={busy !== null || !path.trim()} onClick={() => void add()}>
          {busy === 'add' ? <Loader2 className="spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}{busy === 'add' ? t('console.artifacts.adding') : t('console.artifacts.add')}
        </button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  )
}
