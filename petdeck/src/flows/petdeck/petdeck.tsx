// =============================================
// PetDeck — 入口：ErrorBoundary 兜底 + 静态轻量 App Shell
// Edge 补全：ErrorBoundary 提供重新加载出口
// 首屏性能：AppShell 为原生轻量实现（不依赖 sparkdesign JS barrel），header/离线横幅/
// 导航随入口 chunk 立即渲染；Spark 重组件（Mermaid/KaTeX/Response）只在路由 chunk
// 懒加载（见 themed-routes.tsx），首屏不再下载它们。
// =============================================
import { Component } from 'react'
import type { ReactNode } from 'react'
import { AppShell } from './app-shell'
import { t } from '../../i18n/index.ts'

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="m-4 rounded-md bg-error-bg p-8 text-error">
          <p className="mb-2 font-semibold">{t('error.title')}</p>
          <pre className="whitespace-pre-wrap text-sm">{String(this.state.error)}</pre>
          <button
            type="button"
            className="mt-4 rounded-md border border-border-secondary bg-bg-container px-3 py-1 text-sm text-text transition-colors hover:bg-bg-elevated"
            onClick={() => window.location.reload()}
          >
            {t('error.reload')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function PetDeckApp() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  )
}

export default PetDeckApp
