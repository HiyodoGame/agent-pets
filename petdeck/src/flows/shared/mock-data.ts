// =============================================
// Agent Pets (petdeck) — Mock Data
// 让 4 个 flow 在无后端时可交互。
// 故事线：App v2.1 发版管线（Codex 素材 → Qoder 部署 → kimi work 宣传 → 官网）
// ⚠️ 字段完全匹配 types.ts；类型 import 必须用 import type。
// =============================================

import type {
  Agent,
  AgentCatalogEntry,
  Artifact,
  Message,
  PetEvent,
  Project,
  RelayDraft,
  Session,
} from './types'

export const mockAgents: Agent[] = [
  { id: 'a1', name: 'Codex', form: 'cli', capability: 'full', status: 'idle', projectIds: ['p1'] },
  { id: 'a2', name: 'Qoder', form: 'cli', capability: 'full', status: 'running', projectIds: ['p1', 'p3'] },
  { id: 'a3', name: 'kimi work', form: 'web', capability: 'observe-only', status: 'stuck', projectIds: ['p1'] },
  { id: 'a4', name: 'MiniMaxDesign', form: 'web', capability: 'manual', status: 'thinking', projectIds: ['p2'] },
  { id: 'a5', name: 'opencode', form: 'cli', capability: 'observe-only', status: 'idle', projectIds: ['p2'] },
]

export const mockProjects: Project[] = [
  {
    id: 'p1',
    name: 'App 发版管线',
    description: 'v2.1 发版：素材 → 部署 → 宣传 → 网站',
    sessionIds: ['s1', 's2', 's3'],
    updatedAt: '2026-11-13T18:35:00+08:00',
  },
  {
    id: 'p2',
    name: '素材工坊',
    description: '宣传素材与视觉物料生产',
    sessionIds: ['s4'],
    updatedAt: '2026-11-13T18:30:00+08:00',
  },
  {
    id: 'p3',
    name: '官网维护',
    description: 'App 对应官网展示内容更新',
    sessionIds: ['s5'],
    updatedAt: '2026-11-13T17:50:00+08:00',
  },
]

export const mockArtifacts: Artifact[] = [
  { id: 'art1', name: 'v2.1-素材包.zip', kind: 'file', size: '8.4 MB', fromSessionId: 's1' },
  { id: 'art2', name: '商店截图-3张.png', kind: 'image', size: '2.1 MB', fromSessionId: 's1' },
  { id: 'art3', name: '宣传文案-初稿.md', kind: 'text', size: '4 KB', fromSessionId: 's3' },
]

export const mockMessages: Message[] = [
  {
    id: 'm1',
    role: 'user',
    content: '为 App v2.1 生成更新素材包：12 张应用内图片 + 3 张商店截图，风格沿用 v2.0。',
    timestamp: '2026-11-13T18:02:00+08:00',
    artifactIds: [],
  },
  {
    id: 'm2',
    role: 'agent',
    content: '素材包已生成：12 张应用内图片（@2x/@3x）+ 3 张商店截图（6.7 寸）。已打包为 v2.1-素材包.zip，商店截图单独导出。',
    timestamp: '2026-11-13T18:20:00+08:00',
    artifactIds: ['art1', 'art2'],
  },
  {
    id: 'm3',
    role: 'user',
    content: '把 v2.1 素材包上传到服务器，更新 App 资源引用。',
    timestamp: '2026-11-13T18:25:00+08:00',
    artifactIds: [],
  },
  {
    id: 'm4',
    role: 'agent',
    content: '正在上传素材包（62%）…已更新 8/12 张图片的资源引用。',
    timestamp: '2026-11-13T18:35:00+08:00',
    artifactIds: [],
  },
  {
    id: 'm5',
    role: 'user',
    content: '基于 v2.1 新特性写小红书和抖音宣传文案，突出素材焕新。',
    timestamp: '2026-11-13T18:26:00+08:00',
    artifactIds: [],
  },
  {
    id: 'm6',
    role: 'agent',
    content: '初稿已完成。需要你确认：主打「视觉焕新」还是「性能提升」？确认后我出终稿。',
    timestamp: '2026-11-13T18:32:00+08:00',
    artifactIds: ['art3'],
  },
  {
    id: 'm7',
    role: 'user',
    content: '为华为服务号生成 3 张 v2.1 宣传图，尺寸 900x500。',
    timestamp: '2026-11-13T18:28:00+08:00',
    artifactIds: [],
  },
  {
    id: 'm8',
    role: 'user',
    content: '把官网首页的 App 展示内容更新到 v2.1。',
    timestamp: '2026-11-13T17:30:00+08:00',
    artifactIds: [],
  },
  {
    id: 'm9',
    role: 'agent',
    content: '官网首页已更新：新截图、更新日志、下载链接均已替换为 v2.1。',
    timestamp: '2026-11-13T17:50:00+08:00',
    artifactIds: [],
  },
]

