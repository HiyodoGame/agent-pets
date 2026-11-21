// Runtime data layer — node:sqlite (Node 24 built-in), no native dependency.
// Canonical transcript lives in runs/<runId>/events.jsonl (service appends); this
// DB stores projects/tasks/runs plus an event index with payload for fast replay.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const SCHEMA_VERSION = 4;

export function resolveDataDir(env = process.env) {
  if (env.PETDECK_DATA_DIR) return path.resolve(env.PETDECK_DATA_DIR);
  if (process.platform === 'win32') {
    return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'PetDeck');
  }
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'petdeck');
}

export function resolveWorktreesDir(env = process.env) {
  if (env.PETDECK_WORKTREES_DIR) return path.resolve(env.PETDECK_WORKTREES_DIR);
  if (process.platform === 'win32') {
    return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'PetDeck', 'worktrees');
  }
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'petdeck', 'worktrees');
}

const TASK_FIELDS = new Set([
  'title', 'prompt', 'agent', 'status', 'worktree_path', 'branch', 'session_id', 'permission_mode',
  'depends_on', 'priority', 'queued_prompt', 'queued_resume',
  'summary', 'last_feedback', 'reviewed_at', 'merged_at', 'merge_token', 'merge_token_expires',
  'reject_count', 'updated_at',
]);
const RUN_FIELDS = new Set(['session_id', 'pid', 'status', 'ended_at', 'exit_code', 'error']);
const DECISION_FIELDS = new Set(['status', 'answer', 'answered_at', 'expires_at']);
const ARTIFACT_FIELDS = new Set(['name', 'kind', 'mime', 'bytes']);
const PROPOSAL_FIELDS = new Set(['project_id', 'title', 'summary', 'status', 'items_json', 'task_ids_json', 'confirmed_at', 'updated_at']);

function nowMs() { return Date.now(); }

function makeId() { return randomUUID(); }

const CORRUPT_RE = /malformed|not a database|disk image is malformed|file is encrypted|database corrupt/i;

function looksCorrupt(error) {
  return CORRUPT_RE.test(String(error?.message ?? error));
}

/** Move a corrupt database (and its WAL sidecars) aside, keeping the bytes for support. */
function backupDatabase(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let primary = null;
  for (const candidate of [file, file + '-wal', file + '-shm']) {
    if (!fs.existsSync(candidate)) continue;
    let dest = candidate + '.bak-' + stamp;
    let n = 1;
    while (fs.existsSync(dest)) dest = candidate + '.bak-' + stamp + '-' + n++;
    fs.renameSync(candidate, dest);
    if (candidate === file) primary = dest;
  }
  return primary;
}

/**
 * Open the SQLite file and prove it is readable before the runtime trusts it.
 * quick_check catches a truncated or zeroed file cheaply; on failure the original
 * bytes are moved to petdeck.sqlite.bak-<stamp> and a fresh database is created, so
 * the app still starts (the UI reads store.integrity to explain what happened).
 */
function openVerifiedDatabase(file) {
  let db = null;
  try {
    db = new DatabaseSync(file);
    const rows = db.prepare('PRAGMA quick_check').all();
    const messages = rows.map((row) => Object.values(row)[0]).filter((value) => typeof value === 'string');
    if (messages.length === 1 && messages[0].toLowerCase() === 'ok') return { db, integrity: { ok: true } };
    try { db.close(); } catch { /* ignore */ }
    db = null;
    const reason = messages.slice(0, 3).join('; ') || 'quick_check returned no rows';
    const backupPath = backupDatabase(file);
    return { db: new DatabaseSync(file), integrity: { ok: false, backupPath, reason, at: Date.now() } };
  } catch (error) {
    try { db?.close(); } catch { /* ignore */ }
    if (!looksCorrupt(error)) throw error;
    const backupPath = backupDatabase(file);
    return {
      db: new DatabaseSync(file),
      integrity: { ok: false, backupPath, reason: String(error?.message ?? error).slice(0, 300), at: Date.now() },
    };
  }
}

/** Open (and migrate) the runtime database. Returns an object with narrow methods. */
export function openRuntimeDb({ dataDir = resolveDataDir(), filename = 'petdeck.sqlite' } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const { db, integrity } = openVerifiedDatabase(path.join(dataDir, filename));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  const store = createStore(db);
  // Not part of the store API surface used by callers; read-only recovery metadata.
  store.integrity = integrity;
  return store;
}

