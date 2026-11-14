// =============================================
// PetDeck App Shell — 轻量原生首屏 chrome（header/nav/主题属性/悬浮球）
// 本模块刻意不 import sparkdesign：header/离线横幅/悬浮球随入口 chunk 立即渲染，
// Spark 重组件（Mermaid/KaTeX/Response 所在 barrel）只随路由 chunk 懒加载
// （见 themed-routes.tsx），dist/index.html 因此不再随首屏下载它们。
// 主题：根节点挂 data-theme/data-style 属性（与 Spark ThemeStyleProvider 对
// theme="mint" style="soft" 计算出的值一致），token 变量由 sparkdesign/theme.css 提供。
// =============================================
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Sun, Moon, FlaskConical } from 'lucide-react'
import { PetAvatar } from '../shared/pet-avatar'
import { DataSourceProvider, usePetData } from '../../adapters'
import { track, EVENT } from '../../telemetry'
import { fmtCount } from '../shared/ui-logic'

// 代码分包：五个懒加载单元（四个 flow 在 themed-routes 内 + 本路由模块），
// sparkdesign barrel 不进入入口静态依赖，也就不会被 HTML 预加载。
const ThemedRoutes = lazy(() => import('./themed-routes').then((m) => ({ default: m.ThemedRoutes })))

const NAV = [
  { path: '/pet', label: '桌宠' },
  { path: '/connect', label: '接入' },
  { path: '/panel', label: '面板' },
  { path: '/relay', label: '接力' },
]

// 原生状态徽章：取代 Spark Tag（filled 变体的 token 类组合），仅用于 shell chrome。
const SHELL_TAG_COLORS = {
  slate: 'border-transparent bg-slate-bg text-slate',
  success: 'border-transparent border-success-border bg-success-bg text-success',
  warning: 'border-transparent border-warning-border bg-warning-bg text-warning',
  error: 'border-transparent border-error-border bg-error-bg text-error',
} as const

function ShellTag({ color, className, children }: { color: keyof typeof SHELL_TAG_COLORS; className?: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-0.5 text-xs font-medium ${SHELL_TAG_COLORS[color]} ${className ?? ''}`}>
      {children}
    </span>
  )
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
    <div data-theme={appearance} data-style="soft" className="flex min-h-screen flex-col bg-bg-base text-text">
      <header className="flex items-center gap-3 border-b border-border-secondary bg-bg-layout p-3">
        <span className="font-semibold">PetDeck</span>
        <ShellTag color={badge.color}>{badge.label}</ShellTag>
        <nav className="flex gap-2" aria-label="主导航">
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
          <button
            type="button"
            aria-label="切换演示数据"
            aria-pressed={demo}
            onClick={onToggleDemo}
            className={`rounded-md border p-1.5 transition-colors ${
              demo
                ? 'border-primary bg-bg-elevated text-text'
                : 'border-border-secondary bg-bg-container text-text-secondary hover:bg-bg-elevated'
            }`}
          >
            <FlaskConical className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="切换亮暗色"
            onClick={onToggleAppearance}
            className="rounded-md border border-border-secondary bg-bg-container p-1.5 text-text-secondary transition-colors hover:bg-bg-elevated"
          >
            {appearance === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* offline-no-network：真实连接状态驱动，不阻断缓存查看 */}
      {offline && (
        <div className="p-3">
          <div role="alert" className="rounded-md border border-info-border bg-info-bg p-3 text-info">
            <p className="text-sm font-semibold">当前离线</p>
            <p className="text-sm">{clock ? `查看的是本地缓存（截至 ${clock}）；恢复后自动同步。` : '尚未连接本地 bridge；启动后自动同步。'}</p>
            <button
              type="button"
              onClick={reconnect}
              className="mt-2 inline-flex items-center gap-1 rounded-md border border-info-border px-3 py-1 text-sm transition-colors hover:bg-info-bg-hover"
            >
              重连
            </button>
          </div>
        </div>
      )}

      <main className="flex-1 overflow-auto">
        <Suspense fallback={<div className="p-6 text-text-secondary">加载中…</div>}>
          <ThemedRoutes appearance={appearance} />
        </Suspense>
      </main>

      <button
        type="button"
        onClick={() => navigate('/pet')}
        className="fixed bottom-4 right-4 flex items-center gap-2 rounded-full border border-border-secondary bg-bg-container p-2 shadow-sm transition-colors hover:bg-bg-elevated"
        aria-label="打开桌宠"
      >
        <PetAvatar status={offline ? 'offline' : waiting > 0 ? 'stuck' : running > 0 ? 'running' : 'idle'} size={40} />
        <ShellTag className="tabular-nums" color={offline ? 'error' : waiting > 0 ? 'warning' : 'success'}>
          {offline ? '离线' : waiting > 0 ? `${fmtCount(waiting)} 待处理` : `${fmtCount(running)} 运行`}
        </ShellTag>
      </button>
    </div>
  )
}

export function AppShell() {
  const [appearance, setAppearance] = useState<'light' | 'dark'>('light')
  const [demo, setDemo] = useState(false)
  return (
    <DataSourceProvider demo={demo}>
      <Shell
        appearance={appearance}
        onToggleAppearance={() => setAppearance((a) => (a === 'light' ? 'dark' : 'light'))}
        demo={demo}
        onToggleDemo={() => setDemo((d) => !d)}
      />
    </DataSourceProvider>
  )
}

export default AppShell
