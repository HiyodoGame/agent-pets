# Project Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 按优先级修复 2026-11-14 项目审查确认的问题，使真实模式不再伪报成功，接力内容完整，状态与通知可信，并补齐可靠性、质量门、性能和文档缺口。

**Architecture:** 保留现有 React flows → adapters → 本地 bridge → CLI adapters 分层，不引入新运行期依赖。先在纯模块和 HTTP 边界补回归测试，再做最小实现；共享契约集中在 `src/adapters/types.ts`，交接包统一由同一纯函数生成，真实/演示路径继续由显式 `demo` 开关分隔。

**Tech Stack:** React 19、TypeScript、Vite 8、Node 24 `node:test`、Oxlint、Spark Design 0.4.11。

**Spec:** `docs/superpowers/specs/2026-11-14-phase3-hardening-design.md` 与 2026-11-14 全项目审查结论（当前会话中已逐项确认）。

## Global Constraints

- UI 文案中文；沿用 Spark Design 组件与 token。
- 隐私红线：会话内容与缓存全部本地，埋点只报行为；日志不得记录 `context`、`instruction`、token 或完整 stderr。
- bridge 仅绑定 `127.0.0.1`；保留 Host/Origin/Content-Type/body/concurrency 防护。
- 无新增运行期依赖；不为 UI 测试引入 Playwright/jsdom。
- 真实 CLI 兼容性不能用有副作用的注入来验证；只使用 fake spawn/fetch/adapter 和临时目录。
- 不自动提交、不推送、不修改归档和生成物。
- 每处行为修复先写失败测试；每个任务运行相关测试，最终运行完整 CI 等价检查。

## Review Focus

- 非 2xx、空响应和非 JSON 响应：不得显示注入成功，由 Task 1 的 fake-fetch 测试覆盖。
- 无 token、无 Origin、IPv6 Host 和非默认前端端口：安全失败或显式配置，由 Task 2 的 HTTP 集成测试覆盖。
- 事件列表超过 50 条、DND 开关切换及工具结果 jsonl：通知不丢失、状态不误报，由 Task 5 的纯测试覆盖。
- 慢轮询、重复 tick、同步 spawn 异常和超大 CLI 输出：不得重叠、拒绝 Promise 或无限增长，由 Task 6 的 deterministic 测试覆盖。
- bridge 断连与 tier 降级必须可区分，演示事件不得混入真实漏斗，由 Task 7 的事件形状测试覆盖。

---

### Task 1: 修复注入响应契约与假成功

**Files:**
- Modify: `petdeck/src/adapters/types.ts`
- Modify: `petdeck/src/adapters/bridge-client.ts`
- Modify: `petdeck/src/flows/flow-4-relay/flow4-relay.tsx`
- Test: `petdeck/src/adapters/logic.test.ts` 或新建同目录 focused test

**Interfaces:**
- `InjectDecision` 增加可选 `fallbackReason?: 'tier' | 'cli' | 'bridge-error'`；HTTP 非 2xx 和 `{ok:false}` 必须抛出带 `status` 的错误，不得进入成功分支。
- Flow4 仅在 `mode === 'inject'` 时进入 `injected`，`clipboard` 进入 `manual`，其余进入 `failed`。

- [x] 写 fake-fetch 测试：401、429、500、非 JSON、网络错误均 reject；合法 `{ok:true,mode:'inject'}` 原样返回。
- [x] 运行测试并确认旧实现因直接 `r.json()` 而失败。
- [x] 实现响应检查和 Flow4 的显式分支，移除 `mode: undefined` 被当作 injected 的路径。
- [x] 运行相关测试并确认通过。

### Task 2: 默认鉴权安全失败与 bridge 兼容修复

**Files:**
- Modify: `petdeck/server/bridge.mjs`
- Modify: `petdeck/src/adapters/bridge-client.ts`
- Test: `petdeck/server/bridge-security.test.mjs`

**Interfaces:**
- `main()` 在 `PETDECK_BRIDGE_TOKEN` 为空时打印明确配置错误并返回而不监听；测试用 `createApp` 可继续显式注入 security。
- `main()` 支持逗号分隔的 `PETDECK_BRIDGE_ORIGINS`，合并默认 Origin。
- `hostAllowed` 正确规范化 `[::1]:5199` 为 `::1`。
- `/api/health` 返回不含秘密的 `authRequired: boolean`。

