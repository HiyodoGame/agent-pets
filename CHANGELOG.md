# Changelog

本项目的全部重要变更记录于此。格式参考 Keep a Changelog；版本号遵循 SemVer（桌面端 0.x 阶段）。

## [Unreleased]

## [0.1.3] — 2026-11-20

### 变更

- 落地新的设计与交互规范：三层设计令牌、侧边任务导航、会话/接力/连接/伙伴页面与统一亮暗色外观；演示和外观偏好在主窗口与桌宠之间同步。
- 桌宠快捷面板、事件卡、菜单和设置改为不遮挡宠物的侧挂布局，主窗口打开时主动避让；会话追问使用真实注入与串行发送，接力返回编辑后不会被旧请求结果覆盖，重复确认也不会发起第二次注入。
- 真实会话按 cwd、来源项目标识和远程主机归组；会话首页与桌宠快捷面板优先展示等待处理和运行中的任务，列表、事件卡与看板统一显示 Agent、项目、任务和状态文字。

### 修复

- 恢复桌宠系统通知生产接线，新增进入 running 时的 started 提示；所有生命周期事件仅在状态转变时触发一次并携带 Agent、项目和任务，unknown 不误报，bridge 冷启动只播种存量状态且 SSE 历史回放不启动刷屏，通知点击使用正确的本地/远程复合会话 ID。
- 修复历史完成会话持续控制宠物状态，以及项目看板混入其他项目会话、显示内部 Agent ID 的问题。
- 真实回复显式禁用 Spark Response 的库内置照片整理演示轮次，不再把无关模拟内容拼入会话；事件到达时按统一 overlay 优先级替换快捷面板，不再互相重叠。
- 自定义浅色令牌现在同时覆盖 Spark 的嵌套浅色容器，不再回退为薄荷绿；桌宠状态胶囊订阅语言上下文，切换语言时与设置面板同步刷新。
- 桌宠尺寸与位置更新合并为一个 Rust 命令，避免展开/收起时两次前端 IPC 之间的跳帧；真实 Agent 授权成功后保存本机接入记录，连接首页直接展示已接入 Agent 与同步状态，不再误回“还没有连接任何 Agent”。
- 真实会话使用清理 Markdown 后的可读短标题，正文明确标记“最新回复”；轮询观察快照按完成态渲染，不再伪装成流式输出。
- Windows 后台 bridge 不再弹出控制台窗口，托盘语言更新移至主线程执行。
- 撤回 v0.1.2 新增的手工依赖分组：该方案会导致生产包启动异常（`E is not a function`），但它与主窗口空白不是同一问题（空白根因见下条路由匹配）；生产包改回自动分包，保留 Seti 字体清理与 Lottie light player。
- **修复生产安装包主窗口整块空白**：Tauri 以 `http://tauri.localhost/index.html` 载入主窗口，而 `src/App.jsx` 的无 basename `BrowserRouter` 只认 `/`、`/panel` 等路径，控制台反复 `No routes matched location "/index.html"`，内容区只剩 shell。新增 `src/desktop/entry-path.ts`（`entryRedirect` / `normalizeEntryLocation`），在 `src/main.jsx` 挂载 Router 前把 `/index.html` 归一化为 `/` 并保留 query/hash；`tauri:build` 产出的真实安装包经 WebView2 远程调试确认主窗口渲染出完整面板（`tauri.localhost/panel`）。
- 修正上一行的验证口径：2026-11-19「本地真实生产窗口已验证恢复」很可能跑的是加载 `devUrl` 的开发态二进制——单独 `cargo build --release` 不嵌入 `dist`（产物约 14 MB，会连 `http://localhost:5183`），只有 `npm run tauri:build` 才是生产包（约 18 MB）。该命令在缺少 `TAURI_SIGNING_PRIVATE_KEY` 时会于签名步骤退出 1，但 exe 与 NSIS 安装包已经产出，不能据此判定构建失败。
- 修复适配器对真实 CLI 数据的解析：Codex 的 cwd 只读首行 `session_meta`、标题改用 `item_completed/UserMessage`（`headLines` 改为按行读满，避免 100 KB 单行 AGENTS.md 占满 64 KB 窗口）；DeepSeek Harness 的 `session` 事件是扁平的；Kimi Code 改读 `~/.kimi-code` v2 库（`session_index.jsonl` + `state.json` + `agents/main/wire.jsonl`）并按 `archived` 过滤；Cursor 去掉 `<timestamp>` 前言并从有损 slug 还原可读项目名；Claude 优先用 `ai-title`；zcode 的沙箱工作目录不再被当成用户项目。
- 修复 opencode 在 Windows 上整源不可用：`exec.mjs` 按 `PATHEXT` 解析可执行文件（`.exe`/`.com` 直连 spawn，`.cmd`/`.bat` 走 `cmd.exe /d /s /c`），并兼容 v2 payload 的 `location.directory`。
- 修复项目分组噪声：新增 `server/project-root.mjs`，子目录会话归并到最近的 git 工作树根，系统临时目录单独成「临时目录」桶（临时目录内的真 git 检出仍按项目处理）；bridge 在发布前归一化，SSE 推送键包含分组变化。真实生产包面板从 13 个项目降为 12 个，`CatWanted` 的父子目录会话合并为 6 条。
- 修复 bridge 启动失败时前端只显示「当前离线」的问题：`bridgeConfigError()` 保留 Rust 侧错误，离线横幅显示「本地会话服务未启动」与具体原因（如未检测到 Node.js），不再让用户自行猜测。

