# Phase 2 设计 — offline-partial-sync（离线与部分同步健壮性）

> **状态：已归档，已实施。** 本文保留设计时快照，正文未勾选验收项不代表当前待办；完成记录见 [Phase 1 归档](../../../archive/phase-1-2026-11-14/INDEX.md)，当前计划见[统一路线图](../../ROADMAP.md)。

- **日期**：2026-11-13
- **项目**：Agent Pets / petdeck（方向 B「接力秘书」）
- **状态**：已与用户逐节确认（方向选择 → 场景范围 → 方案 A → 三节设计）
- **上游**：Phase 1 收尾（tag `phase-1`）、retro 建议、edge 状态矩阵中已设计未实现的 offline 态

## 1. 背景与目标

Phase 1 的核心押注「接力秘书」仍 inconclusive：NSM（人均日接力≥3）无真实数据。用户选择 Phase 2 先做**健壮性**，为日常 dogfood 使用建立可靠的数据连续性。

当前三个真实缺口：

1. **bridge 整体断连**：前端 `selectSource(healthy)` 直接 live→mock，真实数据被假演示数据替换。edge 设计承诺的「保留最后缓存状态」未实现。
2. **单 Agent 源失效**：bridge poll 的 `catch { /* adapter offline => skip */ }` 让该源会话从列表静默消失，无 stale 标记、无最后已知状态。
3. **SSE 重连**：睡眠/唤醒、bridge 重启后无主动重同步与事件去重。

**目标**：任何部分失效下，用户看到的都是「真实的最后已知状态 + 诚实的新鲜度标记」，恢复后自动重同步。

**非目标（明确排除）**：离线指令队列（延后）、团队协作（out_of_scope 已验证）、macOS/鸿蒙、真实路由映射、同步引擎/CRDT。

## 2. 关键决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| Phase 2 主方向 | 健壮性 offline-partial-sync | 用户选择；为 dogfood 建立可靠性 |
| 新鲜度权威 | bridge（方案 A） | bridge 是唯一观察者，知道真实 lastSeen；前端无法区分「适配器失效」与「会话合法消失」 |
| 持久化位置 | 前端 localStorage | bridge 保持无状态；重启后重新观察即可 |
| mock 定位 | 仅显式演示开关 | 不再自动降级到假数据 |
| 协议演进 | 只加字段，向后兼容 | 旧客户端只读 `ok`/数组形状，不受影响 |

## 3. 架构

### 3.1 Bridge 侧：新鲜度权威

**新文件 `server/freshness.mjs`** — 纯函数，fake adapter 可直接单测：

```js
pollOnce(adapters, lastGood, now) → { sessions, sources, lastGood, key }
```

- `adapters`：`[{id, observe()}]`；`lastGood`：`Map<agentId, {at, rows}>`（不可变更新，返回新 Map）。
- adapter **成功** → `lastGood[id] = {at: now, rows}`；rows 标 `stale: false, lastSeen: now`。
- adapter **抛错** → 有 lastGood 则保留其 rows 标 `stale: true, lastSeen: lastGood.at`；从未成功则该源无 rows。
- `sources`：`{[id]: {ok: boolean, lastSeen: number|null}}`。
- `key`：`JSON.stringify(rows.map(r => [r.agent, r.session, r.status, r.lastMessage, r.stale]))`。**含 stale、不含 lastSeen**——否则每次 poll 都触发推送（事件风暴）。

**适配器契约**（实现时逐一核验）：`observe 抛错 = 源不可达`；`返回 [] = 合法为空`。opencode 的 fetch 在服务 down 时自然抛错；文件型适配器（codex/claude/kimi）目录不存在按空处理（从未使用 ≠ 故障）。

**`server/bridge.mjs` 改动**：

- poll() 改为调用 `pollOnce`，持有 `lastGood` 状态；`key !== sessionsKey` 时推送（沿用现有 change-driven 逻辑）。
- `/api/sessions` 与 SSE `sessions` 事件的 rows 携带 `stale`/`lastSeen`（数组形状不变）。
- `/api/health` 扩展为 `{ok: true, sources}`（加性；旧 `fetchHealth` 只读 `j.ok`）。

