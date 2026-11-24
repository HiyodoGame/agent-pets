import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, Copy, FileText, HardDrive, Loader2, RefreshCw, RotateCw, Stethoscope } from 'lucide-react'
import { bridgeConfigError } from '../../adapters/bridge-client.ts'
import {
  exportDiagnostics,
  getRuntimeStatus,
  type DiagnosticsExport,
  type RuntimeAdapterProbe,
  type RuntimeSecrets,
  type RuntimeStatusSnapshot,
} from '../../adapters/runtime-client.ts'
import { openNodeLicenses, restartBridge } from '../../desktop/bridge-config.ts'
import { isTauri } from '../../desktop/window.ts'
import { t, useLocale } from '../../i18n/index.ts'
import { runtimeErrorText } from './runtime-error.ts'
import { formatClock } from './format.ts'

function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return t('console.settings.uptimeSeconds', { n: total })
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return t('console.settings.uptimeMinutes', { n: minutes })
  return t('console.settings.uptimeHours', { h: Math.floor(minutes / 60), m: minutes % 60 })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

function secretLabel(secrets: RuntimeSecrets | undefined): string {
  if (!secrets || secrets.mode === 'none') return t('console.settings.secretsNone')
  if (secrets.mode === 'dpapi') return t('console.settings.secretsDpapi')
  if (secrets.mode === 'plaintext') return t('console.settings.secretsPlaintext')
  return t('console.settings.secretsUnreadable')
}

function probeBadge(agent: RuntimeAdapterProbe) {
  if (agent.detected === true) {
    return (
      <span className="probe-state ok">
        {agent.version ? agent.version : t('console.settings.probeDetected')}
      </span>
    )
  }
  if (agent.detected === false) return <span className="probe-state missing">{t('console.settings.probeMissing')}</span>
  return <span className="probe-state unknown">{t('console.settings.probeUnknown')}</span>
}

