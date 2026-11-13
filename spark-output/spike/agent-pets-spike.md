# Spike 技术调研 — Agent Pets 集成可行性

- **生成时间**：2026-11-13
- **目标**：验证 frame.critical_assumption「状态可读 / 产物可拿 / 提示词可注入」在三类 Agent 形态上的可行性
- **方法**：本机只读侦察 + 只读 PoC 适配器（spike/poc-observe.mjs）+ 官方文档调研
- **结论**：✅ **GO** —— 每类形态至少 observe 可行；CLI 类与 kimi hosted-agents 可达 FULL 接力闭环

## 能力矩阵（3 类 × 3 能力）

| 形态 / 代表 | 状态可读 (observe) | 产物可拿 (artifacts) | 提示词可注入 (inject) | 分级 |
| --- | --- | --- | --- | --- |
| **CLI**：codex / claude / opencode / kimi-code | ✅ 实证 PoC：codex rollout jsonl `task_complete`+`last_agent_message`；claude projects jsonl；hooks 实时（codex SessionStart/Stop、claude settings hooks+URL POST）；opencode serve SSE | ✅ rollout tool/patch 事件 + `generated_images/`；claude jsonl tool_use(Write/Edit)+cwd；opencode API diff | ✅ codex exec / app-server；claude `-p --output-format stream-json` / Agent SDK；opencode `serve` session.prompt / SDK；kimi `--prompt/--session` | **FULL** |
| **桌面应用**：Qoder Desktop / zcode / kimi-code-desktop | ✅/🟡 本地会话存储（~/.qoder、~/.zcode）+ CLI 共享 runtime；Qoder CLI SDK sessions/hooks | 🟡 本地文件 / 会话存储 | 🟡 Qoder CLI SDK（TS/Python）可程序化；Desktop 本体无公开 API → 经 CLI/SDK 或手动 | **observe-only ~ FULL(经SDK)** |
| **网页服务**：kimi work / MiniMaxDesign / 小艺work / GrokBot | ✅ kimi hosted-agents REST API（会话/消息）+ WebBridge 扩展；MiniMax 开放平台；其余 DOM 扩展/手动 | ✅ hosted-agents 产物下载 API；其余 DOM/手动 | ✅ kimi hosted-agents send message / kha CLI；其余扩展 DOM(脆弱)/手动剪贴板 | **kimi FULL；其余 observe-only/manual** |

## 实证证据（本机只读）

- 已装 CLI：`codex`、`claude`、`opencode`、`kimi`(kimi-code)；目录 `~/.codex ~/.claude ~/.opencode ~/.kimi ~/.qoder ~/.zcode`
- codex 会话：`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`，event_msg payload 含 `task_complete`(带 last_agent_message)/`task_started`/`turn_aborted`/`token_count`
- claude 会话：`~/.claude/projects/<slug>/<session>.jsonl`（type user/assistant、cwd、gitBranch）；`settings.json` 支持 hooks
- opencode：`~/.local/share/opencode/opencode.db`(SQLite)+log/；`opencode serve` headless HTTP OpenAPI + SSE + JS/TS SDK
- **PoC 输出**（poc-observe.mjs 实跑）：codex → `{status:"done", lastMessage:"已继续推进…", turn:"01a1d091…"}`；claude → `{status:"waiting", cwd:"…od-conn-test…"}`

## 成功标准核对

- 每类形态至少 observe 可行：✅（CLI 实证 / 桌面本地存储 / 网页 API+扩展）
- 至少 1 类跑通完整接力闭环（读状态→拿产物→注入下一个）：✅ CLI（codex/claude/opencode）+ kimi hosted-agents
- → **MVP GO**：先接本机已装 CLI（FULL）+ kimi work（API FULL）；桌面/其余网页 observe-only/manual 降级

## 推荐集成架构

