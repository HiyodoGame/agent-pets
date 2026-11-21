// Typed client for the PetDeck runtime API served by the local bridge
// (server/bridge.mjs -> /api/runtime/*). The runtime is the new source of truth:
// projects, tasks, runs and the durable per-task event stream.
import { bridgeConfigSnapshot } from './bridge-client.ts'

export type TaskStatus = 'ready' | 'queued' | 'running' | 'waiting' | 'paused' | 'review' | 'pending_merge' | 'merged' | 'completed' | 'failed' | 'stopped'
export type ProjectKind = 'git' | 'dir'
export type DecisionStatus = 'pending' | 'answered' | 'expired'

export interface Project {
  id: string
  name: string
  path: string
  kind: ProjectKind
  base_branch?: string | null
  created_at: number
}

export interface Decision {
  id: string
  task_id: string
  run_id: string | null
  question: string
  options: string[]
  allow_freeform: boolean
  status: DecisionStatus
  answer: string | null
  created_at: number
  answered_at: number | null
  expires_at: number | null
  task_title?: string | null
  task_status?: TaskStatus | null
  agent?: string | null
  project_name?: string | null
}

export interface Task {
  id: string
  project_id: string
  title: string
  prompt: string
  agent: string
  status: TaskStatus
  worktree_path: string | null
  branch: string | null
  session_id: string | null
  permission_mode: string
  depends_on: string[]
  priority: number
  created_at: number
  updated_at: number
  project_name?: string | null
  project_kind?: ProjectKind | null
  active?: boolean
  pending_decision?: Decision | null
  summary?: string | null
  last_feedback?: string | null
  reviewed_at?: number | null
  merged_at?: number | null
  reject_count?: number
  merge_token_expires?: number | null
}

export interface Run {
  id: string
  task_id: string
  session_id: string | null
  pid: number | null
  status: string
  started_at: number
  ended_at: number | null
  exit_code: number | null
  error: string | null
  active: boolean
}

export type EventPayload = Record<string, unknown>

export interface RuntimeEvent {
  id: number
  taskId: string
  runId: string | null
  type: string
  ts: number
  payload: EventPayload
}

export type ArtifactKind = 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'file'

export interface Artifact {
  id: string
  task_id: string
  run_id: string | null
  name: string
  kind: ArtifactKind
  mime: string
  bytes: number
  source: 'auto' | 'manual'
  created_at: number
}

export interface MergePreview {
  task_id: string
  base_branch: string
  branch: string
  clean: boolean
  working_tree_clean: boolean
  merge_clean: boolean
  current_branch: string | null
  commits: string[]
  diff_stat: string
  conflicts: string[]
}

export interface TaskDetail {
  task: Task
  project: Project | null
  runs: Run[]
  active_run_id: string | null
  decisions: Decision[]
  artifacts: Artifact[]
}

export interface AcceptResult {
  task: Task
  merge_required: boolean
  merge_token: string | null
  merge_token_expires: number | null
}

export interface AgentCapabilities {
  host: boolean
  stream: boolean
  resume: boolean
  suspend: boolean
  decisions: boolean
  permissionModes: string[]
}

export interface AgentInfo {
  id: string
  name: string
  form: string
  command: string
  capabilities: AgentCapabilities
}

export interface RuntimeSettings {
  maxConcurrent: number
  decisionTimeoutMinutes: number
  decisionSound: boolean
}

export interface ManagerProvider {
  id: string
  label: string
  baseUrl: string
  requiresKey: boolean
}

export type ManagerApiKeySource = 'settings' | 'environment' | 'none'

export interface ManagerSettings {
  provider: string
  baseUrl: string
  model: string
  temperature: number
  timeoutMs: number
  apiKeySet: boolean
  apiKeySource: ManagerApiKeySource
  ready: boolean
  providers: ManagerProvider[]
}

export interface ManagerSettingsPatch {
  provider?: string
  baseUrl?: string
  model?: string
  temperature?: number
  timeoutMs?: number
  apiKey?: string
  clearApiKey?: boolean
}

export interface ManagerTestResult {
  model: string
  reply: string
}

export type ManagerMessageRole = 'user' | 'assistant' | 'system'

