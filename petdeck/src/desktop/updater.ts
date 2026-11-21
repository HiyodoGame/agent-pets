import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from './window.ts'
import { t } from '../i18n/index.ts'

export interface UpdateInfo {
  available: boolean
  version?: string
  body?: string
}

export type UpdatePhase = 'unsupported' | 'idle' | 'checking' | 'available' | 'uptodate' | 'installing' | 'error'

/** Pure: user-facing status line for the settings panel. */
export function updateStatusText(phase: UpdatePhase, info?: UpdateInfo | null, error?: string): string {
  switch (phase) {
    case 'unsupported': return t('update.unsupported')
    case 'checking': return t('update.checking')
    case 'available': return info?.version ? t('update.available', { version: info.version }) : t('update.availableNoVersion')
    case 'uptodate': return t('update.uptodate')
    case 'installing': return t('update.installing')
    case 'error': return error ? t('update.error', { error }) : t('update.errorGeneric')
    default: return t('update.idle')
  }
}

export function updateAvailable(info: UpdateInfo | null | undefined): boolean {
  return Boolean(info?.available && info.version)
}

/** Tauri-only: query the signed release manifest. Never downloads anything. */
export async function checkForUpdate(): Promise<UpdateInfo> {
  if (!isTauri()) throw new Error('仅桌面版支持自动更新')
  return await invoke<UpdateInfo>('check_update')
}

/** Tauri-only: download + install the pending update. Windows exits the app after
 *  launching the installer; the new version starts on its own. */
export async function installPendingUpdate(): Promise<void> {
  if (!isTauri()) throw new Error('仅桌面版支持自动更新')
  await invoke('install_update')
}

export interface UpdateProgress {
  downloaded: number
  total: number | null
}

export type UpdateErrorKind = 'network' | 'signature' | 'disk' | 'unknown'

/** Pure: bucket the updater's raw error string so the UI can say something honest. */
export function classifyUpdateError(raw: string | null | undefined): UpdateErrorKind {
  const text = String(raw ?? '').toLowerCase()
  if (!text) return 'unknown'
  if (/signature|verify|verification|minisign|pubkey|public key|invalid key/i.test(text)) return 'signature'
  if (/no space|disk full|not enough space|write|permission denied|access is denied|os error 112|os error 28/i.test(text)) return 'disk'
  if (/network|connect|timeout|timed out|dns|resolve|proxy|failed to fetch|sending request|502|503|504|temporarily unavailable|tls|certificate/i.test(text)) return 'network'
  return 'unknown'
}

/** Pure: percent for the download bar, or null when the server sent no length. */
export function progressPercent(downloaded: number, total: number | null | undefined): number | null {
  if (!total || total <= 0) return null
  return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)))
}

/** Tauri-only: the installed app version ('' outside the desktop shell). */
export async function currentAppVersion(): Promise<string> {
  if (!isTauri()) return ''
  return await getVersion()
}

/** Tauri-only: subscribe to the download progress emitted by `install_update`. */
export async function onUpdateProgress(handler: (progress: UpdateProgress) => void): Promise<UnlistenFn> {
  return listen<UpdateProgress>('update-progress', (event) => handler(event.payload))
}
