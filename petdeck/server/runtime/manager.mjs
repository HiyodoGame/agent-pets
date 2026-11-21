// Manager client: an OpenAI-compatible chat-completions adapter plus the prompts
// that turn project/task facts into proposals and daily reports. The manager has
// no dispatch/merge/stop tools by construction: it can only propose work, and a
// proposal reaches the runtime only after the user confirms it in the UI.

export const MANAGER_PROVIDERS = {
  openai: { id: 'openai', label: 'OpenAI 兼容', baseUrl: 'https://api.openai.com/v1', requiresKey: true },
  ollama: { id: 'ollama', label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', requiresKey: false },
  lmstudio: { id: 'lmstudio', label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', requiresKey: false },
  custom: { id: 'custom', label: '自定义端点', baseUrl: '', requiresKey: false },
};

export const MANAGER_DEFAULTS = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  temperature: 0.3,
  timeoutMs: 60_000,
};

export class ManagerClientError extends Error {
  constructor(code, message, status = 502, details = null) {
    super(message);
    this.name = 'ManagerClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function text(value, max = 200_000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function providerPreset(provider) {
  return MANAGER_PROVIDERS[provider] ?? MANAGER_PROVIDERS.custom;
}

/** Normalize persisted settings + environment into one effective config. */
export function resolveManagerConfig(stored = {}, env = process.env) {
  const provider = MANAGER_PROVIDERS[stored.provider] ? stored.provider : MANAGER_DEFAULTS.provider;
  const preset = providerPreset(provider);
  const baseUrl = text(stored.baseUrl, 500) || preset.baseUrl || MANAGER_DEFAULTS.baseUrl;
  const model = text(stored.model, 200);
  const storedKey = text(stored.apiKey, 4000);
  const envKey = text(env.PETDECK_MANAGER_API_KEY, 4000) || text(env.OPENAI_API_KEY, 4000);
  const apiKey = storedKey || (provider === 'openai' || provider === 'custom' ? envKey : '');
  const temperature = Number.isFinite(Number(stored.temperature))
    ? Math.max(0, Math.min(2, Number(stored.temperature)))
    : MANAGER_DEFAULTS.temperature;
  const timeoutMs = Number.isFinite(Number(stored.timeoutMs))
    ? Math.max(5_000, Math.min(600_000, Math.trunc(Number(stored.timeoutMs))))
    : MANAGER_DEFAULTS.timeoutMs;
  return {
    provider,
    baseUrl,
    model,
    apiKey,
    apiKeySource: storedKey ? 'settings' : apiKey ? 'environment' : 'none',
    temperature,
    timeoutMs,
    ready: Boolean(baseUrl && model && (apiKey || !preset.requiresKey)),
  };
}

/** Public settings never contain the key itself, only whether one is available. */
export function publicManagerConfig(config) {
  return {
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    timeoutMs: config.timeoutMs,
    apiKeySet: Boolean(config.apiKey),
    apiKeySource: config.apiKeySource,
    ready: config.ready,
    providers: Object.values(MANAGER_PROVIDERS),
  };
}

export function normalizeManagerPatch(patch = {}, current = {}) {
  const next = { ...current };
  if (patch.provider != null) {
    if (!MANAGER_PROVIDERS[patch.provider]) throw new ManagerClientError('INVALID_INPUT', 'unknown manager provider', 400);
    next.provider = patch.provider;
    if (patch.baseUrl == null) next.baseUrl = providerPreset(patch.provider).baseUrl;
  }
  if (patch.baseUrl != null) {
    const value = text(patch.baseUrl, 500);
    if (value && !/^https?:\/\//i.test(value)) throw new ManagerClientError('INVALID_INPUT', 'baseUrl must start with http:// or https://', 400);
    next.baseUrl = value;
  }
  if (patch.model != null) next.model = text(patch.model, 200);
  if (patch.apiKey != null) next.apiKey = text(patch.apiKey, 4000);
  if (patch.clearApiKey === true) next.apiKey = '';
  if (patch.temperature != null) {
    const value = Number(patch.temperature);
    if (!Number.isFinite(value) || value < 0 || value > 2) throw new ManagerClientError('INVALID_INPUT', 'temperature must be between 0 and 2', 400);
    next.temperature = value;
  }
  if (patch.timeoutMs != null) {
    const value = Number(patch.timeoutMs);
    if (!Number.isFinite(value) || value < 5_000 || value > 600_000) throw new ManagerClientError('INVALID_INPUT', 'timeoutMs must be between 5000 and 600000', 400);
    next.timeoutMs = Math.trunc(value);
  }
  return next;
}

function chatEndpoint(baseUrl) {
  const trimmed = String(baseUrl || '').replace(/\/+$/, '');
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : trimmed + '/chat/completions';
}

/** OpenAI-compatible client. Injected fetch keeps the unit tests hermetic. */
export function createManagerClient({ getConfig, fetchImpl = globalThis.fetch } = {}) {
  async function chat({ messages, tools = null, toolChoice = 'auto', temperature = null, maxTokens = 1600 } = {}) {
    const config = getConfig();
    if (!config.ready) throw new ManagerClientError('MANAGER_NOT_CONFIGURED', 'manager model is not configured', 409);
    if (!config.apiKey && providerPreset(config.provider).requiresKey) {
      throw new ManagerClientError('MANAGER_KEY_MISSING', 'manager API key is not configured', 409);
    }
    const body = {
      model: config.model,
      messages,
      stream: false,
      temperature: temperature == null ? config.temperature : Math.max(0, Math.min(2, Number(temperature))),
    };
    if (maxTokens) body.max_tokens = Math.max(16, Math.min(8000, Math.trunc(maxTokens)));
    if (tools?.length) { body.tools = tools; body.tool_choice = toolChoice ?? 'auto'; }
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = 'Bearer ' + config.apiKey;
    let response;
    try {
      response = await fetchImpl(chatEndpoint(config.baseUrl), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      const aborted = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new ManagerClientError(aborted ? 'MANAGER_TIMEOUT' : 'MANAGER_UNREACHABLE',
        aborted ? 'manager request timed out' : 'cannot reach the manager endpoint: ' + (error?.message ?? String(error)), 504);
    }
    let payload = null;
    const raw = await response.text().catch(() => '');
    try { payload = raw ? JSON.parse(raw) : null; } catch { /* handled below */ }
    if (!response.ok) {
      const detail = text(payload?.error?.message || payload?.message || raw, 500);
      throw new ManagerClientError('MANAGER_HTTP_ERROR', 'manager endpoint returned HTTP ' + response.status + (detail ? ': ' + detail : ''), 502, { status: response.status });
    }
    if (!payload) throw new ManagerClientError('MANAGER_BAD_RESPONSE', 'manager endpoint returned an unreadable response', 502);
    const message = payload?.choices?.[0]?.message ?? {};
    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    return {
      content: typeof message.content === 'string' ? message.content : '',
      toolCalls: toolCalls.map((call) => ({
        id: call?.id ?? null,
        name: call?.function?.name ?? null,
        arguments: call?.function?.arguments ?? '',
      })).filter((call) => call.name),
      model: payload?.model ?? config.model,
      usage: payload?.usage ?? null,
    };
  }

  return { chat };
}

export const PROPOSE_TASKS_TOOL = {
  type: 'function',
  function: {
    name: 'propose_tasks',
    description: '把用户的一句话需求拆成 1-8 个可独立验收、可并行或按依赖顺序执行的开发任务。只生成提案，提交给用户确认，不会派发。',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '这次拆解的一句话说明' },
        project_id: { type: 'string', description: '目标项目的 id；上下文里只有一个项目时可省略' },
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: '本提案内的短标识，如 t1、t2' },
              title: { type: 'string', description: '任务标题，简短具体' },
              prompt: { type: 'string', description: '交给 Agent 的完整任务说明，包含背景、范围、不要做什么' },
              acceptance: { type: 'string', description: '用户可照着验收的标准' },
              agent: { type: 'string', enum: ['claude-code', 'kimi-code', 'opencode'], description: '建议使用的 Agent' },
              depends_on: { type: 'array', items: { type: 'string' }, description: '依赖的 ref 列表；没有依赖留空' },
              priority: { type: 'integer', minimum: 0, maximum: 100 },
            },
            required: ['title', 'prompt'],
          },
        },
      },
      required: ['tasks'],
    },
  },
};