export interface ManagerMessage {
  id: string
  role: ManagerMessageRole
  content: string
  proposal_id: string | null
  meta: Record<string, unknown>
  created_at: number
}

export interface ProposalItem {
  ref: string
  title: string
  prompt: string
  acceptance: string
  agent: string
  dependsOn: string[]
  priority: number
}

export type ProposalStatus = 'pending' | 'confirmed' | 'rejected'

export interface Proposal {
  id: string
  project_id: string | null
  project_name: string | null
  title: string
  summary: string
  status: ProposalStatus
  items: ProposalItem[]
  task_ids: string[]
  created_at: number
  updated_at: number
  confirmed_at: number | null
}

export interface ManagerReply {
  message: ManagerMessage
  proposal: Proposal | null
}

export interface ProposalPatch {
  title?: string
  summary?: string
  items?: ProposalItem[]
}

export interface StartedTaskResult {
  taskId: string
  deferred?: boolean
  status?: string
  error?: string
  runId?: string | null
  queued?: boolean
}

export interface ConfirmProposalResult {
  proposal: Proposal
  tasks: Task[]
  started: StartedTaskResult[]
}

export interface DailyReportStats {
  total?: number
  completed?: number
  merged?: number
  review?: number
  pending_merge?: number
  running?: number
  queued?: number
  paused?: number
  waiting?: number
  failed?: number
  stopped?: number
  decisions?: number
  proposals?: number
  manager_error?: string
  [key: string]: number | string | null | undefined
}

export interface DailyReport {
  id: string
  date: string
  project_id: string | null
  project_name: string | null
  title: string
  body: string
  stats: DailyReportStats
  source: 'local' | 'manager'
  created_at: number
  updated_at: number
}

/** Result of starting/resuming a task: it either launches immediately or queues. */
export interface StartResult {
  taskId: string
  runId: string | null
  status: TaskStatus | 'starting'
  queued?: boolean
}

export interface AnswerDecisionInput {
  answer?: string
  optionIndex?: number
}

export interface AnswerDecisionResult {
  decision: Decision
  task: Task
  runId?: string | null
  status?: string
  queued?: boolean
}

export class RuntimeClientError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown> | null
  constructor(message: string, status = 0, code = 'NETWORK', details: Record<string, unknown> | null = null) {
    super(message)
    this.name = 'RuntimeClientError'
    this.status = status
    this.code = code
    this.details = details
  }
}

const TIMEOUT_MS = 8000

