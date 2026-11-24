// =============================================
// FLOW: Project & Session Panel (4 screens + edge states)
// Edge 补全：loading-initial / 999+ / empty-filter / truncate / error-not-found / permission-read-only / error-network / loading-submit
// =============================================
import { useEffect, useMemo, useRef, useState, Suspense } from 'react'
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarTrigger,
  SidebarInset,
  UserMessage,
  FileCard,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Input,
  Textarea,
  Toaster,
  toast,
  Tag,
  ScrollArea,
  Card,
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  Separator,
  TypographyMuted,
  Button,
  Skeleton,
  Tooltip,
} from 'sparkdesign'
import { MoreHorizontal, FolderOpen, MessageSquare, Archive, Trash2, Pencil, ArrowLeft, ArrowRightLeft, ArrowUpRight, Copy, RefreshCw, List, LayoutGrid, Clock3, Send } from 'lucide-react'
import type { Session, SessionStatus } from '../shared/types'
import { kanbanColumns } from './kanban'
import { createSerialSender } from './serial-sender.ts'
import { firstProjectSessionId, summarizeProjectSessions } from './project-summary.ts'
import { usePetData, mergeSessions, type SessionOverlay } from '../../adapters'
import { loadPanelViewState, savePanelViewState } from '../../adapters/live-sessions'
import { track, EVENT } from '../../telemetry'
import { EdgeAlert } from '../shared/edge-kit'
import { LazyResponse } from '../shared/lazy-response'
import { fmtCount, fmtAgo, fmtTokens, fmtResetCountdown, planFollowUp, shouldStreamResponse } from '../shared/ui-logic'
import { t } from '../../i18n/index.ts'
import type { MessageKey } from '../../i18n/messages.ts'
import { presentSession, prioritizeSessions } from '../shared/session-presentation.ts'

const STATUS_TAG: Record<SessionStatus, { labelKey: MessageKey; color: 'info' | 'warning' | 'success' | 'error' | 'slate' }> = {
  active: { labelKey: 'status.active', color: 'info' },
  waiting: { labelKey: 'status.waiting', color: 'warning' },
  done: { labelKey: 'status.done', color: 'success' },
  stuck: { labelKey: 'status.stuck', color: 'error' },
  archived: { labelKey: 'status.archived', color: 'slate' },
}
const statusText = (status: SessionStatus) => t(STATUS_TAG[status].labelKey)
const STATUS_DOT: Record<SessionStatus, string> = {
  active: 'var(--color-info)',
  waiting: 'var(--color-warning)',
  done: 'var(--color-success)',
  stuck: 'var(--color-error)',
  archived: 'var(--color-text-secondary)',
}

