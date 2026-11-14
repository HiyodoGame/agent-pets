import 'sparkdesign/style'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PetAvatar } from './flows/shared/pet-avatar'
import './index.css'

document.documentElement.dataset.petWindow = 'true'

export function PetEntry() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-2 select-none">
      <PetAvatar status="idle" size={112} />
      <span className="rounded-full border border-border-secondary bg-bg-container/90 px-3 py-1 text-xs text-text shadow-sm">
        PetDeck
      </span>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PetEntry />
  </StrictMode>,
)
