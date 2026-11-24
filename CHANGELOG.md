# Changelog

本项目的全部重要变更记录于此。格式参考 Keep a Changelog；版本号遵循 SemVer（桌面端 0.x 阶段）。

## [Unreleased]

### 新增

- **密钥加固**：经理 API 密钥改用 Windows DPAPI（CurrentUser）加密后存入本机 SQLite，密文带 `dpapi:v1:` 前缀；启动时自动把历史明文迁移为密文，内存只缓存明文，保存模型/温度等未触及密钥的字段不会重新加密。DPAPI 不可用时降级明文并在设置页运行状态卡标注「未加密」；密文无法解密时保留原值、提示重填且不影响启动。未引入 koffi 等原生依赖，调用系统 PowerShell 完成加解密，日志与诊断包不输出密钥。
- **内置 Node 运行时**：安装包自带官方未修改的 Node.js **v24.18.0** Windows x64 运行时（MIT），干净机器不再需要预装 Node。`scripts/fetch-node.mjs` 按官方 `SHASUMS256.txt` 校验后解出 `node.exe`，版本与哈希记录在 `node-runtime.json`；`LICENSE` 与 `THIRD_PARTY_LICENSES` 全文随包，设置页「运行状态」新增许可入口。bridge 启动优先使用内置运行时，release 绝不回退 PATH；内置运行时缺失、无法启动或版本过低时提示「安装可能不完整/已损坏」而非要求安装 Node，开发态才回退系统 Node。CI 缓存并校验下载产物、构建后核对 `node.exe`。NSIS 安装包 29.66 MB（v0.2.0 为 7.8 MB，增量 22.2 MB），安装后主占用 107.0 MB。
- **只读观察**：新增 `GET /api/observe/sessions` 聚合 Cursor / DSH / ZCode / Gemini / Kimi 等 observe-only 会话（标题、项目、来源、最近活动、状态 running/idle/error）与 `GET /api/observe/sessions/:agent/:session/transcript` 只读转录；今日页新增「观察中的会话」区（最多 5 条 + 查看全部，抽屉展示最近 20 条脱敏转录），Agents 页观察型卡片显示最近写入、解析成功/失败计数与最近错误。观察会话不进任务板、验收、合并与汇报统计；隐藏推理与工具调用不进入转录。
- **本地文件日志**：bridge 以结构化 JSON 行写入 `<数据目录>/logs/petdeck-YYYY-MM-DD.log`，按天与 5 MB 轮转、保留 7 天；记录启动/关闭、任务生命周期（发起、完成、失败、停止、验收、打回、合并、清理、决策）与进程退出码，写入前按键名脱敏，不含提示词全文、密钥与 token。生产包另把 sidecar 的 stdout/stderr 落到 `%APPDATA%/PetDeck/logs/sidecar-*.log`，「Node 未安装」「脚本缺失」「端口占用」等启动失败也有记录。
- **运行状态与诊断包**：设置页新增「运行状态」卡（版本、Node、端口、数据库版本、运行时长、数据与日志目录可复制、Agent 探测表、重启本地服务）与「导出诊断包」（自写 ZIP，白名单字段 + 密钥掩码，含环境信息与最近 7 天日志）；新增 `GET /api/runtime/status` 深探测与 `POST /api/diagnostics/export`，托盘增加「本地服务」状态项与「重启本地服务」。
- **性能与可访问性**：任务页事件流改为 2000 条内存窗口 + 服务端 `?before=` 分页，SSE 事件按 50 ms 合批并 `memo` 事件行，向历史滚动时保持视口位置、离开底部时新事件进入缓冲并提示条数；任务板与产物网格启用 `contain`，事件行 `content-visibility: auto`。新增焦点陷阱（新建项目/新建任务）、任务状态 `aria-live` 播报与减弱动效覆盖桌宠及面板动画；补《无障碍检查表》与 `scripts/seed-events.mjs` 体检脚本。
- **更新流程**：设置页新增「关于与更新」卡：当前版本、检查更新、可用版本与更新说明、下载进度条、「安装并重启」，并在有任务运行时提醒（不强制）。更新失败按网络不可达 / 签名校验失败 / 磁盘写入失败给出可读文案与重试入口，原始错误同时写入 sidecar 日志（`update.*`）。
- **发布自检**：新增 `npm run release:check`，发布后拉取真实 `latest.json` 校验结构、签名长度与版本号一致性；`docs/自动更新与签名.md` 补齐 tag 前检查、tag 后核对、回滚与失败分类四段清单。
- **崩溃恢复**：本地服务崩溃或被杀后重启，运行中的任务与 run 如实标记中断（`bridge-restarted`）并保留会话，任务页与今日页显示中断横幅，可一键「继续（同一会话）」或放弃本次；未捕获异常写 `crash-<时间>.json`（错误栈、最近 50 行日志、活跃任务）供下次启动提示。数据库启动时 `PRAGMA quick_check` 校验，损坏则整库备份为 `.bak-<时间>` 并重建，设置页显示备份路径。修复重启后排队任务永久卡住：`queued` 不再被改写，启动即按并发上限自动派发；启动后延迟清理「已摘注册只剩目录」的残留 worktree。
- **存储占用与清理**：设置页新增「存储」卡显示日志、运行记录、产物、数据库占用与最早记录，并可清理超过 30 天未更新的运行记录（`GET /api/storage`、`POST /api/storage/cleanup`；任务与事件索引保留在数据库中）。

