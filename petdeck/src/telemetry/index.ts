// Browser binding: local-first (localStorage), anonymous uid, behavior-only.
import { attachPersistence, createTelemetryCore, EVENT } from './core'

const KEY = 'petdeck.telemetry.v1'
const UID_KEY = 'petdeck.uid'

function getUid(): string {
  try {
    let u = localStorage.getItem(UID_KEY)
    if (!u) { u = 'u-' + Math.random().toString(36).slice(2, 10); localStorage.setItem(UID_KEY, u) }
    return u
  } catch { return 'anon' }
}

export const telemetry = createTelemetryCore({ user: getUid() })
if (typeof localStorage !== 'undefined') attachPersistence(telemetry, localStorage, KEY)

export const track = (page: string, action: string, extra?: Record<string, unknown>) => telemetry.track(page, action, extra)
export const exportTelemetry = () => telemetry.exportJSON()
export { EVENT }