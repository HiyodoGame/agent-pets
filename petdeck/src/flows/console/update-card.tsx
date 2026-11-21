import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, Loader2, RefreshCw } from 'lucide-react'
import { getRuntimeStatus } from '../../adapters/runtime-client.ts'
import {
  checkForUpdate,
  classifyUpdateError,
  currentAppVersion,
  installPendingUpdate,
  onUpdateProgress,
  progressPercent,
  updateAvailable,
  updateStatusText,
  type UpdateErrorKind,
  type UpdateInfo,
  type UpdatePhase,
  type UpdateProgress,
} from '../../desktop/updater'
import { isTauri } from '../../desktop/window.ts'
import { t } from '../../i18n/index.ts'

const RELEASES_URL = 'https://github.com/HiyodoGame/agent-pets/releases'

function errorText(kind: UpdateErrorKind): string {
  switch (kind) {
    case 'network': return t('update.errorNetwork')
    case 'signature': return t('update.errorSignature')
    case 'disk': return t('update.errorDisk')
    default: return t('update.errorUnknown')
  }
}

export function UpdateCard() {
  const desktop = isTauri()
  const [version, setVersion] = useState('')
  const [phase, setPhase] = useState<UpdatePhase>(desktop ? 'idle' : 'unsupported')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [error, setError] = useState('')
  const [errorKind, setErrorKind] = useState<UpdateErrorKind>('unknown')
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [running, setRunning] = useState<number | null>(null)

  const loadFacts = useCallback(async () => {
    if (!desktop) return
    try { setVersion(await currentAppVersion()) } catch { /* version stays unknown */ }
    try {
      const status = await getRuntimeStatus()
      setRunning(status.runtime?.counts.running ?? null)
    } catch { /* bridge offline: no warning is better than a false one */ }
  }, [desktop])

  useEffect(() => {
    void loadFacts()
  }, [loadFacts])

  useEffect(() => {
    if (!desktop) return
    let unlisten: (() => void) | null = null
    let active = true
    void onUpdateProgress((next) => { if (active) setProgress(next) })
      .then((fn) => { if (active) unlisten = fn; else fn() })
      .catch(() => {})
    return () => { active = false; unlisten?.() }
  }, [desktop])

  async function runCheck() {
    if (!desktop || phase === 'checking' || phase === 'installing') return
    setPhase('checking')
    setError('')
    setProgress(null)
    try {
      const next = await checkForUpdate()
      setInfo(next)
      setPhase(next.available ? 'available' : 'uptodate')
      await loadFacts()
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause)
      setError(raw)
      setErrorKind(classifyUpdateError(raw))
      setPhase('error')
    }
  }

  async function runInstall() {
    if (!desktop || phase === 'installing') return
    setPhase('installing')
    setError('')
    setProgress(null)
    try {
      await installPendingUpdate()
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : String(cause)
      setError(raw)
      setErrorKind(classifyUpdateError(raw))
      setPhase('error')
      await loadFacts()
    }
  }

  const available = updateAvailable(info)
  const percent = progress ? progressPercent(progress.downloaded, progress.total) : null
  const statusLine = phase === 'error'
    ? errorText(errorKind)
    : phase === 'installing'
      ? (percent == null ? t('update.progressUnknown') : t('update.progress', { percent }))
      : updateStatusText(phase, info, error)

  return (
    <section className="panel-card">
      <header className="panel-card-head">
        <h2><Download aria-hidden="true" />{t('console.settings.updateTitle')}</h2>
      </header>
      <div className="settings-card">
        <p className="update-version-line">
          {t('update.currentVersion', { version: version || t('update.unknownVersion') })}
        </p>
        <p className="settings-note" role="status">{statusLine}</p>

        {phase === 'installing' ? (
          <div
            className={percent == null ? 'update-progress indeterminate' : 'update-progress'}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            aria-label={statusLine}
          >
            <span style={percent == null ? undefined : { width: percent + '%' }} />
          </div>
        ) : null}

        {phase === 'error' && error ? (
          <p className="console-banner warn" role="alert"><AlertTriangle aria-hidden="true" />{errorText(errorKind)}</p>
        ) : null}
        {phase === 'available' && available && running ? (
          <p className="console-banner warn"><AlertTriangle aria-hidden="true" />{t('update.runningWarning', { n: running })}</p>
        ) : null}

        {available && info?.body ? (
          <div className="update-notes">
            <h3>{t('update.releaseNotes')}</h3>
            <div className="update-notes-body">{info.body}</div>
          </div>
        ) : null}

        <div className="settings-actions">
          {available && phase !== 'installing' && phase !== 'error' ? (
            <button type="button" className="button primary" onClick={() => void runInstall()}>
              <Download aria-hidden="true" />{t('settings.installRestart')}
            </button>
          ) : null}
          {phase === 'error' && available ? (
            <button type="button" className="button primary" onClick={() => void runInstall()}>
              {t('update.retry')}
            </button>
          ) : null}
          <button
            type="button"
            className={available ? 'button ghost' : 'button primary'}
            disabled={!desktop || phase === 'checking' || phase === 'installing'}
            aria-busy={phase === 'checking' || phase === 'installing'}
            onClick={() => void runCheck()}
          >
            {phase === 'checking' ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            {phase === 'checking' ? t('settings.checking') : phase === 'error' && !available ? t('update.retry') : t('settings.checkUpdate')}
          </button>
        </div>

        {!desktop ? <p className="settings-note">{t('update.unsupported')}</p> : null}
        <p className="settings-note">
          <a href={RELEASES_URL} target="_blank" rel="noreferrer">{t('update.manualDownload')}</a>
        </p>
      </div>
    </section>
  )
}
