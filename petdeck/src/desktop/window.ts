import { invoke } from '@tauri-apps/api/core'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state'

export interface PanelTarget {
  projectId?: string
  sessionId?: string
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function startPetDragging(): Promise<void> {
  if (!isTauri()) return
  await getCurrentWindow().startDragging()
}

export async function resizePetWindow(expanded: boolean, hasEvent: boolean): Promise<void> {
  if (!isTauri()) return
  const width = expanded || hasEvent ? 380 : 280
  const height = expanded ? 520 : hasEvent ? 320 : 220
  await getCurrentWindow().setSize(new LogicalSize(width, height))
}

export async function savePetPosition(): Promise<void> {
  if (!isTauri()) return
  await saveWindowState(StateFlags.POSITION)
}

export async function persistPetPositionOnMove(): Promise<() => void> {
  if (!isTauri()) return () => {}
  return getCurrentWindow().onMoved(() => { void savePetPosition() })
}

export async function openMainPanel(target: PanelTarget = {}): Promise<void> {
  if (!isTauri()) return
  await invoke('open_panel', { target })
}

export async function listenForPanelNavigation(handler: (target: PanelTarget) => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  return listen<PanelTarget>('petdeck:navigate', (event) => handler(event.payload))
}