- **Adapter 层**：每 Agent 一个 adapter 实现 `{ observe(), artifacts(), inject() }`；统一 `AgentEvent` 总线（status/artifact/decision）
- **能力分级自动探测**：full / observe-only / manual；inject 不可用时降级剪贴板交接包（UI 已实现）
- **本地优先**：adapter 跑在 Tauri sidecar（node/rust），只读本地会话存储，不上传代码；hooks 仅本地回调
- **实时性**：hooks/serve-SSE 优先，jsonl tail 轮询兜底（schema 非稳定契约，需版本适配层）

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| hooks 仍 beta、事件名变动 | 版本适配层 + jsonl tail 兜底 |
| jsonl/DB schema 非公开契约 | 适配器隔离 + 快照测试 + 降级 observe-only |
| 网页 DOM 注入脆弱 | 优先 hosted-agents API；DOM 仅 observe；inject 降级剪贴板 |
| 隐私/权限 | local-first、只读、授权可撤销（UI 已有拒绝授权态） |
| API 限流 | 退避倒计时（UI 已有限流态） |

## 下一步

1. **inject PoC**：codex `exec resume` / opencode `session.prompt` 实跑一次「读状态→拿产物→注入下一个」闭环
2. 把 adapter 接口落成 `src/adapters/`（Tauri sidecar），替换 mock-data
3. 上线前跑 Metric + 用研（Retro inconclusive 假设）

## Inject PoC（跨 Agent 接力闭环实证）

**可复现脚本**：`spike/poc-relay.mjs`（observe → package → inject，只读 observe + 极简无工具 inject，临时沙箱目录）

实跑结果（codex → opencode）：
- **observe**：codex rollout `rollout-2026-11-12T17-21-20-….jsonl` → `task_complete.last_agent_message`（真实产物：订单票据 AES-256-GCM 加密存储 + 密钥轮换 + 确认发货重试）
- **inject**：`opencode run --format json`（prompt 经 stdin）→ 新会话 `ses_e2b0262b3ffe…`
- **response**：「Agent A 在 CM-01 阶段完成了订单票据的 AES-256-GCM 加密存储（绑定 App、环境与订单号，含密钥轮换基础能力）和确认发货重试的本地基础实现，尚未达到真实收费条件。」→ **上下文跨 Agent 正确传递并被理解** ✅

**发现**：
- `opencode run` headless 注入稳定（json 输出含 sessionID/part.text）✅
- `codex exec` 在本机出现 WebSocket reconnect / workspace routing discovery 超时（inject 传输不稳）；observe(jsonl) 不受影响 → inject 优先 opencode/claude，codex 走 app-server 或重试
- observe 需「newest-first 扫描到首个含 task_complete 的会话」，避免取到空的新会话

**结论升级**：inject 侧实证通过 → 关键假设「状态可读/产物可拿/提示词可注入」**全链路验证成立**，MVP GO 确认。

## Adapter 层落地（代码实现，TDD）

spike 验证后把 adapter 层落成可运行代码，替换 mock-data 让桌宠接真实 Agent。

**架构**（浏览器不能读 fs/起 CLI，故分两层）：
- `petdeck/server/bridge.mjs`：本地 HTTP+SSE bridge（默认 **5199**，CORS 5173）。`/api/health` `/api/agents` `/api/sessions` `/api/events`(SSE) `/api/inject`。5s 轮询 observe，状态变化经统一 bus 推 SSE。
- `petdeck/server/adapters/{codex,claude,opencode,kimi}.mjs`：各实现 `{observe, inject}` + 纯解析函数（`parseRollout`/`parseClaude`/`parseRun`），observe 只读本机 jsonl/serve，inject 走 headless CLI。
- `petdeck/server/tiers.mjs`：能力分级 `full/observe-only/manual` + `injectDecision`（非 full 或失败 → 剪贴板交接包）。
- `petdeck/server/bus.mjs`：统一 AgentEvent bus（normalize + replay + fan-out）+ `toPetEventType` 映射。
- `petdeck/src/adapters/`：前端 `bus.ts`/`registry.ts`（纯逻辑，单测）+ `bridge-client.ts`(fetch/EventSource) + `mock-adapter.ts`(回退) + `data.tsx`(`DataSourceProvider`/`usePetData`，live↔mock 自动切换) + `types.ts`(AgentAdapter 契约)。