export const mockSessions: Session[] = [
  {
    id: 's1',
    projectId: 'p1',
    agentId: 'a1',
    title: '生成 v2.1 应用内素材包',
    status: 'done',
    messages: [
      { id: 'm1', role: 'user', content: '为 App v2.1 生成更新素材包：12 张应用内图片 + 3 张商店截图，风格沿用 v2.0。', timestamp: '2026-11-13T18:02:00+08:00', artifactIds: [] },
      { id: 'm2', role: 'agent', content: '素材包已生成：12 张应用内图片（@2x/@3x）+ 3 张商店截图（6.7 寸）。已打包为 v2.1-素材包.zip，商店截图单独导出。', timestamp: '2026-11-13T18:20:00+08:00', artifactIds: ['art1', 'art2'] },
    ],
    artifactIds: ['art1', 'art2'],
    updatedAt: '2026-11-13T18:20:00+08:00',
  },
  {
    id: 's2',
    projectId: 'p1',
    agentId: 'a2',
    title: '上传素材并部署服务器',
    status: 'active',
    messages: [
      { id: 'm3', role: 'user', content: '把 v2.1 素材包上传到服务器，更新 App 资源引用。', timestamp: '2026-11-13T18:25:00+08:00', artifactIds: [] },
      { id: 'm4', role: 'agent', content: '正在上传素材包（62%）…已更新 8/12 张图片的资源引用。', timestamp: '2026-11-13T18:35:00+08:00', artifactIds: [] },
    ],
    artifactIds: [],
    updatedAt: '2026-11-13T18:35:00+08:00',
  },
  {
    id: 's3',
    projectId: 'p1',
    agentId: 'a3',
    title: '撰写小红书/抖音宣传文案',
    status: 'waiting',
    messages: [
      { id: 'm5', role: 'user', content: '基于 v2.1 新特性写小红书和抖音宣传文案，突出素材焕新。', timestamp: '2026-11-13T18:26:00+08:00', artifactIds: [] },
      { id: 'm6', role: 'agent', content: '初稿已完成。需要你确认：主打「视觉焕新」还是「性能提升」？确认后我出终稿。', timestamp: '2026-11-13T18:32:00+08:00', artifactIds: ['art3'] },
    ],
    artifactIds: ['art3'],
    updatedAt: '2026-11-13T18:32:00+08:00',
  },
  {
    id: 's4',
    projectId: 'p2',
    agentId: 'a4',
    title: '生成华为服务号宣传图',
    status: 'active',
    messages: [
      { id: 'm7', role: 'user', content: '为华为服务号生成 3 张 v2.1 宣传图，尺寸 900x500。', timestamp: '2026-11-13T18:28:00+08:00', artifactIds: [] },
    ],
    artifactIds: [],
    updatedAt: '2026-11-13T18:30:00+08:00',
  },
  {
    id: 's5',
    projectId: 'p3',
    agentId: 'a2',
    title: '更新官网展示内容',
    status: 'done',
    messages: [
      { id: 'm8', role: 'user', content: '把官网首页的 App 展示内容更新到 v2.1。', timestamp: '2026-11-13T17:30:00+08:00', artifactIds: [] },
      { id: 'm9', role: 'agent', content: '官网首页已更新：新截图、更新日志、下载链接均已替换为 v2.1。', timestamp: '2026-11-13T17:50:00+08:00', artifactIds: [] },
    ],
    artifactIds: [],
    updatedAt: '2026-11-13T17:50:00+08:00',
  },
]

