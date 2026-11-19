import 'sparkdesign/style'       // ← 必须第一行：Spark 组件样式
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { I18nProvider } from './i18n/provider.tsx'
import { initializeBridgeConfig } from './desktop/bridge-config'
import { normalizeEntryLocation } from './desktop/entry-path.ts'
import './index.css'             // ← 最后：Tailwind + Spark token 语义类（确保 utility 优先级）

function renderApp() {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  )
}

// 生产包由 /index.html 加载：先归一化成 /，否则 BrowserRouter 一条路由都匹配不上（内容区空白）。
normalizeEntryLocation()

initializeBridgeConfig().catch(() => {}).then(renderApp)