**能力分级（spike 实证）**：opencode/claude/codex=full（codex inject 传输不稳→自动降级剪贴板）；kimi=observe-only（hosted，无本地 jsonl，inject 恒降级）。

**接线**：Shell/Flow1/Flow3/Flow4 改消费 `usePetData()`（标识符不变，仅来源切换）；Flow4 `onSend` 调真实 `inject`。Flow2 目录仍为设计期 mock。bridge 离线自动回退 mock，原型不白屏。

**验证**：`node --test` 21/21 绿（server 12 + 前端 bus/registry 3 + live-sessions merge 6）；`vite build` 干净；浏览器双模式实证——bridge 起→「实时」+「实时 Agent」10 真实会话（5 codex+5 claude）；bridge 停→「演示」+ mock 三项目。oxlint 0 error（warning 均为存量）。

**Flow3 实时刷新（SSE）**：bridge poll 检测到会话集合变化即 `bus.emit({type:'sessions'})` 推 SSE；`data.tsx` 订阅后即时 `setData(sessions)`；Flow3 改 `mergeSessions(base, overlays, deleted)` 派生——base 随 SSE 实时刷新，本地 rename/archive/delete/followUp 以 overlay 保留。端到端实证：fixture observe home 下不刷新页面，会话随 SSE 从「运行中」→「已完成」。observe 目录可用 `PETDECK_OBSERVE_HOME` 覆盖（测试/fixture 用）。

**Flow1/Flow4 同通道（SSE）**：`data.tsx` 另暴露 `agentEvents`（raw bus 事件，newest-first）；SSE pet-event 分支即时 `setData(events)` 让 Flow1 事件流/环境化计数实时（计数本就随 sessions 实时）。Flow4 `deriveTracking(agentEvents, targetAgentId)`（relay-tracking.ts，6 单测）派生 sending/running/done/stuck 驱动 Screen3_Tracking，live 模式 done 才进完成屏、stuck 显示降级；mock 保留模拟计时。live 模式 Flow4 目标下拉来自真实 adapters（codex/claude/opencode=full、kimi=observe-only）。bridge 不再把 task_started 误标为 pet「done」。验证：27/27 测试、build 干净、fixture 下 Flow1 计数不刷新页面 1运行→1完成。

**运行**：`npm run bridge`（5199）+ `npm run dev`（5173）。注意 5174 已被另一项目占用，bridge 改用 5199。

## Sources

- [Codex Hooks](https://learn.chatgpt.com/docs/hooks) · [Codex hooks reference](https://agenticcontrolplane.com/blog/codex-cli-hooks-reference) · [Codex session JSONL](https://stackoverflow.com/questions/79734991/how-to-save-full-codex-cli-exec-session-output-as-json)
- [opencode Server](https://opencode.ai/docs/server/) · [opencode SDK](https://opencode.ai/docs/sdk/) · [Programmatic OpenCode control](https://gist.github.com/Aaronontheweb/276765cea4d1f538e24ec79149372ae1)
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/structured-outputs) · [Claude hooks extensibility](https://github.com/Windy3f3f3f3f/how-claude-code-works/blob/main/en/docs/06-hooks-extensibility.md) · [Claude CLI quickstart](https://platform.claude.com/docs/en/cli-sdks-libraries/cli/quickstart)
- [Qoder CLI SDK Tools](http://docs.qoder.com/cli/sdk/tools) · [Qoder SDK References](http://docs.qoder.com/cli/sdk/references) · [Qoder CLI](https://qoder.com/en/cli)
- [Kimi 开放平台 hosted-agents quickstart](https://platform.kimi.com/docs/hosted-agents/quickstart) · [Kimi 功能总览](https://platform.kimi.com/docs/features) · [Kimi WebBridge 解析](https://www.v2code.ai/post/kimi-webbridge-analysis)