- [x] 写测试：无 Origin 且 token 错误/缺失不得调用 adapter；IPv6 Host 被接受；非法 Origin 仍被拒绝。
- [x] 运行测试确认 IPv6 与无 token 策略失败。
- [x] 实现强制启动 token、Origin 配置、Host 规范化及 health 标志；保留 createApp 的测试注入能力。
- [x] 运行 bridge-security 全套测试并确认通过。

### Task 3: 让接入、追问和恢复 CTA 与真实行为一致

**Files:**
- Modify: `petdeck/src/flows/flow-2-connect-agent/flow2-connect-agent.tsx`
- Modify: `petdeck/src/flows/flow-3-panel/flow3-panel.tsx`
- Modify: `petdeck/src/flows/petdeck/petdeck.tsx`
- Modify: `petdeck/src/flows/shared/ui-logic.ts`
- Test: `petdeck/src/flows/shared/ui-logic.test.ts`

**Interfaces:**
- 新增纯决策函数决定 live connect 是否可成功：输入 `{healthy:boolean, agentIds:string[], selectedId:string}`，只有健康且目标存在才成功。
- Flow2 live 目录取自 `usePetData().agents`，连接结果由 `connState`/真实健康检查决定；所有模拟按钮和定时器仅在 mock 模式出现。
- Flow3 `followUp` 调用 `inject({from:'petdeck',to:s.agentId,context:<当前会话文本>,instruction:text})`，仅在 `mode:'inject'` 时提示已发送；clipboard 显示可复制的真实交接内容，失败提示失败。
- 空状态 CTA 导航 `/connect`；倒计时文案改为“X 秒后可重试”，不再承诺自动重试。

- [x] 写纯测试：bridge 离线、目标不存在、目标存在三种连接结果；follow-up 的 inject/clipboard/error 文案决策。
- [x] 运行测试确认旧逻辑没有真实决策而失败。
- [x] 实现 live/mock 分流、真实追问和 CTA 导航，保持现有 UI 结构。
- [x] 运行相关测试并确认通过。

### Task 4: 补全接力包并明确不可关联状态

**Files:**
- Modify: `petdeck/src/adapters/types.ts`
- Modify: `petdeck/src/adapters/registry.ts`
- Modify: `petdeck/server/tiers.mjs`
- Modify: `petdeck/server/bridge.mjs`
- Modify: `petdeck/server/adapters/codex.mjs`
- Modify: `petdeck/server/adapters/claude.mjs`
- Modify: `petdeck/server/adapters/opencode.mjs`
- Modify: `petdeck/src/flows/flow-4-relay/flow4-relay.tsx`
- Test: `petdeck/server/pure.test.mjs`、`petdeck/src/adapters/logic.test.ts`、`petdeck/src/adapters/relay-tracking.test.ts`

**Interfaces:**
- `InjectPayload.artifacts?: string[]`；Flow4 发送产物显示名，bridge 原样传给 `injectDecision` 和 adapter prompt。
- 前后端使用同一字段顺序与中文标签：`from/context/instruction/artifacts`；offline clipboard 不得丢 `from` 或 artifacts。
- 没有 `sessionID` 的注入从开始即显示“无法自动确认”，不得伪装为可自动完成；不猜测 Codex/Claude 的未知输出格式。

- [x] 写测试：包含 from/context/instruction/artifacts 的线上与离线包完全等价；空 sessionID 显示 unconfirmed。
- [x] 运行测试确认旧 offline 包丢字段、无 ID 初始状态为 sending。
- [x] 实现统一 builder、payload 透传、adapter prompt 和明确 unconfirmed UI。
- [x] 运行 relay/tiers/registry/tracking 测试并确认通过。

### Task 5: 修复状态生命周期、DND 收件箱和 50 条事件上限

