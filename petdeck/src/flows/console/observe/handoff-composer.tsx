import { useEffect, useId, useRef, useState } from 'react'
import { ClipboardCopy, Loader2, X } from 'lucide-react'
import { handoffPackageText } from '../../../adapters/registry.ts'
import { t } from '../../../i18n/index.ts'
import { buildObservedHandoff, defaultHandoffContext, MAX_HANDOFF_TEXT } from './handoff.ts'

type CopyState = 'idle' | 'copying' | 'copied' | 'copy-failed'

const NO_LINES: ReadonlyArray<{ role: string; text: string }> = []

export function ObservedHandoff({ agent, sessionTitle, lastMessage, lines, onClose }: {
  agent: string
  sessionTitle: string
  lastMessage?: string | null
  lines?: ReadonlyArray<{ role: string; text: string }>
  onClose: () => void
}) {
  const contextId = useId()
  const instructionId = useId()
  const hintId = useId()
  const sourceLines = lines ?? NO_LINES
  const [context, setContext] = useState(() => defaultHandoffContext(sourceLines, lastMessage))
  const [instruction, setInstruction] = useState('')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [state, setState] = useState<CopyState>('idle')
  const [packageText, setPackageText] = useState('')
  const contextTouched = useRef(false)
  const busy = useRef(false)

  // The transcript can arrive after the composer opens; only fill an untouched context.
  useEffect(() => {
    if (contextTouched.current) return
    setContext(defaultHandoffContext(sourceLines, lastMessage))
  }, [sourceLines, lastMessage])

  function changeContext(value: string) {
    contextTouched.current = true
    setContext(value)
    setState('idle')
  }

  async function copyPackage() {
    if (busy.current) return
    const text = instruction.trim()
    if (!text) {
      setTouched(true)
      setError(t('console.observe.handoffRequired'))
      setState('idle')
      return
    }
    busy.current = true
    setState('copying')
    setError(null)
    const pkg = handoffPackageText(buildObservedHandoff({ agent, context, instruction: text }))
    setPackageText(pkg)
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(pkg)
      setState('copied')
    } catch {
      setState('copy-failed')
      setError(t('console.observe.handoffCopyFailed'))
    } finally {
      busy.current = false
    }
  }

  const invalid = touched && !instruction.trim()

  return (
    <section className="observe-handoff" aria-label={t('console.observe.handoffTitle', { agent })}>
      <header className="observe-handoff-head">
        <div>
          <strong>{t('console.observe.handoffTitle', { agent })}</strong>
          <p>{sessionTitle}</p>
        </div>
        <button type="button" className="icon-button" aria-label={t('console.observe.handoffClose')} title={t('console.observe.handoffClose')} onClick={onClose}>
          <X aria-hidden="true" />
        </button>
      </header>
      <p className="observe-handoff-note">{t('console.observe.handoffNote')}</p>

      <label className="field" htmlFor={contextId}>
        <span>{t('console.observe.handoffContext')}</span>
        <textarea id={contextId} rows={3} value={context} maxLength={MAX_HANDOFF_TEXT} onChange={(event) => changeContext(event.target.value)} />
      </label>

      <label className="field" htmlFor={instructionId}>
        <span>{t('console.observe.handoffInstruction')}</span>
        <textarea
          id={instructionId}
          rows={4}
          value={instruction}
          maxLength={MAX_HANDOFF_TEXT}
          placeholder={t('console.observe.handoffPlaceholder')}
          aria-invalid={invalid}
          aria-describedby={hintId}
          onChange={(event) => { setInstruction(event.target.value); setError(null); setState('idle') }}
          onBlur={() => setTouched(true)}
        />
      </label>
      <p id={hintId} className="field-hint">{t('console.observe.localOnly')}</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {state === 'copied' ? <p className="observe-handoff-result" role="status">{t('console.observe.handoffCopied', { agent })}</p> : null}

      {packageText ? (
        <label className="field">
          <span>{t('console.observe.handoffPreview')}</span>
          <textarea className="observe-handoff-package" readOnly rows={6} value={packageText} onFocus={(event) => event.currentTarget.select()} />
        </label>
      ) : null}

      <div className="observe-handoff-actions">
        <button type="button" className="button primary" disabled={state === 'copying'} onClick={() => void copyPackage()}>
          {state === 'copying' ? <Loader2 className="spin" aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
          {state === 'copy-failed' ? t('console.observe.handoffRetryCopy') : t('console.observe.handoffCopy')}
        </button>
      </div>
    </section>
  )
}
