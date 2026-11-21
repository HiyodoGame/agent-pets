import { useEffect, type RefObject } from 'react'
import { trapTabIndex } from '../shared/ui-logic.ts'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keeps Tab / Shift+Tab inside a modal and restores focus to the trigger on
 * unmount. Escape handling stays with the dialog so it can ask before closing.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null)

    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !node) return
      const list = focusables()
      if (list.length === 0) { event.preventDefault(); node.focus(); return }
      const current = document.activeElement instanceof HTMLElement ? list.indexOf(document.activeElement) : -1
      const target = trapTabIndex(current, list.length, event.shiftKey)
      const outside = current === -1
      if (outside || target !== current + (event.shiftKey ? -1 : 1)) {
        event.preventDefault()
        list[target]?.focus()
      }
    }

    node.addEventListener('keydown', onKey)
    return () => {
      node.removeEventListener('keydown', onKey)
      if (previous?.isConnected) previous.focus()
    }
  }, [ref])
}
