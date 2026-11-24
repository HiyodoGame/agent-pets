import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Database, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { bridgeConfigError } from '../../adapters/bridge-client.ts'
import {
  cleanupRunTranscripts,
  getStorageUsage,
  type StorageCleanupResult,
  type StorageUsage,
} from '../../adapters/runtime-client.ts'
import { t } from '../../i18n/index.ts'
import { runtimeErrorText } from './runtime-error.ts'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

function formatWhen(ms: number | null): string {
  if (!ms) return '—'
  try { return new Date(ms).toLocaleDateString() } catch { return '—' }
}

export function StorageCard() {
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cleaned, setCleaned] = useState<StorageCleanupResult | null>(null)

  const load = useCallback(async () => {
    try {
      setUsage(await getStorageUsage())
      setError(null)
    } catch (cause) {
      setUsage(null)
      setError(runtimeErrorText(cause))
    }
  }, [])

  useEffect(() => {
    let disposed = false
    load().finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [load])

  async function refresh() {
    if (refreshing) return
    setRefreshing(true)
    try { await load() } finally { setRefreshing(false) }
  }

  async function clean() {
    if (cleaning) return
    const days = usage?.runKeepDays ?? 30
    if (!window.confirm(t('console.settings.storageCleanConfirm', { days }))) return
    setCleaning(true)
    setError(null)
    try {
      const result = await cleanupRunTranscripts(days)
      setCleaned(result)
      await load()
    } catch (cause) {
      setError(t('console.settings.storageCleanFailed') + '：' + (runtimeErrorText(cause)))
    } finally {
      setCleaning(false)
    }
  }

  const offlineReason = bridgeConfigError()

  return (
    <section className="panel-card">
      <header className="panel-card-head">
        <h2><Database aria-hidden="true" />{t('console.settings.storageTitle')}</h2>
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
      ) : loading && !usage ? (
        <div className="page-loading"><Loader2 className="spin" aria-hidden="true" />{t('common.loading')}</div>
      ) : usage ? (
        <div className="settings-card">
          <dl className="meta-grid">
            <div><dt>{t('console.settings.storageLogs')}</dt><dd>{formatBytes(usage.logsBytes)}</dd></div>
            <div><dt>{t('console.settings.storageRuns')}</dt><dd>{formatBytes(usage.runsBytes)}</dd></div>
            <div><dt>{t('console.settings.storageArtifacts')}</dt><dd>{formatBytes(usage.artifactsBytes)}</dd></div>
            <div><dt>{t('console.settings.storageDb')}</dt><dd>{formatBytes(usage.dbBytes)}</dd></div>
            <div><dt>{t('console.settings.storageTotal')}</dt><dd>{formatBytes(usage.totalBytes)}</dd></div>
            <div><dt>{t('console.settings.storageOldest')}</dt><dd>{formatWhen(usage.oldestRunMs)}</dd></div>
          </dl>
          <p className="settings-health-line">
            {t('console.settings.storageLine', { runs: usage.runCount, days: usage.runKeepDays })}
          </p>
          <div className="settings-actions">
            <button type="button" className="button" disabled={cleaning} onClick={() => void clean()}>
              {cleaning ? <Loader2 className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}
              {cleaning ? t('console.settings.storageCleaning') : t('console.settings.storageClean')}
            </button>
          </div>
          {cleaned ? (
            <p className="diag-result" role="status">
              {t('console.settings.storageCleaned', { n: cleaned.removed, size: formatBytes(cleaned.bytes) })}
            </p>
          ) : null}
          <p className="settings-note">
            {t('console.settings.storageCleanHint', { days: usage.runKeepDays })}
          </p>
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