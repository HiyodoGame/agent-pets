import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './window.ts'

export interface UpdateInfo {
  available: boolean
  version?: string
  body?: string
}

export type UpdatePhase = 'unsupported' | 'idle' | 'checking' | 'available' | 'uptodate' | 'installing' | 'error'

/** Pure: user-facing status line for the settings panel. */
export function updateStatusText(phase: UpdatePhase, info?: UpdateInfo | null, error?: string): string {
  switch (phase) {
    case 'unsupported': return '自动更新仅在桌面版可用'
    case 'checking': return '正在检查更新…'
    case 'available': return info?.version ? `发现新版本 ${info.version}` : '发现新版本'
    case 'uptodate': return '已是最新版本'
    case 'installing': return '正在下载并安装，应用将会自动重启…'
    case 'error': return error ? `检查更新失败：${error}` : '检查更新失败'
    default: return '从 GitHub Releases 检查新版本'
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