export function parseToolArguments(raw) {
  if (raw && typeof raw === 'object') return raw;
  const value = text(raw, 200_000);
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

/** Some models ignore tool calling and print a fenced JSON object instead. */
export function extractLooseProposal(content) {
  const value = text(content, 200_000);
  if (!value) return null;
  const match = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = match?.[1] ?? value;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return parsed && Array.isArray(parsed.tasks) ? parsed : null;
  } catch { return null; }
}

function clip(value, max) { return text(value, max); }

export function buildManagerSystemPrompt({ projects = [], agents = [] } = {}) {
  const projectLines = projects.length
    ? projects.map((p) => '- ' + p.name + ' (' + p.id + ', ' + p.kind + ')').join('\n')
    : '- 还没有登记项目';
  const agentLines = agents.map((a) => '- ' + a.id + ' (' + (a.name ?? a.id) + ')').join('\n') || '- claude-code';
  return [
    '你是 PetDeck 的项目经理，服务对象是独立开发者。',
    '你的职责只有四件事：把一句话需求拆成任务提案、解释提案、汇总阶段总结、写日报。',
    '硬性边界：你没有派发、合并、停止 Agent 的权限。任何任务提案都必须由用户在界面确认后才会进入运行时；不要声称任务已经开始。',
    '需要拆任务时调用 propose_tasks 工具。每个任务都要有完整 prompt（含背景、范围、明确不要做什么）和可照着验收的标准。任务之间能并行就并行，确实有先后才写 depends_on。',
    '任务粒度：一个任务应能让一个 Agent 在单次运行内完成，并产出可检查的结果。不要凭空发明项目事实；缺信息时直接问用户。',
    '回答用中文，简洁、具体，不要输出大段代码。',
    '',
    '当前项目：',
    projectLines,
    '',
    '可用 Agent：',
    agentLines,
  ].join('\n');
}

