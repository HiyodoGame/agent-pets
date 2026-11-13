// Context + hook separated from the provider component so data.tsx only exports
// a component (react/only-export-components fast-refresh rule).
import { createContext, useContext } from 'react'
import type { Agent, Artifact, PetEvent, Project, Session } from '../flows/shared/types'
import type { InjectDecision, InjectPayload, PetData, RawAgentEvent } from './types'

export interface PetDataContextValue extends PetData {
  getAgent(id: string): Agent | undefined
  getProject(id: string): Project | undefined
  getSession(id: string): Session | undefined
  getArtifact(id: string): Artifact | undefined
  sessionsOfProject(pid: string): Session[]
  unhandledEvents(): PetEvent[]
  agentEvents: RawAgentEvent[]
  inject(p: InjectPayload): Promise<InjectDecision>
}

export const PetDataCtx = createContext<PetDataContextValue | null>(null)

export function usePetData(): PetDataContextValue {
  const v = useContext(PetDataCtx)
  if (!v) throw new Error('usePetData must be used within DataSourceProvider')
  return v
}