// Main-window chrome helpers. Every call is a no-op outside Tauri so the web
// preview and unit tests never touch a native window.
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from './window.ts'

export function windowControlsSupported(): boolean {
  return isTauri()
}

export async function minimizeMainWindow(): Promise<void> {
  if (!isTauri()) return
  try { await getCurrentWindow().minimize() } catch { /* window already gone */ }
}

export async function isMainWindowMaximized(): Promise<boolean> {
  if (!isTauri()) return false
  try { return await getCurrentWindow().isMaximized() } catch { return false }
}

export async function toggleMainWindowMaximize(): Promise<void> {
  if (!isTauri()) return
  try { await getCurrentWindow().toggleMaximize() } catch { /* window already gone */ }
}

/** Rust's global CloseRequested handler hides the window, so this is close-to-tray. */
export async function closeMainWindow(): Promise<void> {
  if (!isTauri()) return
  const win = getCurrentWindow()
  try { await win.close() } catch {
    try { await win.hide() } catch { /* nothing left to do */ }
  }
}

export async function onMainWindowResized(handler: () => void): Promise<() => void> {
  if (!isTauri()) return () => {}
  try { return await getCurrentWindow().onResized(handler) } catch { return () => {} }
}