**Files:**
- Modify: `petdeck/server/adapters/claude.mjs`
- Modify: `petdeck/server/bridge.mjs`
- Modify: `petdeck/src/adapters/data.tsx`
- Modify: `petdeck/src/flows/flow-1-pet-surface/flow1-pet-surface.tsx`
- Modify: `petdeck/src/flows/shared/ui-logic.ts`
- Test: `petdeck/server/pure.test.mjs`、`petdeck/src/flows/shared/ui-logic.test.ts`

**Interfaces:**
- `parseClaude` 仅对 string content 的真实用户输入设置 waiting；tool_result 不覆盖状态；lastMessage 只取 assistant 文本。
- `unknown`/未识别状态映射为非 active 的 waiting 展示；waiting 状态变化产生 `type:'decision',petType:'decision'`。
- 新增 `newEventsAfter(events, watermark)` 纯函数，以事件 timestamp/id 水位线识别新事件，不依赖 capped length。
- DND 保存 suppressed event 队列；计数标签可点击并查看/逐条关闭，关闭 DND 后至少提供批量补提示，不得静默丢弃。

- [x] 写 Claude tool_result/user/assistant fixture、unknown 映射和 50→50 新事件测试。
- [x] 运行测试确认旧实现失败。
- [x] 实现状态解析、decision 事件、水位线和可操作收件箱；修复 running Tag 的无效三元表达式。
- [x] 运行相关测试并确认通过。

### Task 6: 轮询、请求与 CLI 生命周期可靠性

**Files:**
- Modify: `petdeck/server/bridge.mjs`
- Modify: `petdeck/server/adapters/shared.mjs`
- Modify: `petdeck/server/adapters/exec.mjs`
- Modify: `petdeck/src/adapters/data.tsx`
- Modify: `petdeck/src/adapters/bridge-client.ts`
- Test: `petdeck/server/exec.test.mjs`、`petdeck/server/bridge-security.test.mjs`、`petdeck/src/adapters/connection.test.ts` 或 focused test

**Interfaces:**
- 服务端和客户端均在上一轮未完成时跳过新 tick；`fetchAgents`/`fetchSessions` 使用 3 秒 abort timeout。
- `runCli` 对同步 spawn 异常 resolve `{status:-1,error:true}`；stdout/stderr 各保留最后 1 MiB；不声称能跨平台 kill 未验证的进程树。
- 超大请求体被拒绝时 drain/destroy request；`lastStatus` 只保留本轮及 last-good 中仍存在的 session key。
- 文件扫描保持有界读取；在不改变 ENOENT/故障语义的前提下，以目录 mtime 缓存未变化子树，避免每 5 秒完整递归。

- [x] 写同步 throw、输出截断、慢 poll 不重叠、客户端请求超时和目录缓存失效测试。
- [x] 运行测试确认旧实现至少同步 throw 与防重入失败。
- [x] 实现最小防护，保持公开返回形状。
- [x] 运行相关测试并确认通过。

### Task 7: 故障日志与可信遥测

**Files:**
- Modify: `petdeck/server/bridge.mjs`
- Modify: `petdeck/server/adapters/exec.mjs`
- Modify: `petdeck/src/adapters/registry.ts`
- Modify: `petdeck/src/flows/flow-4-relay/flow4-relay.tsx`
- Modify: `petdeck/src/flows/flow-2-connect-agent/flow2-connect-agent.tsx`
- Modify: `petdeck/src/telemetry/core.ts`
- Test: `petdeck/src/telemetry/core.test.ts`、`petdeck/src/adapters/logic.test.ts`

**Interfaces:**
- `InjectDecision.fallbackReason` 区分 `tier`、`cli`、`bridge-error`；relay failure 有显式 `ok:false,reason`。
- relay/connect 漏斗事件均带 `live:boolean`；日志只记录 adapter id、error name/code 和脱敏单行摘要。
- telemetry persistence 采用短 debounce，并在 `pagehide` flush；不把会话内容写入日志或事件。

- [x] 写 fallbackReason、demo/live 标记和 debounce/flush 测试。
- [x] 运行测试确认旧事件形状和同步写策略失败。
- [x] 实现日志与事件调整，更新过期注释。
- [x] 运行 telemetry/registry 测试并确认通过。

### Task 8: 补齐质量门和 data 同步回归测试

