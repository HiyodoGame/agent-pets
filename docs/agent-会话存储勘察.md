# Agent 本地会话存储勘察（2026-11-16，用户机器实测）

> 目的：为新增适配器（Cursor、Gemini CLI、Kimi Code、zcode、DeepSeek Harness）提供真实数据格式依据。结论来自 `C:\Users\Con_WKK` 下实际文件的只读检查或官方源码，不含猜测；未能确认的项如实标注。

## 总览

| Agent | CLI/形态 | 本地存储 | 格式 | observe 可行性 | inject 可行性 |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `claude` CLI | `~/.claude/projects/*.jsonl` | JSONL | ✅ 已有适配器 | ✅ 已有（headless `-p --output-format stream-json`） |
| Codex | `codex` CLI | `~/.codex/sessions` rollout jsonl | JSONL | ✅ 已有 | ⚠️ `codex exec` 实验性（已有） |
| opencode | `opencode` CLI | v2 后台服务（动态端口 + CLI 管理密码）；v1 `serve` :4096 | HTTP + Basic Auth；列表 `opencode api session.list`，运行态 SSE `/api/event` | ✅ 已有 | ✅ 已有（spike 实证） |
| Cursor | `cursor` CLI / IDE 3.29.15 | `~/.cursor/projects/<project>/agent-transcripts/<sessionId>/<sessionId>.jsonl` | JSONL（user/assistant + `turn_ended`） | ✅ 新增（真机 5 会话） | ❓ 无已验证 headless 语法 → observe-only |
| Gemini CLI | 本机未安装（官方源码确认格式） | `~/.gemini/tmp/<projectShortId>/chats/session-*.jsonl`（兼容 legacy `.json`） | JSONL（metadata + user/gemini/error 记录） | ✅ 新增（仅合成 fixture，本机无数据） | ❓ 无已验证语法 → observe-only |
| Kimi Code | `~/.kimi-code/bin/kimi.exe` | `~/.kimi/sessions/<projHash>/<uuid>/context.jsonl` | JSONL | ✅ 新增 | ❓ 非交互注入语法未验证 → 先 observe-only |
| zcode | CLI 存放位置待确认 | `~/.zcode/cli/db/db.sqlite`(+wal) | SQLite（node:sqlite 可只读副本解析） | ✅ 新增 | ❓ CLI 注入语法未验证 → 先 observe-only |
| DeepSeek Harness | `dsh` CLI（npm `@deepseek-ai`） | `~/.dsh/sessions/<workspaceSlug>/<sessionId>/session.v4.jsonl.zstd` | 多帧 zstd 拼接的 JSONL（每帧一条事件，magic `28 B5 2F FD`） | ✅ 新增 | ⚠️ `dsh` CLI 存在但注入语法未验证 → 先 observe-only；发现 `.dsh/profiles/acp` 支持 ACP 协议，未来可走 ACP 注入 |
| Antigravity | Antigravity 桌面 | `~/.gemini/antigravity/conversations/<brainId>.db` | SQLite，payload 为 protobuf 二进制（无 schema） | ⚠️ 缓做：需逆向 protobuf | ❌ 无 CLI 注入面 |

## 各 Agent 关键格式细节

### Kimi Code（`~/.kimi/sessions`）

- 目录结构：`sessions/<工程哈希>/<会话uuid>/context.jsonl`。
- 行格式 `{"role": ..., "content": ...}`，role 取值：`_system_prompt`（1 行）、`user`、`assistant`（content 为数组，含 `text`/`think` 类型块）、`_checkpoint`（压缩水位）、`_usage`（`{"token_count": N}`，每回合追加）。
- 状态推断（需在实现中诚实标注局限）：文件末尾为 `user` → **waiting**（等待模型响应/等用户？见下）；末尾为 `assistant` + 其后仅 `_usage` → 回合已完成。**「running vs done」无显式信号**，先用 mtime 新鲜度（< 90s 视为 running）+ 状态 unknown 兜底，真机观察修正。
- 成本信号：`_usage.token_count` 累计值可直接聚合（无 input/output 拆分）。

### zcode（`~/.zcode/cli/db/db.sqlite`）

- 表：`session`（id/title/directory/time_created/time_updated/**last_outcome**(completed|interrupted|null)/parent_id 支持子代理）、`message`（data JSON：role/time/model/contextSnapshot）、`turn_usage`（input_tokens/output_tokens/reasoning_tokens/cache_*/status(completed|error|cancelled)/error_type）。
- 状态推断：`last_outcome='completed'` → done；`'interrupted'` → stuck；null + time_updated 新鲜 → running；`message` 末条 user → waiting。
- 读取方式：**先复制 db+wal+shm 到临时目录再打开**（避免对用户活动中的库加锁/写 wal-shm）。Node 24 内置 `node:sqlite`。
- 成本信号：turn_usage 聚合即可得每会话 token（含 cache 拆分，比 kimi 更完整）。

### DeepSeek Harness（`~/.dsh`）

- 目录结构：`sessions/<工作区slug（路径转义）>/<sessionId>/session.v4.jsonl.zstd`；另有 `storages/session_projcache.json`（含 cwd/turns/steps 统计）。
- zstd 文件 = **多个独立 zstd frame 顺序拼接，每帧一条事件**，逐帧 `zlib.zstdDecompressSync(buf.subarray(frameStart))` 解出。
- 事件类型（实测 45 文件、~13k 事件统计）：`session`（头：id/cwd/createdAt）、`session/title`、`turn/start`{turn}、`turn/end`{turn, reason.kind=completed|...}、`approval/asked`（等批准 → waiting）、`assistant/message`（content 含 reasoning/text）、`tool/call`、`tool/result`、`user/message`、`llm/retry` 等。
- 状态推断：`turn/start` 后无对应 `turn/end` → running；`approval/asked` 未决 → waiting；`turn/end(reason.kind='completed')` → done；否则 unknown。
- 成本信号：未见 token 计数事件（暂无成本）。
- inject 线索：`dsh` 命令存在（npm bin），`.dsh/profiles/acp/` 表明支持 ACP（Agent Client Protocol）——未来注入可走 ACP over stdio，待验证。