function migrate(db) {
  const row = db.prepare('PRAGMA user_version').get();
  const current = Number(row?.user_version ?? 0);
  if (current > SCHEMA_VERSION) throw new Error('database schema is newer than this build');
  if (current >= SCHEMA_VERSION) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL DEFAULT 'git',
      base_branch TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      agent TEXT NOT NULL,
      status TEXT NOT NULL,
      worktree_path TEXT,
      branch TEXT,
      session_id TEXT,
      permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
      depends_on TEXT NOT NULL DEFAULT '[]',
      priority INTEGER NOT NULL DEFAULT 0,
      queued_prompt TEXT,
      queued_resume INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      last_feedback TEXT,
      reviewed_at INTEGER,
      merged_at INTEGER,
      merge_token TEXT,
      merge_token_expires INTEGER,
      reject_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      session_id TEXT,
      pid INTEGER,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      exit_code INTEGER,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      run_id TEXT,
      type TEXT NOT NULL,
      ts INTEGER NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id, id);
    CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id, started_at);
  `);
  // v1 -> v2: dependency/priority columns, decision cards and durable settings.
  const taskColumns = new Set(db.prepare('PRAGMA table_info(tasks)').all().map((c) => c.name));
  if (!taskColumns.has('depends_on')) db.exec("ALTER TABLE tasks ADD COLUMN depends_on TEXT NOT NULL DEFAULT '[]'");
  if (!taskColumns.has('priority')) db.exec('ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0');
  if (!taskColumns.has('queued_prompt')) db.exec('ALTER TABLE tasks ADD COLUMN queued_prompt TEXT');
  if (!taskColumns.has('queued_resume')) db.exec('ALTER TABLE tasks ADD COLUMN queued_resume INTEGER NOT NULL DEFAULT 0');
  // v2 -> v3: acceptance/merge lifecycle, acceptance summary and durable artifacts.
  const projectColumns = new Set(db.prepare('PRAGMA table_info(projects)').all().map((c) => c.name));
  if (!projectColumns.has('base_branch')) db.exec('ALTER TABLE projects ADD COLUMN base_branch TEXT');
  if (!taskColumns.has('summary')) db.exec('ALTER TABLE tasks ADD COLUMN summary TEXT');
  if (!taskColumns.has('last_feedback')) db.exec('ALTER TABLE tasks ADD COLUMN last_feedback TEXT');
  if (!taskColumns.has('reviewed_at')) db.exec('ALTER TABLE tasks ADD COLUMN reviewed_at INTEGER');
  if (!taskColumns.has('merged_at')) db.exec('ALTER TABLE tasks ADD COLUMN merged_at INTEGER');
  if (!taskColumns.has('merge_token')) db.exec('ALTER TABLE tasks ADD COLUMN merge_token TEXT');
  if (!taskColumns.has('merge_token_expires')) db.exec('ALTER TABLE tasks ADD COLUMN merge_token_expires INTEGER');
  if (!taskColumns.has('reject_count')) db.exec('ALTER TABLE tasks ADD COLUMN reject_count INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      run_id TEXT,
      question TEXT NOT NULL,
      options_json TEXT NOT NULL DEFAULT '[]',
      allow_freeform INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'pending',
      answer TEXT,
      created_at INTEGER NOT NULL,
      answered_at INTEGER,
      expires_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_task ON decisions(task_id, created_at);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      run_id TEXT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      mime TEXT NOT NULL,
      bytes INTEGER NOT NULL DEFAULT 0,
      stored_path TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'auto',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_task ON artifacts(task_id, created_at);
    CREATE TABLE IF NOT EXISTS manager_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      proposal_id TEXT,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_manager_messages ON manager_messages(created_at);
    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      summary TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      items_json TEXT NOT NULL DEFAULT '[]',
      task_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      confirmed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status, created_at);
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      report_date TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      stats_json TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'local',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(report_date, project_id)
    );
    CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(report_date DESC, updated_at DESC);
    PRAGMA user_version = ${SCHEMA_VERSION};
  `);
}

