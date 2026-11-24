import { useEffect, useState, type ReactNode } from 'react'
import { CalendarDays, FileBarChart, Loader2, RefreshCw } from 'lucide-react'
import {
  generateDailyReport,
  listProjects,
  listReports,
  type DailyReport,
  type Project,
} from '../../adapters/runtime-client.ts'
import { t, useLocale } from '../../i18n/index.ts'
import { runtimeErrorText } from './runtime-error.ts'
import { formatRelative } from './format.ts'
import { EmptyState } from './task-bits.tsx'

function todayString(): string {
  const now = new Date()
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
}

/** Daily report browser: one report per day/project, generated from runtime facts
 *  through the optional manager model with a deterministic local fallback. */
export function ReportsView() {
  const { locale } = useLocale()
  const [projects, setProjects] = useState<Project[]>([])
  const [reports, setReports] = useState<DailyReport[]>([])
  const [projectId, setProjectId] = useState('')
  const [date, setDate] = useState(todayString)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    listProjects()
      .then((next) => { if (!disposed) setProjects(next) })
      .catch(() => { /* the report list can still work without the project filter */ })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    let disposed = false
    setLoading(true)
    listReports({ projectId: projectId || null })
      .then((next) => {
        if (disposed) return
        setReports(next)
        setError(null)
      })
      .catch((cause) => { if (!disposed) setError(runtimeErrorText(cause)) })
      .finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [projectId])

  useEffect(() => {
    if (reports.length === 0) { setSelectedId(null); return }
    if (!selectedId || !reports.some((report) => report.id === selectedId)) setSelectedId(reports[0].id)
  }, [reports, selectedId])

  const selected = reports.find((report) => report.id === selectedId) ?? null

  async function generate() {
    if (generating) return
    setGenerating(true)
    setError(null)
    try {
      const report = await generateDailyReport({ date, projectId: projectId || null })
      setReports((current) => [report, ...current.filter((item) => item.id !== report.id)])
      setSelectedId(report.id)
    } catch (cause) {
      setError(runtimeErrorText(cause))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="reports-view">
      <div className="reports-toolbar">
        <label className="reports-filter">
          <span>{t('console.manager.project')}</span>
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">{t('console.reports.projectAll')}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="reports-filter">
          <span>{t('console.reports.dateLabel')}</span>
          <input type="date" value={date} max={todayString()} onChange={(event) => setDate(event.target.value)} />
        </label>
        <button type="button" className="button primary" disabled={generating} onClick={() => void generate()}>
          {generating ? <Loader2 className="spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          {generating ? t('console.reports.generating') : t('console.reports.generate')}
        </button>
      </div>

      {error ? <p className="console-banner error" role="alert">{error}</p> : null}

      {loading && reports.length === 0 ? (
        <div className="page-loading"><Loader2 className="spin" aria-hidden="true" />{t('common.loading')}</div>
      ) : reports.length === 0 ? (
        <EmptyState icon={<FileBarChart aria-hidden="true" />} title={t('console.reports.emptyTitle')} body={t('console.reports.emptyBody')}>
          <button type="button" className="button primary" disabled={generating} onClick={() => void generate()}>
            {generating ? <Loader2 className="spin" aria-hidden="true" /> : <CalendarDays aria-hidden="true" />}
            {generating ? t('console.reports.generating') : t('console.reports.generateToday')}
          </button>
        </EmptyState>
      ) : (
        <div className="reports-layout">
          <nav className="report-list" aria-label={t('console.reports.title')}>
            {reports.map((report) => (
              <button
                type="button"
                key={report.id}
                className="report-list-item"
                data-selected={report.id === selectedId}
                onClick={() => setSelectedId(report.id)}
              >
                <span className="report-list-date">{report.date}</span>
                <strong>{report.title}</strong>
                <span className="report-list-meta">
                  {report.project_name ?? t('console.reports.projectAll')}
                  <span className="report-source" data-source={report.source}>
                    {report.source === 'manager' ? t('console.reports.sourceManager') : t('console.reports.sourceLocal')}
                  </span>
                </span>
              </button>
            ))}
          </nav>
          <article className="report-detail panel-card">
            {selected ? (
              <>
                <header className="report-detail-head">
                  <div>
                    <span className="console-kicker">{selected.date} · {selected.project_name ?? t('console.reports.projectAll')}</span>
                    <h2>{selected.title}</h2>
                    <span className="report-detail-meta">
                      {t('console.reports.updated')} {formatRelative(selected.updated_at, locale)}
                    </span>
                  </div>
                  <span className="report-source is-large" data-source={selected.source}>
                    {selected.source === 'manager' ? t('console.reports.sourceManager') : t('console.reports.sourceLocal')}
                  </span>
                </header>
                <ReportStats report={selected} />
                <ReportBody body={selected.body} />
              </>
            ) : (
              <p className="report-select-hint">{t('console.reports.selectHint')}</p>
            )}
          </article>
        </div>
      )}
    </div>
  )
}

function ReportStats({ report }: { report: DailyReport }) {
  const stats = report.stats ?? {}
  const entries: { key: string; label: string; value: number }[] = [
    { key: 'total', label: t('console.reports.statTotal'), value: Number(stats.total ?? 0) },
    { key: 'done', label: t('console.reports.statDone'), value: Number(stats.completed ?? 0) + Number(stats.merged ?? 0) },
    { key: 'review', label: t('console.reports.statReview'), value: Number(stats.review ?? 0) },
    { key: 'merge', label: t('console.reports.statMerge'), value: Number(stats.pending_merge ?? 0) },
    { key: 'attention', label: t('console.reports.statAttention'), value: Number(stats.failed ?? 0) + Number(stats.waiting ?? 0) },
    { key: 'decisions', label: t('console.reports.statDecisions'), value: Number(stats.decisions ?? 0) },
  ]
  return (
    <dl className="report-stats">
      {entries.map((entry) => (
        <div key={entry.key}>
          <dt>{entry.label}</dt>
          <dd className="tabular-nums">{entry.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Small, dependency-free Markdown subset for the report body. It never uses
 *  innerHTML, so model output cannot inject markup. */
function ReportBody({ body }: { body: string }) {
  const blocks: ReactNode[] = []
  let bullets: string[] = []
  let index = 0
  const flush = () => {
    if (bullets.length === 0) return
    blocks.push(<ul key={'ul-' + index++}>{bullets.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>)
    bullets = []
  }
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (/^\s*##\s+/.test(line)) { flush(); blocks.push(<h3 key={'h3-' + index++}>{line.replace(/^\s*##\s+/, '')}</h3>); continue }
    if (/^\s*###\s+/.test(line)) { flush(); blocks.push(<h4 key={'h4-' + index++}>{line.replace(/^\s*###\s+/, '')}</h4>); continue }
    if (/^\s*[-*]\s+/.test(line)) { bullets.push(line.replace(/^\s*[-*]\s+/, '')); continue }
    if (!line.trim()) { flush(); continue }
    flush()
    blocks.push(<p key={'p-' + index++}>{line}</p>)
  }
  flush()
  if (blocks.length === 0) return <p className="report-select-hint">{t('console.reports.noBody')}</p>
  return <div className="report-body">{blocks}</div>
}
