// =============================================
// ThemedRoutes — 路由表 + Spark ThemeStyleProvider
// 独立成懒加载 chunk：sparkdesign barrel（含 Mermaid/KaTeX/Response）只随本 chunk 下载，
// 轻量原生 shell（app-shell.tsx）不依赖它，header/悬浮球随入口立即渲染。
// ThemeStyleProvider 需要 React context，Spark 路由组件必须包在它内部；
// 其渲染的 data-theme/data-style div 与 shell 根节点上的同名属性取值一致（light/dark · soft）。
// =============================================
import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { ThemeStyleProvider } from 'sparkdesign'
import type { Session } from '../shared/types'
import { usePetData } from '../../adapters'

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

function ShellRoutes() {
  const navigate = useNavigate()
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/panel" replace />} />
      <Route path="/pet" element={<Flow1_PetSurface onOpenPanel={() => navigate('/panel')} onReconnect={() => navigate('/connect')} />} />
      <Route path="/connect" element={<Flow2_ConnectAgent onConnected={() => navigate('/panel')} />} />
      <Route path="/panel" element={<Flow3_Panel onRelay={(s) => navigate('/relay', { state: { sessionId: s.id } })} onConnect={() => navigate('/connect')} />} />
      <Route path="/relay" element={<RelayRoute onExit={() => navigate('/panel')} />} />
    </Routes>
  )
}

export function ThemedRoutes({ appearance }: { appearance: 'light' | 'dark' }) {
  return (
    <ThemeStyleProvider appearance={appearance} theme="mint" style="soft">
      <Suspense fallback={<div className="p-6 text-text-secondary">加载中…</div>}>
        <ShellRoutes />
      </Suspense>
    </ThemeStyleProvider>
  )
}

export default ThemedRoutes
