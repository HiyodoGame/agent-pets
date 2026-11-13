# Sitemap — Agent Pets

- **生成时间**：2026-11-14T00:10:00+08:00
- **平台**：web（Windows 先行，Vite/Tauri webview）
- **数据源**：brief + stories（6）+ flow-web（已实现 4 路由）
- **页面总数**：14 · **最大深度**：3 · **主导航**：4

## 主导航

- 🐾 桌宠 — /pet（paw-print）
- 🔌 接入 — /connect（plug）
- 📋 面板 — /panel（layout-dashboard）
- 🔁 接力 — /relay（arrow-right-left）

## 站点树

```
/
├── /pet (桌宠)
│   ├── /pet            环境化常驻 [story-2,5]
│   ├── /pet/event      事件轻拍 [story-2,5]
│   └── /pet/expand     戳展开 [story-2,3]
├── /connect (接入)
│   ├── /connect        冷启动 [story-4]
│   ├── /connect/select 选类型 [story-4]
│   ├── /connect/detect 检测授权 [story-4]
│   └── /connect/success 成功 [story-4]
├── /panel (面板)
│   ├── /panel                       项目概览 [story-3]
│   ├── /panel/[projectId]           会话树 [story-3]
│   └── /panel/[projectId]/[sessionId] 线程 [story-3]
└── /relay (接力)
    ├── /relay          发起 [story-1]
    ├── /relay/preview  预览 [story-1]
    ├── /relay/track    追踪 [story-1,6]
    └── /relay/complete 完成 [story-1]
```

## 页面清单

| ID | Route | Label | Access | 关联 Story |
| --- | --- | --- | --- | --- |
| page-pet-ambient | /pet | 环境化常驻 | auth | 2,5 |
| page-pet-event | /pet/event | 事件轻拍 | auth | 2,5 |
| page-pet-expand | /pet/expand | 戳展开 | auth | 2,3 |
| page-connect-home | /connect | 冷启动 | auth | 4 |
| page-connect-select | /connect/select | 选类型 | auth | 4 |
| page-connect-detect | /connect/detect | 检测授权 | auth | 4 |
| page-connect-success | /connect/success | 成功 | auth | 4 |
| page-panel-home | /panel | 项目概览 | auth | 3 |
| page-panel-shell | /panel/[projectId] | 会话树 | auth | 3 |
| page-panel-thread | /panel/[projectId]/[sessionId] | 线程 | auth | 3 |
| page-relay-trigger | /relay | 发起 | auth | 1 |
| page-relay-preview | /relay/preview | 预览 | auth | 1 |
| page-relay-track | /relay/track | 追踪 | auth | 1,6 |
| page-relay-complete | /relay/complete | 完成 | auth | 1 |

## 关键 Flow

- **Relay Handoff**：/relay → /relay/preview → /relay/track → /relay/complete
- **Ambient Glance**：/pet → /pet/event → /pet/expand
- **Connect First Agent**：/connect → select → detect → success
- **Project Drilldown**：/panel → /panel/[projectId] → /panel/[projectId]/[sessionId]

> 注：子屏当前以 screen state 实现，路由表为逻辑 IA；工程可逐步映射为真实 route（PRD Section 6/8 消费）。