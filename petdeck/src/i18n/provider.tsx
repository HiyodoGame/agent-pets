import { useEffect, type ReactNode } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getLocale, setLocale, useLocale } from './index.ts'
import { I18nContext } from './context.ts'
import { isTauri, setDesktopLocale } from '../desktop/window.ts'

/** Re-renders the whole tree on locale change, persists the choice, and keeps the
 *  Rust tray labels plus the other Tauri window in sync. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const value = useLocale()

  useEffect(() => {
    void setDesktopLocale(value.locale)
  }, [value.locale])

  useEffect(() => {
    if (!isTauri()) return
    let active = true
    let unlisten: (() => void) | null = null
    listen<string>('petdeck:locale-changed', (event) => {
      const next = event.payload
      if ((next === 'zh' || next === 'en') && next !== getLocale()) setLocale(next)
    }).then((fn) => {
      if (active) unlisten = fn
      else fn()
    }).catch(() => {})
    return () => {
      active = false
      unlisten?.()
    }
  }, [])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
