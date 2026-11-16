import 'sparkdesign/style'       // ← 必须第一行：Spark 组件样式
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { I18nProvider } from './i18n/provider.tsx'
import { initializeBridgeConfig } from './desktop/bridge-config'
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

initializeBridgeConfig().catch(() => {}).then(renderApp)