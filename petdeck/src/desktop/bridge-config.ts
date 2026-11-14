import { invoke } from '@tauri-apps/api/core'
import { BRIDGE_URL, configureBridgeClient, type BridgeClientConfig } from '../adapters/bridge-client.ts'
import { isTauri } from './window.ts'

export async function initializeBridgeConfig(): Promise<BridgeClientConfig> {
  const config = isTauri()
    ? await invoke<BridgeClientConfig>('get_bridge_config')
    : {
        url: BRIDGE_URL,
        token: (import.meta.env?.VITE_PETDECK_BRIDGE_TOKEN as string | undefined) ?? '',
      }
  configureBridgeClient(config)
  return config
}
