import 'sparkdesign/style'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DataSourceProvider } from './adapters'
import { CompactPet } from './flows/flow-1-pet-surface/pet-compact'
import './index.css'

document.documentElement.dataset.petWindow = 'true'

export function PetEntry() {
  return (
    <DataSourceProvider>
      <CompactPet />
    </DataSourceProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PetEntry />
  </StrictMode>,
)
