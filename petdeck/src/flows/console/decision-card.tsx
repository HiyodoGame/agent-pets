import { useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { answerDecision, type Decision } from '../../adapters/runtime-client.ts'
import { t } from '../../i18n/index.ts'

export interface DecisionCardProps {
  decision: Decision
  compact?: boolean
  onAnswered?: () => void
}

/** One pending decision card. Used by the task page, the Today banner and the
 *  pet quick panel, so answering behaves the same everywhere: either an option
 *  index or a free-form answer is written back into the agent's session. */
export function DecisionCard({ decision, compact = false, onAnswered }: DecisionCardProps) {
  const [freeform, setFreeform] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function answer(input: { optionIndex?: number; answer?: string }) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await answerDecision(decision.id, input)
      setFreeform('')
      onAnswered?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={'decision-card' + (compact ? ' is-compact' : '')} data-decision-id={decision.id}>
      <header className="decision-card-head">
        <span className="decision-card-kicker"><Check aria-hidden="true" />{t('console.task.decisionTitle')}</span>
        {decision.task_title ? <span className="decision-card-task">{decision.task_title}</span> : null}
      </header>
      <p className="decision-card-question">{decision.question}</p>
      {decision.options.length > 0 ? (
        <div className="decision-card-options">
          {decision.options.map((label, index) => (
            <button
              key={label + index}
              type="button"
              className="button decision-option"
              disabled={busy}
              onClick={() => void answer({ optionIndex: index })}
            >
              {busy ? <Loader2 className="spin" aria-hidden="true" /> : <span className="decision-option-index">{index + 1}</span>}
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {decision.allow_freeform ? (
        <form
          className="decision-card-freeform"
          onSubmit={(event) => {
            event.preventDefault()
            const value = freeform.trim()
            if (value) void answer({ answer: value })
          }}
        >
          <input
            className="text-input"
            value={freeform}
            onChange={(event) => setFreeform(event.target.value)}
            placeholder={t('console.task.decisionFreeform')}
            aria-label={t('console.task.decisionFreeform')}
            disabled={busy}
          />
          <button type="submit" className="button primary" disabled={busy || !freeform.trim()}>
            {busy ? <Loader2 className="spin" aria-hidden="true" /> : null}
            {busy ? t('console.task.decisionSubmitting') : t('console.task.decisionSubmit')}
          </button>
        </form>
      ) : null}
      {error ? <p className="decision-card-error" role="alert">{error}</p> : null}
    </article>
  )
}
