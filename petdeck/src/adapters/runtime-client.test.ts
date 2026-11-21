import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BRIDGE_URL, configureBridgeClient } from './bridge-client.ts'
import { createTask, listTasks } from './runtime-client.ts'

const originalFetch = globalThis.fetch

function reset(t: import('node:test').TestContext) {
  t.after(() => {
    configureBridgeClient({ url: BRIDGE_URL, token: '' })
    globalThis.fetch = originalFetch
  })
}

test('createTask posts the camelCase bridge contract', async (t) => {
  reset(t)
  configureBridgeClient({ url: 'http://127.0.0.1:6401', token: 'desktop-secret' })
  let seenUrl = ''
  let seenInit: RequestInit | undefined
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seenUrl = String(url)
    seenInit = init
    return new Response(JSON.stringify({ ok: true, task: { id: 'task-1' } }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch

  const task = await createTask({ projectId: 'project-1', title: 'T', prompt: 'P', agent: 'kimi-code', permissionMode: 'default' })
  assert.equal(task.id, 'task-1')
  assert.equal(seenUrl, 'http://127.0.0.1:6401/api/runtime/tasks')
  assert.ok(seenInit)
  assert.deepEqual(JSON.parse(String(seenInit.body)), {
    projectId: 'project-1',
    title: 'T',
    prompt: 'P',
    agent: 'kimi-code',
    permissionMode: 'default',
  })
  assert.equal((seenInit.headers as Record<string, string>)['X-Petdeck-Token'], 'desktop-secret')
})

test('listTasks filters with the camelCase projectId query', async (t) => {
  reset(t)
  configureBridgeClient({ url: 'http://127.0.0.1:6402', token: '' })
  let seenUrl = ''
  globalThis.fetch = (async (url: string | URL | Request) => {
    seenUrl = String(url)
    return new Response(JSON.stringify({ ok: true, tasks: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch

  await listTasks('project 1')
  assert.equal(seenUrl, 'http://127.0.0.1:6402/api/runtime/tasks?projectId=project%201')
})
