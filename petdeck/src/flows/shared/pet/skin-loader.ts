import type { MotionPref } from '../ui-logic'
import { PET_ACTIONS, type AnimationClip, type PetAction, type PetSkin } from './skin-types.ts'

export interface ManifestClip {
  frames: number
  fps: number
  loop: boolean
  extension?: string
}

export interface SkinManifest {
  schemaVersion: number
  id: string
  name: string
  author: string
  frameSize: { width: number; height: number }
  anchor: { x: number; y: number }
  direction: string
  animations: Partial<Record<PetAction, ManifestClip>>
}

export type SkinFetcher = (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>

const SKIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function parseClip(action: PetAction, value: ManifestClip | undefined, baseUrl: string): AnimationClip | undefined {
  if (!value || !Number.isInteger(value.frames) || value.frames < 1 || value.frames > 64) return undefined
  if (!Number.isFinite(value.fps) || value.fps < 1 || value.fps > 60 || typeof value.loop !== 'boolean') return undefined
  const extension = value.extension ?? 'png'
  if (extension !== 'png' && extension !== 'webp') return undefined
  return {
    action,
    frames: value.frames,
    fps: value.fps,
    loop: value.loop,
    extension,
    urls: Array.from({ length: value.frames }, (_, index) =>
      `${baseUrl}/animations/${action}/${String(index + 1).padStart(4, '0')}.${extension}`),
  }
}

function parseManifest(value: unknown, id: string, baseUrl: string): PetSkin {
  const manifest = value as SkinManifest
  if (!manifest || manifest.schemaVersion !== 1 || manifest.id !== id) throw new Error('Invalid pet skin manifest')
  if (manifest.frameSize?.width !== 256 || manifest.frameSize?.height !== 256) throw new Error('Invalid pet frame size')
  if (manifest.anchor?.x !== 128 || manifest.anchor?.y !== 224 || manifest.direction !== 'right') {
    throw new Error('Invalid pet anchor')
  }
  const animations: PetSkin['animations'] = {}
  for (const action of PET_ACTIONS) {
    const clip = parseClip(action, manifest.animations?.[action], baseUrl)
    if (clip) animations[action] = clip
  }
  if (!animations.idle) throw new Error('Pet skin requires a valid idle animation')
  return {
    schemaVersion: 1,
    id,
    name: typeof manifest.name === 'string' && manifest.name.trim() ? manifest.name : id,
    author: typeof manifest.author === 'string' ? manifest.author : '',
    frameSize: { width: 256, height: 256 },
    anchor: { x: 128, y: 224 },
    direction: 'right',
    baseUrl,
    animations,
  }
}

async function fetchSkin(id: string, fetcher: SkinFetcher, basePath: string): Promise<PetSkin> {
  if (!SKIN_ID.test(id)) throw new Error('Unsafe pet skin id')
  const baseUrl = `${basePath}/${id}`
  const response = await fetcher(`${baseUrl}/manifest.json`)
  if (!response.ok) throw new Error('Pet skin not found')
  return parseManifest(await response.json(), id, baseUrl)
}

export async function listSkinIds(fetcher: SkinFetcher = fetch, basePath = '/pets'): Promise<string[]> {
  const response = await fetcher(`${basePath}/index.json`)
  if (!response.ok) return ['default']
  const value = await response.json() as { schemaVersion?: number; skins?: unknown }
  if (value.schemaVersion !== 1 || !Array.isArray(value.skins)) return ['default']
  return [...new Set(value.skins.filter((id): id is string => typeof id === 'string' && SKIN_ID.test(id)))]
}

export async function loadSkin(id: string, fetcher: SkinFetcher = fetch, basePath = '/pets'): Promise<PetSkin> {
  try {
    return await fetchSkin(id, fetcher, basePath)
  } catch (error) {
    if (id === 'default') throw error
    return fetchSkin('default', fetcher, basePath)
  }
}

export function resolveAnimation(skin: PetSkin, action: PetAction): AnimationClip {
  const direct = skin.animations[action]
  if (direct) return direct
  const fallback = action === 'notify' && skin.animations.attention
    ? skin.animations.attention
    : skin.animations.idle as AnimationClip
  const oneShot = action === 'drop' || action === 'pet' || action === 'done' || action === 'attention'
    || action === 'greet' || action === 'wake' || action === 'notify'
  return oneShot ? { ...fallback, loop: false } : fallback
}

export function shouldCompleteClip(input: {
  loop: boolean
  playback: 'full' | 'static'
  currentFrame: number
  frameCount: number
}): boolean {
  if (input.loop) return false
  return input.playback === 'static' || input.currentFrame === input.frameCount - 1
}

export function advanceSpriteFrame(current: number, frames: number, loop: boolean): number | null {
  const next = current + 1
  if (next < frames) return next
  return loop ? 0 : null
}

export function resolveSpritePlayback(pref: MotionPref, osReduced: boolean): 'full' | 'static' {
  if (pref === 'off' || pref === 'reduced') return 'static'
  if (pref === 'on') return 'full'
  return osReduced ? 'static' : 'full'
}
