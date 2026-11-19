import type { ComponentProps } from 'react'

type ResponsePhase = ComponentProps<typeof import('sparkdesign').Response>['phase']

export function responseBehavior(phase: ResponsePhase) {
  return { rounds: [], simulate: phase === 'streaming' }
}
