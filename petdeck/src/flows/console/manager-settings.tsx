import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, KeyRound, Loader2, PlugZap, Save } from 'lucide-react'
import {
  getManagerSettings,
  testManager,
  updateManagerSettings,
  type ManagerSettings,
  type ManagerSettingsPatch,
} from '../../adapters/runtime-client.ts'
import { t } from '../../i18n/index.ts'
import { runtimeErrorText } from './runtime-error.ts'

type Draft = {
  provider: string
  baseUrl: string
  model: string
  temperature: number
  timeoutMs: number
}

function toDraft(manager: ManagerSettings): Draft {
  return {
    provider: manager.provider,
    baseUrl: manager.baseUrl,
    model: manager.model,
    temperature: manager.temperature,
    timeoutMs: manager.timeoutMs,
  }
}

/** Manager model configuration. The key is never read back into the form; the
 *  server only reports whether one is stored and where it came from. */
export function ManagerSettingsSection() {
  const [manager, setManager] = useState<ManagerSettings | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadTick, setLoadTick] = useState(0)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setLoadError(null)
    getManagerSettings()
      .then((next) => {
        if (disposed) return
        setManager(next)
        setDraft(toDraft(next))
        setError(null)
      })
      .catch((cause) => { if (!disposed) setLoadError(runtimeErrorText(cause)) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [loadTick])

  const current = manager
  const dirty = Boolean(draft && current && (
    draft.provider !== current.provider ||
    draft.baseUrl !== current.baseUrl ||
    draft.model !== current.model ||
    draft.temperature !== current.temperature ||
    draft.timeoutMs !== current.timeoutMs ||
    apiKey.trim().length > 0 ||
    clearApiKey
  ))

  function pickProvider(providerId: string) {
    if (!draft || !current) return
    const preset = current.providers.find((provider) => provider.id === providerId)
    setDraft({ ...draft, provider: providerId, baseUrl: preset ? preset.baseUrl : draft.baseUrl })
    setSaved(false)
  }

  async function save() {
    if (!draft || busy) return
    setBusy(true)
    setSaved(false)
    setError(null)
    try {
      const patch: ManagerSettingsPatch = {
        provider: draft.provider,
        baseUrl: draft.baseUrl,
        model: draft.model,
        temperature: draft.temperature,
        timeoutMs: draft.timeoutMs,
      }
      if (apiKey.trim()) patch.apiKey = apiKey.trim()
      if (clearApiKey) patch.clearApiKey = true
      const next = await updateManagerSettings(patch)
      setManager(next)
      setDraft(toDraft(next))
      setApiKey('')
      setClearApiKey(false)
      setSaved(true)
      setTestResult(null)
    } catch (cause) {
      setError(runtimeErrorText(cause))
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    if (testing) return
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      const result = await testManager()
      setTestResult(t('console.settings.managerTestOk', { model: result.model, reply: result.reply }))
    } catch (cause) {
      setError(runtimeErrorText(cause))
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="panel-card manager-settings">
      <header className="panel-card-head">
        <h2><Bot aria-hidden="true" />{t('console.settings.managerTitle')}</h2>
        {current ? (
          <span className="manager-state" data-ready={current.ready}>
            {current.ready ? t('console.settings.managerReady') : t('console.settings.managerNotReady')}
          </span>
        ) : null}
      </header>
      <p className="settings-note">{t('console.settings.managerHint')}</p>
      {loading && !loadError ? (
        <div className="page-loading"><Loader2 className="spin" aria-hidden="true" />{t('common.loading')}</div>
      ) : !draft || !current ? (
        <div className="settings-load-failed">
          <p className="console-banner error" role="alert"><AlertTriangle aria-hidden="true" />{loadError ?? t('console.error.unknown')}</p>
          <button type="button" className="button ghost" onClick={() => setLoadTick((value) => value + 1)}>{t('common.retry')}</button>
        </div>
      ) : (
        <div className="settings-form manager-settings-form">
          <label className="field">
            <span>{t('console.settings.managerProvider')}</span>
            <select value={draft.provider} onChange={(event) => pickProvider(event.target.value)}>
              {current.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('console.settings.managerBaseUrl')}</span>
            <input
              type="url"
              value={draft.baseUrl}
              spellCheck={false}
              placeholder="https://api.openai.com/v1"
              onChange={(event) => { setDraft({ ...draft, baseUrl: event.target.value }); setSaved(false) }}
            />
          </label>
          <label className="field">
            <span>{t('console.settings.managerModel')}</span>
            <input
              type="text"
              value={draft.model}
              spellCheck={false}
              placeholder={t('console.settings.managerModelPlaceholder')}
              onChange={(event) => { setDraft({ ...draft, model: event.target.value }); setSaved(false) }}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>{t('console.settings.managerTemperature')}</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={draft.temperature}
                onChange={(event) => { setDraft({ ...draft, temperature: Number(event.target.value) }); setSaved(false) }}
              />
              <span className="field-hint">{t('console.settings.managerTemperatureHint')}</span>
            </label>
            <label className="field">
              <span>{t('console.settings.managerTimeout')}</span>
              <input
                type="number"
                min={5000}
                max={600000}
                step={1000}
                value={draft.timeoutMs}
                onChange={(event) => { setDraft({ ...draft, timeoutMs: Number(event.target.value) }); setSaved(false) }}
              />
              <span className="field-hint">{t('console.settings.managerTimeoutHint')}</span>
            </label>
          </div>
          <label className="field">
            <span><KeyRound aria-hidden="true" />{t('console.settings.managerApiKey')}</span>
            <input
              type="password"
              value={apiKey}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                current.apiKeySource === 'settings'
                  ? t('console.settings.managerApiKeySet')
                  : current.apiKeySource === 'environment'
                    ? t('console.settings.managerKeyEnv')
                    : t('console.settings.managerKeyNone')
              }
              onChange={(event) => { setApiKey(event.target.value); setSaved(false) }}
            />
            <span className="field-hint">{t('console.settings.managerApiKeyHint')}</span>
          </label>
          {current.apiKeySet || apiKey ? (
            <label className="toggle-row">
              <input
                className="pd-switch"
                type="checkbox"
                checked={clearApiKey}
                onChange={(event) => { setClearApiKey(event.target.checked); setSaved(false) }}
              />
              <span>{t('console.settings.managerClearKey')}</span>
            </label>
          ) : null}
          <div className="settings-actions">
            <button type="button" className="button primary" disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? <Loader2 className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
              {busy ? t('console.settings.saving') : t('console.settings.save')}
            </button>
            <button type="button" className="button ghost" disabled={testing || busy || !current.ready} onClick={() => void test()}>
              {testing ? <Loader2 className="spin" aria-hidden="true" /> : <PlugZap aria-hidden="true" />}
              {testing ? t('console.settings.managerTesting') : t('console.settings.managerTest')}
            </button>
            {saved && !dirty ? <span className="settings-saved">{t('console.settings.managerSaved')}</span> : null}
          </div>
          {testResult ? <p className="settings-test-ok" role="status">{testResult}</p> : null}
          {error ? <p className="console-banner error" role="alert">{error}</p> : null}
        </div>
      )}
    </section>
  )
}