### 修复

- **跨平台与崩溃恢复修复**：观察会话与 Kimi Code v2 的项目名在 Windows 路径被 POSIX 进程读取时仍取最后一级目录；Windows CLI shim 解析在非 Windows 主机（CI）上也能还原 `%dp0%` 路径；同一毫秒内的两次崩溃报告不再互相覆盖；崩溃恢复启动清理残留 worktree 改读 `projects.path`（此前读取不存在的 `project_path`，导致残留目录不会被清理）；判断 worktree 是否仍被 git 注册前先解析真实路径，兼容 Windows 8.3 短路径。
- **真机验收修复**：诊断包脱敏不再把 `secrets`、`apiKeySet` 这类元数据键当成凭据（只按 `token/password/apikey/privatekey/secret` 等后缀与 `authorization/credential` 判断，对象不再取 `[object Object]` 末四位）；内置 Node 缺失时 `bridge_config` 不再自动反复重启，只有用户显式「重启本地服务」才重试；本地服务重启/重连后广播配置变更，数据层丢弃指向旧端口/旧 token 的 EventSource 并立即重订阅；设置页运行状态卡在重启后按 400 ms 重试 10 次，不再停在「Failed to fetch」；生产包通过 `PETDECK_APP_VERSION` 注入版本，`/api/health` 与 bridge 日志不再出现 `version:null`；「最早一份」存储文案不再显示字面量 `{when}`。
- **W8 从零安装验收**：按用户手册用最新 NSIS（31,109,728 B）在隔离目录静默安装、独立 `APPDATA`/`LOCALAPPDATA` 首启，走通登记项目→新建任务→opencode 运行→验收→合并→清理→生成日报→导出诊断包；任务 21 s、产物 w8.txt 21 B、合并 commit `2a3f086`、清理后只剩 master，诊断包 6 文件且无密钥/prompt。期间修复界面反复离线：bridge 每 5 s 的观察扫描会同步占住事件循环 1.5–3.0 s，与 health tick 相位锁定，`fetchHealth` 超时由 1.5 s 放宽到 5 s，重建后 32 s 内 health 全部 200、顶栏保持「实时」。
- **密钥与交付保护**：自定义经理端点不再隐式继承并外发 `OPENAI_API_KEY`；Git worktree 查询失败不再被当作未注册目录递归删除；自动提交失败会阻断验收并保留交付，含未提交文件的任务不能验收、合并或清理；merge 与 reject/重新授权/放弃合并串行化；工件路径增加 realpath 边界，阻止符号链接或 junction 指向工作区外。
- **运行时与 bridge 可靠性**：过期决策不再接受迟到答案并启动新 run；最新 run 已完成但进程退出前崩溃的任务恢复为待验收而非已停止；Windows 退出/重启清理完整进程树，POSIX supervisor 使用进程组终止；bridge 正确关闭 SSE、轮询和 OpenCode watcher，任务 SSE 支持多页追赶、`Last-Event-ID` 与慢消费者上限；非对象 JSON 返回 400，CLI 输出跨 chunk UTF-8 不再乱码；远程 SSH 按主机保留 stale，远程会话重新进入只读观察面板。生产真机还发现 OpenCode 在 Windows 会信任继承的 `PWD` 而非仅使用 spawn `cwd`：从仓库目录启动 PetDeck 时工具可能写回该仓库；supervisor 现在统一同步 `PWD/OLDPWD` 到任务 worktree，并用真实 CLI 只读 `pwd` 探针验证修复前后目录。
- **前端状态与交互**：任务详情、历史分页和轮询增加 task 代次与防重入，旧响应不能串入新任务；DND 同批多个拍板请求逐条补提示；当前注入契约不支持原会话 resume 时明确显示为「新接力」而不污染原线程；合并 preview 未就绪不可授权，任务切换隔离 token/preview；创建中的对话框不能伪装取消；面板隐藏/归档选择本地持久化，复制失败、清理确认与输入标签补齐。
- **桌面与发布链路**：发布版 bridge 脚本缺失在 spawn 前明确报错，Windows verbatim UNC 路径正确转换，启动增加健康就绪检查，生产 WebView 启用严格 CSP；Release 改为版本门禁→本地 CLI 构建签名→安装包内容与 Minisign 验签→本地 manifest 校验→上传草稿，人工核对后才公开发布，Desktop CI 增加真实 NSIS 静默安装内容检查。
- **依赖与首屏性能**：通过 lockfile override 将 `diff` / `katex` 提升到安全修补版本；控制台改为路由级按需加载，避免手工 vendor 分组造成的生产初始化回归。


