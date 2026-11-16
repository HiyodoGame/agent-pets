import { invoke } from '@tauri-apps/api/core'
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
