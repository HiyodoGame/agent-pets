import 'sparkdesign/style'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DataSourceProvider } from './adapters'
import { I18nProvider } from './i18n/provider.tsx'
import { CompactPet } from './flows/flow-1-pet-surface/pet-compact'
import { initializeBridgeConfig } from './desktop/bridge-config'
import { getDemoPreference, subscribeDemoPreference } from './desktop/demo-preference.ts'
import './index.css'

document.documentElement.dataset.petWindow = 'true'

function applyAppearance(value: string | null) {
  document.documentElement.dataset.theme = value === 'light' || value === 'dark'
    ? value
    : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

applyAppearance(window.localStorage.getItem('petdeck.appearance'))
window.addEventListener('storage', (event) => {
  if (event.key === 'petdeck.appearance') applyAppearance(event.newValue)
})

export function PetEntry({ bridgeError = null }: { bridgeError?: string | null }) {
  const [demo, setDemo] = useState(getDemoPreference)
  useEffect(() => subscribeDemoPreference(setDemo), [])
  return (
    <I18nProvider>
      <DataSourceProvider demo={demo}>
        <CompactPet bridgeError={bridgeError} />
      </DataSourceProvider>
    </I18nProvider>
  )
}

function renderPet(bridgeError: string | null) {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <PetEntry bridgeError={bridgeError} />
    </StrictMode>,
  )
}

initializeBridgeConfig()
  .then((config) => renderPet(config.error ?? null))
  .catch(() => renderPet('无法初始化本地 bridge，请重启 PetDeck 后重试。'))
