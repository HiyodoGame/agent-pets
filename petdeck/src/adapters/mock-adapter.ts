// Mock fallback adapter: replays the design-time story when the bridge is offline.
import {
  mockAgents, mockArtifacts, mockEvents, mockProjects, mockSessions,
} from '../flows/shared/mock-data'
import type { PetData } from './types'

export function mockPetData(): PetData {
  return {
    mode: 'mock',
    agents: mockAgents,
    projects: mockProjects,
    sessions: mockSessions,
    events: mockEvents,
    artifacts: mockArtifacts,
  }
}