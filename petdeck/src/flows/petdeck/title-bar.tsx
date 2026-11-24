import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Copy, Minus, Square, X } from 'lucide-react'
import {
  closeMainWindow, isMainWindowMaximized, minimizeMainWindow,
  onMainWindowResized, toggleMainWindowMaximize, windowControlsSupported,
} from '../../desktop/window-controls.ts'
import { t } from '../../i18n/index.ts'

export function TitleBar({ connectionLabel, connectionState, running }: {
  connectionLabel: string
  connectionState: 'live' | 'reconnecting' | 'offline'
  running: string
}) {
  const supported = windowControlsSupported()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (!supported) return
    let disposed = false
    let unlisten: (() => void) | null = null
    const sync = () => {
      void isMainWindowMaximized().then((value) => { if (!disposed) setMaximized(value) })
    }
    sync()
    void onMainWindowResized(sync).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    })
    return () => { disposed = true; unlisten?.() }
  }, [supported])

  return (
    <header className="app-titlebar">
      <NavLink to="/today" className="app-titlebar-brand" aria-label="PetDeck">
        <img src="/brand-mark.png" width="24" height="24" alt="" />
        <strong>PetDeck</strong>
      </NavLink>
      <div className="app-titlebar-drag" data-tauri-drag-region aria-hidden="true" />
      <div className="app-connection" data-state={connectionState} role="status">
        <span className="app-connection-dot" aria-hidden="true" />
        <span>{connectionLabel}</span>
      </div>
      <span className="app-titlebar-running tabular-nums">{running}</span>
      {supported ? (
        <div className="window-controls" role="group" aria-label={t('window.controls')}>
          <button type="button" className="window-control" aria-label={t('window.minimize')} title={t('window.minimize')} onClick={() => void minimizeMainWindow()}>
            <Minus aria-hidden="true" />
          </button>
          <button
            type="button"
            className="window-control"
            aria-label={maximized ? t('window.restore') : t('window.maximize')}
            title={maximized ? t('window.restore') : t('window.maximize')}
            onClick={() => void toggleMainWindowMaximize()}
          >
            {maximized ? <Copy aria-hidden="true" /> : <Square aria-hidden="true" />}
          </button>
          <button type="button" className="window-control close" aria-label={t('window.closeToTray')} title={t('window.closeToTray')} onClick={() => void closeMainWindow()}>
            <X aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </header>
  )
}