### opencode v2（动态后台服务）

- 服务发现：`opencode service status` 输出 `http://127.0.0.1:<port>`；`opencode service get password` 输出访问密码（Basic Auth 用户名 `opencode`）。
- 会话列表：`opencode api session.list`（CLI 自动发现/鉴权）→ `{"data":[...]}`；行含 `outcome`（succeeded/interrupted/failed/null）与 `time.{created,updated,idle}`，**没有 status 字段**。
- 运行中状态：SSE `GET /api/event`（Basic Auth）发送 `session.execution.started` / `succeeded` / `failed` / `interrupted`，事件 `data.sessionID` 指向会话。桥接进程维持重连长连接，把 started 后的会话标为 running，终态事件移除。
- 兜底：仅当 SSE 未连接时，才用 `outcome=null && time.updated < 120s` 推断 running；watcher 在线时不做新鲜度猜测，避免把陈旧会话误报为运行中。
- `opencode run --format json` 的 inject 不依赖显式 serve（实测约 4.9s）。

### Cursor（`~/.cursor/projects`）

- 目录结构：`projects/<项目slug>/agent-transcripts/<sessionId>/<sessionId>.jsonl`；子代理在 `<sessionId>/subagents/<id>.jsonl`，观察时跳过。
- 行格式：`{"role":"user"|"assistant","message":{"content":[{type:"text",text},{type:"tool_use",name,input}]}}`；每回合末行 `{"type":"turn_ended","status":"success"|"error"}`。
- 真机统计（2026-11-16，7 个顶层 transcript）：6 个 success / 1 个 error，无缺终态样本。
- 状态推断：`turn_ended(success)` → done；`error`/`aborted`/`interrupted` → stuck；新的 `user` 行清除上一回合终态；无终态且 mtime < 120s → running；否则 unknown。
- 标题：使用项目 slug（transcript 本身无标题）。另有 `globalStorage/conversation-search.db`（title/updated_at 索引，10 条，其中 6 条 id 与 transcript 重合），当前不做跨库 join，避免额外 I/O 与锁风险。
- inject 复核（2026-11-17，Cursor 3.29.15）：顶层 CLI 的 `agent` 子命令（终端 TUI）与 `desktop` 子命令（操作运行中的桌面会话，定义中带 `--json/--force/--stdin`）在当前构建中均未接线——`cursor agent --help` / `cursor desktop --json` 被当作普通参数传给 Electron 并退出 0；安装目录内未发现独立 `cursor-agent` 可执行文件。npm 上的 `cursor-agent` 是第三方任务序列工具（zalab-inc），非官方。故 inject 保持未验证 → observe-only。

### Gemini CLI（`~/.gemini/tmp`，官方源码确认）

- 依据：google-gemini/gemini-cli 源码 `packages/core/src/config/storage.ts`、`packages/core/src/services/chatRecordingTypes.ts`、`chatRecordingService.ts`（2026-11-16 查阅）。
- 目录结构：`~/.gemini/tmp/<projectShortId>/chats/session-<timestamp>-<id8>.jsonl`；legacy `.json` 为单对象 `{sessionId, projectHash, messages}`。
- 行类型：
  - metadata：`{sessionId, projectHash, startTime, lastUpdated, kind?, summary?}`；
  - message：`{id, timestamp, content, type: user|gemini|info|error|warning, tokens?}`；
  - 更新/回退：`{$set}`、`{$patch}`、`{$rewindTo}`。
- 状态推断：没有显式回合终止信号，按最后一条会话消息推断：`user` → running、`gemini` → done、`error` → stuck；`info`/`warning` 不改变状态；`kind='subagent'` 跳过。
- 成本信号：gemini 消息的 `tokens`（input/output/cached/total）。
- 限制：本机未安装 Gemini CLI（无 `~/.gemini/tmp`），仅按官方源码实现并通过合成测试，未做真机回填。

### Gemini / Antigravity（缓做原因）

- 用户机器上未安装 Gemini CLI（无 `~/.gemini/tmp`、npm 无 gemini bin），Gemini 使用形态是 **Antigravity 桌面**。
- `conversations/<brainId>.db` 的 `steps`/`step_payload` 为 protobuf 二进制（无 schema 可循），`trajectory_meta` 只有 id 对应关系。读取会话内容需逆向 protobuf——按「不凭猜测实现」约定暂缓，待官方暴露 CLI/导出接口或拿到 schema 再做。

## 对实现的影响

1. 新增 5 个 observe-only 适配器：`kimi-code`、`zcode`、`dsh`（DeepSeek Harness）、`cursor`、`gemini`；`TIER` 全部 observe-only（inject 语法未验证，不假装能注入）。
2. zcode / dsh / cursor 的会话天然带项目归属（zcode project_id、dsh workspace slug、cursor project slug），可展示「项目」维度。
3. 成本 MVP 数据源：claude（jsonl usage 字段）、zcode（turn_usage 完整）、kimi-code（token_count 累计）、gemini（tokens 分项）。
4. Antigravity 列入 blocked，理由如上。
5. opencode v2 的后台服务端口/密码由 CLI 管理，观察走 `opencode api session.list`；运行中状态由桥接进程订阅 SSE `session.execution.*` 得到，watcher 离线时才退回 mtime 新鲜度兜底；旧 `/session` HTTP 仅作 v1 回退。
