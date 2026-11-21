// v1 -> v2 migration and restart recovery for the new scheduling/decision state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openRuntimeDb, SCHEMA_VERSION } from './db.mjs';

function tempDir(tag) { return fs.mkdtempSync(path.join(os.tmpdir(), 'petdeck-' + tag + '-')); }

test('migrates a v1 database without losing tasks and adds v2 defaults', () => {
  const dir = tempDir('db-v1');
  const file = path.join(dir, 'petdeck.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'git', created_at INTEGER NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL, prompt TEXT NOT NULL, agent TEXT NOT NULL, status TEXT NOT NULL,
      worktree_path TEXT, branch TEXT, session_id TEXT,
      permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE runs (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), session_id TEXT,
      pid INTEGER, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
      exit_code INTEGER, error TEXT
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, run_id TEXT,
      type TEXT NOT NULL, ts INTEGER NOT NULL, payload_json TEXT NOT NULL
    );
    INSERT INTO projects (id, name, path, kind, created_at) VALUES ('p1', 'Legacy', 'C:/legacy', 'git', 1);
    INSERT INTO tasks (id, project_id, title, prompt, agent, status, created_at, updated_at)
      VALUES ('t1', 'p1', 'Old task', 'old prompt', 'claude-code', 'ready', 2, 2);
    PRAGMA user_version = 1;
  `);
  legacy.close();

  const store = openRuntimeDb({ dataDir: dir });
  const task = store.getTask('t1');
  assert.equal(task.title, 'Old task');
  assert.equal(task.depends_on, '[]');
  assert.equal(task.priority, 0);
  assert.equal(task.queued_prompt, null);
  const decision = store.createDecision({ taskId: 't1', question: 'Which one?', options: ['A', 'B'] });
  assert.equal(decision.status, 'pending');
  assert.equal(store.listPendingDecisions().length, 1);
  store.setSetting('maxConcurrent', 3);
  assert.equal(store.getSetting('maxConcurrent'), 3);
  store.close();
  const check = new DatabaseSync(file);
  assert.equal(check.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  check.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restart recovery: queued tasks return to ready, paused runs/tasks are stopped', () => {
  const dir = tempDir('db-recover');
  const store = openRuntimeDb({ dataDir: dir });
  const project = store.addProject({ name: 'P', projectPath: 'C:/recover', kind: 'git' });
  const queued = store.createTask({ projectId: project.id, title: 'Queued', prompt: 'x', agent: 'claude-code' });
  store.updateTask(queued.id, { status: 'queued' });
  const paused = store.createTask({ projectId: project.id, title: 'Paused', prompt: 'y', agent: 'claude-code' });
  const run = store.createRun({ taskId: paused.id, status: 'paused' });
  store.updateTask(paused.id, { status: 'paused' });

  store.recoverInterrupted();

  assert.equal(store.getTask(queued.id).status, 'ready');
  assert.equal(store.getTask(paused.id).status, 'stopped');
  const recovered = store.getRun(run.id);
  assert.equal(recovered.status, 'failed');
  assert.equal(recovered.error, 'bridge-restarted');
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
