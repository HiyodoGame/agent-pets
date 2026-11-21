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

/** Restart the local bridge from the desktop shell. The port and token are regenerated,
 *  so the returned config is applied to every client before the caller refreshes. */
export async function restartBridge(): Promise<BridgeClientConfig> {
  const config = await invoke<BridgeClientConfig>('restart_bridge')
  configureBridgeClient(config)
  return config
}

/** Open the bundled Node.js license directory and return its path. */
export async function openNodeLicenses(): Promise<string> {
  return invoke<string>('open_node_licenses')
}
