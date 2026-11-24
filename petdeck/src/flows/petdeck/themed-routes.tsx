// ThemedRoutes — route table + Spark ThemeStyleProvider.
// Only the console surfaces remain; legacy /panel, /relay, /connect and /pet are
// gone, and unknown paths fall back to Today so old deep links stay safe.
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { ThemeStyleProvider } from 'sparkdesign'
import { t } from '../../i18n/index.ts'

const TodayPage = lazy(() => import('../console/today-page.tsx').then((m) => ({ default: m.TodayPage })))
const TaskPage = lazy(() => import('../console/task-page.tsx').then((m) => ({ default: m.TaskPage })))
const ProjectsPage = lazy(() => import('../console/pages.tsx').then((m) => ({ default: m.ProjectsPage })))
const TasksPage = lazy(() => import('../console/pages.tsx').then((m) => ({ default: m.TasksPage })))
const AgentsPage = lazy(() => import('../console/pages.tsx').then((m) => ({ default: m.AgentsPage })))
const ReportsPage = lazy(() => import('../console/pages.tsx').then((m) => ({ default: m.ReportsPage })))
const SettingsPage = lazy(() => import('../console/pages.tsx').then((m) => ({ default: m.SettingsPage })))

function ShellRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/today" replace />} />
      <Route path="/today" element={<TodayPage />} />
      <Route path="/tasks" element={<TasksPage />} />
      <Route path="/tasks/:taskId" element={<TaskPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  )
}

export function ThemedRoutes({ appearance }: { appearance: 'light' | 'dark' }) {
  return (
    <ThemeStyleProvider appearance={appearance} theme="mint" style="soft">
      <Suspense fallback={<div className="p-6 text-text-secondary">{t('common.loading')}</div>}>
        <ShellRoutes />
      </Suspense>
    </ThemeStyleProvider>
  )
}

export default ThemedRoutes
