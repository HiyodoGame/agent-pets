// =============================================
// FLOW: Project & Session Panel (4 screens + edge states)
// Edge 补全：loading-initial / 999+ / empty-filter / truncate / error-not-found / permission-read-only / error-network / loading-submit
// =============================================
import { useEffect, useMemo, useState, Suspense } from 'react'
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
  ChatInput,
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
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
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
import { MoreHorizontal, FolderOpen, MessageSquare, Archive, Trash2, Pencil, ArrowLeft, ArrowRightLeft, Copy, RefreshCw } from 'lucide-react'
import type { Session, SessionStatus } from '../shared/types'
import { usePetData, mergeSessions, type SessionOverlay } from '../../adapters'
import { track, EVENT } from '../../telemetry'
import { EdgeAlert } from '../shared/edge-kit'
import { LazyResponse } from '../shared/lazy-response'
import { fmtCount, fmtAgo, planFollowUp, shouldStreamResponse } from '../shared/ui-logic'

const STATUS_TAG: Record<SessionStatus, { label: string; color: 'info' | 'warning' | 'success' | 'error' | 'slate' }> = {
  active: { label: '运行中', color: 'info' },
  waiting: { label: '等拍板', color: 'warning' },
  done: { label: '已完成', color: 'success' },
  stuck: { label: '卡住', color: 'error' },
  archived: { label: '已归档', color: 'slate' },
}
const STATUS_DOT: Record<SessionStatus, string> = {
  active: 'var(--color-info)',
  waiting: 'var(--color-warning)',
  done: 'var(--color-success)',
  stuck: 'var(--color-error)',
  archived: 'var(--color-text-secondary)',
}

