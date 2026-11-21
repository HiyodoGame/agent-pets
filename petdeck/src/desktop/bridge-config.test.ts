import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BRIDGE_URL, bridgeConfigError, configureBridgeClient, inject, subscribeEvents } from '../adapters/bridge-client.ts'
import type { InjectPayload } from '../adapters/types.ts'
import { BRIDGE_CONFIG_CHANGED, initializeBridgeConfig, onBridgeConfigChanged } from './bridge-config.ts'

const payload: InjectPayload = { from: 'petdeck', to: 'codex', context: 'ctx', instruction: 'run' }
const originalFetch = globalThis.fetch
const originalEventSource = globalThis.EventSource

function reset(t: import('node:test').TestContext) {
  t.after(() => {
    configureBridgeClient({ url: BRIDGE_URL, token: '' })
    globalThis.fetch = originalFetch
    globalThis.EventSource = originalEventSource
  })
}

test('web bridge bootstrap: non-Tauri environments keep the default endpoint', async (t) => {
  reset(t)
  const config = await initializeBridgeConfig()
  assert.equal(config.url, BRIDGE_URL)
  assert.equal(config.token, '')
})

test('desktop bridge: a Rust-side startup error is kept and exposed to the shell', (t) => {
  reset(t)
  configureBridgeClient({ url: 'http://127.0.0.1:6331', token: 'x', error: '未检测到 Node.js，请安装 Node.js 24 后重启 PetDeck。' })
  assert.equal(bridgeConfigError(), '未检测到 Node.js，请安装 Node.js 24 后重启 PetDeck。')
  configureBridgeClient({ url: 'http://127.0.0.1:6331', token: 'x' })
  assert.equal(bridgeConfigError(), undefined)
})

test('desktop bridge: runtime URL and token are used for HTTP inject', async (t) => {
  reset(t)
  configureBridgeClient({ url: 'http://127.0.0.1:6321/', token: 'desktop-secret' })
  let seenUrl = ''
  let seenToken = ''
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url)
    seenToken = (init?.headers as Record<string, string> | undefined)?.['X-Petdeck-Token'] ?? ''
    return new Response(JSON.stringify({ ok: true, mode: 'inject' }))
  }) as typeof fetch
  await inject(payload)
  assert.equal(seenUrl, 'http://127.0.0.1:6321/api/inject')
  assert.equal(seenToken, 'desktop-secret')
})

test('desktop bridge: runtime URL is used for SSE', (t) => {
  reset(t)
  configureBridgeClient({ url: 'http://127.0.0.1:6322', token: 'desktop-secret' })
  let seenUrl = ''
  class FakeEventSource {
    static readonly CONNECTING = 0
    onmessage = null
    onopen = null
    onerror = null
    constructor(url: string) { seenUrl = url }
    close() {}
  }
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  const close = subscribeEvents(() => {})
  assert.equal(seenUrl, 'http://127.0.0.1:6322/api/events?token=desktop-secret')
  close()
})

test('desktop bridge: initializing a config notifies SSE owners', async (t) => {
  const target = new EventTarget()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true, writable: true })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete (globalThis as { window?: unknown }).window
  })
  let calls = 0
  const off = onBridgeConfigChanged(() => { calls += 1 })
  await initializeBridgeConfig()
  assert.equal(calls, 1)
  off()
  await initializeBridgeConfig()
  assert.equal(calls, 1)
})

test('desktop bridge: config changes notify and detach SSE owners', (t) => {
  const target = new EventTarget()
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { value: target, configurable: true, writable: true })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else delete (globalThis as { window?: unknown }).window
  })
  let calls = 0
  const off = onBridgeConfigChanged(() => { calls += 1 })
  target.dispatchEvent(new Event(BRIDGE_CONFIG_CHANGED))
  assert.equal(calls, 1)
  off()
  target.dispatchEvent(new Event(BRIDGE_CONFIG_CHANGED))
  assert.equal(calls, 1)
})

test('desktop bridge: failures never include the runtime token', async (t) => {
  reset(t)
  const token = 'desktop-secret-must-not-leak'
  configureBridgeClient({ url: 'http://127.0.0.1:6323', token })
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false }), { status: 401 })) as typeof fetch
  const error = await inject(payload).then(() => null, (reason: unknown) => reason)
  assert.ok(error instanceof Error)
  assert.equal(String(error).includes(token), false)
  assert.equal(JSON.stringify(error).includes(token), false)
})