## [0.1.2] — 2026-11-17

### 文档与维护

- 新增仓库根 README、文档索引与统一路线图；Phase 1–3 和 2026-11-16 调研报告明确标为历史资料，不再与当前计划并行。
- 修正开发 README、用户手册与皮肤文档中的相对链接、适配器覆盖、opencode v2、Claude `--verbose`、蓝噗 `default` 集成方式及复现材料边界。
- 新增 `npm run docs:check` 并接入 CI，校验 Markdown 本地链接和 package/Cargo/Tauri 版本一致性。
- 接力离线与限流的中英文提示改为如实说明手动重试及非持久化行为，不再承诺离线交接包自动暂存。

### 性能

- 生产构建使用 `lottie-web` light player，消除未使用的 direct `eval`；通过 PostCSS 移除 Spark 全局样式中未使用且缺少资源的 Seti 字体声明。
- 按 Spark、Lottie、KaTeX、Markdown 拆分稳定依赖缓存包，主路由相关文件均低于 500 kB；按需 Mermaid 的单一预构建模块仍保留 662 kB 提示，未通过提高阈值隐藏。

### 修复

- 演示接力的模拟限流倒计时结束后现在会显示「重试发送」，点击后继续完成流程，不再停留在无操作的中间态。

## [0.1.1] — 2026-11-17

### 新增

- **跨机器会话（SSH observe）**：桥接进程通过 `PETDECK_REMOTE_HOSTS` 以只读 SSH 探针观察远程主机的 Claude Code / Codex 会话；远程会话带 `@host` 标记并强制禁用接力/注入。探针自包含、仅读文件，SSH 使用 `BatchMode` + `StrictHostKeyChecking=yes`，主机名白名单校验。
- **宠物成长（使用驱动）**：完成 Agent 任务/接力 +10 XP、抚摸 +2 XP（30 秒冷却）；8 个等级与称号、连续活跃天数、进度条与完成任务数；`localStorage` 持久化 + `BroadcastChannel` 跨窗口同步。不引入饥饿或衰减惩罚。
- **中英双语界面（i18n）**：新增 zh/en 消息字典、系统语言检测与本地持久化；宠物设置内可切换语言，应用壳、四个流程、宠物快捷面板、通知、更新提示及 Rust 托盘菜单即时跟随。演示模式的样例会话/事件内容仍为中文示例数据。
- **自动更新**：接入 Tauri updater + GitHub Releases `latest.json`；宠物设置内提供「检查更新 / 安装并重启」，打开设置自动检查但安装必须由用户确认；更新包使用 Minisign 签名校验。发布工作流改用 `tauri-action` 生成签名更新包与 `latest.json`。密钥与发布说明见 `docs/自动更新与签名.md`。
- **Flow3 看板视图**：面板新增「列表 / 看板」切换，会话按状态分五列（运行中/等拍板/已完成/卡住/已归档），空列保留、点卡片直达线程；分组逻辑抽纯函数单测。
- **免打扰（DND）持久化**：Rust 侧写入应用配置目录 `dnd.json`，启动即恢复托盘勾选态与宠物 UI；前端挂载时经新 `get_dnd` 命令主动拉取（不依赖事件时序）。非 Tauri 环境安全 no-op。

