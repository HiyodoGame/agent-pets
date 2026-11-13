// Pure a11y/UX logic (unit-tested): stepper state + user-level motion preference.

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