// Remote SSH adapter — observe-only. Runs a self-contained read-only probe on each
// configured host (`ssh host node -`, script over stdin) and tags rows with the host.
// MVP probe covers Claude Code + Codex; remote sessions are never injectable.
import fs from 'node:fs'
import { runCli } from './exec.mjs'

export const id = 'remote'
export const name = 'Remote SSH'
export const tier = 'observe-only'

export const MAX_ROWS = 10
const HOST_RE = /^[A-Za-z0-9_.-]+(@[A-Za-z0-9_.-]+)?$/
const PROBE = fs.readFileSync(new URL('../remote/probe.mjs', import.meta.url), 'utf8')

/** Parse PETDECK_REMOTE_HOSTS; rejects option-like / shell-metacharacter hosts. */
export function parseHosts(value = process.env.PETDECK_REMOTE_HOSTS ?? '') {
  return String(value)
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host && !host.startsWith('-') && HOST_RE.test(host))
}

/** Pure: validate the JSON array printed by the remote probe and tag it with the host. */
export function parseProbeRows(stdout, host) {
  let rows
  try { rows = JSON.parse(stdout) } catch { return [] }
  if (!Array.isArray(rows)) return []
  return rows
    .filter((row) => row && typeof row.session === 'string' && typeof row.agent === 'string')
    .map((row) => ({
      agent: row.agent,
      source: 'ssh-probe',
      session: row.session,
      status: typeof row.status === 'string' ? row.status : 'unknown',
      lastMessage: typeof row.lastMessage === 'string' ? row.lastMessage.slice(0, 200) : '',
      title: typeof row.title === 'string' ? row.title.slice(0, 200) : '',
      turn: typeof row.turn === 'string' ? row.turn : '',
      tokens: row.tokens,
      updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
      host,
    }))
}

/** Observe all configured hosts. One unreachable host only drops that host's rows;
 *  if every host fails, throw so the bridge keeps the previous stale snapshot. */
export async function observe({ hosts = parseHosts(), run = runCli } = {}) {
  if (hosts.length === 0) return []
  const rows = []
  let ok = 0
  for (const host of hosts) {
    const result = await run('ssh', [
      '-T',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=8',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'LogLevel=ERROR',
      host, 'node', '-',
    ], { input: PROBE, timeout: 25000 })
    if (result.status !== 0) continue
    ok++
    rows.push(...parseProbeRows(result.stdout, host))
  }
  if (ok === 0) throw new Error('remote observe failed')
  return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_ROWS)
}

export function inject() {
  // Remote sessions are read-only by design; relay always degrades to clipboard.
  return { ok: false, response: '' }
}

export default { id, name, tier, observe, inject }
