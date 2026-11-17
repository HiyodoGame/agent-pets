# Phase 3 健壮性优化设计 — 接力安全 · 链路正确性 · 可靠性 · 性能

> **状态：已归档，实施任务已完成。** 本文保留设计时约束和方案快照；后续功能演进见 [CHANGELOG](../../../CHANGELOG.md)，当前计划见[统一路线图](../../ROADMAP.md)。

- **日期**：2026-11-14
- **项目**：Agent Pets / petdeck（方向 B「接力秘书」）
- **状态**：已与用户确认范围（全部含性能）、后端一次性破坏式重构、mock 仅演示开关、新增 `typescript` devDep、不加 Playwright
- **上游**：架构与质量审查（12 项发现，按 4 阶段编排）；Phase 2 offline-partial-sync 已归档

## 0. 约束（全程保持）

- 隐私红线：会话内容与缓存全部本地，埋点只报行为、FORBIDDEN 递归脱敏。
- bridge 仅绑定 `127.0.0.1:5199`（`PETDECK_BRIDGE_PORT`）；不得触碰占用 5174 的应用。
- 无新增运行期依赖（唯一新增：`typescript` devDependency，仅用于 `tsc --noEmit`）。
- TDD：每处新逻辑先写失败测试；每阶段结束 `npm test` / `npx vite build` / `npx oxlint src server` 全绿。
- UI 文案中文；沿用 Spark Design 组件与 token。
- inject 返回结构与 bridge 鉴权允许一次性破坏式重构（本地原型、单一消费方）。

## 阶段一：接力安全

**执行模型**：`codex/claude/opencode` 的 `inject` 去掉 `shell:true`；提示词经 argv 位置参数（codex/claude）或 stdin（opencode）传入，杜绝 shell 元字符解释；对以 `-` 开头的文本加前导空格做参数注入防护。`spawnSync` 全替换为异步 `child_process.spawn`（Promise 化，集中在 `server/adapters/exec.mjs` 的 `runCli`），带超时 kill、error/close 收尾；`inject(payload, {run})` 暴露注入点便于确定性单测。

**bridge 访问守卫**：`server/bridge.mjs` 重构为 `createApp({adapters, security})`（导入不再自动 listen/poll）。守卫：`Host` 主机名 ∈ {127.0.0.1,localhost,::1}（防 DNS 重绑定）；POST 强制 `Content-Type: application/json`（迫使预检）+ `Origin` 白名单；`PETDECK_BRIDGE_TOKEN` 配置时 POST 需 `X-Petdeck-Token`；请求体大小上限；注入并发上限（超限 429）。前端 `bridge-client.inject` 附带 token 头（`VITE_PETDECK_BRIDGE_TOKEN`）。

**实施期契约更新（2026-11-14 review-remediation，Task 2 起生效）**：`main()` 要求 `PETDECK_BRIDGE_TOKEN` 非空——缺失时打印配置错误并拒绝监听（仅测试注入的 `createApp` 可不带 token）；`PETDECK_BRIDGE_ORIGINS`（逗号分隔）合并进默认 Origin 白名单，便于非 5173 前端端口；`Host` 规范化支持 `[::1]:port`；`/api/health` 额外返回不含秘密的 `authRequired: boolean`。opencode 适配器观察依赖本地 `opencode serve`，默认 `http://127.0.0.1:4096`。因此原句「未配置 token 时 Host+Origin+Content-Type 仍闭合跨站写入主洞」仅适用于 `createApp` 显式测试注入场景，生产入口（`main()`）不存在无 token 启动路径。

**观察故障真实性**：`shared.mjs` 的 `tailLines` 遇非 ENOENT（如 EACCES）抛出；`latestFiles` 基础目录缺失（ENOENT）返回空（未安装=合法空），非 ENOENT 抛出。`opencode.observe` 非数组响应抛错。使 `pollOnce` 得以保留 stale 而非把故障当"健康且为空"清空会话。

**验证**：bridge 集成测试（fake adapter，ephemeral 端口）——错误 token/Origin/Host/content-type 一律不调用 inject；超大 body 413；并发超限 429；health 正常。exec 单测——`options.shell !== true`、metachar 提示词原样入 argv、前导 `-` 防护、超时 kill。shared 单测——缺失目录返回空、ENOTDIR 抛出。

## 阶段二：接力链路正确性

**真实草稿/完成页**：`/relay` 路由携带源会话；live 草稿由真实源会话构造，目标解析失败禁止发送（不回退 mock）；完成页只展示真实回执（inject 返回 + 追踪事件），移除硬编码部署文案与产物；mock 仅 `demo=true`。

**attempt 关联**：客户端 `attemptId` + 目标 `sessionID` + 起始时间归属；历史事件/其他会话完成/重连回放不得结束当前接力；无法关联显示「尚未确认」；修复未知事件把 running 降回 sending。

**降级保指令 + 真重试**：`tiers.mjs` 统一完整交接包构造器（from/context/instruction/artifacts）；Flow4 显式 `pending/injected/manual/failed` 状态，manual 态展示可选中可复制交接包；重试真正再发一次（计数）。

**状态生命周期**：`parseClaude` 依 `stop_reason`/结果类型区分完成与运行；opencode 无信号时归 unknown/idle；建合成 fixture。真实 CLI 版本兼容标注为未实测。

## 阶段三：可靠性与离线一致性

**回写竞争**：`data.tsx` 单一更新入口 + 请求代际/SSE 修订号，旧响应不覆盖新；内存 last-good 优先，仅冷启动无内存数据才读磁盘快照；修 storage=null/首失败清空。

**埋点**：`_load` 校验数组-of-事件对象形状；递归剥离 FORBIDDEN。

**Flow1**：空事件 + DND 不崩溃/空屏；真实 `agentEvents` 接入自动轻拍与 DND 静默计数（decision 仍轻拍），演示模拟与真实消费分离。

## 阶段四：性能 + 质量门

`tsconfig.json` + `npm run typecheck`（`tsc --noEmit`）入 CI；Node `http` bridge 集成测试 + `data.tsx` tick 抽纯模块测试（`node:test`，无 Playwright）；路由与重型聊天面 `React.lazy` + `manualChunks`；`tailLines` 改增量读文件尾部；构建前后真实体积对比。

## 失败信号与回退

- 阶段一若真实 CLI stdin/argv 迁移无法在本机验证，保留 argv 方案并标注需真机验证，不谎报已实测。
- 性能阶段若 sparkdesign 重型依赖无法有效 tree-shake，如实报告体积变化而非强行拆分致回归。
