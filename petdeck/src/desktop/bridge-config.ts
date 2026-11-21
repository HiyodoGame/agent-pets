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
  // 首次启动时监听方还没挂上；重连路径依赖这次广播丢掉旧 EventSource。
  bridgeEventTarget()?.dispatchEvent(new Event(BRIDGE_CONFIG_CHANGED))
  return config
}

/** 本地服务重启后 URL 与 token 都会换新。数据层的 SSE 订阅只建立一次，
 *  所以这里广播配置变更，让订阅方关掉旧 EventSource 并按新配置重新连接。 */
export const BRIDGE_CONFIG_CHANGED = 'petdeck:bridge-config-changed'

function bridgeEventTarget(): EventTarget | null {
  return typeof window === 'undefined' ? null : window
}

export function onBridgeConfigChanged(listener: () => void): () => void {
  const target = bridgeEventTarget()
  if (!target) return () => {}
  const handler = () => listener()
  target.addEventListener(BRIDGE_CONFIG_CHANGED, handler)
  return () => target.removeEventListener(BRIDGE_CONFIG_CHANGED, handler)
}

/** Restart the local bridge from the desktop shell. The port and token are regenerated,
 *  so the returned config is applied to every client before the caller refreshes. */
export async function restartBridge(): Promise<BridgeClientConfig> {
  const config = await invoke<BridgeClientConfig>('restart_bridge')
  configureBridgeClient(config)
  bridgeEventTarget()?.dispatchEvent(new Event(BRIDGE_CONFIG_CHANGED))
  return config
}

/** Open the bundled Node.js license directory and return its path. */
export async function openNodeLicenses(): Promise<string> {
  return invoke<string>('open_node_licenses')
}
