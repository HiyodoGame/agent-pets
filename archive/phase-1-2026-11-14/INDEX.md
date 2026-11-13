# Archive — Agent Pets · Phase 1（2026-11-14）

方向 B「接力秘书」。设计链 11/27 闭环；原型+adapter+SSE+埋点已实现并验证；未上线。

## 归档包

| 文件 | 内容 | 恢复 |
| --- | --- | --- |
| spark-output-phase1.tar.gz | 设计链全部 context/报告/dashboard（12 context） | `tar -xzf` 到项目根 |
| petdeck-src-phase1.tar.gz | 应用源码 src/server/配置（不含 node_modules/dist） | `tar -xzf` 后 `npm i && npm run dev` + `npm run bridge` |
| spike-phase1.tar.gz | spike PoC 脚本（observe/relay，不含 tmp-relay） | `tar -xzf` |

## 设计链产出（spark-output/）

- context/：frame brief flow-web check qa edge stories sitemap prd metric retro（11）+ _session-state
- 报告：brief/agent-pets.html · check/ · qa/agent-pets-验收报告.md · edge/ · stories/ · sitemap/ · prd/agent-pets.md · metric/ · retro/ · spike/agent-pets-spike.md
- dashboard.html（11/27 进度面板）

## 代码产出（petdeck/）

- 4 flow + App Shell（Spark Design）：flow-1 桌宠 / flow-2 接入 / flow-3 面板 / flow-4 接力
- adapter 层：server/bridge.mjs(HTTP+SSE 5199) + server/adapters/{codex,claude,opencode,kimi} + tiers/bus；src/adapters/(bus/registry/bridge-client/data/live-sessions/relay-tracking)
- 埋点：src/telemetry/(core+index)，13 事件本地优先、匿名 uid、脱敏
- a11y/UX：edge-kit(Stepper/ClampText/EdgeAlert/fmtCount) + ui-logic(stepperState/resolveMotionEnabled)

## 验证快照

- 测试 39/39 绿（server 12 + adapters 15 + telemetry 6 + ui-logic 6）；`vite build` 干净；oxlint 0 error
- QA 复跑 0 blocker/0 major/0 minor，9 维全过，Check 6/6
- 浏览器实证：live/mock 双模式、SSE 实时（Flow1 计数/Flow3 列表/Flow4 追踪）、埋点无内容泄漏、动效开关生效

## 关键决策与指标

- NSM 人均日接力≥3（60天）；MVP=S1接力+S2桌宠+S5bridge+S6埋点
- 能力分级 full/observe-only/manual + 剪贴板降级；spike 实证 CLI 全链路、网页仅观察
- 隐私红线：会话内容本地优先，埋点只报行为

## Phase 2 待办

- ~~offline-partial-sync~~ ✅ 完成（2026-11-14，commits d0b1ce3..5acb767）：bridge pollOnce 新鲜度权威（stale 保留 + sources 健康）+ 前端连接状态机/快照缓存/事件去重 + demo 显式化 + UI 四态/stale 标记；68 测试、E2E 5 条实证 + 埋点隐私核查通过；spec/plan 见 docs/superpowers/。
- sitemap 逻辑路由映射真实 route；网页 Agent 注入侧；macOS/鸿蒙；团队
- 上线后 4-8 周跑 /retro 对照 NSM/留存/付费（当前 inconclusive）
- Phase 3 健壮性补强包（Phase 2 最终审查 triage=carry，均非阻塞）：bridge `poll().catch` 兜底；fetchAgents/fetchSessions 加 timeout+catch；loadSnapshot 行形状守卫；lastStatus 随会话消失裁剪；Flow4 stale 提示文案区分「源不可达」与「离线缓存」；Shell 离线 footer 计数与 spec §3.3 对齐（弱化缓存计数）；考虑引入 tsc --noEmit 质量门。

## 收尾（2026-11-14 闭环）

- **版本管理**：git init + 4 commits（c60f73b 原型 → a499567 CI → b71c09c/d1cd838 lint 清零）；tag `phase-1`。
- **远程**：私有仓库 https://github.com/HiyodoGame/agent-pets （master 受保护，必需检查 `ci`，禁 force-push/删除）。
- **CI**：GitHub Actions Node24（npm test 39 + build + oxlint），全绿。
- **质量门**：oxlint 0 warnings/0 errors；QA 0/0/0；Check 6/6；39/39 测试。
- **结论**：Phase 1 完整收尾。设计链 11/27 闭环、PRD strong、可运行原型+adapter+SSE+埋点、spike 实证接力可行。