### 3.2 前端：连接状态机 + 快照缓存 + 重同步

三个新纯模块（`src/adapters/`，沿用 bus/registry 模式）：

**`connection.ts`**

```ts
type ConnState = 'live' | 'reconnecting' | 'offline'
type ConnEvent = {type:'health', ok:boolean} | {type:'sse', open:boolean}
nextConnState(prev: {state: ConnState, fails: number}, ev: ConnEvent) → {state, fails}
```

转移矩阵：

| 当前 | 事件 | 结果 |
| --- | --- | --- |
| 任意 | health ok | live，fails=0 |
| live | health fail（第 1 次） | reconnecting，fails=1 |
| reconnecting | health fail（第 2 次） | offline，fails=2 |
| offline | health fail | offline（fails 封顶） |
| live/reconnecting | sse error | reconnecting（offline 保持 offline） |
| reconnecting/offline | sse open | live，fails=0 |

阈值常量 `FAILS_TO_OFFLINE = 2`。demo 是独立开关，不进状态机。

**`snapshot-cache.ts`**

- key `petdeck.snapshot.v1`；结构 `{savedAt, sessions, agents}`；**只缓存真实数据**（调用点保证：仅 live 通道写入）。
- `saveSnapshot(storage, data, now)` / `loadSnapshot(storage) → data | null`；storage 为最小接口 `{getItem, setItem, removeItem}`，测试用内存实现。
- sessions 上限 200 条；JSON 解析失败 → 返回 null 并清除；localStorage 不可用 → 调用方降级为仅内存。

**`event-dedup.ts`**

- `createDeduper(cap = 500)` → `{seen(id): boolean}`；重复 id 返回 false；超容量按 FIFO 淘汰。
- 用途：bus replay 在 SSE 重连后可能重发近期事件，pet 事件按 `RawAgentEvent.id` 去重。

**`registry.ts` 语义变更**

- `selectSource(demo: boolean)`：`demo → 'mock'`；否则 `'live'`（真实数据通道，离线时供缓存/空态）。**不再因断连自动回退 mock**，健康与否由连接状态机处理，不再参与数据源选择。
- 原 `selectSource(bridgeHealthy)` 签名废弃；`logic.test.ts` 中对应用例**有意重写**为新语义（先写失败测试），其余现有用例保持绿。

**`data.tsx` 集成**（仍只导出 DataSourceProvider）：

- 新增 connState/fails 状态；非 live 时每 5s health 轮询（自动恢复）；初始挂载也轮询一次。
- live 快照每次变化写缓存；启动时 bridge 不健康 → 读缓存展示（带 savedAt）；无缓存 → 离线空态 + 接入 CTA。
- 恢复（connState → live）时 fetch sessions+agents 全量快照替换 base；本地编辑经现有 `mergeSessions(base, overlays, deleted)` 保留。
- pet 事件经 deduper 后再入 eventsRef/agentEvents。
- context 值扩展：`{connState, savedAt, reconnect()}`；`reconnect()` 立即 health 检查 + 重同步。

**类型加性扩展**：`ObservedSession` 与 flow 层 `Session` 增加可选 `stale?: boolean, lastSeen?: number`，data.tsx 映射时透传。

### 3.3 UI 表面（最小改动，复用 edge-kit）

| 位置 | 变化 |
| --- | --- |
| Shell badge | 实时 / 重连中 / 离线·数据截至 HH:MM / 演示 四态 |
| Flow1 | offline 时 PetAvatar 灰化 + 离线 badge + 重连 CTA（edge 已设计态）；计数保留缓存值弱化显示 |
| Flow3 | stale 会话行加「stale」Tag + lastSeen 相对时间；fresh 行不变 |
| Flow4 | 追踪目标 stale 时提示「状态可能滞后」；inject 失败沿用剪贴板降级，不做队列 |
| 重连 CTA | 触发 `reconnect()` |

### 3.4 埋点（小增量，行为-only）

`EVENT` 增加 2 个事件：`offline_entered`（extra `{fails}`）、`connection_recovered`（extra `{}`），禁止内容字段，沿用 FORBIDDEN 脱敏。为后续 retro 提供离线频率数据。

