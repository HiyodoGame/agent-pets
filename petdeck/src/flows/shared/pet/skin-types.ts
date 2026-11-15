export const PET_ACTIONS = [
  'idle', 'walk', 'sleep', 'drag', 'drop', 'pet', 'work', 'think', 'done', 'attention', 'offline',
  'greet', 'wake', 'notify',
] as const

export type PetAction = (typeof PET_ACTIONS)[number]
export type PetDirection = 'left' | 'right'

export interface AnimationClip {
  action: PetAction
  frames: number
  fps: number
  loop: boolean
  extension: 'png' | 'webp'
  urls: string[]
}

export interface PetSkin {
  schemaVersion: 1
  id: string
  name: string
  author: string
  frameSize: { width: 256; height: 256 }
  anchor: { x: 128; y: 224 }
  direction: 'right'
  baseUrl: string
  animations: Partial<Record<PetAction, AnimationClip>>
}
