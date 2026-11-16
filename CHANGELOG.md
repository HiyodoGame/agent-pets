# Changelog

本项目的全部重要变更记录于此。格式参考 Keep a Changelog；版本号遵循 SemVer（桌面端 0.x 阶段）。

## [Unreleased]

### 新增

- **Flow3 看板视图**：面板新增「列表 / 看板」切换，会话按状态分五列（运行中/等拍板/已完成/卡住/已归档），空列保留、点卡片直达线程；分组逻辑抽纯函数单测。
- **免打扰（DND）持久化**：Rust 侧写入应用配置目录 `dnd.json`，启动即恢复托盘勾选态与宠物 UI；前端挂载时经新 `get_dnd` 命令主动拉取（不依赖事件时序）。非 Tauri 环境安全 no-op。

- **三个新适配器（只读观察）**：Kimi Code CLI（`~/.kimi/sessions` context.jsonl）、zcode（`~/.zcode/cli/db` SQLite 只读副本，含 token 用量聚合）、DeepSeek Harness（`~/.dsh/sessions` 多帧 zstd 事件流）。格式依据用户机器实测勘察（`docs/agent-会话存储勘察.md`）；inject 语法均未真机验证，能力分级 observe-only，接力走剪贴板。Antigravity（Gemini 桌面）因会话库为无 schema protobuf 暂缓。
- **Cursor / Gemini CLI 适配器（只读观察）**：Cursor 读取 `~/.cursor/projects/*/agent-transcripts/*/*.jsonl`（真机 5 会话通过，子代理 transcript 跳过）；Gemini CLI 读取 `~/.gemini/tmp/*/chats/session-*.jsonl`（按 google-gemini/gemini-cli 官方源码格式实现；本机未安装，仅有合成测试）。两者 tier 均为 observe-only，注入走剪贴板。
- **用量/成本 MVP**：观察行携带 `tokens`（claude：jsonl usage 分项聚合；zcode：turn_usage 聚合；kimi：累计 token_count），面板会话头显示紧凑徽标（`↑in ↓out` / 总量）。claude 用量为观察窗口内聚合值，非会话全历史（UI 有标注）。
- **Claude 5h 用量窗口 + 重置倒计时**：按 jsonl 时间戳推算账户级 5 小时滚动窗口（窗口起点 / 预计重置点 / 剩余分钟 / 窗口内 token 聚合），面板会话头显示 `⏳ 约X后重置` 徽标。全部为推算值（UI 标注「估」，以官方 `/usage` 为准）；订阅配额百分比无法从本地文件得知，不做猜测。
- 读端点（`/api/agents`、`/api/sessions`、`/api/events`）与 inject 同一套访问纪律：Host 回环校验之外，带 Origin 必须在白名单内；配置 token 后读取同样要求鉴权（SSE 支持经 `?token=` 查询参数，因 EventSource 无法自定义 header）。修复本机其它进程可未授权读取会话标题与最后消息的问题。
- SSE 建连后立即发送注释行，客户端可即时确认连接成功。
- MIT LICENSE。
- Release 工作流：推送 `v*` tag 自动构建 NSIS 安装包并发布 GitHub Release。
- Desktop CI 补 `cargo fmt --check`（与 README 质量门一致）。
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

[Unreleased]: https://github.com/HiyodoGame/agent-pets/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/HiyodoGame/agent-pets/releases/tag/v0.1.0