## 4. 数据流

```
adapters.observe ──pollOnce──▶ sessions(+stale/lastSeen) + sources
                                   │ change-driven(key)
                                   ▼
                          SSE /api/events ──▶ data.tsx base 快照
                                                 │        ├─ live: 写 snapshot-cache
                                                 │        └─ 断连: 读 cache → 展示 + offline
                                                 ▼
                              mergeSessions(base, overlays, deleted) ──▶ flows
health 轮询(5s, 非 live) ──▶ nextConnState ──▶ 恢复时全量重同步 + dedup 事件
```

## 5. 错误处理

| 场景 | 行为 |
| --- | --- |
| 缓存 JSON 损坏 | loadSnapshot 返回 null 并清除该 key |
| localStorage 不可用 | 仅内存缓存，功能降级不报错 |
| bridge 重启 | SSE 自动重连 + 快照重同步 + id 去重 |
| adapter 抖动（up/down 交替） | key 含 stale，仅状态变化推送，无事件风暴 |
| 长期离线 | 缓存不自动过期，始终显示 savedAt |
| 首次启动 bridge down 且无缓存 | 离线空态 + 接入 CTA，不显示假数据 |
| inject 时 bridge down | 沿用现有错误路径 + 剪贴板降级 |

## 6. 测试策略（TDD：每个新逻辑先写失败测试）

| 测试文件 | 覆盖 |
| --- | --- |
| `server/freshness.test.mjs` | pollOnce：成功更新 / 失败保留 stale / 从未成功无输出 / key 含 stale 不含 lastSeen / sources 健康 |
| `src/adapters/connection.test.ts` | 转移矩阵全路径、2 次失败阈值、demo 独立 |
| `src/adapters/snapshot-cache.test.ts` | round-trip / 损坏丢弃 / 200 上限 / 内存 storage |
| `src/adapters/event-dedup.test.ts` | 重复 id / FIFO 淘汰 |
| 现有测试 | 除 `logic.test.ts` 的 selectSource 用例有意重写外，其余保持绿（stale 字段加性，mergeSessions 不受影响） |

`npm test` 脚本追加新文件；CI（Node 24）自动覆盖。

**浏览器实证**（最后一步）：

1. 运行中 kill bridge → ~10s 内 Shell 显示离线·截至 HH:MM，Flow1/3 保留最后真实数据，宠物灰化 + 重连 CTA。
2. 重启 bridge → ~10s 内自动恢复实时，本地编辑（overlay）保留。
3. 单源失效（opencode server down）→ 其会话 stale Tag + lastSeen，其余 fresh。
4. SSE 断开重连 → 追踪无重复事件。
5. 显式演示开关仍可用；任何情况下不自动回退 mock。

## 7. 验收标准

- [ ] 上述 5 条浏览器实证全部通过
- [ ] 首次启动无 bridge 无缓存 → 离线空态 + CTA（无假数据）
- [ ] 测试全绿（现有用例除 selectSource 有意重写外全部保留 + 新增）、`vite build` 干净、oxlint 0 warnings / 0 errors
- [ ] 埋点新事件无内容泄漏（FORBIDDEN 脱敏生效）
- [ ] 隐私边界不变：会话内容与缓存全部本地

## 8. 质量门与交付

与 Phase 1 同标准：TDD 红绿循环、CI 全绿、QA 对照 edge 已设计 offline 态核销。完成后按惯例归档 + commit + push（master 受保护，必需检查 `ci`）。

## 9. 实现顺序（供 writing-plans 展开）

1. `server/freshness.mjs` TDD → bridge.mjs 接入 + 协议加性字段
2. 类型扩展（ObservedSession/Session）
3. `connection.ts` / `snapshot-cache.ts` / `event-dedup.ts` TDD
4. `registry.selectSource` 语义变更 + `data.tsx` 集成（轮询/缓存/重同步/去重）
5. UI 四态 badge + Flow1/3/4 stale 表面 + 埋点 2 事件
6. 浏览器实证 5 条 + 质量门 + 归档提交