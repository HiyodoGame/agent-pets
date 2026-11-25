import { useState } from 'react'
import { ClipboardCopy, CornerDownLeft } from 'lucide-react'
import type { AgentAsk, Session } from '../shared/types'
import { t } from '../../i18n/index.ts'

/**
 * 只读观察下的「选择题」：Claude 的 AskUserQuestion 会把问题与选项写进会话
 * jsonl，PetDeck 能读出来并展示，但回答只能发生在终端里（observe-only 不回写）。
 * 所以这里做的是「一键复制选项 + 指回终端」，而不是假装替用户作答。
 */
export function PetAskBody({ ask, onOpen }: { ask: AgentAsk; onOpen: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)
  const question = ask.questions[0]
  if (!question) return null
  const extra = ask.questions.length - 1

  async function pick(label: string) {
    try {
      await navigator.clipboard.writeText(label)
      setCopied(label)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div className="pet-ask">
      <p className="pet-ask-question">{question.question}</p>
      <div className="pet-ask-options">
        {question.options.map((option) => (
          <button
            key={option.label}
            type="button"
            className="pet-ask-option"
            onClick={() => void pick(option.label)}
          >
            <strong>{option.label}</strong>
            {option.description ? <span>{option.description}</span> : null}
            <ClipboardCopy className="pet-ask-copy" aria-hidden="true" />
          </button>
        ))}
      </div>
      {copied ? (
        <p className="pet-ask-hint" role="status">
          <CornerDownLeft aria-hidden="true" />
          {t('petAsk.copied', { label: copied })}
        </p>
      ) : (
        <p className="pet-ask-hint">{t('petAsk.readonly')}</p>
      )}
      {extra > 0 ? <p className="pet-ask-hint">{t('petAsk.more', { n: String(extra) })}</p> : null}
      <button type="button" className="pet-secondary-button pet-ask-open" onClick={onOpen}>
        {t('petAsk.open')}
      </button>
    </div>
  )
}

export function PetAskCard({ session, onOpen }: { session: Session; onOpen: () => void }) {
  if (!session.ask && !session.notify) return null
  return (
    <article className="pet-ask-card">
      <header className="pet-ask-head">
        <span className="pet-ask-kicker">
          {session.ask
            ? t('petAsk.kicker', { agent: session.agentId })
            : t('petAsk.kickerNotify', { agent: session.agentId })}
        </span>
      </header>
      {session.ask ? (
        <PetAskBody ask={session.ask} onOpen={onOpen} />
      ) : (
        <div className="pet-ask">
          <p className="pet-ask-question">{session.notify?.message || t('petAsk.permission')}</p>
          <p className="pet-ask-hint">{t('petAsk.readonly')}</p>
          <button type="button" className="pet-secondary-button pet-ask-open" onClick={onOpen}>
            {t('petAsk.open')}
          </button>
        </div>
      )}
    </article>
  )
}
