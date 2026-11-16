import 'sparkdesign/style'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DataSourceProvider } from './adapters'
import { I18nProvider } from './i18n/provider.tsx'
import { CompactPet } from './flows/flow-1-pet-surface/pet-compact'
import { initializeBridgeConfig } from './desktop/bridge-config'
import './index.css'

document.documentElement.dataset.petWindow = 'true'

export function PetEntry({ bridgeError = null }: { bridgeError?: string | null }) {
  return (
    <I18nProvider>
      <DataSourceProvider>
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
