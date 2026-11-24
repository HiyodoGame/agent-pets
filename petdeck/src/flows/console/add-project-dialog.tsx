import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Loader2, X } from 'lucide-react'
import { registerProject, type Project } from '../../adapters/runtime-client.ts'
import { t } from '../../i18n/index.ts'
import { useFocusTrap } from './focus-trap.ts'

export function AddProjectDialog({ onClose, onRegistered }: {
  onClose: () => void
  onRegistered: (project: Project, created: boolean) => void
}) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pathRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useFocusTrap(dialogRef)
  useEffect(() => { pathRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    if (!path.trim()) { setError(t('console.error.pathRequired')); return }
    setBusy(true)
    setError(null)
    try {
      const result = await registerProject(path.trim(), name.trim() || undefined)
      onRegistered(result.project, result.created)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="console-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose() }}>
      <div ref={dialogRef} className="console-dialog narrow" role="dialog" aria-modal="true" aria-labelledby="add-project-title">
        <header className="console-dialog-head">
          <div>
            <h2 id="add-project-title">{t('console.addProject.title')}</h2>
            <p>{t('console.addProject.hint')}</p>
          </div>
          <button type="button" className="icon-button" aria-label={t('common.close')} disabled={busy} onClick={() => { if (!busy) onClose() }}><X aria-hidden="true" /></button>
        </header>
        <form className="console-form" onSubmit={submit}>
          <label className="field">
            <span>{t('console.field.projectPath')}</span>
            <input ref={pathRef} value={path} onChange={(event) => setPath(event.target.value)} placeholder={t('console.field.projectPathPlaceholder')} spellCheck={false} />
          </label>
          <label className="field">
            <span>{t('console.field.projectName')}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('console.field.projectNamePlaceholder')} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <footer className="console-dialog-actions">
            <button type="button" className="button ghost" disabled={busy} onClick={() => { if (!busy) onClose() }}>{t('common.cancel')}</button>
            <button type="submit" className="button primary" disabled={busy}>
              {busy ? <Loader2 className="spin" aria-hidden="true" /> : null}
              {t('console.addProject.submit')}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
