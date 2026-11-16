import { useCallback, useEffect, useState } from 'react'
import { messages, type MessageKey } from './messages.ts'

export type Locale = 'zh' | 'en'

export const LOCALE_KEY = 'petdeck.locale'
export const LOCALE_EVENT = 'petdeck:locale-changed'

let activeLocale: Locale | null = null

function browserStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

interface LocaleStorage {
  getItem(key: string): string | null
}

export function detectLocale(storage: LocaleStorage | undefined = browserStorage(), language = typeof window === 'undefined' ? 'zh' : navigator.language): Locale {
  const stored = storage?.getItem(LOCALE_KEY)
  if (stored === 'zh' || stored === 'en') return stored
  return language && !language.toLowerCase().startsWith('zh') ? 'en' : 'zh'
}

export function getLocale(): Locale {
  if (!activeLocale) activeLocale = detectLocale()
  return activeLocale
}

export function setLocale(locale: Locale): void {
  activeLocale = locale
  try { browserStorage()?.setItem(LOCALE_KEY, locale) } catch { /* storage unavailable */ }
  if (typeof document !== 'undefined') document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: locale }))
}

/** Translate a key in the active locale. `{name}` placeholders are interpolated. */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = messages[getLocale()][key] ?? messages.zh[key] ?? key
  return vars ? raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? '')) : raw
}

/** React hook for the language selector; provider re-renders the tree on change. */
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const [locale, setLocal] = useState<Locale>(getLocale)
  useEffect(() => {
    const handler = () => setLocal(getLocale())
    window.addEventListener(LOCALE_EVENT, handler)
    return () => window.removeEventListener(LOCALE_EVENT, handler)
  }, [])
  const change = useCallback((next: Locale) => {
    setLocale(next)
    setLocal(next)
  }, [])
  return { locale, setLocale: change }
}
