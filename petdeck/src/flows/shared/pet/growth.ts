import type { MessageKey } from '../../../i18n/messages.ts'

export const GROWTH_KEY = 'petdeck.growth'
export const GROWTH_EVENT = 'petdeck:growth-changed'
export const PET_COOLDOWN_MS = 30_000
export const PET_XP = 2
export const TASK_XP = 10

export interface GrowthState {
  version: 1
  xp: number
  lastPetAt: number
  lastActiveDay: string
  streakDays: number
  tasks: number
  pets: number
}

export const DEFAULTS: GrowthState = {
  version: 1,
  xp: 0,
  lastPetAt: 0,
  lastActiveDay: '',
  streakDays: 0,
  tasks: 0,
  pets: 0,
}

/** Thresholds are cumulative XP. Titles are i18n keys. */
export const LEVELS: { minXp: number; titleKey: MessageKey }[] = [
  { minXp: 0, titleKey: 'growth.title.0' },
  { minXp: 40, titleKey: 'growth.title.1' },
  { minXp: 120, titleKey: 'growth.title.2' },
  { minXp: 260, titleKey: 'growth.title.3' },
  { minXp: 480, titleKey: 'growth.title.4' },
  { minXp: 800, titleKey: 'growth.title.5' },
  { minXp: 1300, titleKey: 'growth.title.6' },
  { minXp: 2000, titleKey: 'growth.title.7' },
]

export interface GrowthProgress {
  level: number
  titleKey: MessageKey
  xpIntoLevel: number
  xpForNext: number
  percent: number
  /** null at max level. */
  nextMinXp: number | null
}

export function levelProgress(xp: number): GrowthProgress {
  const safeXp = Number.isFinite(xp) && xp > 0 ? xp : 0
  let index = 0
  for (let i = 0; i < LEVELS.length; i++) if (safeXp >= LEVELS[i].minXp) index = i
  const current = LEVELS[index]
  const next = LEVELS[index + 1] ?? null
  const span = next ? next.minXp - current.minXp : 0
  const into = safeXp - current.minXp
  return {
    level: index + 1,
    titleKey: current.titleKey,
    xpIntoLevel: into,
    xpForNext: span,
    percent: next ? Math.min(100, Math.round((into / span) * 100)) : 100,
    nextMinXp: next?.minXp ?? null,
  }
}

function dayKey(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function withStreak(state: GrowthState, now: number): GrowthState {
  const today = dayKey(now)
  if (state.lastActiveDay === today) return state
  const yesterday = dayKey(now - 86_400_000)
  return { ...state, lastActiveDay: today, streakDays: state.lastActiveDay === yesterday ? state.streakDays + 1 : 1 }
}

export function addXp(state: GrowthState, amount: number, now = Date.now()): GrowthState {
  if (!Number.isFinite(amount) || amount <= 0) return state
  return { ...withStreak(state, now), xp: state.xp + Math.floor(amount) }
}

export function awardTask(state: GrowthState, count = 1, now = Date.now()): GrowthState {
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return state
  return { ...addXp(state, n * TASK_XP, now), tasks: state.tasks + n }
}

/** Petting has a cooldown so rapid clicking cannot farm XP. */
export function awardPet(state: GrowthState, now = Date.now()): { state: GrowthState; awarded: boolean } {
  if (now - state.lastPetAt < PET_COOLDOWN_MS) return { state, awarded: false }
  return { state: { ...addXp(state, PET_XP, now), lastPetAt: now, pets: state.pets + 1 }, awarded: true }
}

interface GrowthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function browserStorage(): GrowthStorage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined }
}

function sanitize(value: Partial<GrowthState>): GrowthState {
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)
  return {
    version: 1,
    xp: num(value.xp),
    lastPetAt: num(value.lastPetAt),
    lastActiveDay: typeof value.lastActiveDay === 'string' ? value.lastActiveDay : '',
    streakDays: num(value.streakDays),
    tasks: num(value.tasks),
    pets: num(value.pets),
  }
}

export function loadGrowth(storageImpl: GrowthStorage | undefined = browserStorage()): GrowthState {
  if (!storageImpl) return { ...DEFAULTS }
  try {
    const parsed = JSON.parse(storageImpl.getItem(GROWTH_KEY) ?? 'null') as Partial<GrowthState> | null
    if (!parsed || parsed.version !== 1) return { ...DEFAULTS }
    return sanitize(parsed)
  } catch {
    return { ...DEFAULTS }
  }
}

let channel: BroadcastChannel | null = null

function broadcast(state: GrowthState): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(GROWTH_EVENT, { detail: state }))
  try {
    if (typeof BroadcastChannel === 'undefined') return
    channel ??= new BroadcastChannel('petdeck-growth')
    channel.postMessage(state)
  } catch { /* cross-window sync is best-effort */ }
}

export function saveGrowth(state: GrowthState, storageImpl: GrowthStorage | undefined = browserStorage()): GrowthState {
  try { storageImpl?.setItem(GROWTH_KEY, JSON.stringify(state)) } catch { /* storage unavailable */ }
  broadcast(state)
  return state
}

/** Award XP from a completed task/relay run and persist it. */
export function awardTaskGrowth(count = 1, now = Date.now()): GrowthState {
  return saveGrowth(awardTask(loadGrowth(), count, now))
}

/** Pet once (cooldown enforced); returns whether XP was awarded. */
export function awardPetGrowth(now = Date.now()): { awarded: boolean; state: GrowthState } {
  const result = awardPet(loadGrowth(), now)
  if (result.awarded) saveGrowth(result.state)
  return result
}

export function subscribeGrowth(handler: (state: GrowthState) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onCustom = (event: Event) => handler((event as CustomEvent<GrowthState>).detail ?? loadGrowth())
  const onStorage = (event: StorageEvent) => { if (event.key === GROWTH_KEY) handler(loadGrowth()) }
  window.addEventListener(GROWTH_EVENT, onCustom)
  window.addEventListener('storage', onStorage)
  let bc: BroadcastChannel | null = null
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('petdeck-growth')
      bc.onmessage = (event) => handler(event.data as GrowthState)
    }
  } catch { /* cross-window sync is best-effort */ }
  return () => {
    window.removeEventListener(GROWTH_EVENT, onCustom)
    window.removeEventListener('storage', onStorage)
    bc?.close()
  }
}
