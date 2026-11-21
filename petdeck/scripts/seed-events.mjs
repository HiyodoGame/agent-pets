#!/usr/bin/env node
// Seeds a runtime database with one task and N transcript events so the task
// page can be profiled (W5: 1000 / 5000 events, first paint P95, scrolling).
//
//   node scripts/seed-events.mjs --events 5000
//   PETDECK_DATA_DIR=<printed dir> node server/bridge.mjs
//
// Prints a JSON line with the data dir and task id to open in the console.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openRuntimeDb } from '../server/runtime/db.mjs';

function arg(name, fallback) {
  const idx = process.argv.indexOf('--' + name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

const count = Math.max(1, Number(arg('events', '5000')) || 5000);
const dataDir = path.resolve(arg('dir', path.join(os.tmpdir(), 'petdeck-perf-' + count)));
fs.mkdirSync(dataDir, { recursive: true });

const store = openRuntimeDb({ dataDir });
const project = store.addProject({ name: 'Perf project', projectPath: path.join(dataDir, 'repo'), kind: 'git' });
const task = store.createTask({
  projectId: project.id,
  title: 'Perf ' + count + ' events',
  prompt: 'Transcript seeded for the W5 performance check.',
  agent: 'claude-code',
});
const run = store.createRun({ taskId: task.id, status: 'completed' });
store.updateRun(run.id, { status: 'completed', ended_at: Date.now(), exit_code: 0 });

const started = Date.now();
const rows = [];
for (let i = 1; i <= count; i += 1) {
  const type = i % 7 === 0 ? 'tool.started' : i % 11 === 0 ? 'message.thinking' : 'message.assistant';
  const payload = type === 'tool.started'
    ? { name: 'Read', input: { file: 'src/flows/console/task-page.tsx' } }
    : { text: 'Seeded transcript line ' + i + ' — ' + 'lorem ipsum dolor sit amet '.repeat(3) };
  rows.push({ taskId: task.id, runId: run.id, type, payload, ts: Date.now() + i });
}
for (let offset = 0; offset < rows.length; offset += 1000) store.appendEvents(rows.slice(offset, offset + 1000));
store.updateTask(task.id, { status: 'completed' });
store.close();

console.log(JSON.stringify({
  dataDir,
  taskId: task.id,
  runId: run.id,
  events: count,
  seededInMs: Date.now() - started,
  hint: 'PETDECK_DATA_DIR=' + dataDir + ' node server/bridge.mjs',
}, null, 2));
