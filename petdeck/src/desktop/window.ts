import { invoke } from '@tauri-apps/api/core'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { listen } from '@tauri-apps/api/event'
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import { saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state'
import type { PetDirection } from '../flows/shared/pet/skin-types'
import { computePetLayout, computeRoamPosition, type PetPanelPlacement, type PetWindowMode, type PetWorkArea } from './pet-layout.ts'
import { createLatestOnlyQueue } from './latest-only-queue.ts'

export interface PanelTarget {
  projectId?: string
  sessionId?: string
}

const schedulePetLayout = createLatestOnlyQueue()

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function startPetDragging(): Promise<void> {
  if (!isTauri()) return
  await getCurrentWindow().startDragging()
}

async function petGeometry() {
  const pet = getCurrentWindow()
  const monitor = await currentMonitor()
  if (!monitor) return null
  const [position, currentSize] = await Promise.all([pet.outerPosition(), pet.outerSize()])
  const workArea: PetWorkArea = {
    x: monitor.workArea.position.x,
    y: monitor.workArea.position.y,
    width: monitor.workArea.size.width,
    height: monitor.workArea.size.height,
  }
  return { pet, monitor, position, currentSize, workArea }
}

export async function updatePetWindowLayout(mode: PetWindowMode, scale: number, previousScale = scale): Promise<void> {
  if (!isTauri()) return
  await schedulePetLayout(async () => {
    const geometry = await petGeometry()
    if (!geometry) return
    const previousPlacement = document.documentElement.dataset.panelPlacement
    const next = computePetLayout({
      mode,
      scale,
      previousScale,
      previousPlacement: previousPlacement === 'left' || previousPlacement === 'right' ? previousPlacement as PetPanelPlacement : undefined,
      pixelRatio: geometry.monitor.scaleFactor,
      position: geometry.position,
      currentSize: geometry.currentSize,
      workArea: geometry.workArea,
    })
    document.documentElement.dataset.panelPlacement = next.placement ?? 'none'
    await invoke('set_pet_layout', { width: next.width, height: next.height, x: next.x, y: next.y })
  })
}

export async function resizePetWindow(expanded: boolean, hasEvent: boolean): Promise<void> {
  await updatePetWindowLayout(expanded ? 'quick' : hasEvent ? 'event' : 'compact', 1)
}

export async function setPetAlwaysOnTop(enabled: boolean): Promise<void> {
  if (!isTauri()) return
  await getCurrentWindow().setAlwaysOnTop(enabled)
}

export async function movePetBy(direction: PetDirection): Promise<void> {
  if (!isTauri()) return
  const geometry = await petGeometry()
  if (!geometry) return
  const next = computeRoamPosition({
    position: geometry.position,
    size: geometry.currentSize,
    direction,
    workArea: geometry.workArea,
    pixelRatio: geometry.monitor.scaleFactor,
  })
  if (next.x === geometry.position.x && next.y === geometry.position.y) return
  await geometry.pet.setPosition(new PhysicalPosition(next.x, next.y))
}

export async function savePetPosition(): Promise<void> {
  if (!isTauri()) return
  await saveWindowState(StateFlags.POSITION)
}

export async function persistPetPositionOnMove(onSettled?: () => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const unlisten = await getCurrentWindow().onMoved(() => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      void savePetPosition()
      onSettled?.()
    }, 180)
  })
  return () => {
    clearTimeout(timer)
    unlisten()
  }
}

export async function openMainPanel(target: PanelTarget = {}): Promise<void> {
  if (!isTauri()) return
  await invoke('open_panel', { target })
}

export async function hidePet(): Promise<void> {
  if (!isTauri()) return
  await getCurrentWindow().hide()
}

export async function quitPetDeck(): Promise<void> {
  if (!isTauri()) return
  await invoke('quit_app')
}

export async function setDesktopDnd(enabled: boolean): Promise<void> {
  if (!isTauri()) return
  await invoke('set_dnd', { enabled })
}

/** DND 持久化（P2-11）：启动时读取 Rust 侧持久化的免打扰状态；非 Tauri 环境返回 false。 */
export async function getDnd(): Promise<boolean> {
  if (!isTauri()) return false
  const enabled = await invoke<boolean>('get_dnd')
  return enabled
}

export async function listenForDndChange(handler: (enabled: boolean) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  const unlisten = await listen<boolean>('petdeck:dnd-changed', (event) => handler(event.payload))
  return unlisten
}

export async function listenForPanelNavigation(handler: (target: PanelTarget) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  return listen<PanelTarget>('petdeck:navigate', (event) => handler(event.payload))
}

/** Persist the UI language and re-label the native tray menu. Best-effort: the
 *  web/dev environment simply skips it. */
export async function setDesktopLocale(locale: 'zh' | 'en'): Promise<void> {
  if (!isTauri()) return
  try { await invoke('set_locale', { locale }) } catch { /* tray sync is best-effort */ }
}
