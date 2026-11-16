# PetDeck — Agent Pets 桌面宠物

Windows 优先的 Agent 桌面宠物：透明、无边框、置顶的小窗常驻桌面，通过本机 bridge（HTTP + SSE）观察并接力本地 Agent CLI。主面板按需打开；会话内容与缓存全部留在本机。

## 桌面版前置条件

- Windows 10/11 与 Microsoft Edge WebView2（安装器可在缺失时下载 bootstrapper）
- **Node.js 24 或更新版本**（首个桌面 Beta 仍使用系统 Node 启动 bridge）
- 开发构建还需要 Rust 1.90+、Cargo 和 Visual Studio MSVC 工具链
- 本地 Agent CLI 均为可选；缺失只影响对应卡片：
  - **Codex**：读取 `~/.codex/sessions` rollout jsonl；`codex exec` 注入为实验能力，失败降级剪贴板。
  - **Claude**：读取 `~/.claude/projects/*.jsonl`，使用 headless `claude -p --output-format stream-json`。
  - **opencode**：观察依赖本地 `opencode serve`，默认 `http://127.0.0.1:4096`；v2 由 `opencode api session.list` 自动发现后台服务。
  - **kimi work**：hosted web Agent，仅观察层，注入恒为剪贴板交接。
  - **Kimi Code**：读取 `~/.kimi/sessions/*/*/context.jsonl`，仅观察层（注入恒剪贴板）。
  - **zcode**：读取 `~/.zcode/cli/db/db.sqlite` 的只读副本，仅观察层（注入恒剪贴板）。
  - **DeepSeek Harness**：读取 `~/.dsh/sessions/*/*/session.v4.jsonl.zstd`（多帧 zstd），仅观察层（注入恒剪贴板）。
  - **Cursor**：读取 `~/.cursor/projects/*/agent-transcripts/*/*.jsonl`，仅观察层（注入恒剪贴板）。
  - **Gemini CLI**：读取 `~/.gemini/tmp/*/chats/session-*.jsonl`，仅观察层（注入恒剪贴板；本机未安装时无数据）。

> 真实 CLI 的兼容性尚未在所有适配器上逐一完成安装版实测。现有自动化测试使用 fake spawn/fetch/adapter；首次接入时请小步验证，不以测试替代真机结论。

## 桌面开发与运行

```bash
npm ci
npm run tauri:dev
```

桌面应用自动完成以下操作，无需手动开两个终端：

- 每次启动生成随机 token，并选择可用的 loopback 端口。
- 启动和退出时管理 `server/bridge.mjs` Node 子进程。
- 显示透明宠物；拖拽手柄移动位置并自动记住位置。
- 单击宠物展开项目摘要、DND 收件箱和主面板入口。
- 托盘提供显示宠物、打开面板、免打扰、开机启动和退出；开机启动默认关闭。
- 关闭宠物或主面板只会隐藏；退出应用才回收 bridge。

缺少 Node、Node 版本过低或 bridge 组件缺失时，宠物会显示明确错误，不会自动切换到演示数据。

## Windows 安装包

```bash
npm run tauri:build
```

NSIS 安装包输出到 `src-tauri/target/release/bundle/nsis/`。安装器包含前端、应用图标、WebView2 检查及 `server/` bridge resources。Node 24 暂不内嵌。

本地打包含签名更新产物时，需要设置签名私钥（见 `docs/自动更新与签名.md`）：

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat <私钥路径>)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<密码> \
npm run tauri:build
```

## 自动更新

桌面版在「右键宠物 → 宠物设置 → 自动更新」检查 GitHub Releases；打开设置会自动检查一次，但下载与安装必须由用户确认。更新包使用 Tauri 签名校验，发布流程与密钥管理见 `docs/自动更新与签名.md`。

> v0.1.0 未内置 updater，需要手动安装 v0.1.1 一次；从 v0.1.1 起可在应用内自动更新。

## 语言 / Language

界面支持中文与 English。入口：右键宠物 →「宠物设置」→「语言」。切换会即时更新应用界面与原生托盘菜单，并保存在本机（`petdeck.locale`）。首次启动跟随系统语言，非中文系统默认 English。

> 演示模式的样例会话/事件内容是中文示例数据，不影响真实链路与界面语言。

## Web 开发/演示预览

Web 版用于开发、设计走查和演示，不再是默认产品形态：

```bash
npm run dev   # http://localhost:5173
```

界面的 demo 开关是唯一使用模拟数据的路径。真实模式断连时展示最后已知状态与新鲜度标记，不回退 mock。

如需在 Web 真实模式下手动运行 bridge，可使用两个终端：

```bash
# 终端 1
PETDECK_BRIDGE_TOKEN=<本地随机值> npm run bridge

# 终端 2，VITE token 必须与上面一致
VITE_PETDECK_BRIDGE_TOKEN=<本地随机值> npm run dev
```

| 变量 | 作用 |
| --- | --- |
| `PETDECK_BRIDGE_TOKEN` | bridge 进程读取；缺失时拒绝启动。读端点（agents/sessions/events）与 inject 同样要求此 token |
| `VITE_PETDECK_BRIDGE_TOKEN` | Web 前端读取；读取与注入请求携带 `X-Petdeck-Token`，SSE 走 `?token=` 查询参数 |
| `PETDECK_BRIDGE_ORIGINS` | 逗号分隔的额外允许 Origin；桌面 Origin 已内置 |
| `PETDECK_BRIDGE_PORT` | Web 手动模式端口，默认 `5199`；桌面版自动选择 |

参考 `.env.example`（仅占位值）。Vite 不会自动把 `.env` 变量传给独立 Node 进程。

## 文档

- 用户手册（安装/接入/日常使用/故障排查）：`docs/用户手册.md`
- 真机实测矩阵与环境检查：`docs/真机实测矩阵.md`，运行 `node scripts/verify-local.mjs --md` 生成自动检查表（只读观察，不执行注入）
- 变更历史：根目录 `CHANGELOG.md`

## 质量门

```bash
npm run typecheck && npm test && npm run lint && npm run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:build -- --no-bundle
```