**Files:**
- Create: `petdeck/src/adapters/data-sync.ts`
- Create: `petdeck/src/adapters/data-sync.test.ts`
- Modify: `petdeck/src/adapters/data.tsx`
- Modify: `petdeck/tsconfig.json`
- Modify: `petdeck/package.json`
- Modify: `.github/workflows/ci.yml`（仅在命令需要同步时）

**Interfaces:**
- `data-sync.ts` 提供纯函数：`shouldCommitHttp(revBefore,revNow)`、`shouldLoadSnapshot(hasMemory,cacheShown)`、`observedToSessions(rows,now)`；`data.tsx` 使用这些函数。
- `tsconfig` 设置 `allowImportingTsExtensions:true` 且不再排除测试。
- `npm test` 使用 Node 24 glob 自动发现 `server/**/*.test.mjs` 和 `src/**/*.test.ts`；lint script 与 CI 同为 `oxlint src server`。

- [x] 写 stale HTTP、SSE 先提交、冷启动缓存、内存 last-good 优先和 unknown 映射测试。
- [x] 先运行新测试并确认旧耦合实现无法通过。
- [x] 抽纯函数、接入 provider、修正 tsconfig/scripts。
- [x] 运行 typecheck、完整 test、lint，确认所有测试确实被发现。

### Task 9: 首屏性能与剩余 UX/可访问性修复

**Files:**
- Create: `petdeck/src/flows/shared/lazy-response.tsx`
- Modify: `petdeck/src/flows/flow-3-panel/flow3-panel.tsx`
- Modify: `petdeck/src/flows/flow-4-relay/flow4-relay.tsx`
- Modify: `petdeck/src/flows/flow-2-connect-agent/flow2-connect-agent.tsx`
- Modify: `petdeck/src/flows/petdeck/petdeck.tsx`
- Modify: `petdeck/index.html`
- Modify: `petdeck/vite.config.js`（仅在分包配置确有必要时）

**Interfaces:**
- `LazyResponse` 通过 `React.lazy` 隔离 `Response`，只暴露当前使用的 `phase/finalMarkdown/thinkingIndicator` props。
- 首屏 HTML 不再 modulepreload 含 Mermaid/KaTeX 的共享大 chunk；若 Spark barrel 阻止进一步拆分，以首屏不再预加载为验收，不声称减少总下载量。
- 仅最后一条 assistant 消息可显示 streaming；新表单错误在 blur/submit 后出现；状态点有可读文本；页面 `lang="zh-CN"`；ErrorBoundary 提供重新加载按钮。

- [x] 写可抽离的 streaming/validation 纯逻辑回归测试。
- [x] 记录修改前 build 的入口 preload 和 chunk 体积。
- [x] 实现 lazy Response 与 UX 修复，不新增依赖、不深导入不存在的 Spark 子路径。
- [x] build 并检查 `dist/index.html`，确认重型 chunk 不再由入口预加载。

### Task 10: 文档与最终端到端验证

**Files:**
- Modify: `petdeck/README.md`
- Create: `petdeck/.env.example`（只含占位值，不含秘密）
- Modify: `docs/superpowers/plans/2026-11-13-phase2-offline-partial-sync.md`（仅加已归档状态头）
- Modify: `docs/superpowers/specs/2026-11-14-phase3-hardening-design.md`（如行为契约变化需同步）

- [x] README 写明 Node 24、CLI 前置条件、两个启动命令、demo 开关、token 配对、Origins 和 opencode 4096 默认端口。
- [x] `.env.example` 使用空值/占位符；package.json 声明与 CI 一致的 Node 版本。
- [x] 运行 `npm run typecheck`、`npm test`、`npm run lint`、`npm run build`。
- [x] 用 fake adapter/HTTP 测试走通成功、401、429、CLI 失败、clipboard、DND 和断连路径；启动 UI 检查 `/connect`、`/panel`、`/relay`，但不向真实 Agent 注入。
- [x] 检查 `git status`，删除本次产生且不需要的文件，确认没有秘密或生成物被纳入修改。

## Final Verification

全部任务完成后，逐项对照审查清单标记已修复或说明阻塞原因；任何真实 CLI 未实测项必须明确保留为“未验证”，不得以 fake 测试替代真机兼容性结论。