- **三个新适配器（只读观察）**：Kimi Code CLI（`~/.kimi/sessions` context.jsonl）、zcode（`~/.zcode/cli/db` SQLite 只读副本，含 token 用量聚合）、DeepSeek Harness（`~/.dsh/sessions` 多帧 zstd 事件流）。格式依据用户机器实测勘察（`docs/agent-会话存储勘察.md`）；inject 语法均未真机验证，能力分级 observe-only，接力走剪贴板。Antigravity（Gemini 桌面）因会话库为无 schema protobuf 暂缓。
- **Cursor / Gemini CLI 适配器（只读观察）**：Cursor 读取 `~/.cursor/projects/*/agent-transcripts/*/*.jsonl`（真机 5 会话通过，子代理 transcript 跳过）；Gemini CLI 读取 `~/.gemini/tmp/*/chats/session-*.jsonl`（按 google-gemini/gemini-cli 官方源码格式实现；本机未安装，仅有合成测试）。两者 tier 均为 observe-only，注入走剪贴板。
- **用量/成本 MVP**：观察行携带 `tokens`（claude：jsonl usage 分项聚合；zcode：turn_usage 聚合；kimi：累计 token_count），面板会话头显示紧凑徽标（`↑in ↓out` / 总量）。claude 用量为观察窗口内聚合值，非会话全历史（UI 有标注）。
- **Claude 5h 用量窗口 + 重置倒计时**：按 jsonl 时间戳推算账户级 5 小时滚动窗口（窗口起点 / 预计重置点 / 剩余分钟 / 窗口内 token 聚合），面板会话头显示 `⏳ 约X后重置` 徽标。全部为推算值（UI 标注「估」，以官方 `/usage` 为准）；订阅配额百分比无法从本地文件得知，不做猜测。
- 读端点（`/api/agents`、`/api/sessions`、`/api/events`）与 inject 同一套访问纪律：Host 回环校验之外，带 Origin 必须在白名单内；配置 token 后读取同样要求鉴权（SSE 支持经 `?token=` 查询参数，因 EventSource 无法自定义 header）。修复本机其它进程可未授权读取会话标题与最后消息的问题。
- SSE 建连后立即发送注释行，客户端可即时确认连接成功。
- MIT LICENSE。
- Release 工作流：推送 `v*` tag 自动构建并签名 NSIS 安装包，生成 updater `latest.json` 后发布 GitHub Release。
- Desktop CI 补 `cargo fmt --check`（与 README 质量门一致）。
- **版本 0.1.1**：`package.json` / `Cargo.toml` / `tauri.conf.json` 统一为 0.1.1，作为首个内置 updater 的版本；v0.1.0 用户需手动安装一次。
- 2026-11-16 全面检查与竞品调研报告（`docs/2026-11-16-全面检查与竞品调研报告.md`）。

### 修复

- **opencode v2 运行中状态**：桥接进程订阅 v2 SSE `/api/event` 的 `session.execution.started/succeeded/failed/interrupted` 事件，实时把运行中会话映射为 `running`；仅当 watcher 未连接时才退回 mtime 新鲜度兜底，避免把陈旧会话误报为运行中。
- **opencode v2 观察**：v2 后台服务改为动态端口 + CLI 管理密码，旧 `/session` 路径返回 Web UI HTML。观察改用 `opencode api session.list`（CLI 自动发现与鉴权），保留 v1 HTTP 4096 回退；状态按 `outcome`（succeeded/interrupted/failed）映射，无终态信号时保持 unknown。
- **Claude 注入**：Claude CLI 2.1+ 要求 `--print --output-format stream-json` 必须显式带 `--verbose`，否则直接 exit 1。补上参数，并把 stream-json 解析为最终 assistant 文本（不再把原始 JSON 当作接力响应）。
- **dsh 多帧会话读取**：Node 24 的 zstd 解压在一次性喂入拼接帧时只解压第一帧，导致 `session.v4.jsonl.zstd` 仅读到 `session` 头、会话被整体跳过。改为按 zstd magic 逐帧解压（损坏前缀与伪边界容错），并补回归测试。

### 变更

