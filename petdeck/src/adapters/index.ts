// Adapter layer public surface.
// (bus.ts 已删除——前端事件总线是死代码，全 src 无消费者，P2-11 清理)
export { selectSource, gateInject, clipboardPackage, handoffPackageText, injectOrClipboard } from './registry'
export type { SourceMode } from './registry'
export { DataSourceProvider } from './data'
export { usePetData } from './pet-data-context'
export type { PetDataContextValue } from './pet-data-context'
export { mockPetData } from './mock-adapter'
export * from './bridge-client'
export type { AgentAdapter, InjectDecision, InjectPayload, ObservedSession, PetData, RawAgentEvent } from './types'