export function buildManagerContext({ projects = [], tasks = [], proposals = [], decisions = [], reports = [] } = {}) {
  const taskRows = tasks.slice(0, 50).map((task) => ({
    title: clip(task.title, 120),
    project: task.project_name ?? task.project_id,
    agent: task.agent,
    status: task.status,
    summary: clip(task.summary, 300) || null,
    depends_on: Array.isArray(task.depends_on) ? task.depends_on.length : 0,
  }));
  return JSON.stringify({
    projects: projects.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    tasks: taskRows,
    pending_proposals: proposals.filter((p) => p.status === 'pending').map((p) => ({ id: p.id, title: p.title, items: p.items?.length ?? 0 })),
    pending_decisions: decisions.map((d) => ({ task_id: d.task_id, question: clip(d.question, 200) })),
    recent_reports: reports.slice(0, 3).map((r) => ({ date: r.date, title: r.title })),
  }, null, 2);
}

export function buildReportMessages({ date, projectName, stats, tasks, decisions, proposals }) {
  const facts = {
    date,
    project: projectName || '全部项目',
    stats,
    tasks: tasks.slice(0, 80).map((task) => ({
      title: task.title,
      project: task.project_name ?? null,
      agent: task.agent,
      status: task.status,
      summary: clip(task.summary, 500) || null,
      last_feedback: clip(task.last_feedback, 300) || null,
      artifacts: Array.isArray(task.artifacts) ? task.artifacts.slice(0, 6) : [],
      reject_count: task.reject_count ?? 0,
    })),
    pending_decisions: decisions.map((d) => ({ task: d.task_title ?? d.task_id, question: clip(d.question, 300) })),
    pending_proposals: proposals.filter((p) => p.status === 'pending').map((p) => p.title),
  };
  return [
    {
      role: 'system',
      content: [
        '你是 PetDeck 的项目经理。根据给定事实写一份当天的工作日报，不要编造事实。',
        '输出 Markdown，严格使用这五个二级标题：## 今日产出、## 进行中、## 遇到的问题、## 等你处理、## 明天建议。',
        '每节用短列表；没有内容就写「暂无」。今日产出只写已完成或已合并的任务，并保留任务标题。总长度不超过 700 字。',
      ].join('\n'),
    },
    { role: 'user', content: JSON.stringify(facts, null, 2) },
  ];
}

export function buildLocalReport({ date, projectName = null, stats, tasks = [], decisions = [], proposals = [] }) {
  const done = tasks.filter((t) => t.status === 'completed' || t.status === 'merged');
  const active = tasks.filter((t) => ['running', 'queued', 'ready', 'paused', 'waiting', 'review', 'pending_merge'].includes(t.status));
  const blocked = tasks.filter((t) => t.status === 'failed' || t.status === 'stopped' || t.last_feedback);
  const waiting = [];
  for (const task of tasks) {
    if (task.status === 'review') waiting.push('- 任务「' + task.title + '」等待验收');
    if (task.status === 'pending_merge') waiting.push('- 任务「' + task.title + '」待合并');
  }
  for (const decision of decisions) waiting.push('- 「' + (decision.task_title ?? decision.task_id) + '」在等你决定：' + clip(decision.question, 140));
  for (const proposal of proposals.filter((p) => p.status === 'pending')) waiting.push('- 提案「' + proposal.title + '」待确认');
  const line = (task) => '- **' + task.title + '** · ' + (task.project_name ?? '') + (task.agent ? ' · ' + task.agent : '') + (task.summary ? ' — ' + clip(task.summary, 220) : '');
  const section = (title, rows) => '## ' + title + '\n' + (rows.length ? rows.join('\n') : '暂无') + '\n';
  return [
    '# ' + date + ' 日报',
    projectName ? '项目：' + projectName : '范围：全部项目',
    '',
    section('今日产出', done.map(line)),
    section('进行中', active.map(line)),
    section('遇到的问题', blocked.length ? blocked.map((task) => '- **' + task.title + '** — ' + (task.last_feedback || task.status)) : []),
    section('等你处理', waiting),
    section('明天建议', active.length ? ['- 先处理等待验收与待合并的任务，再启动新任务。'] : ['- 今天没有正在进行的工作，可以从待办里挑一项开始。']),
    '统计：' + Object.entries(stats).map(([k, v]) => k + ' ' + v).join(' · '),
  ].join('\n');
}
