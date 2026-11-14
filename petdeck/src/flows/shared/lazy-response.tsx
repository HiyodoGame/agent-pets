// =============================================
// LazyResponse — Response 的统一懒加载入口
// Spark 0.4.11 仅提供单文件 barrel 导出（dist/spark-design.es.js），React.lazy 无法把 Response
// 从 barrel chunk 中真正剥离；本组件收窄 props 面（只用 phase/finalMarkdown/thinkingIndicator）。
// 重型 barrel 只经路由懒加载 chunk（见 themed-routes.tsx）进入首屏后的下载，
// 轻量 shell 不 import sparkdesign，dist/index.html 不再 modulepreload 它。
// =============================================
import { lazy } from 'react'
import type { ComponentProps } from 'react'

type ResponseProps = ComponentProps<typeof import('sparkdesign').Response>

export interface LazyResponseProps {
  phase: ResponseProps['phase']
  finalMarkdown: ResponseProps['finalMarkdown']
  thinkingIndicator: ResponseProps['thinkingIndicator']
}

export const LazyResponse = lazy(() =>
  import('sparkdesign').then((m) => ({ default: m.Response })),
)