/* SCREEN 1 of 4: Project Home（+ loading-initial + 999+ + empty） */
function Screen1_ProjectHome({ onOpen, onConnect }: { onOpen: (pid: string) => void; onConnect: () => void }) {
  const { projects: mockProjects, sessionsOfProject } = usePetData()
  const [emptyDemo, setEmptyDemo] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500)
    return () => clearTimeout(t)
  }, [])
  const projects = emptyDemo ? [] : mockProjects

  if (loading) {
    return (
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    )
  }
  if (projects.length === 0) {
    return (
      <div className="p-6">
        <h1 className="mb-4 text-text text-lg font-semibold">项目概览</h1>
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen className="h-6 w-6" />
            </EmptyMedia>
            <EmptyTitle>还没有项目</EmptyTitle>
            <EmptyDescription>连接 Agent 并创建第一个项目，宠物开始替你盯进度</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="primary" onClick={onConnect}>
              连接 Agent
            </Button>
            <Button variant="ghost" onClick={() => setEmptyDemo(false)}>
              恢复示例
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }
  return (
    <>
      <h1 className="px-6 pt-4 text-text text-lg font-semibold">项目概览</h1>
      <div className="flex justify-end p-2">
        <Button variant="ghost" onClick={() => setEmptyDemo(true)}>
          模拟无项目
        </Button>
      </div>
      <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-3 p-6 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => {
          const ss = sessionsOfProject(p.id)
          const running = ss.filter((s) => s.status === 'active').length
          const waiting = ss.filter((s) => s.status === 'waiting' || s.status === 'stuck').length
          return (
            <button key={p.id} type="button" className="text-left" onClick={() => onOpen(p.id)}>
              <Card className="transition-colors hover:bg-bg-elevated">
                <CardHeader>
                  <CardTitle>
                    <FolderOpen className="mr-1 inline h-4 w-4" />
                    {p.name}
                  </CardTitle>
                  <CardDescription>{p.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 tabular-nums">
                    <Tag color="info">{fmtCount(running)} 运行</Tag>
                    {waiting > 0 && <Tag color="warning">{fmtCount(waiting)} 待处理</Tag>}
                    <Tag color="slate">{fmtCount(ss.length)} 会话</Tag>
                  </div>
                </CardContent>
              </Card>
            </button>
          )
        })}
      </div>
    </>
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
  onFollowUp: (s: Session, text: string) => void
  onClearSession: () => void
}) {
  const [draft, setDraft] = useState('')
  const [loadedId, setLoadedId] = useState<string | null | undefined>(undefined)
  const [loadError, setLoadError] = useState(false)
  const [sending, setSending] = useState(false)
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
  const { getAgent, getArtifact } = usePetData()

  if (notFound) {
    return (
      <div className="p-6">
        <EdgeAlert
          variant="warning"
          title="会话已删除"
          desc="该会话不存在或已被删除，回列表选择其他会话。"
          extra={
            <Button variant="secondary" onClick={onClearSession}>
              回列表
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
          <EmptyTitle>选择一个会话</EmptyTitle>
          <EmptyDescription>从左侧项目树中挑选会话查看线程与状态</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  const agent = getAgent(session.agentId)
  const readOnly = agent?.capability !== 'full'

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
        <EdgeAlert title="加载失败" desc="线程没拉下来，重试不会丢失已填草稿。" onRetry={() => setLoadError(false)} />
      </div>
    )
  }

  const send = (v: string) => {
    setSending(true)
    setTimeout(() => {
      setSending(false)
      onFollowUp(session, v)
      setDraft('')
    }, 500)
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-text-secondary" />
        <h1 className="text-text truncate font-semibold">{session.title}</h1>
        <Tag color={STATUS_TAG[session.status].color}>{STATUS_TAG[session.status].label}</Tag>
        {session.stale && <Tag color="slate">stale · {fmtAgo(session.lastSeen ?? now, now)}</Tag>}
        <TypographyMuted>{agent?.name}</TypographyMuted>
        {readOnly && <Tag color="info">仅观察 · 不可指挥</Tag>}
        <div className="ml-auto">
          <Button variant="secondary" onClick={() => onRelay(session)} disabled={readOnly}>
            <ArrowRightLeft className="mr-1 h-4 w-4" /> 接力
          </Button>
        </div>
      </div>
      <Separator />
      {/* clipboard 降级的真实交接内容：只读但可选中，自动复制失败时可手动复制 */}
      {handoff && handoff.sessionId === session.id && (
        <>
          <EdgeAlert
            variant="warning"
            title="无法直达 Agent · 交接内容已生成"
            desc="下方是真实交接内容，可全选复制后到目标 Agent 粘贴继续。"
            extra={
              <>
                <Button variant="secondary" onClick={onCopyHandoff}>
                  <Copy className="mr-1 h-4 w-4" /> 复制交接内容
                </Button>
                <Button variant="ghost" onClick={onDismissHandoff}>
                  关闭
                </Button>
              </>
            }
          />
          {handoff.text && (
            <Textarea
              readOnly
              value={handoff.text}
              rows={5}
              aria-label="交接内容"
              className="max-h-48 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </>
      )}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-3 pr-3">
          {session.messages.map((m, idx) =>
            m.role === 'user' ? (
              <UserMessage key={m.id}>{m.content}</UserMessage>
            ) : (
              <div key={m.id} className="flex flex-col gap-2 break-words">
                {/* 仅最后一条 assistant 消息在会话活跃时 streaming；历史消息一律 done（光标不再闪） */}
                <Suspense fallback={<span className="text-text-secondary text-sm">回复渲染中…</span>}>
                  <LazyResponse
                    phase={shouldStreamResponse(session.messages, idx, session.status === 'active') ? 'streaming' : 'done'}
                    finalMarkdown={m.content}
                    thinkingIndicator={<span className="text-text-secondary text-sm">思考中…</span>}
                  />
                </Suspense>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    aria-label="复制回复"
                    onClick={() => {
                      navigator.clipboard?.writeText(m.content)
                      toast('已复制回复')
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" aria-label="重试" onClick={() => toast('已请求重试')}>
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
      <ChatInput
        value={draft}
        onChange={setDraft}
        onSend={send}
        placeholder={readOnly ? '仅观察 · 不可追问' : '继续追问…'}
        maxRows={4}
        disabled={readOnly || sending}
        sendButtonStatus={sending ? 'generating' : 'normal'}
      />
      <Button variant="ghost" onClick={() => setLoadError(true)}>
        模拟加载失败
      </Button>
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
  onFollowUp: (s: Session, text: string) => void
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const { projects: mockProjects } = usePetData()
  const projects = projectId ? mockProjects.filter((p) => p.id === projectId) : mockProjects
  const current = sessions.find((s) => s.id === sessionId) ?? null
  const notFound = sessionId !== null && !current

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim())
    setRenamingId(null)
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>项目 → 会话</SidebarGroupLabel>
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
                            <TypographyMuted>该项目暂无会话</TypographyMuted>
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
                                      aria-label={STATUS_TAG[s.status].label}
                                    />
                                    <Tooltip content={s.title} side="right">
                                      <span className="truncate">{s.title}</span>
                                    </Tooltip>
                                    {s.stale && <span className="ml-1 shrink-0 text-xs text-text-secondary">stale</span>}
                                  </button>
                                </SidebarMenuSubButton>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <SidebarMenuAction showOnHover aria-label="会话操作">
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
                                    <Pencil className="mr-2 h-4 w-4" /> 重命名
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => onArchive(s.id)}>
                                    <Archive className="mr-2 h-4 w-4" /> 归档
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setDeleteTarget(s.id)}>
                                    <Trash2 className="mr-2 h-4 w-4" /> 删除
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
          <Button variant="ghost" onClick={onBack} aria-label="返回项目概览">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-text text-sm font-semibold">项目 / 会话面板</h1>
        </div>
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
      </SidebarInset>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除会话？</AlertDialogTitle>
            <AlertDialogDescription>该会话线程与产物引用将被移除，可在 Toast 中撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              style={{ backgroundColor: 'var(--color-error)', color: 'var(--color-text-on-primary)' }}
              onClick={() => {
                if (deleteTarget) onDelete(deleteTarget)
                setDeleteTarget(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SidebarProvider>
  )
}

export function Flow3_Panel({ onRelay, onConnect, focusTarget }: { onRelay?: (s: Session) => void; onConnect: () => void; focusTarget?: { projectId?: string; sessionId?: string } | null }) {
  const { sessions: baseSessions, sessionsOfProject, inject, mode } = usePetData()
  const [view, setView] = useState<'home' | 'panel'>(focusTarget ? 'panel' : 'home')
  const [projectId, setProjectId] = useState<string | null>(focusTarget?.projectId ?? null)
  const [sessionId, setSessionId] = useState<string | null>(focusTarget?.sessionId ?? null)
  const [overlays, setOverlays] = useState<Record<string, SessionOverlay>>({})
  const [deleted, setDeleted] = useState<string[]>([])
  // clipboard 降级的真实交接内容：展示为可选中的只读文本块，供自动复制失败时手动复制。
  const [handoff, setHandoff] = useState<{ sessionId: string; text: string } | null>(null)
  // live base（随 SSE 实时刷新）+ 本地编辑 overlay（rename/archive/delete/followUp）
  const sessions = useMemo(() => mergeSessions(baseSessions, overlays, deleted), [baseSessions, overlays, deleted])
  const rename = (id: string, title: string) => setOverlays((o) => ({ ...o, [id]: { ...o[id], title } }))
  const archive = (id: string) => {
    setOverlays((o) => ({ ...o, [id]: { ...o[id], status: 'archived' } }))
    toast('已归档会话', { action: { label: '撤销', onClick: () => setOverlays((o) => { const cur = { ...o[id] }; delete cur.status; return { ...o, [id]: cur } }) } })
  }
  const remove = (id: string) => {
    setDeleted((d) => [...d, id])
    if (sessionId === id) setSessionId(null)
    toast('已删除会话', { action: { label: '撤销', onClick: () => setDeleted((d) => d.filter((x) => x !== id)) } })
  }
  // 追问走真实 inject：mode=inject 才声称已发送并本地追加；live 降级 clipboard 不追加
  // （消息未送达，不得显得已发出），只展示可复制交接内容；演示模式本地追加用户消息 +
  // 如实交接复制，toast 绝不谎称已发送。
  const followUp = async (s: Session, text: string) => {
    const context = s.messages.map((m) => `${m.role}: ${m.content}`).join('\n')
    const decision = await inject({ from: 'petdeck', to: s.agentId, context, instruction: text })
    const plan = planFollowUp(decision, { live: mode === 'live' })
    if (plan.appendLocal) {
      const msg = { id: `m-${Date.now()}`, role: 'user' as const, content: text, timestamp: new Date().toISOString(), artifactIds: [] }
      setOverlays((o) => ({ ...o, [s.id]: { ...o[s.id], extraMessages: [...(o[s.id]?.extraMessages ?? []), msg] } }))
    }
    if (plan.outcome === 'sent') {
      setHandoff(null)
      toast(plan.toast)
      return
    }
    setHandoff({ sessionId: s.id, text: plan.copyText ?? '' })
    let copied = false
    if (plan.copyText && navigator.clipboard) {
      try { await navigator.clipboard.writeText(plan.copyText); copied = true } catch { copied = false }
    }
    toast(copied ? plan.toast : '无法直达 Agent 且自动复制失败，请手动复制交接内容后继续')
  }
  // 手动复制出口：展示块上的「复制交接内容」按钮，结果如实 toast。
  const copyHandoff = async () => {
    if (!handoff) return
    let ok = false
    if (navigator.clipboard) {
      try { await navigator.clipboard.writeText(handoff.text); ok = true } catch { ok = false }
    }
    toast(ok ? '已复制交接内容' : '复制失败，请全选下方文本手动复制')
  }

  return (
    <div className="h-screen">
      <Toaster />
      {view === 'home' ? (
        <Screen1_ProjectHome
          onConnect={onConnect}
          onOpen={(pid) => {
            track('panel', EVENT.panelDrilldown, { projectId: pid })
            setProjectId(pid)
            setSessionId(sessionsOfProject(pid)[0]?.id ?? null)
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