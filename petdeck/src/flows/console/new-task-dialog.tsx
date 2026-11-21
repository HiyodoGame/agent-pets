import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Loader2, X } from 'lucide-react'
import { createTask, listAgents, type AgentInfo, type Project, type Task } from '../../adapters/runtime-client.ts'
import { t } from '../../i18n/index.ts'

const MODE_LABEL: Record<string, Parameters<typeof t>[0]> = {
  acceptEdits: 'console.mode.acceptEdits',
  default: 'console.mode.default',
  plan: 'console.mode.plan',
  bypassPermissions: 'console.mode.bypass',
}

const FALLBACK_AGENTS: AgentInfo[] = [
  { id: 'claude-code', name: 'Claude Code', form: 'cli', command: 'claude', capabilities: { host: true, stream: true, resume: true, suspend: true, decisions: true, permissionModes: ['default', 'acceptEdits', 'plan', 'bypassPermissions'] } },
  { id: 'kimi-code', name: 'Kimi Code', form: 'cli', command: 'kimi', capabilities: { host: true, stream: true, resume: true, suspend: true, decisions: true, permissionModes: ['default'] } },
]

export function NewTaskDialog({ projects, tasks = [], defaultProjectId, onClose, onCreated }: {
  projects: Project[]
  tasks?: Task[]
  defaultProjectId?: string | null
  onClose: () => void
  onCreated: (task: Task) => void
}) {
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [agents, setAgents] = useState<AgentInfo[]>(FALLBACK_AGENTS)
  const [agent, setAgent] = useState(FALLBACK_AGENTS[0].id)
  const [permissionMode, setPermissionMode] = useState(FALLBACK_AGENTS[0].capabilities.permissionModes[1] ?? 'default')
  const [dependsOn, setDependsOn] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    let disposed = false
    listAgents()
      .then((next) => { if (!disposed && next.length > 0) setAgents(next) })
      .catch(() => { /* the dialog still works with the built-in fallback */ })
    return () => { disposed = true }
  }, [])

  const current = agents.find((item) => item.id === agent) ?? agents[0]
  const modes = current?.capabilities.permissionModes?.length ? current.capabilities.permissionModes : ['default']
  const candidates = useMemo(
    () => tasks.filter((task) => task.project_id === projectId && task.status !== 'completed'),
    [tasks, projectId],
  )

  useEffect(() => {
    if (!modes.includes(permissionMode)) setPermissionMode(modes.includes('acceptEdits') ? 'acceptEdits' : modes[0])
  }, [agent, modes, permissionMode])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!projectId) { setError(t('console.error.noProject')); return }
    if (!title.trim() || !prompt.trim()) { setError(t('console.error.required')); return }
    setBusy(true)
    setError(null)
    try {
      const task = await createTask({ projectId, title: title.trim(), prompt: prompt.trim(), agent, permissionMode, dependsOn })
      onCreated(task)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="console-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="console-dialog" role="dialog" aria-modal="true" aria-labelledby="new-task-title">
        <header className="console-dialog-head">
          <div>
            <h2 id="new-task-title">{t('console.newTask.title')}</h2>
            <p>{t('console.newTask.hint')}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t('common.close')} onClick={onClose}><X aria-hidden="true" /></button>
        </header>
        <form className="console-form" onSubmit={submit}>
          <label className="field">
            <span>{t('console.field.project')}</span>
            <select value={projectId} onChange={(event) => { setProjectId(event.target.value); setDependsOn([]) }}>
              {projects.length === 0 && <option value="">{t('console.field.noProjects')}</option>}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.kind === 'dir' ? t('console.projectKindDirSuffix') : ''}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{t('console.field.taskTitle')}</span>
            <input ref={titleRef} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder={t('console.field.taskTitlePlaceholder')} />
          </label>
          <label className="field">
            <span>{t('console.field.prompt')}</span>
            <textarea value={prompt} rows={6} onChange={(event) => setPrompt(event.target.value)} placeholder={t('console.field.promptPlaceholder')} />
          </label>
          <div className="field-row">
            <label className="field">
              <span>{t('console.field.agent')}</span>
              <select value={agent} onChange={(event) => setAgent(event.target.value)}>
                {agents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t('console.field.permission')}</span>
              <select value={permissionMode} onChange={(event) => setPermissionMode(event.target.value)}>
                {modes.map((mode) => <option key={mode} value={mode}>{t(MODE_LABEL[mode] ?? 'console.mode.default')}</option>)}
              </select>
            </label>
          </div>
          <fieldset className="field dependency-field">
            <legend>{t('console.field.dependsOn')}</legend>
            <p className="field-hint">{t('console.field.dependsOnHint')}</p>
            {candidates.length === 0
              ? <p className="field-hint">{t('console.field.noDeps')}</p>
              : <div className="dependency-list">
                  {candidates.map((task) => (
                    <label key={task.id} className="dependency-item">
                      <input
                        type="checkbox"
                        checked={dependsOn.includes(task.id)}
                        onChange={(event) => setDependsOn((current) => event.target.checked ? [...current, task.id] : current.filter((id) => id !== task.id))}
                      />
                      <span>{task.title}</span>
                      <span className="dependency-status">{task.status}</span>
                    </label>
                  ))}
                </div>}
          </fieldset>
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer className="console-dialog-actions">
            <button type="button" className="button ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="button primary" disabled={busy || projects.length === 0}>
              {busy ? <Loader2 className="spin" aria-hidden="true" /> : null}
              {t('console.newTask.create')}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
