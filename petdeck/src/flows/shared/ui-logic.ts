// Pure a11y/UX logic (unit-tested): stepper state + user-level motion preference.

/** 计数 999+ 封顶（boundary-overflow）。纯函数，独立于组件文件以利 fast-refresh。 */
export const fmtCount = (n: number): string => (n > 999 ? '999+' : String(n))

export type StepStatus = 'done' | 'current' | 'todo'

/** i<current done, i===current current, else todo. */
export function stepperState(count: number, current: number): StepStatus[] {
  return Array.from({ length: count }, (_, i) => (i < current ? 'done' : i === current ? 'current' : 'todo'))
}

export type MotionPref = 'auto' | 'on' | 'off'

/** User preference overrides OS: off=>false, on=>true, auto=>!osReduced. */
export function resolveMotionEnabled(pref: MotionPref, osReduced: boolean): boolean {
  if (pref === 'off') return false
  if (pref === 'on') return true
  return !osReduced
}

const MOTION_KEY = 'petdeck.motion'

export function getMotionPref(): MotionPref {
  try {
    const v = localStorage.getItem(MOTION_KEY)
    return v === 'on' || v === 'off' ? v : 'auto'
  } catch { return 'auto' }
}

export function setMotionPref(pref: MotionPref): void {
  try { localStorage.setItem(MOTION_KEY, pref) } catch { /* ignore */ }
}

/** 新鲜度相对时间（stale 标记用）。ts 在未来时按「刚刚」处理。 */
export function fmtAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}