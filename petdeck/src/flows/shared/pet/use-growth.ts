import { useEffect, useState } from 'react'
import { levelProgress, loadGrowth, subscribeGrowth, type GrowthState } from './growth.ts'

export function useGrowth(): { state: GrowthState; progress: ReturnType<typeof levelProgress> } {
  const [state, setState] = useState<GrowthState>(() => loadGrowth())
  useEffect(() => subscribeGrowth(setState), [])
  return { state, progress: levelProgress(state.xp) }
}