export function RuntimeStatusCard() {
  const { locale } = useLocale()
  const [status, setStatus] = useState<RuntimeStatusSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<DiagnosticsExport | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [licensePath, setLicensePath] = useState<string | null>(null)
  const [licenseError, setLicenseError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const next = await getRuntimeStatus()
      setStatus(next)
      setError(null)
    } catch (cause) {
      setStatus(null)
      setError(runtimeErrorText(cause))
    }
  }, [])

  useEffect(() => {
    let disposed = false
    load().finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [load])

  async function loadWithRetry(attempts = 10) {
    let last: unknown = null
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        setStatus(await getRuntimeStatus())
        setError(null)
        return
      } catch (cause) {
        last = cause
        if (attempt < attempts - 1) await new Promise((resolve) => window.setTimeout(resolve, 400))
      }
    }
    setStatus(null)
    setError(last instanceof Error ? last.message : String(last))
  }

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try { await load() } finally { setRefreshing(false) }
  }

  async function copy(key: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600)
    } catch { /* clipboard unavailable */ }
  }

  async function runExport() {
    if (exporting) return
    setExporting(true)
    setError(null)
    try {
      setExported(await exportDiagnostics())
    } catch (cause) {
      setError(runtimeErrorText(cause))
    } finally {
      setExporting(false)
    }
  }

  async function openLicenses() {
    setLicenseError(null)
    try {
      setLicensePath(await openNodeLicenses())
    } catch (cause) {
      setLicenseError(runtimeErrorText(cause))
    }
  }

  async function restart() {
    if (restarting || !isTauri()) return
    setRestarting(true)
    setExported(null)
    setError(null)
    try {
      await restartBridge()
      await loadWithRetry()
    } catch (cause) {
      setError(runtimeErrorText(cause))
    } finally {
      setRestarting(false)
    }
  }

  const offlineReason = bridgeConfigError()
  const counts = status?.runtime?.counts

  return (
    <section className="panel-card">
      <header className="panel-card-head">
        <h2><HardDrive aria-hidden="true" />{t('console.settings.runtimeTitle')}</h2>
        <button
          type="button"
          className="button ghost small"
          disabled={loading || refreshing}
          onClick={() => void refresh()}
        >
          {loading || refreshing ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          {t('console.settings.healthRefresh')}
        </button>
      </header>
      {error ? (
        <div className="settings-card">
          <p className="console-banner error" role="alert"><AlertTriangle aria-hidden="true" />{error}</p>
          {offlineReason ? <p className="settings-note">{offlineReason}</p> : null}
        </div>
      ) : loading && !status ? (
        <div className="page-loading"><Loader2 className="spin" aria-hidden="true" />{t('common.loading')}</div>
      ) : status ? (
        <div className="settings-card">
          <dl className="meta-grid">
            <div><dt>{t('console.settings.healthVersion')}</dt><dd>{status.version}</dd></div>
            <div><dt>{t('console.settings.healthNode')}</dt><dd>{status.node}</dd></div>
            <div><dt>{t('console.settings.healthPort')}</dt><dd>{status.port ?? '—'}</dd></div>
            <div><dt>{t('console.settings.healthDb')}</dt><dd>{status.dbVersion ?? '—'}</dd></div>
            <div><dt>{t('console.settings.healthSecrets')}</dt><dd>{secretLabel(status.runtime?.secrets)}</dd></div>
            <div><dt>{t('console.settings.healthUptime')}</dt><dd>{status.runtime ? formatUptime(status.runtime.uptimeSec) : '—'}</dd></div>
            <div>
              <dt>{t('console.settings.dataDir')}</dt>
              <dd className="meta-copy">
                <code>{status.dataDir ?? '—'}</code>
                {status.dataDir ? (
                  <button type="button" className="button ghost small icon-only" title={t('console.settings.copy')} onClick={() => void copy('dataDir', status.dataDir ?? '')}>
                    {copied === 'dataDir' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  </button>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>{t('console.settings.logDir')}</dt>
              <dd className="meta-copy">
                <code>{status.logDir ?? '—'}</code>
                {status.logDir ? (
                  <button type="button" className="button ghost small icon-only" title={t('console.settings.copy')} onClick={() => void copy('logDir', status.logDir ?? '')}>
                    {copied === 'logDir' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                  </button>
                ) : null}
              </dd>
            </div>
          </dl>
          {counts ? (
            <p className="settings-health-line">
              {t('console.settings.healthCounts', {
                running: counts.running,
                queued: counts.queued,
                review: counts.review,
                merge: counts.pending_merge,
              })}
            </p>
          ) : null}
          {status.runtime?.crash ? (
            <p className="console-banner warn" role="status">
              <AlertTriangle aria-hidden="true" />
              {t('console.settings.crashWarning', {
                reason: status.runtime.crash.reason,
                time: status.runtime.crash.at ? formatClock(Date.parse(status.runtime.crash.at), locale) : '—',
              })}
            </p>
          ) : null}
          {status.runtime?.recovery && status.runtime.recovery.interrupted > 0 ? (
            <p className="settings-health-line">
              {t('console.settings.recoveryLine', { n: status.runtime.recovery.interrupted })}
            </p>
          ) : null}
          {status.runtime?.dbIntegrity && !status.runtime.dbIntegrity.ok ? (
            <p className="console-banner warn" role="status">
              <AlertTriangle aria-hidden="true" />
              {status.runtime.dbIntegrity.backupPath
                ? t('console.settings.dbRebuilt', { file: status.runtime.dbIntegrity.backupPath })
                : t('console.settings.dbBroken', { reason: status.runtime.dbIntegrity.reason ?? 'unknown' })}
            </p>
          ) : null}
          {status.runtime?.secrets?.mode === 'plaintext' ? (
            <p className="console-banner warn" role="status">
              <AlertTriangle aria-hidden="true" />
              {t('console.settings.secretsPlaintextHint')}
            </p>
          ) : null}
          {status.runtime?.secrets?.mode === 'unreadable' ? (
            <p className="console-banner warn" role="status">
              <AlertTriangle aria-hidden="true" />
              {t('console.settings.secretsUnreadableHint')}
            </p>
          ) : null}
          <div className="probe-block">
            <h3><Stethoscope aria-hidden="true" />{t('console.settings.healthAgents')}</h3>
            <table className="probe-table">
              <thead>
                <tr>
                  <th>{t('console.settings.probeAgent')}</th>
                  <th>{t('console.settings.probeCommand')}</th>
                  <th>{t('console.settings.probeResult')}</th>
                </tr>
              </thead>
              <tbody>
                {status.adapters.map((agent) => (
                  <tr key={agent.id}>
                    <td><strong>{agent.name}</strong><span className="probe-tier">{agent.tier}</span></td>
                    <td className="probe-command">{agent.command ?? '—'}</td>
                    <td>{probeBadge(agent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="settings-actions">
            <button type="button" className="button" disabled={exporting} onClick={() => void runExport()}>
              {exporting ? <Loader2 className="spin" aria-hidden="true" /> : <HardDrive aria-hidden="true" />}
              {exporting ? t('console.settings.diagExporting') : t('console.settings.diagExport')}
            </button>
            <button type="button" className="button" disabled={restarting || !isTauri()} onClick={() => void restart()} title={isTauri() ? t('console.settings.restartHint') : t('console.settings.restartUnavailable')}>
              {restarting ? <Loader2 className="spin" aria-hidden="true" /> : <RotateCw aria-hidden="true" />}
              {restarting ? t('console.settings.restarting') : t('console.settings.restartBridge')}
            </button>
            <button type="button" className="button ghost" disabled={!isTauri()} onClick={() => void openLicenses()} title={t('console.settings.nodeLicenseHint')}>
              <FileText aria-hidden="true" />
              {t('console.settings.nodeLicense')}
            </button>
          </div>
          {licensePath ? <p className="settings-note">{t('console.settings.nodeLicensePath', { path: licensePath })}</p> : null}
          {licenseError ? <p className="console-banner error" role="alert"><AlertTriangle aria-hidden="true" />{licenseError}</p> : null}
          {exported ? (
            <div className="diag-result" role="status">
              <span>{t('console.settings.diagExported', { n: exported.files.length, size: formatBytes(exported.bytes) })}</span>
              <code>{exported.path}</code>
              <button type="button" className="button ghost small icon-only" title={t('console.settings.copy')} onClick={() => void copy('diag', exported.path)}>
                {copied === 'diag' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              </button>
            </div>
          ) : null}
          <p className="settings-note">{t('console.settings.restartHint')}</p>
        </div>
      ) : (
        <div className="settings-card">
          <p className="console-banner error" role="alert"><AlertTriangle aria-hidden="true" />{t('console.settings.runtimeOffline')}</p>
          {offlineReason ? <p className="settings-note">{offlineReason}</p> : null}
        </div>
      )}
    </section>
  )
}
