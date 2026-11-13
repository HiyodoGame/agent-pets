// =============================================
// PetDeck — Main Application (App Shell + edge states)
// Integrates all 4 flows with dual-surface layout
// Edge 补全：offline-no-network 全局 banner + 缓存提示；ErrorBoundary 兜底
// =============================================
import { Component, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { ThemeStyleProvider, Button, Tag } from 'sparkdesign'
import { Sun, Moon, WifiOff } from 'lucide-react'
import { Flow1_PetSurface, PetAvatar } from '../flow-1-pet-surface/flow1-pet-surface'
import { Flow2_ConnectAgent } from '../flow-2-connect-agent/flow2-connect-agent'
import { Flow3_Panel } from '../flow-3-panel/flow3-panel'
import { Flow4_Relay } from '../flow-4-relay/flow4-relay'
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

function Shell({ appearance, onToggleAppearance }: { appearance: 'light' | 'dark'; onToggleAppearance: () => void }) {
  const navigate = useNavigate()
  const [offline, setOffline] = useState(false)
  const { sessions, mode } = usePetData()
  // mount-only：useRef 初始值即挂载时 mode，effect 内读取（不在 render 期写 ref）
  const modeRef = useRef(mode)
  useEffect(() => { track('shell', EVENT.appSessionStart, { mode: modeRef.current }) }, [])
  const running = sessions.filter((s) => s.status === 'active').length
  const waiting = sessions.filter((s) => s.status === 'waiting' || s.status === 'stuck').length

  return (
    <div className="flex min-h-screen flex-col bg-bg-base text-text">
      <header className="flex items-center gap-3 border-b border-border-secondary bg-bg-layout p-3">
        <span className="font-semibold">PetDeck</span>
        <Tag color={mode === 'live' ? 'success' : 'slate'}>{mode === 'live' ? '实时' : '演示'}</Tag>
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
          <Button variant="ghost" aria-label="模拟离线" onClick={() => setOffline((o) => !o)}>
            <WifiOff className="h-4 w-4" />
          </Button>
          <Button variant="ghost" aria-label="切换亮暗色" onClick={onToggleAppearance}>
            {appearance === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      {/* offline-no-network：全局 banner，不阻断缓存查看 */}
      {offline && (
        <div className="p-3">
          <EdgeAlert variant="info" title="当前离线" desc="查看的是本地缓存；恢复网络后自动同步。" onRetry={() => setOffline(false)} retryLabel="恢复网络" />
        </div>
      )}

      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/panel" replace />} />
          <Route path="/pet" element={<Flow1_PetSurface onOpenPanel={() => navigate('/panel')} onReconnect={() => navigate('/connect')} />} />
          <Route path="/connect" element={<Flow2_ConnectAgent onConnected={() => navigate('/panel')} />} />
          <Route path="/panel" element={<Flow3_Panel onRelay={() => navigate('/relay')} />} />
          <Route path="/relay" element={<Flow4_Relay onExit={() => navigate('/panel')} />} />
        </Routes>
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
  return (
    <ThemeStyleProvider appearance={appearance} theme="mint" style="soft">
      <ErrorBoundary>
        <DataSourceProvider>
          <Shell appearance={appearance} onToggleAppearance={() => setAppearance((a) => (a === 'light' ? 'dark' : 'light'))} />
        </DataSourceProvider>
      </ErrorBoundary>
    </ThemeStyleProvider>
  )
}

export default PetDeckApp