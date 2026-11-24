// =============================================
// 入口路径归一化：生产包（Tauri）以 `http://tauri.localhost/index.html` 加载主窗口，
// 而 BrowserRouter 的路由表只有控制台页面。Path 为 /index.html 时
// 一条路由都匹配不上 —— 生产主窗口只剩侧栏，内容区整块空白（2026-11-20 生产包实测）。
// 在挂载 Router 之前把 /index.html 改写成 /，让 "/" → /today 的重定向正常生效。
// =============================================

/** 纯函数：生产入口路径 -> 应替换成的路径；无需替换时返回 null。 */
export function entryRedirect(pathname: string, search = '', hash = ''): string | null {
  if (!/\/index\.html$/i.test(pathname)) return null
  const dir = pathname.slice(0, -'/index.html'.length)
  const base = dir === '' ? '/' : dir.endsWith('/') ? dir : `${dir}/`
  return `${base}${search}${hash}`
}

/** 在 React 挂载前调用：把 /index.html 归一化成目录根，避免路由全不匹配。 */
export function normalizeEntryLocation(win: Pick<Window, 'location' | 'history'> = window): boolean {
  const next = entryRedirect(win.location.pathname, win.location.search, win.location.hash)
  if (next === null) return false
  win.history.replaceState(win.history.state, '', next)
  return true
}
