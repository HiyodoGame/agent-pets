import { useEffect, useRef } from 'react'
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
      aria-label="宠物菜单"
      onKeyDown={onKeyDown}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" role="menuitem" onClick={() => run(onOpenPanel)}>打开主面板</button>
      <button type="button" role="menuitemcheckbox" aria-checked={dnd} onClick={() => run(onToggleDnd)}>
        {dnd ? '关闭免打扰' : '开启免打扰'}
      </button>
      <button type="button" role="menuitem" onClick={() => run(onSettings)}>宠物设置</button>
      <hr />
      <button type="button" role="menuitem" onClick={() => run(onHide)}>隐藏宠物</button>
      <button type="button" role="menuitem" onClick={() => run(onQuit)}>退出 PetDeck</button>
    </div>
  )
}