### 文档

- **用户手册重写**：`docs/用户手册.md` 从旧「会话/接力」为中心改为按控制台流程组织（安装与内置 Node、接入 Agent、今日页与经理、任务板与任务页、验收/打回/合并/清理、汇报、设置、桌宠与托盘、故障排查、数据与卸载），每节给出可照做步骤与预期结果，并附五分钟走通清单。
- **M5 真机验收矩阵**：`docs/真机实测矩阵.md` 新增 2026-11-22 的 W1–W9 真机段，逐包区分「已验证」与「未实测」，记录 0.1.3→0.2.0 真实升级、内置 Node PATH 隔离与删 `node.exe` 负向、5000 事件性能/键盘/axe、观察抽屉、DPAPI 证据，以及 W8 隔离安装→项目→任务→验收→合并→清理→日报→诊断包的全链路；仍未做项（W9 跨用户负向、真正无 Node 机器、CI 实跑）如实保留。

## [0.2.0] — 2026-11-21

### 新增

- **Agent 控制台**：新增今日、任务板、任务页、汇报、设置五个页面；任务生命周期扩展为 11 个状态（待开始、排队、运行、暂停、需决策、待验收、待合并、已合并、已完成、已停止、失败），任务页含事件流、工具卡、产物画廊与右栏产物列表。
- **多 Agent 调度**：并发上限、依赖顺序、队列与暂停/继续/停止；接入 claude-code、kimi-code、opencode 三个真实运行时适配器（opencode 运行改用 `--standalone`，跑完不留后台守护进程）。
- **验收与合并**：审核本轮总结与产物后可验收或打回（打回意见写入下一轮提示词并续接同一会话）；合并需要一次性授权 token，预检 dirty / 分支 / 冲突，`git merge --no-ff` 合并后清理 worktree 与分支；Agent 未自行提交时以 PetDeck 身份自动提交。
- **经理与日报**：设置页可配置 OpenAI 兼容 / Ollama / LM Studio / 自定义端点，支持对话拆解任务提案、确认派发、按天生成日报；经理不可用时回退本地汇总。
- **数据层**：SQLite v4（manager_messages / proposals / reports），运行事件落盘为 `events.jsonl`，支持按任务回放。

### 修复

- **打回意见被截断**：Windows 上从 npm 安装的 CLI 是 `.cmd` shim，经 `cmd.exe /d /s /c` 托管时命令行在第一个换行处断开，多行提示词只剩第一行（opencode 真机 E2E 中打回原因整段丢失，Agent 反问「打回原因是什么」后只改了原文件）。`exec.mjs` 现在解析 shim 文本找到真实可执行文件直接拉起（本机 opencode、codex、dsh 均命中），仍必须经过 cmd 的 shim 把 CR/LF 折成空格兜底。
- **合并后清理失败（`CLEANUP_FAILED`）**：opencode 后台守护进程把任务 worktree 当作自己的工作目录，Windows 下被占用的目录删不掉，`git worktree remove` 报 `failed to delete ...: Permission denied`，分支已删但任务仍挂着 worktree 路径。运行改用 `opencode --standalone`（私有 server，跑完不留守护进程）；清理改为短暂重试，并以 `disposeWorktree` 处理「git 已摘除注册、只剩残留目录」的情况（记录 `leftover_removed`），确实仍注册时才报错。
- 以 opencode 2.0.30 真机补齐「完成→验收→打回→重跑→验收→合并→清理」全链路验收：一次 49.45s 走通，打回后 run2 续接同一会话并收到完整意见，主仓库 hello/second 均落地。
- 修复经理回复被 tool-call 流污染（智谱 glm-4-flash 会把 `finish_reason` 片段拼进正文）、提案卡被裁切、review 事件 `artifact_count` 恒为 0、Kimi 的 resume 提示被当成阶段总结等问题。

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
