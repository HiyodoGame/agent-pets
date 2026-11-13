# PRD — Agent Pets / 方向 B「接力秘书」

- **生成时间**：2026-11-13T23:10:00+08:00
- **数据源**：frame / brief / flow-web / check / qa / edge / metric（7 个上游 Skill）+ spike 实证 + adapter 层代码
- **完整度**：strong（stories + sitemap 已补强，thin_sections 清零）
- **技术栈**：Vite + React + Spark Design(npm) + Tailwind CSS 4 + react-router-dom + lucide-react；本地 bridge = Node HTTP+SSE（端口 5199）
- **工程目录**：`petdeck/`（原型已可运行，`npm run dev` + `npm run bridge`）

---

## 1. Summary

Agent Pets 是一只住在 OPC 开发者余光里的桌面宠物：它聚合 5+ 异构 AI Agent 的「项目→任务→会话」状态，干别的事时扫一眼即知全局，Agent 干完/卡住/等拍板时才被「轻拍」通知；任务在 Agent 间接力时，宠物自动打包上下文+产物+指令，用户一键确认完成交接，不再当人肉消息总线。给谁：一人跑整条产品线的 OPC 开发者（锚点画像「阿哲」）。为什么是现在：Agent 专业化使「一人+一群 Agent」成标配，大厂桌宠验证形态但互不相通、接力层无人设防、Windows 相对空白。成功长什么样：60 天内人均日接力 ≥3 次（NSM），周活跃留存 ≥40%，种子 4 周 ≥100。集成可行性已由 1 周 spike 实证（observe 读 codex/claude jsonl、inject 走 opencode run 稳定），MVP GO。

---

## 2. Background & Problem

**问题（用户视角）**：阿哲用 10+ 个各有所长的 Agent 跑素材→开发→设计→宣传→维护整条线，自己是唯一项目经理。并行任务看不过来；每次接力都要手动序列化上下文、搬运产物/提示词；每个 Agent 各有桌宠但互不相通，桌面变宠物园却没人看得懂全局。

**当前 workaround**：切窗口盯进度、翻终端日志、等弹窗；Agent 间手动复制粘贴提示词/上下文/素材。不够好：注意力被切碎、接力摩擦全由人承担、无不打断的及时通知。

**为什么是现在**：Agent 专业化让「一人+一群 Agent」成 OPC 标配；大厂桌宠验证形态但各自为政；接力层无人设防；Windows 相对空白（frame.business_angle.why_now）。

**不解决什么**：不做全自动管线编排（方向 C）；不替代 Agent 本体对话界面；MVP 不做 macOS/鸿蒙、不做团队多人协作、不做无宠物纯面板（brief.out_of_scope）。

---

## 3. Personas

**Primary — 阿哲**
- 身份：OPC 开发者，一人跑整条产品线，5+ 异构 Agent、多项目并行。
- 情境：多项目多 Agent 后台执行，而他正在写文案/做设计/休息。
- JTBD：当多 Agent 并行时，想用余光掌握状态并便捷接力，从而不盯窗口也能让多项目推进；感到轻松、掌控、被陪伴。
- workaround：切窗口/翻日志/等弹窗；手动复制粘贴当人肉消息总线。
- 痛点：并行看不过来；接力手动搬运；宠物园无全局；无不打断通知；项目整体推进看不清。

**这个产品不为谁做**：不为「只要单 Agent 通知」或「要重编排控制台」的用户做（那是竞品红海/方向 C）。

---

## 4. Goals & Success Metrics

**产品目标（outcome-framed）**：让 OPC 开发者不盯窗口也能推进多项目，且 Agent 间接力零手动搬运。

**成功度量表**（来自 Metric 蓝图，替代 Brief 简版）：

| 指标 | 度量什么用户行为 | 目标值 | 时间窗 |
| --- | --- | --- | --- |
| 🌟 NSM 人均日接力次数 | relay_done/活跃用户/天 | ≥3 | 60 天 |
| D1 接力30秒·≤3步完成率 | 快速省力接力占比 | ≥80% | 30 天 |
| D2 3秒瞥见识别准确率 | 环境化壳可信度 | ≥90% | /test+30天 |
| D3 首Agent接入时长中位数 | 激活第一关 | ≤300s | 30 天 |
| D4 种子首周首次接力激活率 | growth 入口 | ≥50% | 4 周 |
|  Health inject失败率(full) | 接力可达性 | ≤10% | 持续 |

**Anti-metrics（不优化）**：通知打开率/推送频次（优化它会破坏 calm tech 信任）；接力次数刷量（配 Counter 降级/失败率≤20% 防误接力）；DND 开启率≤30% 防通知轰炸。

**关键假设**：⚠️ 集成可行性（状态可读/产物可拿/提示词可注入）——spike 已实证 CLI 类全链路、网页类仅观察侧；若网页注入长期受阻，MVP 接力降级剪贴板半自动（已设计）。

