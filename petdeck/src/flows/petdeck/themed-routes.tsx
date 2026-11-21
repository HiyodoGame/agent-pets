// =============================================
// ThemedRoutes — 路由表 + Spark ThemeStyleProvider
// 控制台页面（today/tasks/projects/agents/reports/settings）直接随本 chunk 加载；
// 旧版 flow-1..4 仍按需 lazy，保留在侧栏「旧版」分组。
// =============================================
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { ThemeStyleProvider } from 'sparkdesign'
import type { Session } from '../shared/types'
import { usePetData } from '../../adapters'
import { t } from '../../i18n/index.ts'
import { TodayPage } from '../console/today-page.tsx'
import { TaskPage } from '../console/task-page.tsx'
import { ProjectsPage, TasksPage, AgentsPage, ReportsPage, SettingsPage } from '../console/pages.tsx'

const Flow1_PetSurface = lazy(() => import('../flow-1-pet-surface/flow1-pet-surface').then((m) => ({ default: m.Flow1_PetSurface })))
const Flow2_ConnectAgent = lazy(() => import('../flow-2-connect-agent/flow2-connect-agent').then((m) => ({ default: m.Flow2_ConnectAgent })))
const Flow3_Panel = lazy(() => import('../flow-3-panel/flow3-panel').then((m) => ({ default: m.Flow3_Panel })))
const Flow4_Relay = lazy(() => import('../flow-4-relay/flow4-relay').then((m) => ({ default: m.Flow4_Relay })))

// Relay gets its source session from navigation state (real panel selection), not a mock default.
// Keyed remount on mode change: Flow4's useState initializers capture the mode at mount
// (live starts source=null; demo starts from the mock default). Remounting on toggle resets
// them honestly instead of leaving a blank source (browser-confirmed pre-fix failure).
function RelayRoute({ onExit }: { onExit: () => void }) {
  const location = useLocation()
  const { getSession, mode } = usePetData()
  const sessionId = (location.state as { sessionId?: string } | null)?.sessionId
  const sourceSession: Session | undefined = sessionId ? getSession(sessionId) : undefined
  return <Flow4_Relay key={mode} sourceSession={sourceSession} onExit={onExit} />
}

function PanelRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as { projectId?: string; sessionId?: string } | null
  const target = state && (state.projectId || state.sessionId) ? state : null
  return <Flow3_Panel key={location.key} focusTarget={target} onRelay={(s) => navigate('/relay', { state: { sessionId: s.id } })} onConnect={() => navigate('/connect')} />
}

function ShellRoutes() {
  const navigate = useNavigate()
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
      <Route path="/pet" element={<Flow1_PetSurface onOpenPanel={() => navigate('/panel')} onReconnect={() => navigate('/connect')} />} />
      <Route path="/connect" element={<Flow2_ConnectAgent onConnected={() => navigate('/panel')} />} />
      <Route path="/panel" element={<PanelRoute />} />
      <Route path="/relay" element={<RelayRoute onExit={() => navigate('/panel')} />} />
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
