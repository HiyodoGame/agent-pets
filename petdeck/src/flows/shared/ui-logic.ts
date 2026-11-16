// Pure a11y/UX logic (unit-tested): stepper/motion/freshness + connect & follow-up CTA decisions.
// 组件只做渲染；是否声称「已连接/已发送」由这里的纯决策决定。
import type { PetEvent, SessionStatus } from './types'

/** 计数 999+ 封顶（boundary-overflow）。纯函数，独立于组件文件以利 fast-refresh。 */
export const fmtCount = (n: number): string => (n > 999 ? '999+' : String(n))

/** 紧凑数字：<1k 原样；k/M 一位小数截断。 */
export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`
  return String(n)
}

/** 用量徽标（成本 MVP）：分项来源显示 ↑in ↓out，仅累计来源显示总量；无数据返回空串。 */
export function fmtTokens(t?: { input?: number; output?: number; cacheRead?: number; total?: number }): string {
  if (!t) return ''
  if (typeof t.total === 'number' && t.input === undefined && t.output === undefined) {
    return t.total > 0 ? fmtCompact(t.total) : ''
  }
  const i = t.input ?? 0
  const o = t.output ?? 0
  if (i === 0 && o === 0) return ''
  return `↑${fmtCompact(i)} ↓${fmtCompact(o)}`
}

export type StepStatus = 'done' | 'current' | 'todo'

/** i<current done, i===current current, else todo. */
export function stepperState(count: number, current: number): StepStatus[] {
  return Array.from({ length: count }, (_, i) => (i < current ? 'done' : i === current ? 'current' : 'todo'))
}

export type MotionPref = 'auto' | 'on' | 'reduced' | 'off'

/** User preference overrides OS: off=>false, on=>true, auto=>!osReduced. */
export function resolveMotionEnabled(pref: MotionPref, osReduced: boolean): boolean {
  if (pref === 'off') return false
  if (pref === 'on') return true
  return !osReduced
}

const MOTION_KEY = 'petdeck.motion'

export function getMotionPref(): MotionPref {
  try {
    const v = localStorage.getItem(MOTION_KEY)
    return v === 'on' || v === 'off' ? v : 'auto'
  } catch { return 'auto' }
}

export function setMotionPref(pref: MotionPref): void {
  try { localStorage.setItem(MOTION_KEY, pref) } catch { /* ignore */ }
}

/** OS 级减弱动效偏好。SSR / 无 matchMedia 的环境返回 false；与 Spark getReducedMotion 行为一致，
 *  本地实现以免为这一个工具函数把 sparkdesign barrel 拉进 shell 静态依赖。
 *  可注入 matchMedia 以便纯函数测试。 */
export function getOsReducedMotion(matchMediaFn?: (query: string) => { matches: boolean }): boolean {
  const mm = matchMediaFn ?? (typeof window !== 'undefined' ? window.matchMedia?.bind(window) : undefined)
  if (typeof mm !== 'function') return false
  try {
    return mm('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** 新鲜度相对时间（stale 标记用）。ts 在未来时按「刚刚」处理。 */
export function fmtAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

// ---- 接入/追问 CTA 的真实行为决策（纯函数，组件只做渲染） ----

export type LiveConnectResult = 'ok' | 'offline' | 'missing'

/** live 连接决策：bridge 健康且目标在已发现列表中才可成功。 */
export function decideLiveConnect(input: { healthy: boolean; agentIds: string[]; selectedId: string }): LiveConnectResult {
  if (!input.healthy) return 'offline'
  if (!input.agentIds.includes(input.selectedId)) return 'missing'
  return 'ok'
}

export interface FollowUpPlan {
  /** sent=真实 inject 成功；clipboard=未能直达，需复制交接内容。 */
  outcome: 'sent' | 'clipboard'
  toast: string
  /** clipboard 模式下可复制到剪贴板的真实交接内容（InjectDecision.package）。 */
  copyText?: string
  /** 是否把这条用户消息本地追加进线程：真实送达（inject）与演示模式都追加；live 降级 clipboard 不追加（消息并未送达，不得显得已发出）。 */
  appendLocal: boolean
}

/** 追问结果决策：只有 mode=inject 才声称已发送；clipboard 给出真实可复制交接内容。
 *  opts.live 缺省按 true（真实链路）：live 降级不追加本地消息；演示模式（live:false）本地追加、
 *  如实展示交接复制，toast 绝不谎称「已发送」。 */
export function planFollowUp(d: { mode: 'inject' | 'clipboard'; package?: string }, opts?: { live?: boolean }): FollowUpPlan {
  const live = opts?.live ?? true
  if (d.mode === 'inject') return { outcome: 'sent', toast: '已发送追问', appendLocal: true }
  if (!live) {
    return {
      outcome: 'clipboard',
      toast: '演示模式：未真实发送，交接内容已复制到剪贴板',
      copyText: d.package,
      appendLocal: true,
    }
  }
  return { outcome: 'clipboard', toast: '无法直达 Agent，交接内容已复制到剪贴板', copyText: d.package, appendLocal: false }
}

/** 限流倒计时文案：只提示可重试时间，不承诺自动重试。 */
export function fmtRateLimitWait(seconds: number): string {
  return `桥接限流，${seconds} 秒后可重试。`
}

// ---- 会话状态映射：unknown / 未识别状态绝不冒充 active（运行中） ----

const SESSION_STATUS_MAP: Record<string, SessionStatus> = {
  done: 'done', running: 'active', stuck: 'stuck', waiting: 'waiting', unknown: 'waiting',
}

/** 真实观察状态 → 会话展示状态；任何未知值按 waiting 展示，绝不谎报「运行中」。 */
export function mapSessionStatus(raw: string): SessionStatus {
  return SESSION_STATUS_MAP[raw] ?? 'waiting'
}

// ---- 事件水位线：以 (timestamp, 同毫秒 id 集合) 识别新事件，列表恒满 50 条被截断时也成立 ----

export interface EventWatermark {
  ts: number
  /** 水位线时刻同毫秒的事件 id（突发批量）：同毫秒判新/判重不靠 uuid 大小序。 */
  ids: string[]
}

/** 全列表最大 timestamp 处的水位线（不假设列表顺序：演示数据为旧在前）；空列表返回 null（视为「全部皆新」）。 */
export function eventWatermark(events: PetEvent[]): EventWatermark | null {
  if (events.length === 0) return null
  let ts = 0
  for (const e of events) ts = Math.max(ts, Date.parse(e.timestamp) || 0)
  return { ts, ids: events.filter((e) => (Date.parse(e.timestamp) || 0) === ts).map((e) => e.id) }
}

/** 水位线之后到达的事件（保持传入顺序；不假设列表排序）。 */
export function newEventsAfter(events: PetEvent[], watermark: EventWatermark | null): PetEvent[] {
  if (!watermark) return events
  return events.filter((e) => {
    const ts = Date.parse(e.timestamp) || 0
    return ts > watermark.ts || (ts === watermark.ts && !watermark.ids.includes(e.id))
  })
}

// ---- 流式响应归属：仅最后一条 assistant（非 user）消息在会话活跃时可显示 streaming ----

/** 渲染 Response 时是否使用 streaming phase：仅当目标消息是整个线程的最后一条且非 user（assistant 回复）、
 *  且会话仍活跃时才允许 streaming；历史消息一律 done，避免已完成内容继续闪烁光标。 */
export function shouldStreamResponse(messages: { role: string }[], index: number, sessionActive: boolean): boolean {
  if (!sessionActive || index < 0 || index !== messages.length - 1) return false
  return messages[index].role !== 'user'
}

// ---- 表单校验可见性：错误仅在 blur/submit 后出现；aria-invalid / aria-describedby 与可见错误同步 ----

export interface FieldErrorState {
  /** 是否渲染可见错误文本（渲染时同时给错误元素 id，供 describedBy 指向）。 */
  showError: boolean
  /** 与可见错误同步：只有错误真正展示时才置 true。 */
  ariaInvalid: boolean
  /** 仅错误展示时返回错误元素 id；否则 null（不挂 aria-describedby）。 */
  describedBy: string | null
}

/** 交互后校验（validate-input-after-interaction）：未 blur 未 submit 时不展示错误，也不挂 aria-invalid/describedby。 */
export function fieldErrorState(input: { value: string; touched: boolean; submitted: boolean; errorId: string }): FieldErrorState {
  const invalid = input.value.trim().length === 0
  const showError = invalid && (input.touched || input.submitted)
  return { showError, ariaInvalid: showError, describedBy: showError ? input.errorId : null }
}

// ---- DND 到达分流：decision 必须轻拍（绝不入静默队列、绝不因水位线推进而丢失）；其余静默入队 ----

/** 免打扰下新到事件的处置分流。decision 返回需轻拍的代表事件（同批多条时取最早到达者，逐条补提示语义不变）；
 *  调用方拿到 decision 后必须执行轻拍副作用，且不得附加 screen 门槛——用户身处 screen 2/3 时拍板事件同样要打断。 */
export function routeDndArrivals(added: PetEvent[]): { quiet: PetEvent[]; decision: PetEvent | null } {
  let decision: PetEvent | null = null
  const quiet: PetEvent[] = []
  for (const e of added) {
    if (e.type === 'decision') decision ??= e
    else quiet.push(e)
  }
  return { quiet, decision }
}