- **宠物皮肤整体替换**：新皮肤「蓝噗」（原创灰紫色毛绒小怪物，11 个动作 / 65 帧 / 256×256 RGBA，逐帧边界与循环接缝经 validation.json 校验）顶替原「薄荷皮皮」。内部皮肤键保持 `default`——skin-loader 回退链、既有用户设置与新 art 无缝衔接；皮肤系统仍支持多皮肤扩展。设计过程与校验记录见 `petdeck/docs/pet-design/lilac-nubo/`（大体积源文件与历史 zip 留存本机，不入库）。
- **交接包文本合一**：前端 `handoffPackageText` 直接引用 `server/tiers.mjs` 的 `handoffPackage`（单一来源 + 同名导出），删除逐字镜像与 parity 兜底测试；`src/adapters/bus.ts` 死代码删除（全 src 无消费者）。
- **真机注入实测（2026-11-16 Windows）**：codex 0.157.1 / claude 2.1.312 / opencode 2.0.27 的 observe 与 inject 结果已回填 `docs/真机实测矩阵.md`；codex 首次受本机 CC Switch 模型路由阻塞，修正配置后注入成功。
- **新增适配器真机 observe（2026-11-16）**：dsh / kimi-code / zcode 在本机分别返回 4 / 5 / 5 条会话，状态与 token 字段符合预期；dsh 多帧 zstd 修复经真实会话验证。三者 inject 仍为 observe-only 剪贴板。
- **verify-local 覆盖全部适配器**：自动检查新增 Kimi Code / zcode / DeepSeek Harness / Cursor / Gemini CLI 行；opencode 检查改用适配器自身的 v2 观察，不再手探已失效的 `/session`。
- **Cursor inject 复核（2026-11-17）**：Cursor 3.29.15 未提供可用的 headless 子命令（`agent`/`desktop` 未接线，安装目录无独立 `cursor-agent`），注入保持未验证，继续 observe-only + 剪贴板。
- 仓库换行统一 LF（`.gitattributes` `eol=lf`），消除 CRLF 幻影 diff。

## [0.1.0] — 2026-11-14

首个桌面 Beta（Windows）。方向 B「接力秘书」：聚合本地 AI Agent 状态的桌宠 + Agent 间接力。

### 新增

- **桌宠环境化壳**：透明无边框置顶小窗常驻桌面；四态 + idle/offline；聚合计数；事件轻拍 + 免打扰分级收件箱；拖拽记忆位置；托盘（显示宠物/打开面板/免打扰/开机启动/退出）；桌面通知。
- **接力交接（Flow4）**：任务完成→交接预览（上下文/指令/产物可编辑）→一键发送→SSE 追踪→完成；能力分级 full / observe-only / manual + 剪贴板降级；attempt 归属追踪与「无法自动确认」状态。
- **项目/会话面板（Flow3）**：项目→任务→会话三级钻取，只读会话 + 追问注入；rename/archive/delete + Undo；stale 新鲜度标记。
- **Agent 接入（Flow2）**：≤5 分钟接入向导，检测/授权/降级分流。
- **本地 bridge**：Node HTTP+SSE（仅绑定 127.0.0.1）；适配器 codex / claude / opencode / kimi（观察）；`pollOnce` 新鲜度权威（stale 保留 + 部分同步语义）；inject 无 shell 异步执行、参数注入防护、超时终止。
- **安全**：强制启动 token、Host/Origin 白名单、Content-Type 强制、请求体上限、注入并发上限；日志只记结构化元数据（不回显内容）。
- **离线一致性**：连接状态机（live/reconnecting/offline）、快照缓存、SSE 重放去重、断连保留内存 last-good。
- **埋点**：13 事件本地优先，只报行为不报内容，递归脱敏 + 损坏自恢复。
- Tauri 2 桌面壳：bridge 子进程托管（崩溃重启）、Node ≥24 检测、随机 token + 动态端口、NSIS 打包（含 WebView2 bootstrapper）。
- 质量：约 290 单测、oxlint 0 告警、tsc --noEmit、GitHub Actions CI。

[Unreleased]: https://github.com/HiyodoGame/agent-pets/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/HiyodoGame/agent-pets/releases/tag/v0.1.3
[0.1.2]: https://github.com/HiyodoGame/agent-pets/releases/tag/v0.1.2
[0.1.1]: https://github.com/HiyodoGame/agent-pets/releases/tag/v0.1.1
[0.1.0]: https://github.com/HiyodoGame/agent-pets/releases/tag/v0.1.0