function headers(): Record<string, string> {
  const { token } = bridgeConfigSnapshot()
  return token ? { 'X-Petdeck-Token': token } : {}
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<T> {
  const { url } = bridgeConfigSnapshot()
  let response: Response
  try {
    response = await fetch(url + path, {
      ...init,
      headers: { ...headers(), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new RuntimeClientError(error instanceof Error ? error.message : 'network error', 0)
  }
  let body: unknown = null
  try { body = await response.json() } catch { /* non-JSON error page */ }
  const record = (body ?? {}) as { ok?: unknown; error?: unknown; message?: unknown; details?: unknown }
  if (!response.ok || record.ok === false) {
    const code = typeof record.error === 'string' ? record.error : 'HTTP_' + response.status
    const message = typeof record.message === 'string' ? record.message : code
    const details = record.details && typeof record.details === 'object' ? record.details as Record<string, unknown> : null
    throw new RuntimeClientError(message, response.status, code, details)
  }
  return body as T
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
}

export async function listProjects(): Promise<Project[]> {
  const body = await request<{ ok: true; projects: Project[] }>('/api/runtime/projects')
  return body.projects
}

export async function registerProject(projectPath: string, name?: string): Promise<{ project: Project; created: boolean }> {
  return request<{ ok: true; project: Project; created: boolean }>('/api/runtime/projects', jsonInit('POST', { path: projectPath, ...(name ? { name } : {}) }))
}

export async function listTasks(projectId?: string): Promise<Task[]> {
  const query = projectId ? '?projectId=' + encodeURIComponent(projectId) : ''
  const body = await request<{ ok: true; tasks: Task[] }>('/api/runtime/tasks' + query)
  return body.tasks
}

export interface CreateTaskInput {
  projectId: string
  title: string
  prompt: string
  agent?: string
  permissionMode?: string
  dependsOn?: string[]
  priority?: number
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const body = await request<{ ok: true; task: Task }>('/api/runtime/tasks', jsonInit('POST', {
    projectId: input.projectId,
    title: input.title,
    prompt: input.prompt,
    agent: input.agent,
    permissionMode: input.permissionMode,
    dependsOn: input.dependsOn,
    priority: input.priority,
  }))
  return body.task
}

export async function getTaskDetail(taskId: string): Promise<TaskDetail> {
  return request<TaskDetail>('/api/runtime/tasks/' + encodeURIComponent(taskId))
}

export async function listEvents(taskId: string, after = 0, limit = 500): Promise<RuntimeEvent[]> {
  const query = '?after=' + after + '&limit=' + limit
  const body = await request<{ ok: true; events: RuntimeEvent[] }>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/events' + query)
  return body.events
}

export async function startTask(taskId: string): Promise<StartResult> {
  const body = await request<{ ok: true; run: StartResult }>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/start', jsonInit('POST', {}))
  return body.run
}

export async function stopTask(taskId: string): Promise<TaskDetail> {
  return request<TaskDetail>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/stop', jsonInit('POST', {}))
}

export async function resumeTask(taskId: string): Promise<StartResult> {
  const body = await request<{ ok: true; run: StartResult }>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/resume', jsonInit('POST', {}))
  return body.run
}

export async function pauseTask(taskId: string): Promise<TaskDetail> {
  return request<TaskDetail>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/pause', jsonInit('POST', {}))
}

export async function continueTask(taskId: string): Promise<TaskDetail> {
  return request<TaskDetail>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/continue', jsonInit('POST', {}))
}

export async function listDecisions(): Promise<Decision[]> {
  const body = await request<{ ok: true; decisions: Decision[] }>('/api/runtime/decisions')
  return body.decisions
}

export async function answerDecision(decisionId: string, input: AnswerDecisionInput): Promise<AnswerDecisionResult> {
  const body = await request<{ ok: true } & AnswerDecisionResult>('/api/runtime/decisions/' + encodeURIComponent(decisionId) + '/answer', jsonInit('POST', input))
  const { ok: _ok, ...result } = body
  return result
}

export async function listAgents(): Promise<AgentInfo[]> {
  const body = await request<{ ok: true; agents: AgentInfo[] }>('/api/runtime/agents')
  return body.agents
}

export async function getSettings(): Promise<RuntimeSettings> {
  const body = await request<{ ok: true; settings: RuntimeSettings }>('/api/runtime/settings')
  return body.settings
}

export async function updateSettings(patch: Partial<RuntimeSettings>): Promise<RuntimeSettings> {
  const body = await request<{ ok: true; settings: RuntimeSettings }>('/api/runtime/settings', jsonInit('PUT', patch))
  return body.settings
}

export async function acceptTask(taskId: string): Promise<AcceptResult> {
  const body = await request<{ ok: true } & AcceptResult>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/accept', jsonInit('POST', {}))
  const { ok: _ok, ...result } = body
  return result
}

export async function rejectTask(taskId: string, feedback: string, agent?: string): Promise<TaskDetail> {
  return request<TaskDetail>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/reject', jsonInit('POST', { feedback, ...(agent ? { agent } : {}) }))
}

export async function authorizeMerge(taskId: string): Promise<AcceptResult> {
  const body = await request<{ ok: true } & AcceptResult>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/authorize-merge', jsonInit('POST', {}))
  const { ok: _ok, ...result } = body
  return result
}

export async function mergeTask(taskId: string, token: string): Promise<TaskDetail> {
  return request<TaskDetail>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/merge', jsonInit('POST', { token }))
}

export async function abandonMerge(taskId: string): Promise<TaskDetail> {
  return request<TaskDetail>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/abandon-merge', jsonInit('POST', {}))
}

export async function cleanupTask(taskId: string): Promise<TaskDetail> {
  return request<TaskDetail>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/cleanup', jsonInit('POST', {}))
}

export async function getMergePreview(taskId: string): Promise<MergePreview> {
  const body = await request<{ ok: true; preview: MergePreview }>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/merge-preview')
  return body.preview
}

export async function listArtifacts(taskId: string): Promise<Artifact[]> {
  const body = await request<{ ok: true; artifacts: Artifact[] }>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/artifacts')
  return body.artifacts
}

export async function addArtifact(taskId: string, artifactPath: string): Promise<Artifact> {
  const body = await request<{ ok: true; artifact: Artifact }>('/api/runtime/tasks/' + encodeURIComponent(taskId) + '/artifacts', jsonInit('POST', { path: artifactPath }))
  return body.artifact
}

export async function removeArtifact(taskId: string, artifactId: string): Promise<void> {
  await request<{ ok: true }>('/api/runtime/artifacts/' + encodeURIComponent(artifactId), jsonInit('DELETE', { taskId }))
}

/** Raw content URL for <img>/<video>/download links. The loopback token travels
 *  as a query parameter because media elements cannot set request headers. */
export function artifactContentUrl(artifactId: string): string {
  const { url, token } = bridgeConfigSnapshot()
  return url + '/api/runtime/artifacts/' + encodeURIComponent(artifactId) + '/content' + (token ? '?token=' + encodeURIComponent(token) : '')
}

export async function getManagerSettings(): Promise<ManagerSettings> {
  const body = await request<{ ok: true; manager: ManagerSettings }>('/api/runtime/manager/settings')
  return body.manager
}

export async function updateManagerSettings(patch: ManagerSettingsPatch): Promise<ManagerSettings> {
  const body = await request<{ ok: true; manager: ManagerSettings }>('/api/runtime/manager/settings', jsonInit('PUT', patch))
  return body.manager
}

export async function testManager(): Promise<ManagerTestResult> {
  return request<{ ok: true } & ManagerTestResult>('/api/runtime/manager/test', jsonInit('POST', {}), 60_000)
}

export async function listManagerMessages(limit = 100): Promise<ManagerMessage[]> {
  const body = await request<{ ok: true; messages: ManagerMessage[] }>('/api/runtime/manager/messages?limit=' + limit)
  return body.messages
}

export async function sendManagerMessage(input: { content: string; projectId?: string | null }): Promise<ManagerReply> {
  const body = await request<{ ok: true } & ManagerReply>('/api/runtime/manager/messages', jsonInit('POST', {
    content: input.content,
    ...(input.projectId ? { projectId: input.projectId } : {}),
  }), 120_000)
  const { ok: _ok, ...result } = body
  return result
}

export async function listProposals(status = 'pending'): Promise<Proposal[]> {
  const body = await request<{ ok: true; proposals: Proposal[] }>('/api/runtime/proposals?status=' + encodeURIComponent(status))
  return body.proposals
}

export async function updateProposal(proposalId: string, patch: ProposalPatch): Promise<Proposal> {
  const body = await request<{ ok: true; proposal: Proposal }>('/api/runtime/proposals/' + encodeURIComponent(proposalId) + '/update', jsonInit('POST', patch))
  return body.proposal
}

export async function rejectProposal(proposalId: string, reason = ''): Promise<Proposal> {
  const body = await request<{ ok: true; proposal: Proposal }>('/api/runtime/proposals/' + encodeURIComponent(proposalId) + '/reject', jsonInit('POST', { reason }))
  return body.proposal
}

export async function confirmProposal(proposalId: string, start = true): Promise<ConfirmProposalResult> {
  const body = await request<{ ok: true } & ConfirmProposalResult>('/api/runtime/proposals/' + encodeURIComponent(proposalId) + '/confirm', jsonInit('POST', { start }), 120_000)
  const { ok: _ok, ...result } = body
  return result
}

export async function generateDailyReport(input: { date?: string | null; projectId?: string | null } = {}): Promise<DailyReport> {
  const body = await request<{ ok: true; report: DailyReport }>('/api/runtime/reports/generate', jsonInit('POST', {
    date: input.date ?? null,
    projectId: input.projectId ?? null,
  }), 120_000)
  return body.report
}

export async function listReports(input: { projectId?: string | null; limit?: number } = {}): Promise<DailyReport[]> {
  const query = new URLSearchParams()
  if (input.projectId) query.set('projectId', input.projectId)
  if (input.limit) query.set('limit', String(input.limit))
  const suffix = query.size > 0 ? '?' + query.toString() : ''
  const body = await request<{ ok: true; reports: DailyReport[] }>('/api/runtime/reports' + suffix)
  return body.reports
}

export async function getReport(reportId: string): Promise<DailyReport> {
  const body = await request<{ ok: true; report: DailyReport }>('/api/runtime/reports/' + encodeURIComponent(reportId))
  return body.report
}

export interface TaskSubscriptionHooks {
  onEvent?: (event: RuntimeEvent) => void
  onOpen?: () => void
  onError?: () => void
}

/** Subscribe to one task's live events. EventSource cannot carry headers, so the
 *  loopback token travels as a query parameter (bridge readGuard accepts it). */
export function subscribeTask(taskId: string, after: number, hooks: TaskSubscriptionHooks = {}): () => void {
  const { url, token } = bridgeConfigSnapshot()
  const query = '?after=' + after + (token ? '&token=' + encodeURIComponent(token) : '')
  const source = new EventSource(url + '/api/runtime/tasks/' + encodeURIComponent(taskId) + '/stream' + query)
  source.onmessage = (message) => {
    try {
      hooks.onEvent?.(JSON.parse(message.data) as RuntimeEvent)
    } catch { /* ignore malformed frames */ }
  }
  if (hooks.onOpen) source.onopen = hooks.onOpen
  if (hooks.onError) source.onerror = hooks.onError
  return () => source.close()
}
// --- M5 W1: local service observability -------------------------------------

export interface RuntimeCounts {
  total: number
  running: number
  queued: number
  review: number
  pending_merge: number
  needs_decision: number
}

export interface RuntimeAdapterProbe {
  id: string
  name: string
  tier: string
  command: string | null
  /** null = not probed yet (the cheap health path never spawns a process). */
  detected: boolean | null
  version: string | null
}

export interface RuntimeStatusSnapshot {
  ok: true
  version: string
  node: string
  startedAt: string
  port: number | null
  authRequired: boolean
  dataDir: string | null
  logDir: string | null
  dbVersion: number | null
  runtime: {
    startedAt: string
    uptimeSec: number
    dataDir: string
    dbVersion: number
    maxConcurrent: number
    active: number
    counts: RuntimeCounts
  } | null
  adapters: RuntimeAdapterProbe[]
}

export interface DiagnosticsExport {
  path: string
  bytes: number
  files: string[]
}

/** Deep status of the local service. The bridge spawns each Agent CLI with
 *  `--version` and caches the result for 60 s, so this is safe to call on mount. */
export async function getRuntimeStatus(): Promise<RuntimeStatusSnapshot> {
  return request<RuntimeStatusSnapshot>('/api/runtime/status', {}, 15_000)
}

/** Build a redacted diagnostics zip (summary/settings/agents/environment + recent logs).
 *  Returns the absolute path on the machine so the card can offer it for copying. */
export async function exportDiagnostics(): Promise<DiagnosticsExport> {
  const body = await request<{ ok: true; path: string; bytes: number; files: string[] }>(
    '/api/diagnostics/export',
    jsonInit('POST', {}),
    30_000,
  )
  return { path: body.path, bytes: body.bytes, files: body.files }
}
// --- M5 W3: storage usage and retention -------------------------------------

export interface StorageUsage {
  dataDir: string
  logsBytes: number
  runsBytes: number
  artifactsBytes: number
  dbBytes: number
  totalBytes: number
  runCount: number
  oldestRunMs: number | null
  runKeepDays: number
}

export interface StorageCleanupResult {
  days: number
  removed: number
  bytes: number
  kept: number
}

/** Disk usage of the three runtime folders plus the SQLite database. */
export async function getStorageUsage(): Promise<StorageUsage> {
  const body = await request<{ ok: true; storage: StorageUsage }>('/api/storage', {}, 15_000)
  return body.storage
}

/** Delete run transcripts whose last write is older than the given days (default 30). */
export async function cleanupRunTranscripts(days = 30): Promise<StorageCleanupResult> {
  const body = await request<{ ok: true; days: number; removed: number; bytes: number; kept: number }>(
    '/api/storage/cleanup',
    jsonInit('POST', { days }),
    30_000,
  )
  return { days: body.days, removed: body.removed, bytes: body.bytes, kept: body.kept }
}