---

## 5. Value Proposition

**对阿哲**：终于可以「不盯窗口推进多项目、一键完成 Agent 接力」，而不必「切窗口+手动复制粘贴当人肉消息总线」，因为宠物把上下文/产物/指令自动打包、一键确认交接，且住在余光里有事才轻拍。

**竞争差异化**：UniPet/AgentBell/OC-Claw 等只盯 coding agent 做状态可视化（做对了「余光可见」），留下「接力无人押注、全生命周期 Agent 无人服务、项目视图缺失」三个空白；本产品填「接力+项目视图」，不拼可爱拼接力。ClawPanel 已支持 DeepSeek Harness/OpenCode 可作接入参考。

---

## 6. Solution & Feature Scope

> Feature Scope 由 4 flow + adapter/bridge + 埋点派生，并已用 /stories 补强（story-1..6 → S1..S4，见 `spark-output/stories/agent-pets.md`）。优先级 P0 先发。
>
> | Story | 映射 | 优先级 | 关键假设 |
> | --- | --- | --- | --- |
> | story-1 一键接力 | S1 | P0 | ⭐ |
> | story-2 余光全局 | S2 | P0 | — |
> | story-3 项目钻取 | S3 | P1 | — |
> | story-4 五分钟接入 | S4 | P1 | — |
> | story-5 轻拍不轰炸 | S2 | P0 | — |
> | story-6 断网不丢包 | S1 | P1 | ⭐ |

### S1 接力交接（Flow4）— P0 ⭐关键假设
**Job**：任务完成→把上下文/产物/指令交给下一个 Agent，零手动搬运。
**In Scope**：Trigger→交接预览(Drawer,可编辑上下文/指令/移除产物)→一键发送→SSE 追踪→完成+继续接力；能力分级降级剪贴板。
**Out of Scope**：全自动管线编排（C）。
**验收（GWT）**：
- Given 源会话 done，When 点「接力」，Then 打开预览且自动打包上下文+产物+指令（≤3 步）。
- Given 预览确认，When 发送，Then full-tier 走 inject、observe-only/manual 降级剪贴板并 toast；relay_inject_result 上报 mode/ok。
- Given 注入后，When SSE 推 task_complete，Then 追踪屏 liveStatus=done 进完成屏；turn_aborted 显示降级 alert。
- 边缘：inject 失败→重试/复制交接包；断网→交接包本地暂存不丢。
- 空态：无产物显示「无产物」。
**设计触点**：Flow4 4 屏；组件 Drawer/Response/FileCard/PromptSuggestions/EdgeAlert；状态 loading-submit/error-validation/offline-stash/rateLimit。
**资产**：`src/flows/flow-4-relay/flow4-relay.tsx`、`src/adapters/relay-tracking.ts`、`server/tiers.mjs`。

### S2 桌宠环境化主形态（Flow1）— P0
**Job**：余光掌握全局，有事才轻拍。
**In Scope**：四态+idle/offline 宠物 SVG；聚合计数(999+截断)；事件轻拍+免打扰分级；戳→展开项目；SSE 实时计数/事件。
**验收**：
- Given 后台 Agent 状态变化，When SSE sessions 推送，Then 计数不刷新页面实时变（已实证 1运行→1完成）。
- Given DND 开，When 非 decision 事件，Then 静默计入 inbox 不轻拍。
- 边缘：offline→重连 CTA；长标题 truncate。
**资产**：`src/flows/flow-1-pet-surface/flow1-pet-surface.tsx`、`src/flows/shared/edge-kit.tsx`。

### S3 项目/会话面板（Flow3）— P1
**Job**：项目→任务→会话三级钻取，指挥不离开宠物。
**In Scope**：Project Home(空态+CTA)→Sidebar 树→Session Thread(只读分级/追问/复制/重试)→rename/archive/delete+Undo；SSE 实时 base+overlay。
**验收**：
- Given live base 刷新，When 本地已 rename/delete，Then overlay 保留不覆盖（mergeSessions 单测 6 绿）。
- Given observe-only agent，When 打开线程，Then ChatInput disabled+「仅观察」Tag。
**资产**：`src/flows/flow-3-panel/flow3-panel.tsx`、`src/adapters/live-sessions.ts`。

### S4 Agent 接入（Flow2）— P1
**Job**：≤5 分钟接入首个 Agent。
**In Scope**：Cold Home→选类型→检测&授权(拒绝/限流/手动-c)→Success；能力分级标注。
**验收**：Given 检测失败，When 拒绝/限流，Then inline 错误+倒计时+手动降级；connect_started/success 上报。
**资产**：`src/flows/flow-2-connect-agent/flow2-connect-agent.tsx`。

