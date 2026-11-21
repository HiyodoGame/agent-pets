import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Check, ChevronDown, Loader2, Pencil, Send, Settings2, Sparkles, X } from 'lucide-react'
import {
  confirmProposal,
  getManagerSettings,
  listManagerMessages,
  listProposals,
  rejectProposal,
  sendManagerMessage,
  updateProposal,
  type ManagerMessage,
  type ManagerSettings,
  type Project,
  type Proposal,
  type ProposalItem,
} from '../../adapters/runtime-client.ts'
import { t, useLocale } from '../../i18n/index.ts'
import { formatRelative } from './format.ts'

const AGENT_OPTIONS = ['claude-code', 'kimi-code', 'opencode'] as const

interface ManagerPanelProps {
  projects: Project[]
  onDispatched: () => void
}

/** The manager conversation and its proposals. The manager can plan, but the
 *  only path from a proposal to real tasks is the user's Confirm button here. */
export function ManagerPanel({ projects, onDispatched }: ManagerPanelProps) {
  const navigate = useNavigate()
  const { locale } = useLocale()
  const [manager, setManager] = useState<ManagerSettings | null>(null)
  const [messages, setMessages] = useState<ManagerMessage[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [projectId, setProjectId] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [busyProposal, setBusyProposal] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editing, setEditing] = useState<Proposal | null>(null)
  const [editItems, setEditItems] = useState<ProposalItem[]>([])
  const [editTitle, setEditTitle] = useState('')
  const messagesRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (projects.length === 0) { setProjectId(''); return }
    if (!projects.some((project) => project.id === projectId)) setProjectId(projects[0].id)
  }, [projects, projectId])

  useEffect(() => {
    let disposed = false
    async function load() {
      try {
        const [nextManager, nextMessages, nextProposals] = await Promise.all([
          getManagerSettings(),
          listManagerMessages(),
          listProposals('pending'),
        ])
        if (disposed) return
        setManager(nextManager)
        setMessages(nextMessages)
        setProposals(nextProposals)
        setError(null)
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!disposed) setLoading(false)
      }
    }
    void load()
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    let disposed = false
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      Promise.all([listManagerMessages(), listProposals('pending')])
        .then(([nextMessages, nextProposals]) => {
          if (disposed) return
          setMessages(nextMessages)
          setProposals(nextProposals)
        })
        .catch(() => { /* transient bridge hiccup; the explicit actions surface errors */ })
    }, 6000)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    const element = messagesRef.current
    if (!element) return
    const frame = window.requestAnimationFrame(() => { element.scrollTop = element.scrollHeight })
    return () => window.cancelAnimationFrame(frame)
  }, [messages.length, proposals.length, sending])

  const projectOptions = useMemo(() => projects.map((project) => ({ id: project.id, name: project.name })), [projects])
  const canSend = Boolean(manager?.ready) && Boolean(projectId) && draft.trim().length > 0 && !sending

  async function reloadConversation() {
    const [nextMessages, nextProposals] = await Promise.all([listManagerMessages(), listProposals('pending')])
    setMessages(nextMessages)
    setProposals(nextProposals)
  }

  async function submit() {
    const content = draft.trim()
    if (!content || sending || !manager?.ready) return
    setSending(true)
    setError(null)
    setNotice(null)
    try {
      await sendManagerMessage({ content, projectId: projectId || null })
      setDraft('')
      await reloadConversation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSending(false)
    }
  }

  async function dispatch(proposal: Proposal) {
    if (busyProposal) return
    setBusyProposal(proposal.id)
    setError(null)
    setNotice(null)
    try {
      const result = await confirmProposal(proposal.id, true)
      const started = result.started.filter((item) => !item.deferred && !item.error).length
      const deferred = result.started.filter((item) => item.deferred).length
      setNotice(t('console.manager.dispatchResult', { n: result.tasks.length, m: started }) + (deferred > 0 ? ' ' + t('console.manager.deferred', { n: deferred }) : ''))
      setEditing(null)
      await reloadConversation()
      onDispatched()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyProposal(null)
    }
  }

  async function discard(proposal: Proposal) {
    if (busyProposal) return
    if (!window.confirm(t('console.manager.rejectConfirm'))) return
    setBusyProposal(proposal.id)
    setError(null)
    try {
      await rejectProposal(proposal.id)
      setEditing(null)
      await reloadConversation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyProposal(null)
    }
  }

  function beginEdit(proposal: Proposal) {
    setEditing(proposal)
    setEditTitle(proposal.title)
    setEditItems(proposal.items.map((item) => ({ ...item, dependsOn: [...item.dependsOn] })))
    setError(null)
  }

  function patchEditItem(index: number, patch: Partial<ProposalItem>) {
    setEditItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }

  async function saveEdit() {
    if (!editing || busyProposal) return
    setBusyProposal(editing.id)
    setError(null)
    try {
      await updateProposal(editing.id, { title: editTitle, items: editItems })
      setEditing(null)
      await reloadConversation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusyProposal(null)
    }
  }

  return (
    <aside className="manager-panel panel-card" aria-label={t('console.manager.title')}>
      <header className="manager-head">
        <div className="manager-identity">
          <span className="manager-avatar"><Bot aria-hidden="true" /></span>
          <div>
            <h2>{t('console.manager.title')}</h2>
            <span className="manager-status" data-ready={Boolean(manager?.ready)}>
              <span className="manager-status-dot" />
              {manager?.ready ? t('console.manager.ready') : t('console.manager.notReady')}
            </span>
          </div>
        </div>
        <button type="button" className="icon-button" aria-label={t('console.manager.configure')} title={t('console.manager.configure')} onClick={() => navigate('/settings')}>
          <Settings2 aria-hidden="true" />
        </button>
      </header>

      <label className="manager-project">
        <span>{t('console.manager.project')}</span>
        <span className="manager-project-select">
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} disabled={projects.length === 0}>
            {projectOptions.length === 0 ? <option value="">{t('console.manager.projectAll')}</option> : null}
            {projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
          <ChevronDown aria-hidden="true" />
        </span>
      </label>

      {manager && !manager.ready ? (
        <button type="button" className="manager-configure" onClick={() => navigate('/settings')}>
          <Sparkles aria-hidden="true" />
          <span>{t('console.manager.configure')}</span>
        </button>
      ) : null}

      <div className="manager-messages" ref={messagesRef}>
        {loading && messages.length === 0 ? (
          <div className="manager-loading"><Loader2 className="spin" aria-hidden="true" />{t('common.loading')}</div>
        ) : messages.length === 0 && proposals.length === 0 ? (
          <div className="manager-empty">
            <span className="manager-empty-icon"><Sparkles aria-hidden="true" /></span>
            <strong>{t('console.manager.empty')}</strong>
            <p>{t('console.manager.emptyHint')}</p>
          </div>
        ) : (
          <>
            {messages.map((message) => <ManagerBubble key={message.id} message={message} locale={locale} />)}
            {proposals.length > 0 ? (
              <div className="manager-proposals">
                <div className="manager-proposals-head">
                  <span><Check aria-hidden="true" />{t('console.manager.proposalKicker')}</span>
                  <span>{proposals.length}</span>
                </div>
                {proposals.map((proposal) => editing?.id === proposal.id ? (
                  <div className="proposal-card is-editing" key={proposal.id}>
                    <label className="field">
                      <span>{t('console.manager.fieldTitle')}</span>
                      <input value={editTitle} maxLength={200} onChange={(event) => setEditTitle(event.target.value)} />
                    </label>
                    {editItems.map((item, index) => (
                      <div className="proposal-edit-item" key={item.ref}>
                        <div className="proposal-edit-item-head"><span>{index + 1}</span><strong>{item.ref}</strong></div>
                        <label className="field">
                          <span>{t('console.manager.fieldTitle')}</span>
                          <input value={item.title} maxLength={200} onChange={(event) => patchEditItem(index, { title: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>{t('console.manager.fieldPrompt')}</span>
                          <textarea value={item.prompt} onChange={(event) => patchEditItem(index, { prompt: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>{t('console.manager.fieldAcceptance')}</span>
                          <textarea value={item.acceptance} onChange={(event) => patchEditItem(index, { acceptance: event.target.value })} />
                        </label>
                        <label className="field">
                          <span>{t('console.manager.agent')}</span>
                          <select value={item.agent} onChange={(event) => patchEditItem(index, { agent: event.target.value })}>
                            {AGENT_OPTIONS.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
                          </select>
                        </label>
                      </div>
                    ))}
                    <div className="proposal-actions">
                      <button type="button" className="button ghost small" onClick={() => setEditing(null)} disabled={busyProposal === proposal.id}>{t('console.manager.cancelAdjust')}</button>
                      <button type="button" className="button primary small" onClick={() => void saveEdit()} disabled={busyProposal === proposal.id}>
                        {busyProposal === proposal.id ? <Loader2 className="spin" aria-hidden="true" /> : null}{t('console.manager.saveAdjust')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    busy={busyProposal === proposal.id}
                    onConfirm={() => void dispatch(proposal)}
                    onAdjust={() => beginEdit(proposal)}
                    onDiscard={() => void discard(proposal)}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      {notice ? <p className="manager-notice" role="status">{notice}</p> : null}
      {error ? <p className="console-banner error" role="alert">{error}</p> : null}

      <div className="manager-composer">
        <textarea
          rows={3}
          value={draft}
          maxLength={8000}
          placeholder={manager?.ready ? t('console.manager.placeholder') : t('console.manager.configure')}
          disabled={!manager?.ready || sending || !projectId}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void submit() }
          }}
        />
        <div className="manager-composer-foot">
          <span>Ctrl + Enter</span>
          <button type="button" className="button primary small" disabled={!canSend} onClick={() => void submit()}>
            {sending ? <Loader2 className="spin" aria-hidden="true" /> : <Send aria-hidden="true" />}
            {sending ? t('console.manager.sending') : t('console.manager.send')}
          </button>
        </div>
      </div>
    </aside>
  )
}

function ManagerBubble({ message, locale }: { message: ManagerMessage; locale: 'zh' | 'en' }) {
  if (message.role === 'system') {
    return <p className="manager-system">{message.content}</p>
  }
  const isUser = message.role === 'user'
  return (
    <div className="manager-message" data-role={isUser ? 'user' : 'assistant'}>
      <div className="manager-message-head">
        <span>{isUser ? t('console.manager.you') : t('console.manager.reply')}</span>
        <time>{formatRelative(message.created_at, locale)}</time>
      </div>
      <p>{message.content}</p>
    </div>
  )
}

function ProposalCard({ proposal, busy, onConfirm, onAdjust, onDiscard }: {
  proposal: Proposal
  busy: boolean
  onConfirm: () => void
  onAdjust: () => void
  onDiscard: () => void
}) {
  return (
    <article className="proposal-card">
      <header className="proposal-card-head">
        <span className="proposal-kicker"><Check aria-hidden="true" />{t('console.manager.proposalKicker')}</span>
        <span className="proposal-count">{t('console.manager.proposalTasks', { n: proposal.items.length })}</span>
      </header>
      <h3>{proposal.title}</h3>
      {proposal.project_name ? <span className="proposal-project">{proposal.project_name}</span> : null}
      {proposal.summary ? <p className="proposal-summary">{proposal.summary}</p> : null}
      <ol className="proposal-items">
        {proposal.items.map((item, index) => (
          <li key={item.ref}>
            <span className="proposal-item-index">{index + 1}</span>
            <div>
              <strong>{item.title}</strong>
              <span className="proposal-item-meta">
                {item.agent}
                {item.dependsOn.length > 0 ? ' · ' + t('console.manager.depends') + ' ' + item.dependsOn.join(', ') : ''}
              </span>
            </div>
          </li>
        ))}
      </ol>
      <div className="proposal-actions">
        <button type="button" className="button ghost small" disabled={busy} onClick={onDiscard}>
          {busy ? null : <X aria-hidden="true" />}{t('console.manager.reject')}
        </button>
        <button type="button" className="button ghost small" disabled={busy} onClick={onAdjust}>
          <Pencil aria-hidden="true" />{t('console.manager.adjust')}
        </button>
        <button type="button" className="button primary small" disabled={busy} onClick={onConfirm}>
          {busy ? <Loader2 className="spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
          {busy ? t('console.manager.dispatching') : t('console.manager.confirmDispatch')}
        </button>
      </div>
    </article>
  )
}
