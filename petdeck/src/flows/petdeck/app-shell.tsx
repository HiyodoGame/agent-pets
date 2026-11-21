import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ArrowRightLeft,
  Bot,
  FileBarChart,
  FlaskConical,
  FolderGit2,
  LayoutDashboard,
  Link2,
  ListTodo,
  MessagesSquare,
  Moon,
  PawPrint,
  PlugZap,
  Settings2,
  Sun,
} from 'lucide-react'
import { PetAvatar } from '../shared/pet-avatar'
import { DataSourceProvider, usePetData } from '../../adapters'
import { bridgeConfigError } from '../../adapters/bridge-client.ts'
import { track, EVENT } from '../../telemetry'
import { fmtCount } from '../shared/ui-logic'
import { listenForPanelNavigation } from '../../desktop/window'
import { getDemoPreference, setDemoPreference } from '../../desktop/demo-preference.ts'
import { useGrowth } from '../shared/pet/use-growth.ts'
import { useRuntimeOverview } from '../console/runtime-hooks.ts'
import { t, useLocale } from '../../i18n/index.ts'

const ThemedRoutes = lazy(() => import('./themed-routes').then((m) => ({ default: m.ThemedRoutes })))

const NAV_GROUPS = [
  {
    key: 'shell.navConsole' as const,
    items: [
      { path: '/today', key: 'nav.today' as const, icon: LayoutDashboard },
      { path: '/tasks', key: 'nav.tasks' as const, icon: ListTodo },
      { path: '/projects', key: 'nav.projects' as const, icon: FolderGit2 },
      { path: '/agents', key: 'nav.agents' as const, icon: Bot },
      { path: '/reports', key: 'nav.reports' as const, icon: FileBarChart },
      { path: '/settings', key: 'nav.settings' as const, icon: Settings2 },
    ],
  },
  {
    key: 'shell.navLegacy' as const,
    items: [
      { path: '/panel', key: 'nav.panel' as const, icon: MessagesSquare },
      { path: '/relay', key: 'nav.relay' as const, icon: ArrowRightLeft },
      { path: '/connect', key: 'nav.connect' as const, icon: PlugZap },
      { path: '/pet', key: 'nav.pet' as const, icon: PawPrint },
    ],
  },
]

type Appearance = 'light' | 'dark'

