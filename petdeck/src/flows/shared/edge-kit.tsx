// =============================================
// Edge Kit — 异常态共享 helpers（edge 矩阵代码实现）
// =============================================
import { useState } from 'react'
import { Alert, AlertTitle, AlertDescription, Button, TypographyMuted } from 'sparkdesign'
import { RefreshCw } from 'lucide-react'
import { stepperState } from './ui-logic'

/** 计数 999+ 封顶（boundary-overflow） */
export const fmtCount = (n: number): string => (n > 999 ? '999+' : String(n))

/** 长文本截断 + 展开（boundary-long-text） */
export function ClampText({ text, lines = 2 }: { text: string; lines?: number }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <p className={`text-text text-sm ${expanded ? '' : lines === 1 ? 'line-clamp-1' : 'line-clamp-2'}`}>{text}</p>
      <button type="button" className="self-start" onClick={() => setExpanded((e) => !e)}>
        <TypographyMuted>{expanded ? '收起' : '展开'}</TypographyMuted>
      </button>
    </div>
  )
}

/** 内联错误/警告 + 可行动出口（error-* 通用模板） */
export function EdgeAlert({
  variant = 'error',
  title,
  desc,
  onRetry,
  retryLabel = '重试',
  extra,
}: {
  variant?: 'error' | 'warning' | 'info'
  title: string
  desc: string
  onRetry?: () => void
  retryLabel?: string
  extra?: React.ReactNode
}) {
  return (
    <Alert variant={variant}>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{desc}</AlertDescription>
      {(onRetry || extra) && (
        <div className="mt-2 flex gap-2">
          {onRetry && (
            <Button variant="secondary" onClick={onRetry}>
              <RefreshCw className="mr-1 h-4 w-4" /> {retryLabel}
            </Button>
          )}
          {extra}
        </div>
      )}
    </Alert>
  )
}

/** 多步流程步骤指示（≥3 步，check-minor-1）。语义 ol + aria-current。 */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  const states = stepperState(steps.length, current)
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="流程步骤">
      {steps.map((label, i) => (
        <li key={label} aria-current={states[i] === 'current' ? 'step' : undefined} className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums ${
              states[i] === 'done' ? 'bg-success text-success-foreground' : states[i] === 'current' ? 'bg-primary text-primary-foreground' : 'bg-fill-secondary text-text-secondary'
            }`}
          >
            {i + 1}
          </span>
          <span className={`text-sm ${states[i] === 'current' ? 'font-semibold text-text' : 'text-text-secondary'}`}>{label}</span>
          {i < steps.length - 1 && <span className="text-text-secondary" aria-hidden="true">→</span>}
        </li>
      ))}
    </ol>
  )
}