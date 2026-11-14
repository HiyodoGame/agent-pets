# petdeck — Agent Pets 接力秘书

本地优先的「接力秘书」：React 前端通过本机 bridge（HTTP + SSE，仅绑定 `127.0.0.1:5199`）观察并注入本地 Agent CLI。会话内容与缓存全部留在本机。

## 前置条件

- **Node.js 24**（CI 与 `engines` 均为 24；`node --version` 确认）
- npm（随 Node 提供）
- 本地 Agent CLI（按适配器，均为可选；缺失只影响对应卡片）：
  - **Codex**：`codex` CLI，读取 `~/.codex/sessions` rollout jsonl；`codex exec` 注入为实验能力，失败自动降级剪贴板交接。
  - **Claude**：`claude` CLI（headless `-p --output-format stream-json`），读取 `~/.claude/projects/*.jsonl`。
  - **opencode**：`opencode` CLI；观察依赖本地 `opencode serve`，默认 `http://127.0.0.1:4096`（端口被占用时需自行在 4096 起 serve）。
  - **kimi work**：hosted web Agent，仅观察层（手动签到），注入恒为剪贴板交接。

> ⚠️ 真实 CLI 的兼容性**未在真机逐一实测**：现有测试使用 fake spawn/fetch/adapter 与临时目录。首次接入真实 CLI 时请小步验证。

## 安装

```bash
npm ci
```

## 配置（token 必须配对）

bridge 服务侧与前端的 token 来自两个不同变量，**值必须一致**，否则注入一律 401：

| 变量 | 作用 |
| --- | --- |
| `PETDECK_BRIDGE_TOKEN` | bridge 进程读取；**缺失时 bridge 拒绝启动** |
| `VITE_PETDECK_BRIDGE_TOKEN` | 前端读取（Vite 只暴露 `VITE_` 前缀变量）；注入请求携带 `X-Petdeck-Token` |
| `PETDECK_BRIDGE_ORIGINS` | 逗号分隔的额外允许 Origin（默认已含 `http://localhost:5173`、`http://127.0.0.1:5173`；如用其他前端端口需在此配置） |
| `PETDECK_BRIDGE_PORT` | 可选，bridge 端口，默认 `5199`，仅绑定 `127.0.0.1` |

参考 `petdeck/.env.example`（仅占位值，不含秘密）。注意 Vite 不会自动加载 `.env` 中变量到 Node 的 bridge 进程——两个变量请分别以各自进程的方式提供（export 或各自的 env 文件）。

## 启动（两个终端）

```bash
# 终端 1：本地 bridge（先确保 PETDECK_BRIDGE_TOKEN 已设置）
npm run bridge

# 终端 2：前端 dev server（VITE_PETDECK_BRIDGE_TOKEN 与上面一致）
npm run dev   # http://localhost:5173
```

## Demo 开关

界面内的 demo 开关是**唯一**使用模拟数据的路径，需显式开启、永不自动降级。真实模式断连时展示最后已知状态与新鲜度标记，不回退 mock。

## 质量门

```bash
npm run typecheck && npm test && npm run lint && npm run build
```