/* SCREEN 1 of 4: Project Home（+ loading-initial + 999+ + empty） */
function Screen1_ProjectHome({ sessions, onOpen, onConnect }: { sessions: Session[]; onOpen: (pid: string, sessionId?: string) => void; onConnect: () => void }) {
  const { projects: availableProjects, agents, mode } = usePetData()
  const [emptyDemo, setEmptyDemo] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500)
    return () => clearTimeout(t)
  }, [])
  const projects = emptyDemo ? [] : availableProjects
  const prioritySessions = prioritizeSessions(sessions)
    .filter((session) => session.status === 'waiting' || session.status === 'stuck' || session.status === 'active')
    .slice(0, 4)

  if (loading) {
    return (
      <div className="project-page project-index" aria-label={t('common.loading')}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="mb-3 h-24 w-full rounded-lg" />
        ))}
      </div>
    )
  }
  if (projects.length === 0) {
    return (
      <div className="project-page">
        <div className="project-page-header">
          <div className="project-page-heading">
            <h1>{t('panel.overview')}</h1>
            <p>{t('panel.overviewDesc')}</p>
          </div>
        </div>
        <Empty className="project-empty-state">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen className="h-6 w-6" />
            </EmptyMedia>
            <EmptyTitle>{t('panel.noProjects')}</EmptyTitle>
            <EmptyDescription>{t('panel.noProjectsDesc')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="primary" onClick={onConnect}>
              {t('panel.connectAgent')}
            </Button>
            {mode === 'mock' && (
              <Button variant="ghost" onClick={() => setEmptyDemo(false)}>
                {t('panel.restoreDemo')}
              </Button>
            )}
          </EmptyContent>
        </Empty>
      </div>
    )
  }
  const totalRunning = projects.reduce((count, project) => count + summarizeProjectSessions(sessions, project.id).running, 0)
  const totalWaiting = projects.reduce((count, project) => count + summarizeProjectSessions(sessions, project.id).waiting, 0)
  return (
    <div className="project-page">
      <header className="project-page-header">
        <div className="project-page-heading">
          <h1>{t('panel.overview')}</h1>
          <p>{t('panel.overviewDesc')}</p>
        </div>
        <div className="project-page-summary tabular-nums" aria-label={t('panel.overview')}>
          <span><strong>{projects.length}</strong> {t('petSurface.projects')}</span>
          <span><strong>{totalRunning}</strong> {t('status.running')}</span>
          {totalWaiting > 0 && <span><strong>{totalWaiting}</strong> {t('status.stuck')}</span>}
        </div>
      </header>
      {prioritySessions.length > 0 && (
        <section className="session-priority" aria-labelledby="session-priority-title">
          <div className="session-priority-heading">
            <h2 id="session-priority-title">{t('panel.priorityTitle')}</h2>
            <span>{t('panel.priorityDesc')}</span>
          </div>
          <ul>
            {prioritySessions.map((session) => {
              const view = presentSession(session, agents, availableProjects)
              return (
                <li key={session.id}>
                  <button type="button" onClick={() => onOpen(session.projectId, session.id)}>
                    <span className="session-priority-status" data-status={session.status}>{view.statusLabel}</span>
                    <span className="session-priority-main">
                      <strong>{view.title}</strong>
                      <span>{view.agentName} · {view.projectName}{view.host ? ` · @${view.host}` : ''}</span>
                    </span>
                    <ArrowUpRight aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <div className="project-index">
        {projects.map((p, index) => {
          const summary = summarizeProjectSessions(sessions, p.id)
          const running = summary.running
          const waiting = summary.waiting
          return (
            <button key={p.id} type="button" className={`project-row${index === 0 ? ' is-lead' : ''}`} onClick={() => onOpen(p.id)}>
              <span className="project-row-main">
                <span className="project-row-icon"><FolderOpen className="h-4 w-4" aria-hidden="true" /></span>
                <span className="project-row-copy">
                  <strong>{p.name}</strong>
                  <span title={p.description}>{p.description}</span>
                </span>
              </span>
              <span className="project-row-meta tabular-nums">
                <Tag color={running > 0 ? 'info' : 'slate'}>{t('common.running', { n: fmtCount(running) })}</Tag>
                {waiting > 0 && <Tag color="warning">{t('common.pending', { n: fmtCount(waiting) })}</Tag>}
                <Tag color="slate">{t('common.sessions', { n: fmtCount(summary.total) })}</Tag>
              </span>
              <ArrowUpRight className="project-row-arrow h-4 w-4" aria-hidden="true" />
            </button>
          )
        })}
      </div>
      {mode === 'mock' && (
        <Button variant="ghost" className="project-demo-action" onClick={() => setEmptyDemo(true)}>
          {t('panel.simEmpty')}
        </Button>
      )}
    </div>
  )
}

/* SCREEN 3 of 4: Session Thread（+ loading / error / not-found / read-only / loading-submit / 截断） */
function Screen3_SessionThread({
  session,
  notFound,
  handoff,
  onCopyHandoff,
  onDismissHandoff,
  onRelay,
  onFollowUp,
  onClearSession,
}: {
  session: Session | null
  notFound: boolean
  handoff: { sessionId: string; text: string } | null
  onCopyHandoff: () => void
  onDismissHandoff: () => void
  onRelay: (s: Session) => void
  onFollowUp: (s: Session, text: string) => Promise<void>
  onClearSession: () => void
}) {
  const [draft, setDraft] = useState('')
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  const [sending, setSending] = useState(false)
  const senderRef = useRef(createSerialSender())
  // stale 新鲜度基准：挂载取一次 + 每 30s 推进（组件不按会话重挂载，冻结基准会把陈旧数据误报「刚刚」；
  // Date.now 只在 interval 回调里读，render 期调用违反 react/purity）
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  // 加载态派生自 loadedId，避免在 effect 内同步 setState（set-state-in-effect）
  useEffect(() => {
    const t = setTimeout(() => setLoadedId(session?.id ?? null), 400)
    return () => clearTimeout(t)
  }, [session?.id])
  const loading = loadedId !== (session?.id ?? null)
  const { getAgent, getProject, getArtifact, mode } = usePetData()

  if (notFound) {
    return (
      <div className="p-6">
        <EdgeAlert
          variant="warning"
          title={t('panel.sessionDeleted')}
          desc={t('panel.sessionDeletedDesc')}
          extra={
            <Button variant="secondary" onClick={onClearSession}>
              {t('panel.backToList')}
            </Button>
          }
        />
      </div>
    )
  }
  if (!session) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('panel.chooseSession')}</EmptyTitle>
          <EmptyDescription>{t('panel.chooseSessionDesc')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const agent = getAgent(session.agentId)
  const project = getProject(session.projectId)
  // Remote SSH sessions are read-only: never offer relay/inject against the wrong machine.
  const readOnly = agent?.capability !== 'full' || Boolean(session.host)

  if (loading) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }
  if (loadError) {
    return (
      <div className="p-6">
        <EdgeAlert title={t('panel.loadFailed')} desc={t('panel.loadFailedDesc')} onRetry={() => setLoadError(false)} />
      </div>
    )
  }

  const send = async (v: string) => {
    const sender = senderRef.current
    if (sender.isBusy()) return
    setSending(true)
    try {
      const sent = await sender.run(() => onFollowUp(session, v))
      if (sent) setDraft('')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="session-header">
        <MessageSquare className="h-4 w-4 text-text-secondary" />
        <h1 className="text-text truncate font-semibold" title={session.title}>{session.title}</h1>
        <Tag color={STATUS_TAG[session.status].color}>{statusText(session.status)}</Tag>
        {session.stale && <Tag color="slate">{t('panel.staleAgo', { ago: fmtAgo(session.lastSeen ?? now, now) })}</Tag>}
        <TypographyMuted>{agent?.name ?? session.agentId} · {project?.name ?? t('data.unidentifiedProject')}</TypographyMuted>
        {session.host && <Tag color="slate" title={t('panel.remoteHost')}>@{session.host}</Tag>}
        {/* 成本 MVP：观察窗口内的用量徽标（claude/zcode 分项、kimi 累计），无数据不显示 */}
        {fmtTokens(session.tokens) && <Tag color="slate" title={t('panel.tokensTitle')}>{fmtTokens(session.tokens)}</Tag>}
        {/* 5h 用量窗口倒计时（P1-7）：按最后活动推算，均为估算值，以官方 /usage 为准 */}
        {session.usageWindow?.active && (
          <Tag color="slate" title={t('panel.usageWindowTitle')}>
            <Clock3 className="mr-1 inline h-3 w-3" aria-hidden="true" />
            {fmtResetCountdown(session.usageWindow) || t('panel.windowResetSoon')}
          </Tag>
        )}
        {readOnly && <Tag color="info">{t('panel.readOnly')}</Tag>}
        <div className="ml-auto">
          <Button variant="secondary" onClick={() => onRelay(session)} disabled={readOnly}>
            <ArrowRightLeft className="mr-1 h-4 w-4" /> {t('panel.relay')}
          </Button>
        </div>
      </div>
      <Separator />
      {/* clipboard 降级的真实交接内容：只读但可选中，自动复制失败时可手动复制 */}
      {handoff && handoff.sessionId === session.id && (
        <>
          <EdgeAlert
            variant="warning"
            title={t('panel.handoffUnavailable')}
            desc={t('panel.handoffUnavailableDesc')}
            extra={
              <>
                <Button variant="secondary" onClick={onCopyHandoff}>
                  <Copy className="mr-1 h-4 w-4" /> {t('panel.copyHandoff')}
                </Button>
                <Button variant="ghost" onClick={onDismissHandoff}>
                  {t('common.close')}
                </Button>
              </>
            }
          />
          {handoff.text && (
            <Textarea
              readOnly
              value={handoff.text}
              rows={5}
              aria-label={t('panel.handoffAria')}
              className="max-h-48 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </>
      )}
      <ScrollArea className="flex-1">
        <div className="session-thread-content flex flex-col gap-3 pr-3">
          {mode === 'live' && session.messages.length > 0 && (
            <div className="session-latest-label"><MessageSquare className="h-4 w-4" />{t('panel.latestReply')}</div>
          )}
          {session.messages.map((m, idx) =>
            m.role === 'user' ? (
              <UserMessage key={m.id}>{m.content}</UserMessage>
            ) : (
              <div key={m.id} className="flex flex-col gap-2 break-words">
                {/* 仅演示保留 streaming；真实轮询观察一律按完成态渲染 Markdown。 */}
                <Suspense fallback={<span className="text-text-secondary text-sm">{t('panel.renderingReply')}</span>}>
                  <LazyResponse
                    phase={shouldStreamResponse(session.messages, idx, session.status === 'active', mode === 'mock') ? 'streaming' : 'done'}
                    finalMarkdown={m.content}
                    thinkingIndicator={<span className="text-text-secondary text-sm">{t('common.thinking')}</span>}
                  />
                </Suspense>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    aria-label={t('panel.copyReply')}
                    onClick={() => {
                      if (!navigator.clipboard?.writeText) {
                        toast(t('panel.copyReplyFailed'))
                        return
                      }
                      navigator.clipboard.writeText(m.content).then(
                        () => toast(t('panel.copiedReply')),
                        () => toast(t('panel.copyReplyFailed')),
                      )
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" aria-label={t('panel.retry')} onClick={() => toast(t('panel.retryRequested'))}>
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                {m.artifactIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {m.artifactIds.map((aid) => (
                      <FileCard key={aid} filename={getArtifact(aid)?.name ?? aid} size={getArtifact(aid)?.size} variant="attachment" />
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      </ScrollArea>
      <Separator />
      <form
        className="session-composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (!readOnly && !sending && draft.trim()) send(draft.trim())
        }}
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={readOnly ? t('panel.readOnlyPlaceholder') : t('panel.followUpPlaceholder')}
          rows={2}
          disabled={readOnly || sending}
          aria-label={readOnly ? t('panel.readOnlyPlaceholder') : t('panel.followUpPlaceholder')}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault()
              if (!readOnly && !sending && draft.trim()) send(draft.trim())
            }
          }}
        />
        <div className="session-composer-footer">
          <span>{readOnly ? t('panel.readOnly') : t('panel.followUpHint')}</span>
          <Button
            type="submit"
            variant="primary"
            disabled={readOnly || (!draft.trim() && !sending)}
            loading={sending}
            aria-label={t('panel.sendFollowUp')}
          >
            <Send className="mr-1 h-4 w-4" aria-hidden="true" /> {t('panel.sendFollowUp')}
          </Button>
        </div>
      </form>
      {mode === 'mock' && (
        <Button variant="ghost" onClick={() => setLoadError(true)}>
          {t('panel.simLoadFail')}
        </Button>
      )}
    </div>
  )
}

/* SCREEN 2 of 4: Panel Shell（+ empty-filter + truncate + not-found 传递） */
function Screen2_PanelShell({
  sessions,
  projectId,
  sessionId,
  handoff,
  onCopyHandoff,
  onDismissHandoff,
  onSelectSession,
  onBack,
  onRename,
  onArchive,
  onDelete,
  onRelay,
  onFollowUp,
}: {
  sessions: Session[]
  projectId: string | null
  sessionId: string | null
  handoff: { sessionId: string; text: string } | null
  onCopyHandoff: () => void
  onDismissHandoff: () => void
  onSelectSession: (id: string | null) => void
  onBack: () => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  onRelay: (s: Session) => void
  onFollowUp: (s: Session, text: string) => Promise<void>
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  // P2-11 看板：列表（线程）与看板两视图，点卡片直达线程
  const [mode, setMode] = useState<'thread' | 'board'>('thread')
  const { projects: availableProjects, agents } = usePetData()
  const projects = projectId ? availableProjects.filter((p) => p.id === projectId) : availableProjects
  const current = sessions.find((s) => s.id === sessionId) ?? null
  const notFound = sessionId !== null && !current

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim())
    setRenamingId(null)
  }

  return (
    <SidebarProvider className="session-workspace">
      <Sidebar collapsible="icon">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>{t('panel.projectSessions')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <ul className="flex flex-col gap-1">
                {projects.map((p) => {
                  const pSessions = sessions.filter((s) => s.projectId === p.id)
                  return (
                    <li key={p.id}>
                      <SidebarMenuButton asChild tooltip={p.name}>
                        <button type="button" onClick={() => onSelectSession(pSessions[0]?.id ?? null)}>
                          <FolderOpen />
                          <span>{p.name}</span>
                        </button>
                      </SidebarMenuButton>
                      <SidebarMenuSub>
                        {pSessions.length === 0 ? (
                          <SidebarMenuSubItem>
                            <TypographyMuted>{t('panel.noSessions')}</TypographyMuted>
                          </SidebarMenuSubItem>
                        ) : (
                          pSessions.map((s) => (
                            <SidebarMenuSubItem key={s.id}>
                              {renamingId === s.id ? (
                                <Input
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitRename()
                                    if (e.key === 'Escape') setRenamingId(null)
                                  }}
                                  onBlur={commitRename}
                                  autoFocus
                                />
                              ) : (
                                <SidebarMenuSubButton asChild isActive={s.id === sessionId}>
                                  <button type="button" onClick={() => onSelectSession(s.id)}>
                                    <span
                                      className="mr-1 inline-block h-2 w-2 rounded-full"
                                      style={{ backgroundColor: STATUS_DOT[s.status] }}
                                      role="img"
                                      aria-label={statusText(s.status)}
                                    />
                                    <span className="session-sidebar-copy">
                                      <Tooltip content={s.title} side="right">
                                        <span className="session-sidebar-title">{s.title}</span>
                                      </Tooltip>
                                      <span className="session-sidebar-meta">
                                        {presentSession(s, agents, availableProjects).agentName} · {statusText(s.status)}
                                        {s.host ? ` · @${s.host}` : ''}{s.stale ? ' · stale' : ''}
                                      </span>
                                    </span>
                                  </button>
                                </SidebarMenuSubButton>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <SidebarMenuAction showOnHover aria-label={t('panel.sessionActions')}>
                                    <MoreHorizontal />
                                  </SidebarMenuAction>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent side="right" align="start">
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setRenamingId(s.id)
                                      setRenameValue(s.title)
                                    }}
                                  >
                                    <Pencil className="mr-2 h-4 w-4" /> {t('common.rename')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => onArchive(s.id)}>
                                    <Archive className="mr-2 h-4 w-4" /> {t('common.archive')}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setDeleteTarget(s.id)}>
                                    <Trash2 className="mr-2 h-4 w-4" /> {t('common.delete')}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </SidebarMenuSubItem>
                          ))
                        )}
                      </SidebarMenuSub>
                    </li>
                  )
                })}
              </ul>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <div className="flex items-center gap-2 border-b border-border-secondary p-2">
          <SidebarTrigger />
          <Button variant="ghost" onClick={onBack} aria-label={t('panel.backOverview')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-text text-sm font-semibold">{t('panel.title')}</h1>
          {/* 列表 / 看板切换（P2-11）：aria-pressed 标注当前视图 */}
          <div className="ml-auto flex items-center gap-1" role="group" aria-label={t('panel.viewSwitch')}>
            <Button variant="ghost" size="sm" aria-pressed={mode === 'thread'} onClick={() => setMode('thread')} aria-label={t('panel.listView')}>
              <List className="h-4 w-4" /> {t('panel.list')}
            </Button>
            <Button variant="ghost" size="sm" aria-pressed={mode === 'board'} onClick={() => setMode('board')} aria-label={t('panel.boardView')}>
              <LayoutGrid className="h-4 w-4" /> {t('panel.board')}
            </Button>
          </div>
        </div>
        {mode === 'board' ? (
          <div className="flex flex-1 gap-3 overflow-x-auto p-3">
            {kanbanColumns(sessions, projectId).map((col) => (
              <section key={col.status} className="flex min-w-[220px] flex-1 flex-col gap-2" aria-label={statusText(col.status)}>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_DOT[col.status] }} role="img" aria-label={statusText(col.status)} />
                  <h2 className="text-text text-sm font-medium">{statusText(col.status)}</h2>
                  <span className="text-xs text-text-secondary">{col.sessions.length}</span>
                </div>
                {col.sessions.length === 0 ? (
                  <TypographyMuted className="text-xs">{t('panel.noSessionsShort')}</TypographyMuted>
                ) : (
                  col.sessions.map((s) => {
                    const view = presentSession(s, agents, availableProjects)
                    return (
                      <Card key={s.id} className="session-board-card">
                        <button
                          type="button"
                          aria-label={t('panel.openSession', { title: view.title })}
                          onClick={() => {
                            onSelectSession(s.id)
                            setMode('thread')
                          }}
                        >
                          <p className="session-board-title">{view.title}</p>
                          <p className="session-board-meta">
                            {view.agentName}
                            {view.host ? ` · @${view.host}` : ''}
                            {view.stale ? ' · stale' : ''}
                            {fmtTokens(s.tokens) ? ` · ${fmtTokens(s.tokens)}` : ''}
                          </p>
                          {!projectId && <p className="session-board-project">{view.projectName}</p>}
                        </button>
                      </Card>
                    )
                  })
                )}
              </section>
            ))}
          </div>
        ) : (
          <Screen3_SessionThread
            session={current}
            notFound={notFound}
            handoff={handoff}
            onCopyHandoff={onCopyHandoff}
            onDismissHandoff={onDismissHandoff}
            onRelay={onRelay}
            onFollowUp={onFollowUp}
            onClearSession={() => onSelectSession(null)}
          />
        )}
      </SidebarInset>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('panel.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('panel.deleteDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              style={{ backgroundColor: 'var(--color-error)', color: 'var(--color-text-on-primary)' }}
              onClick={() => {
                if (deleteTarget) onDelete(deleteTarget)
                setDeleteTarget(null)
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}

export function Flow3_Panel({ onRelay, onConnect, focusTarget }: { onRelay?: (s: Session) => void; onConnect: () => void; focusTarget?: { projectId?: string; sessionId?: string } | null }) {
  const { sessions: baseSessions, inject, mode } = usePetData()
  const [initialViewState] = useState(() => {
    try { return loadPanelViewState(window.localStorage) }
    catch { return loadPanelViewState(null) }
  })
  const [view, setView] = useState<'home' | 'panel'>(focusTarget ? 'panel' : 'home')
  const [projectId, setProjectId] = useState<string | null>(focusTarget?.projectId ?? null)
  const [sessionId, setSessionId] = useState<string | null>(focusTarget?.sessionId ?? null)
  const [overlays, setOverlays] = useState<Record<string, SessionOverlay>>(initialViewState.overlays)
  const [deleted, setDeleted] = useState<string[]>(initialViewState.deleted)
  useEffect(() => {
    try { savePanelViewState(window.localStorage, { overlays, deleted }) }
    catch { /* localStorage unavailable: retain this mounted view only */ }
  }, [overlays, deleted])
  // clipboard 降级的真实交接内容：展示为可选中的只读文本块，供自动复制失败时手动复制。
  const [handoff, setHandoff] = useState<{ sessionId: string; text: string } | null>(null)
  // live base（随 SSE 实时刷新）+ 本地编辑 overlay（rename/archive/delete/followUp）
  const sessions = useMemo(() => mergeSessions(baseSessions, overlays, deleted), [baseSessions, overlays, deleted])
  const rename = (id: string, title: string) => setOverlays((o) => ({ ...o, [id]: { ...o[id], title } }))
  const archive = (id: string) => {
    setOverlays((o) => ({ ...o, [id]: { ...o[id], status: 'archived' } }))
    toast(t('panel.archivedToast'), { action: { label: t('common.undo'), onClick: () => setOverlays((o) => { const cur = { ...o[id] }; delete cur.status; return { ...o, [id]: cur } }) } })
  }
  const remove = (id: string) => {
    setDeleted((d) => [...d, id])
    if (sessionId === id) setSessionId(null)
    toast(t('panel.deletedToast'), { action: { label: t('common.undo'), onClick: () => setDeleted((d) => d.filter((x) => x !== id)) } })
  }
  // 当前 inject 契约不能 resume 观察中的原 session：live 成功只表示创建了新接力，
  // 绝不向原线程追加消息，也不编造新 session id；clipboard 降级继续提供真实交接内容。
  const followUp = async (s: Session, text: string) => {
    const context = s.messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    const decision = await inject({ from: 'petdeck', to: s.agentId, context, instruction: text })
    const plan = planFollowUp(decision, { live: mode === 'live' })
    if (plan.appendLocal) {
      const msg = { id: `m-${Date.now()}`, role: 'user' as const, content: text, timestamp: new Date().toISOString(), artifactIds: [] }
      setOverlays((o) => ({ ...o, [s.id]: { ...o[s.id], extraMessages: [...(o[s.id]?.extraMessages ?? []), msg] } }))
    }
    if (plan.outcome === 'relay') {
      setHandoff(null)
      toast(plan.toast)
      return
    }
    setHandoff({ sessionId: s.id, text: plan.copyText ?? '' })
    let copied = false
    if (plan.copyText && navigator.clipboard) {
      try { await navigator.clipboard.writeText(plan.copyText); copied = true } catch { copied = false }
    }
    toast(copied ? plan.toast : t('panel.copyHandoffFailed'))
  }
  // 手动复制出口：展示块上的「复制交接内容」按钮，结果如实 toast。
  const copyHandoff = async () => {
    if (!handoff) return
    let ok = false
    if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(handoff.text); ok = true } catch { ok = false }
    }
    toast(ok ? t('panel.copiedHandoff') : t('panel.copyHandoffFailed2'))
  }

  return (
    <div className="h-full min-h-0">
      <Toaster />
      {view === 'home' ? (
        <Screen1_ProjectHome
          sessions={sessions}
          onConnect={onConnect}
          onOpen={(pid, focusedSessionId) => {
            track('panel', EVENT.panelDrilldown, { projectId: pid })
            setProjectId(pid)
            setSessionId(focusedSessionId ?? firstProjectSessionId(sessions, pid))
            setView('panel')
          }}
        />
      ) : (
        <Screen2_PanelShell
          sessions={sessions}
          projectId={projectId}
          sessionId={sessionId}
          handoff={handoff}
          onCopyHandoff={() => { void copyHandoff() }}
          onDismissHandoff={() => setHandoff(null)}
          onSelectSession={setSessionId}
          onBack={() => setView('home')}
          onRename={rename}
          onArchive={archive}
          onDelete={remove}
          onRelay={(s) => onRelay?.(s)}
          onFollowUp={followUp}
        />
      )}
    </div>
  )
}

export default Flow3_Panel