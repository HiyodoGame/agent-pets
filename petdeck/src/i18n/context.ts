import { createContext, useContext } from 'react'
import { getLocale, setLocale, type Locale } from './index.ts'

export const I18nContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void } | null>(null)

export function useI18n() {
  return useContext(I18nContext) ?? { locale: getLocale(), setLocale }
}