function initialAppearance(): Appearance {
  const saved = window.localStorage.getItem('petdeck.appearance')
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function Shell({ appearance, onToggleAppearance, demo, onToggleDemo }: {
  appearance: Appearance
  onToggleAppearance: () => void
  demo: boolean
  onToggleDemo: () => void
}) {
  const navigate = useNavigate()
  const { locale } = useLocale()
  const { progress: growth } = useGrowth()
  const { connState, savedAt, reconnect } = usePetData()
  const { tasks } = useRuntimeOverview(4000, !demo)
  const modeRef = useRef(!demo)
  useEffect(() => { track('shell', EVENT.appSessionStart, { mode: modeRef.current ? 'live' : 'mock' }) }, [])
  useEffect(() => {
    let active = true
    let unlisten: (() => void) | null = null
    listenForPanelNavigation((target) => {
      if (target.taskId) navigate('/tasks/' + target.taskId)
      else if (target.projectId || target.sessionId) navigate('/panel', { state: target })
      else navigate('/today')
    }).then((fn) => {
      if (active) unlisten = fn
      else fn()
    }).catch(() => {})
    return () => {
      active = false
      unlisten?.()
    }
  }, [navigate])

  const running = tasks.filter((task) => task.status === 'running').length
  const bridgeStartupError = bridgeConfigError()
  const offline = connState === 'offline' && !demo
  const degraded = connState !== 'live' && !demo
  const petStatus = degraded ? 'offline' : running > 0 ? 'running' : 'idle'
  const clock = savedAt !== null
    ? new Date(savedAt).toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })
    : null
  const connectionLabel = demo
    ? t('shell.demo')
    : connState === 'live'
      ? t('shell.live')
      : connState === 'reconnecting'
        ? t('shell.reconnecting')
        : clock ? t('shell.offlineAt', { time: clock }) : t('shell.offline')

  return (
    <div data-theme={appearance} data-style="soft" className="app-shell">
      <a className="app-skip-link" href="#main-content">{t('shell.skipToContent')}</a>
      <aside className="app-sidebar">
        <NavLink to="/today" className="app-brand" aria-label="PetDeck">
          <img src="/brand-mark.png" width="42" height="42" alt="" className="app-brand-mark" />
          <span className="app-brand-copy">
            <strong>PetDeck</strong>
            <span>{t('shell.tagline')}</span>
          </span>
        </NavLink>

        <nav className="app-nav" aria-label={t('shell.mainNav')}>
          {NAV_GROUPS.map((group) => (
            <div className="app-nav-group" key={group.key}>
              <span className="app-nav-group-label">{t(group.key)}</span>
              {group.items.map(({ path, key, icon: Icon }) => (
                <NavLink key={path} to={path} className={({ isActive }) => `app-nav-link${isActive ? ' is-active' : ''}`}>
                  <Icon aria-hidden="true" />
                  <span>{t(key)}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="app-sidebar-bottom">
          <div className="app-companion-summary">
            <PetAvatar status={petStatus} size={42} />
            <div>
              <strong>{t(growth.titleKey)}</strong>
              <span>{t('growth.level', { level: growth.level })}</span>
            </div>
            <span className={`app-presence${degraded ? ' is-offline' : ''}`} aria-label={connectionLabel} />
          </div>
          <div className="app-preferences" aria-label={t('shell.preferences')}>
            <button type="button" aria-pressed={demo} onClick={onToggleDemo} className="app-preference-button">
              <FlaskConical aria-hidden="true" />
              <span>{t('shell.demoMode')}</span>
              <span className="app-preference-state">{demo ? t('shell.on') : t('shell.off')}</span>
            </button>
            <button type="button" aria-label={t('shell.toggleAppearance')} aria-pressed={appearance === 'dark'} onClick={onToggleAppearance} className="app-preference-button">
              {appearance === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
              <span>{appearance === 'light' ? t('shell.darkMode') : t('shell.lightMode')}</span>
            </button>
          </div>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="app-topbar">
          <div className={`app-connection${offline ? ' is-offline' : connState === 'reconnecting' ? ' is-reconnecting' : ''}`} role="status">
            <Link2 aria-hidden="true" />
            <span>{connectionLabel}</span>
          </div>
          <div className="app-topbar-summary tabular-nums">
            <span>{t('common.running', { n: fmtCount(running) })}</span>
          </div>
        </header>

        {offline && (
          <div className="app-offline" role="alert">
            <div>
              <strong>{bridgeStartupError ? t('shell.bridgeStartupTitle') : t('shell.offlineTitle')}</strong>
              <span>{bridgeStartupError ?? (clock ? t('shell.offlineCached', { time: clock }) : t('shell.offlineNoBridge'))}</span>
            </div>
            <button type="button" onClick={reconnect}>{t('shell.reconnect')}</button>
          </div>
        )}

        <main id="main-content" className="app-content">
          <Suspense fallback={<div className="app-loading" role="status"><span /><span /><span /><p>{t('common.loading')}</p></div>}>
            <ThemedRoutes appearance={appearance} />
          </Suspense>
        </main>
      </div>
    </div>
  )
}

export function AppShell() {
  const [appearance, setAppearance] = useState<Appearance>(initialAppearance)
  const [demo, setDemo] = useState(getDemoPreference)
  useEffect(() => {
    window.localStorage.setItem('petdeck.appearance', appearance)
  }, [appearance])
  useEffect(() => { setDemoPreference(demo) }, [demo])
  return (
    <DataSourceProvider demo={demo}>
      <Shell
        appearance={appearance}
        onToggleAppearance={() => setAppearance((value) => (value === 'light' ? 'dark' : 'light'))}
        demo={demo}
        onToggleDemo={() => setDemo((value) => !value)}
      />
    </DataSourceProvider>
  )
}

export default AppShell