function createStore(db) {
  const location = typeof db.location === 'function' ? db.location() : null;
  const q = {
    insertProject: db.prepare('INSERT INTO projects (id, name, path, kind, base_branch, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    allProjects: db.prepare('SELECT * FROM projects ORDER BY created_at ASC'),
    getProject: db.prepare('SELECT * FROM projects WHERE id = ?'),
    getProjectByPath: db.prepare('SELECT * FROM projects WHERE path = ?'),
    insertTask: db.prepare(`
      INSERT INTO tasks (id, project_id, title, prompt, agent, status, worktree_path, branch, session_id, permission_mode, depends_on, priority, queued_prompt, queued_resume, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
    `),
    getTask: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    allTasks: db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC'),
    tasksByProject: db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC'),
    insertRun: db.prepare(`
      INSERT INTO runs (id, task_id, session_id, pid, status, started_at, ended_at, exit_code, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getRun: db.prepare('SELECT * FROM runs WHERE id = ?'),
    runsByTask: db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY started_at ASC'),
    insertEvent: db.prepare('INSERT INTO events (task_id, run_id, type, ts, payload_json) VALUES (?, ?, ?, ?, ?)'),
    eventsByTask: db.prepare('SELECT * FROM events WHERE task_id = ? AND id > ? ORDER BY id ASC LIMIT ?'),
    eventsBefore: db.prepare('SELECT * FROM events WHERE task_id = ? AND id < ? ORDER BY id DESC LIMIT ?'),
    maxEvent: db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events WHERE task_id = ?'),
    insertDecision: db.prepare(`
      INSERT INTO decisions (id, task_id, run_id, question, options_json, allow_freeform, status, answer, created_at, answered_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL, ?)
    `),
    getDecision: db.prepare('SELECT * FROM decisions WHERE id = ?'),
    decisionsByTask: db.prepare('SELECT * FROM decisions WHERE task_id = ? ORDER BY created_at ASC'),
    pendingDecisions: db.prepare("SELECT * FROM decisions WHERE status = 'pending' ORDER BY created_at ASC"),
    getSetting: db.prepare('SELECT value_json FROM settings WHERE key = ?'),
    allSettings: db.prepare('SELECT key, value_json FROM settings ORDER BY key ASC'),
    insertArtifact: db.prepare(`
      INSERT INTO artifacts (id, task_id, run_id, name, kind, mime, bytes, stored_path, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getArtifact: db.prepare('SELECT * FROM artifacts WHERE id = ?'),
    artifactsByTask: db.prepare('SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at ASC'),
    deleteArtifact: db.prepare('DELETE FROM artifacts WHERE id = ?'),
    insertManagerMessage: db.prepare('INSERT INTO manager_messages (id, role, content, proposal_id, meta_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    managerMessages: db.prepare('SELECT * FROM manager_messages ORDER BY created_at DESC LIMIT ?'),
    clearManagerMessages: db.prepare('DELETE FROM manager_messages'),
    insertProposal: db.prepare("INSERT INTO proposals (id, project_id, title, summary, status, items_json, task_ids_json, created_at, updated_at, confirmed_at) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, NULL)"),
    getProposal: db.prepare('SELECT * FROM proposals WHERE id = ?'),
    allProposals: db.prepare('SELECT * FROM proposals ORDER BY created_at DESC LIMIT ?'),
    proposalsByStatus: db.prepare('SELECT * FROM proposals WHERE status = ? ORDER BY created_at DESC LIMIT ?'),
    upsertReport: db.prepare("INSERT INTO reports (id, report_date, project_id, title, body, stats_json, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(report_date, project_id) DO UPDATE SET title = excluded.title, body = excluded.body, stats_json = excluded.stats_json, source = excluded.source, updated_at = excluded.updated_at"),
    getReport: db.prepare('SELECT * FROM reports WHERE id = ?'),
    reportByDate: db.prepare('SELECT * FROM reports WHERE report_date = ? AND project_id = ?'),
    allReports: db.prepare('SELECT * FROM reports ORDER BY report_date DESC, updated_at DESC LIMIT ?'),
    reportsByProject: db.prepare('SELECT * FROM reports WHERE project_id = ? ORDER BY report_date DESC, updated_at DESC LIMIT ?'),
  };

  function getRow(stmt, ...args) { return stmt.get(...args); }
  function allRows(stmt, ...args) { return stmt.all(...args); }

  return {
    path: location,
    close() { try { db.close(); } catch { /* already closed */ } },
    /** On-disk schema version (PRAGMA user_version) — surfaced by the status card/diagnostics. */
    getSchemaVersion() {
      const row = db.prepare('PRAGMA user_version').get();
      return Number(row?.user_version ?? 0);
    },

    addProject({ name, projectPath, kind = 'git', baseBranch = null }) {
      const id = makeId();
      const createdAt = nowMs();
      q.insertProject.run(id, name, projectPath, kind, baseBranch, createdAt);
      return this.getProject(id);
    },
    listProjects() { return allRows(q.allProjects); },
    getProject(id) { return getRow(q.getProject, id) ?? null; },
    findProjectByPath(projectPath) { return getRow(q.getProjectByPath, projectPath) ?? null; },

    createTask({ projectId, title, prompt, agent, permissionMode = 'acceptEdits', dependsOn = [], priority = 0 }) {
      const id = makeId();
      const ts = nowMs();
      const deps = JSON.stringify([...new Set((dependsOn ?? []).filter((v) => typeof v === 'string' && v))]);
      const prio = Number.isFinite(Number(priority)) ? Math.trunc(Number(priority)) : 0;
      q.insertTask.run(id, projectId, title, prompt, agent, 'ready', null, null, null, permissionMode, deps, prio, ts, ts);
      return this.getTask(id);
    },
    getTask(id) { return getRow(q.getTask, id) ?? null; },
    listTasks(projectId) { return projectId ? allRows(q.tasksByProject, projectId) : allRows(q.allTasks); },
    updateTask(id, patch) {
      const keys = Object.keys(patch).filter((k) => TASK_FIELDS.has(k));
      if (!keys.length) return this.getTask(id);
      const sets = keys.map((k) => k + ' = ?');
      const values = keys.map((k) => patch[k]);
      db.prepare('UPDATE tasks SET ' + sets.join(', ') + ', updated_at = ? WHERE id = ?').run(...values, nowMs(), id);
      return this.getTask(id);
    },

    createRun({ taskId, sessionId = null, pid = null, status = 'starting' }) {
      const id = makeId();
      const startedAt = nowMs();
      q.insertRun.run(id, taskId, sessionId, pid, status, startedAt, null, null, null);
      return this.getRun(id);
    },
    getRun(id) { return getRow(q.getRun, id) ?? null; },
    listRuns(taskId) { return allRows(q.runsByTask, taskId); },
    updateRun(id, patch) {
      const keys = Object.keys(patch).filter((k) => RUN_FIELDS.has(k));
      if (!keys.length) return this.getRun(id);
      const sets = keys.map((k) => k + ' = ?');
      const values = keys.map((k) => patch[k]);
      db.prepare('UPDATE runs SET ' + sets.join(', ') + ' WHERE id = ?').run(...values, id);
      return this.getRun(id);
    },

    appendEvent({ taskId, runId = null, type, payload = {}, ts = nowMs() }) {
      const info = q.insertEvent.run(taskId, runId, type, ts, JSON.stringify(payload));
      return {
        id: Number(info.lastInsertRowid),
        taskId,
        runId,
        type,
        ts,
        payload,
      };
    },
    /** Bulk insert in one transaction — seeding and imports otherwise pay one
     *  WAL sync per event (~25 ms locally). */
    appendEvents(rows) {
      const written = [];
      db.exec('BEGIN');
      try {
        for (const row of rows) written.push(this.appendEvent(row));
        db.exec('COMMIT');
        return written;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    listEvents(taskId, { after = 0, before = 0, limit = 500 } = {}) {
      const capped = Math.max(1, Math.min(5000, limit));
      const rows = before > 0
        ? allRows(q.eventsBefore, taskId, before, capped).reverse()
        : allRows(q.eventsByTask, taskId, after, capped);
      return rows.map((r) => ({
        id: r.id,
        taskId: r.task_id,
        runId: r.run_id,
        type: r.type,
        ts: r.ts,
        payload: JSON.parse(r.payload_json),
      }));
    },
    maxEventId(taskId) { return Number(getRow(q.maxEvent, taskId)?.id ?? 0); },

    createDecision({ taskId, runId = null, question, options = [], allowFreeform = true, expiresAt = null }) {
      const id = makeId();
      q.insertDecision.run(id, taskId, runId, question, JSON.stringify(options), allowFreeform ? 1 : 0, nowMs(), expiresAt);
      return this.getDecision(id);
    },
    getDecision(id) { return getRow(q.getDecision, id) ?? null; },
    listDecisions(taskId) { return allRows(q.decisionsByTask, taskId); },
    listPendingDecisions() { return allRows(q.pendingDecisions); },
    updateDecision(id, patch) {
      const keys = Object.keys(patch).filter((k) => DECISION_FIELDS.has(k));
      if (!keys.length) return this.getDecision(id);
      const sets = keys.map((k) => k + ' = ?');
      const values = keys.map((k) => patch[k]);
      db.prepare('UPDATE decisions SET ' + sets.join(', ') + ' WHERE id = ?').run(...values, id);
      return this.getDecision(id);
    },

    getSetting(key, fallback = null) {
      const row = getRow(q.getSetting, key);
      if (!row) return fallback;
      try { return JSON.parse(row.value_json); } catch { return fallback; }
    },
    setSetting(key, value) {
      db.prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
        .run(key, JSON.stringify(value));
      return value;
    },
    listSettings() {
      const out = {};
      for (const row of allRows(q.allSettings)) {
        try { out[row.key] = JSON.parse(row.value_json); } catch { /* skip corrupt row */ }
      }
      return out;
    },

    createArtifact({ taskId, runId = null, name, kind = 'file', mime = 'application/octet-stream', bytes = 0, storedPath, source = 'auto' }) {
      const id = makeId();
      q.insertArtifact.run(id, taskId, runId, name, kind, mime, bytes, storedPath, source, nowMs());
      return this.getArtifact(id);
    },
    getArtifact(id) { return getRow(q.getArtifact, id) ?? null; },
    listArtifacts(taskId) { return allRows(q.artifactsByTask, taskId); },
    updateArtifact(id, patch) {
      const keys = Object.keys(patch).filter((k) => ARTIFACT_FIELDS.has(k));
      if (!keys.length) return this.getArtifact(id);
      const sets = keys.map((k) => k + ' = ?');
      db.prepare('UPDATE artifacts SET ' + sets.join(', ') + ' WHERE id = ?').run(...keys.map((k) => patch[k]), id);
      return this.getArtifact(id);
    },
    deleteArtifact(id) { q.deleteArtifact.run(id); },

    insertManagerMessage({ role, content, proposalId = null, meta = {} }) {
      const id = makeId();
      q.insertManagerMessage.run(id, role, content, proposalId, JSON.stringify(meta ?? {}), nowMs());
      return this.listManagerMessages({ limit: 500 }).find((m) => m.id === id) ?? null;
    },
    listManagerMessages({ limit = 100 } = {}) {
      return allRows(q.managerMessages, Math.max(1, Math.min(500, limit))).reverse();
    },
    clearManagerMessages() { q.clearManagerMessages.run(); },

    createProposal({ projectId = null, title, summary = '', items = [] }) {
      const id = makeId();
      const ts = nowMs();
      q.insertProposal.run(id, projectId, title, summary, 'pending', JSON.stringify(items), ts, ts);
      return this.getProposal(id);
    },
    getProposal(id) { return getRow(q.getProposal, id) ?? null; },
    listProposals({ status = null, limit = 50 } = {}) {
      const cap = Math.max(1, Math.min(200, limit));
      return status ? allRows(q.proposalsByStatus, status, cap) : allRows(q.allProposals, cap);
    },
    updateProposal(id, patch) {
      const keys = Object.keys(patch).filter((k) => PROPOSAL_FIELDS.has(k));
      if (!keys.length) return this.getProposal(id);
      const sets = keys.map((k) => k + ' = ?');
      db.prepare('UPDATE proposals SET ' + sets.join(', ') + ', updated_at = ? WHERE id = ?')
        .run(...keys.map((k) => patch[k]), nowMs(), id);
      return this.getProposal(id);
    },

    upsertReport({ date, projectId = '', title, body, stats = {}, source = 'local' }) {
      const existing = getRow(q.reportByDate, date, projectId);
      const id = existing?.id ?? makeId();
      const ts = nowMs();
      q.upsertReport.run(id, date, projectId, title, body, JSON.stringify(stats ?? {}), source, existing?.created_at ?? ts, ts);
      return this.getReport(id);
    },
    getReport(id) { return getRow(q.getReport, id) ?? null; },
    listReports({ projectId = null, limit = 30 } = {}) {
      const cap = Math.max(1, Math.min(100, limit));
      return projectId ? allRows(q.reportsByProject, projectId, cap) : allRows(q.allReports, cap);
    },
    /** A bridge restart kills every child it supervised; mark those runs/tasks so the
     *  UI never shows a phantom "running" row that has no process behind it. Queued
     *  tasks keep their status so the startup drain can honor concurrency limits and
     *  dependencies instead of dumping them all into "ready". Returns what it changed
     *  so the service can surface an honest startup summary. */
    recoverInterrupted() {
      const ts = nowMs();
      const interruptedRuns = db
        .prepare("SELECT id, task_id, status FROM runs WHERE status IN ('starting', 'running', 'paused')")
        .all()
        .map((row) => ({ runId: row.id, taskId: row.task_id, status: row.status }));
      const runs = db
        .prepare("UPDATE runs SET status = 'failed', error = 'bridge-restarted', ended_at = ? WHERE status IN ('starting', 'running', 'paused')")
        .run(ts);
      const tasks = db
        .prepare("UPDATE tasks SET status = 'stopped', updated_at = ? WHERE status IN ('running', 'paused')")
        .run(ts);
      const queued = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status = 'queued'").get();
      return {
        at: ts,
        interruptedRuns,
        runsFailed: Number(runs.changes ?? 0),
        tasksStopped: Number(tasks.changes ?? 0),
        queued: Number(queued?.n ?? 0),
      };
    },
  };
}