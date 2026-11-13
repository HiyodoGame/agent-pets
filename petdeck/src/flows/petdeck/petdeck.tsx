// =============================================
// PetDeck — Main Application (App Shell + edge states)
// Integrates all 4 flows with dual-surface layout
// Edge 补全：offline-no-network 全局 banner + 缓存提示；ErrorBoundary 兜底
// =============================================
import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { ThemeStyleProvider, Button, Tag } from 'sparkdesign'
import { Sun, Moon, FlaskConical } from 'lucide-react'
import type { Session } from '../shared/types'
import { PetAvatar } from '../shared/pet-avatar'
// 代码分包：四个 flow 懒加载，非首屏的 sparkdesign 重组件（Response/mermaid 等）移出主入口。
const Flow1_PetSurface = lazy(() => import('../flow-1-pet-surface/flow1-pet-surface').then((m) => ({ default: m.Flow1_PetSurface })))
const Flow2_ConnectAgent = lazy(() => import('../flow-2-connect-agent/flow2-connect-agent').then((m) => ({ default: m.Flow2_ConnectAgent })))
const Flow3_Panel = lazy(() => import('../flow-3-panel/flow3-panel').then((m) => ({ default: m.Flow3_Panel })))
const Flow4_Relay = lazy(() => import('../flow-4-relay/flow4-relay').then((m) => ({ default: m.Flow4_Relay })))
import { DataSourceProvider, usePetData } from '../../adapters'
import { track, EVENT } from '../../telemetry'
import { EdgeAlert } from '../shared/edge-kit'
import { fmtCount } from '../shared/ui-logic'

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="m-4 rounded-md bg-error-bg p-8 text-error">
          <p className="mb-2 font-semibold">页面发生错误</p>
          <pre className="whitespace-pre-wrap text-sm">{String(this.state.error)}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

const NAV = [
  { path: '/pet', label: '桌宠' },
  { path: '/connect', label: '接入' },
  { path: '/panel', label: '面板' },
  { path: '/relay', label: '接力' },
]

// Relay gets its source session from navigation state (real panel selection), not a mock default.
function RelayRoute({ onExit }: { onExit: () => void }) {
  const location = useLocation()
  const { getSession } = usePetData()
  const sessionId = (location.state as { sessionId?: string } | null)?.sessionId
  const sourceSession: Session | undefined = sessionId ? getSession(sessionId) : undefined
  return <Flow4_Relay sourceSession={sourceSession} onExit={onExit} />
}

function Shell({ appearance, onToggleAppearance, demo, onToggleDemo }: { appearance: 'light' | 'dark'; onToggleAppearance: () => void; demo: boolean; onToggleDemo: () => void }) {
  const navigate = useNavigate()
  const { sessions, mode, connState, savedAt, reconnect } = usePetData()
  // mount-only：useRef 初始值即挂载时 mode，effect 内读取（不在 render 期写 ref）
  const modeRef = useRef(mode)
  useEffect(() => { track('shell', EVENT.appSessionStart, { mode: modeRef.current }) }, [])
  const running = sessions.filter((s) => s.status === 'active').length
  const waiting = sessions.filter((s) => s.status === 'waiting' || s.status === 'stuck').length
  const offline = connState === 'offline' && mode !== 'mock'
  const clock = savedAt !== null ? new Date(savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null
  const badge = mode === 'mock'
    ? { color: 'slate' as const, label: '演示' }
    : connState === 'live'
      ? { color: 'success' as const, label: '实时' }
      : connState === 'reconnecting'
        ? { color: 'warning' as const, label: '重连中' }
        : { color: 'error' as const, label: clock ? `离线 · 截至 ${clock}` : '离线' }

  return (
    <div className="flex min-h-screen flex-col bg-bg-base text-text">
      <header className="flex items-center gap-3 border-b border-border-secondary bg-bg-layout p-3">
        <span className="font-semibold">PetDeck</span>
        <Tag color={badge.color}>{badge.label}</Tag>
        <nav className="flex gap-2">
          {NAV.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              className={({ isActive }) =>
                `rounded-md border px-3 py-1 transition-colors ${
                  isActive
                    ? 'border-primary bg-bg-elevated font-semibold text-text'
                    : 'border-border-secondary bg-bg-container text-text-secondary hover:bg-bg-elevated'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" aria-label="切换演示数据" aria-pressed={demo} onClick={onToggleDemo}>
            <FlaskConical className="h-4 w-4" />
          </Button>
          <Button variant="ghost" aria-label="切换亮暗色" onClick={onToggleAppearance}>
            {appearance === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* offline-no-network：真实连接状态驱动，不阻断缓存查看 */}
      {offline && (
        <div className="p-3">
          <EdgeAlert
            variant="info"
            title="当前离线"
            desc={clock ? `查看的是本地缓存（截至 ${clock}）；恢复后自动同步。` : '尚未连接本地 bridge；启动后自动同步。'}
            onRetry={reconnect}
            retryLabel="重连"
          />
        </div>
      )}

      <main className="flex-1 overflow-auto">
        <Suspense fallback={<div className="p-6 text-text-secondary">加载中…</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/panel" replace />} />
            <Route path="/pet" element={<Flow1_PetSurface onOpenPanel={() => navigate('/panel')} onReconnect={() => navigate('/connect')} />} />
            <Route path="/connect" element={<Flow2_ConnectAgent onConnected={() => navigate('/panel')} />} />
            <Route path="/panel" element={<Flow3_Panel onRelay={(s) => navigate('/relay', { state: { sessionId: s.id } })} />} />
            <Route path="/relay" element={<RelayRoute onExit={() => navigate('/panel')} />} />
          </Routes>
        </Suspense>
      </main>

      <button
        type="button"
        onClick={() => navigate('/pet')}
        className="fixed bottom-4 right-4 flex items-center gap-2 rounded-full border border-border-secondary bg-bg-container p-2 shadow-sm transition-colors hover:bg-bg-elevated"
        aria-label="打开桌宠"
      >
        <PetAvatar status={offline ? 'offline' : waiting > 0 ? 'stuck' : running > 0 ? 'running' : 'idle'} size={40} />
        <Tag className="tabular-nums" color={offline ? 'error' : waiting > 0 ? 'warning' : 'success'}>
          {offline ? '离线' : waiting > 0 ? `${fmtCount(waiting)} 待处理` : `${fmtCount(running)} 运行`}
        </Tag>
      </button>
    </div>
  )
}

export function PetDeckApp() {
  const [appearance, setAppearance] = useState<'light' | 'dark'>('light')
  const [demo, setDemo] = useState(false)
  return (
    <ThemeStyleProvider appearance={appearance} theme="mint" style="soft">
      <ErrorBoundary>
        <DataSourceProvider demo={demo}>
          <Shell
            appearance={appearance}
            onToggleAppearance={() => setAppearance((a) => (a === 'light' ? 'dark' : 'light'))}
            demo={demo}
            onToggleDemo={() => setDemo((d) => !d)}
          />
        </DataSourceProvider>
      </ErrorBoundary>
    </ThemeStyleProvider>
  )
}

export default PetDeckApp