export const mockEvents: PetEvent[] = [
  { id: 'e0', type: 'started', projectId: 'p1', sessionId: 's2', agentId: 'a2', agentName: 'Qoder', projectName: 'App 发版管线', sessionTitle: '上传素材并部署服务器', text: 'Qoder 正在上传素材并部署服务器', timestamp: '2026-11-13T18:25:00+08:00', handled: true },
  { id: 'e1', type: 'relay-ready', projectId: 'p1', sessionId: 's1', agentId: 'a1', agentName: 'Codex', projectName: 'App 发版管线', sessionTitle: '生成 v2.1 应用内素材包', text: 'Codex 素材生成完成，可接力给 Qoder 部署', timestamp: '2026-11-13T18:20:00+08:00', handled: false },
  { id: 'e2', type: 'decision', projectId: 'p1', sessionId: 's3', agentId: 'a3', agentName: 'kimi work', projectName: 'App 发版管线', sessionTitle: '撰写小红书/抖音宣传文案', text: 'kimi work 等你拍板：宣传主打方向', timestamp: '2026-11-13T18:32:00+08:00', handled: false },
  { id: 'e3', type: 'done', projectId: 'p3', sessionId: 's5', agentId: 'a2', agentName: 'Qoder', projectName: '官网维护', sessionTitle: '更新官网展示内容', text: '官网内容更新完成', timestamp: '2026-11-13T17:50:00+08:00', handled: true },
]

export const mockRelayDrafts: RelayDraft[] = [
  {
    id: 'rd1',
    sourceSessionId: 's1',
    targetAgentId: 'a2',
    contextSummary: 'App v2.1 素材已由 Codex 生成完毕：12 张应用内图片 + 3 张商店截图，风格沿用 v2.0。产物已打包。',
    instruction: '上传素材包到服务器，更新 App 资源引用，完成后告诉我部署状态。',
    artifactIds: ['art1', 'art2'],
    status: 'draft',
  },
]

export const mockCatalog: AgentCatalogEntry[] = [
  { id: 'c1', name: 'Qoder', form: 'cli', capability: 'full', detectHint: '检测本地 Qoder 安装与 CLI 桥接', supported: true },
  { id: 'c2', name: 'Codex', form: 'cli', capability: 'full', detectHint: '检测 codex CLI 与会话日志', supported: true },
  { id: 'c3', name: 'opencode', form: 'cli', capability: 'observe-only', detectHint: '检测 opencode 进程与日志', supported: true },
  { id: 'c4', name: 'kimi code', form: 'cli', capability: 'observe-only', detectHint: '检测 kimi code CLI', supported: true },
  { id: 'c5', name: 'zcode', form: 'cli', capability: 'observe-only', detectHint: '检测 zcode 本地安装', supported: true },
  { id: 'c6', name: 'kimi work', form: 'web', capability: 'observe-only', detectHint: '浏览器扩展读取会话状态', supported: true },
  { id: 'c7', name: 'MiniMaxDesign', form: 'web', capability: 'manual', detectHint: '手动 check-in + 产物下载', supported: true },
  { id: 'c8', name: '小艺work', form: 'web', capability: 'manual', detectHint: '手动 check-in', supported: true },
  { id: 'c9', name: 'GrokBot', form: 'web', capability: 'manual', detectHint: '尚未支持，可请求适配', supported: false },
]

// ── 查询辅助（值 export，普通 import） ──
export const getAgent = (id: string): Agent | undefined => mockAgents.find((a) => a.id === id)
export const getProject = (id: string): Project | undefined => mockProjects.find((p) => p.id === id)
export const getSession = (id: string): Session | undefined => mockSessions.find((s) => s.id === id)
export const getArtifact = (id: string): Artifact | undefined => mockArtifacts.find((a) => a.id === id)
export const sessionsOfProject = (projectId: string): Session[] => mockSessions.filter((s) => s.projectId === projectId)
export const unhandledEvents = (): PetEvent[] => mockEvents.filter((e) => !e.handled)