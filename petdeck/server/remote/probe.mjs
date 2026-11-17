// Self-contained read-only SSH probe. The local bridge sends this file over stdin
// (`ssh host node -`) and receives a JSON array of observed sessions. It must only use
// Node builtins and must never write to the remote filesystem.
//
// MVP scope: Claude Code (~/.claude/projects) + Codex (~/.codex/sessions).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TAIL_BYTES = 512 * 1024
const MAX_PER_AGENT = 5

export function readTail(file) {
  const st = fs.statSync(file)
  const start = Math.max(0, st.size - TAIL_BYTES)
  const fd = fs.openSync(file, 'r')
  try {
    const len = st.size - start
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, start)
    const text = buf.toString('utf8')
    return start === 0 ? text : text.slice(text.indexOf('\n') + 1)
  } finally {
    fs.closeSync(fd)
  }
}

export function latestFiles(root, match, limit = MAX_PER_AGENT, maxDepth = 5) {
  const found = []
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.isFile() && match(entry.name)) {
        try { found.push({ file: full, mtimeMs: fs.statSync(full).mtimeMs }) } catch { /* vanished */ }
      }
    }
  }
  walk(root, 0)
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit)
}

export function parseClaudeLines(lines, mtimeMs = Date.now(), session = '') {
  let status = 'unknown'
  let lastMessage = ''
  let cwd = ''
  const tokens = { input: 0, output: 0, cacheRead: 0 }
  for (const ln of lines) {
    let j
    try { j = JSON.parse(ln) } catch { continue }
    cwd = j.cwd ?? cwd
    if (j.type === 'assistant') {
      const stop = j.message?.stop_reason
      status = stop === 'end_turn' || stop === 'stop_sequence' ? 'done' : 'running'
      const content = j.message?.content
      if (Array.isArray(content)) {
        const text = content.find((x) => x.type === 'text')
        if (text?.text) lastMessage = text.text
      }
      const usage = j.message?.usage
      if (usage) {
        tokens.input += usage.input_tokens ?? 0
        tokens.output += usage.output_tokens ?? 0
        tokens.cacheRead += usage.cache_read_input_tokens ?? 0
      }
    } else if (j.type === 'user' && typeof j.message?.content === 'string') {
      status = 'waiting'
    } else if (j.type === 'result') {
      status = j.is_error ? 'stuck' : 'done'
    }
  }
  if (status === 'unknown' && !lastMessage) return null
  return {
    agent: 'claude',
    session,
    status,
    lastMessage: lastMessage.slice(0, 200),
    title: (lastMessage || cwd).slice(0, 200),
    cwd,
    tokens,
    updatedAt: mtimeMs,
  }
}

export function parseCodexLines(lines, mtimeMs = Date.now(), session = '') {
  let status = 'unknown'
  let lastMessage = ''
  let turn = ''
  for (const ln of lines) {
    let j
    try { j = JSON.parse(ln) } catch { continue }
    const p = j.payload
    switch (p?.type) {
      case 'task_complete': status = 'done'; lastMessage = p.last_agent_message ?? lastMessage; break
      case 'task_started': status = 'running'; break
      case 'turn_aborted': status = 'stuck'; break
      case 'agent_message': lastMessage = p.message ?? lastMessage; break
    }
    if (p?.turn_id) turn = p.turn_id
  }
  if (status === 'unknown' && !lastMessage) return null
  return {
    agent: 'codex',
    session,
    status,
    lastMessage: lastMessage.slice(0, 200),
    title: lastMessage.slice(0, 200),
    turn,
    updatedAt: mtimeMs,
  }
}

export function collectRows(home = os.homedir()) {
  const rows = []
  for (const { file, mtimeMs } of latestFiles(path.join(home, '.claude', 'projects'), (n) => n.endsWith('.jsonl'))) {
    try {
      const row = parseClaudeLines(readTail(file).split('\n'), mtimeMs, path.basename(file))
      if (row) rows.push(row)
    } catch { /* skip unreadable session */ }
  }
  for (const { file, mtimeMs } of latestFiles(path.join(home, '.codex', 'sessions'), (n) => n.startsWith('rollout-') && n.endsWith('.jsonl'))) {
    try {
      const row = parseCodexLines(readTail(file).split('\n'), mtimeMs, path.basename(file))
      if (row) rows.push(row)
    } catch { /* skip unreadable session */ }
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt)
}

function main() {
  try {
    process.stdout.write(JSON.stringify(collectRows()))
  } catch {
    process.stderr.write('remote probe failed\n')
    process.exitCode = 1
  }
}

// `ssh host node -` sets argv[1] to '-'; importing this file in tests must not run main.
if (process.argv[1] === '-') main()
