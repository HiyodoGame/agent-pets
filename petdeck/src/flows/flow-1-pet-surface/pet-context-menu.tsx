import { useEffect, useRef } from 'react'
import { t } from '../../i18n/index.ts'
export interface PetMenuPoint { x: number; y: number }

export function PetContextMenu({ point, dnd, onClose, onOpenPanel, onToggleDnd, onSettings, onHide, onQuit }: {
  point: PetMenuPoint
  dnd: boolean
  onClose: () => void
  onOpenPanel: () => void
  onToggleDnd: () => void
  onSettings: () => void
  onHide: () => void
  onQuit: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [onClose])

  const onKeyDown = (event: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
    items[next]?.focus()
  }

  const run = (action: () => void) => { action(); onClose() }
  const left = Math.max(8, Math.min(point.x, window.innerWidth - 220))
  const top = Math.max(8, Math.min(point.y, window.innerHeight - 220))

  return (
    <div
      ref={ref}
      className="pet-popover pet-context-menu"
      style={{ left, top }}
      role="menu"
      aria-label={t('menu.aria')}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => run(onOpenPanel)}>{t('menu.openPanel')}</button>
      <button type="button" role="menuitemcheckbox" aria-checked={dnd} onClick={() => run(onToggleDnd)}>
        {dnd ? t('menu.dndOff') : t('menu.dndOn')}
      </button>
      <button type="button" role="menuitem" onClick={() => run(onSettings)}>{t('menu.settings')}</button>
      <hr />
      <button type="button" role="menuitem" onClick={() => run(onHide)}>{t('menu.hide')}</button>
      <button type="button" role="menuitem" onClick={() => run(onQuit)}>{t('menu.quit')}</button>
    </div>
  )
}
