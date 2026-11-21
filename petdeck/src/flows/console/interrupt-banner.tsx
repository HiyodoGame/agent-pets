import { useState } from 'react'
import { AlertTriangle, Loader2, RotateCcw, X } from 'lucide-react'
import type { Task } from '../../adapters/runtime-client.ts'
import { t, useLocale } from '../../i18n/index.ts'
import { formatClock } from './format.ts'

// Dismissals survive reloads but stay per run: a fresh interruption shows again.
const STORAGE_KEY = 'petdeck.interrupt.dismissed'

function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function rememberDismissed(key: string) {
  try {
    const next = [...loadDismissed().filter((item) => item !== key), key].slice(-100)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* private mode: dismissing for this render is enough */
  }
}

/**
 * M5 W2: the bridge died mid-run. Say exactly what happened and offer the only two
 * honest actions: continue the same agent session, or drop this run.
 */
export function InterruptBanner({ task, busy = false, canResume = true, onResume }: {
  task: Task
  busy?: boolean
  canResume?: boolean
  onResume: () => void
}) {
  const { locale } = useLocale()
  const [dismissed, setDismissed] = useState<string[]>(() => loadDismissed())
  const hit = task.interrupted ?? null
  if (!hit) return null
  const key = task.id + ':' + hit.runId
  if (dismissed.includes(key)) return null
  const dismiss = () => {
    rememberDismissed(key)
    setDismissed((previous) => (previous.includes(key) ? previous : [...previous, key]))
  }
  return (
    <p className="console-banner warn interrupt-banner" role="status">
      <AlertTriangle aria-hidden="true" />
      <span className="interrupt-text">{t('console.task.interrupt.title', { time: formatClock(hit.at, locale) })}</span>
      <span className="interrupt-actions">
        <button
          type="button"
          className="button primary"
          disabled={busy || !canResume}
          title={canResume ? undefined : t('console.task.noSession')}
          onClick={onResume}
        >
          {busy ? <Loader2 className="spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
          {t('console.task.interrupt.resume')}
        </button>
        <button type="button" className="button ghost" onClick={dismiss}>
          <X aria-hidden="true" />
          {t('console.task.interrupt.dismiss')}
        </button>
      </span>
    </p>
  )
}