### S5 本地 bridge + adapter 层 — P0（工程核心，spike 落地）
**In Scope**：`server/bridge.mjs`(HTTP+SSE 5199) + `server/adapters/{codex,claude,opencode,kimi}.mjs` + `tiers.mjs` + `bus.mjs`；前端 `src/adapters/`(bus/registry/bridge-client/mock-adapter/data.tsx)。observe 只读本地 jsonl/serve；inject headless CLI；live↔mock 自动回退。
**验收**：27/27 单测绿；bridge 起→实时、停→演示；SSE 驱动 Flow1/3/4。
**资产**：`server/bridge.mjs`、`server/adapters/*.mjs`、`server/tiers.mjs`、`server/bus.mjs`、`src/adapters/*`。

### S6 埋点（Metric 对齐）— P0
**In Scope**：13 事件（8 must/3 should/2 nice），本地优先只报行为不报内容。字段统一 {user,page,action,extra,ts}。
| event | 触发 | priority | 关联指标 |
| --- | --- | --- | --- |
| relay_started | flow4 Screen1 onOpen | must | D1+NSM |
| relay_preview_confirmed | flow4 Screen2 confirm | must | D1 |
| relay_inject_result | flow4 onSend+bridge /api/inject | must | Counter+Health |
| relay_done | flow4 Screen3 onDone | must | NSM+D4 |
| connect_started | flow2 Detect 入口 | must | D3 |
| connect_success | flow2 Success | must | D3+D4 |
| ambient_glance | flow1 Screen1 挂载 | must | D2 |
| app_session_start | Shell 挂载 | must | D4 |
| dnd_toggle / notification_suppressed | flow1 DND | should | Counter |
| relay_stopped | flow4 onStop | should | Counter |
| pet_poke / panel_drilldown | flow1/flow3 | nice | 路径分析 |

### 异常态清单（来自 Edge，15 屏 53 态，已实现 52/53）
- 空：Flow2 冷启动/Flow3 无会话/项目 Home（Empty+CTA）。
- 加载：Skeleton(项目/线程)/流式(检测/追踪)/loading-submit。
- 错误：inline(检测拒绝/限流/注入失败)/error-network 重连/回执失败。
- 边界：999+ 截断/长文本 truncate/0 计数。
- 权限：observe-only 只读/manual 剪贴板/full 双向。
- 离线：offline-no-network banner+暂存；**offline-partial-sync 延后（nice，唯一未实现）**。

### 未列入本版（Phase 2）
方向 C 全自动管线；macOS/鸿蒙；团队协作；网页 Agent 注入侧（先观察+剪贴板）。

---

## 7. Constraints & Risks

**技术约束**：单人全职、Windows 先行；Tauri2+React+TS 待确认（当前 Vite 原型）；不改 Agent 源码本地桥接；Spark Design 中途不切换。
**设计约束**：通知像轻拍（calm tech）；动效可关可减弱；接力≤3步30秒。
**数据&隐私**：会话内容本地优先红线待定；埋点只报行为事件不报内容；建议明确「代码/会话不上第三方服务器」。

**关键风险表**：

| 风险 | 可能性 | 影响 | 缓解 |
| --- | --- | --- | --- |
| 网页 Agent 注入受阻 | H | H | 观察+剪贴板半自动兜底（已设计），不承诺全适配 |
| codex exec 传输不稳 | M | M | inject 优先 opencode/claude，codex 降级剪贴板 |
| 隐私红线未定 | M | H | 本地优先架构先行，上线前确认 |
| 已识别未修 minor：stepper/语义heading/用户级动效开关 | L | M | 列入 Phase 2 修复（check 复跑剩 3 minor） |
| qa-11 index.css 字体硬编码 system-ui | L | L | 改 var(--font-ui) |

---

## 8. Release Approach

**推荐顺序**：S5(bridge)+S6(埋点最小集 relay_done/relay_inject_result) → S2(监控壳) → S1(半自动接力) → S3/S4。先发关键假设测试 Story S1（验证接力价值）。
**MVP**：S1+S2+S5+S6 = 环境化监控壳 + 半自动接力 + 本地 bridge + 最小埋点，能验证 NSM 与集成假设。
**Phase 2**：方向 C、macOS/鸿蒙、团队、网页注入侧、3 个 minor 修复、offline-partial-sync。
**上线考虑**：soft launch OPC 社群 beta（B1 种子≥100）；头 2 周 daily 盯 NSM/接力降级率/inject 失败率，稳定后 weekly；owner=创始人。失败信号：人均日接力<1 或降级率>40% → iteration。

---

> ✅ **薄弱章节已清零**：`stories`（/stories 补强，story-1..6）与 `sitemap`（/sitemap 补强，14 页/4 导航/4 flow，见 `spark-output/sitemap/agent-pets.md`）均已补。
> 路由清单（工程输入）：/pet[/event|/expand] · /connect[/select|/detect|/success] · /panel[/[projectId]/[sessionId]] · /relay[/preview|/track|/complete]。