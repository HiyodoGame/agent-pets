# Phase 2 offline-partial-sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 任何部分失效（bridge 断连 / 单 Agent 源失效 / SSE 中断）下，用户看到真实的最后已知状态 + 诚实的新鲜度标记，恢复后自动重同步。

**Architecture:** 方案 A — bridge 是新鲜度权威（`pollOnce` 纯函数记录每源 lastGood，失效保留 stale 行）；前端三个纯模块（连接状态机 / localStorage 快照缓存 / 事件去重）+ DataSourceProvider 接线；mock 仅显式演示开关，永不自动降级。

**Tech Stack:** Node 24（`node --test` + TS type-stripping）、React 19、Vite 8、Spark Design、oxlint。无新依赖。

**Spec:** `docs/superpowers/specs/2026-11-13-phase2-offline-partial-sync-design.md`

## Global Constraints

- 隐私红线：会话内容与缓存全部本地（localStorage）；埋点只报行为事件，FORBIDDEN 字段（context/instruction/lastMessage/content/message/prompt）必须脱敏。
- 协议只加字段、向后兼容：`/api/sessions` 保持数组形状；`/api/health` 保留 `ok` 与 `agents`。
- bridge 端口 5199（`PETDECK_BRIDGE_PORT`），CORS `http://localhost:5173`；**不得触碰占用 5174 的其他应用**。
- 适配器契约：`observe 抛错 = 源不可达`；`返回 [] = 合法为空`。
- 常量：`FAILS_TO_OFFLINE = 2`；缓存 key `petdeck.snapshot.v1`、上限 200 条；去重 cap 500；health 轮询 5s。
- TDD：每个新逻辑先写失败测试并亲眼看它失败，再写最小实现。
- 质量门：`npm test` 全绿、`npx vite build` 干净、`npx oxlint src server` 0 warnings / 0 errors。
- UI 文案用中文；遵循现有 Spark Design 组件与 token（不写裸 hex）。
- 频繁提交；master 受保护（必需检查 `ci`），push 后确认 CI 绿。
- 工作目录：仓库根 `F:\WorkSpace\AIProjects\Agent_Pets`，应用目录 `petdeck/`。所有 npm/node 命令在 `petdeck/` 下执行。

## File Structure

| 文件 | 职责 | 动作 |
| --- | --- | --- |
| `petdeck/server/freshness.mjs` | `pollOnce` 纯函数：每源新鲜度合并 | 创建 |
| `petdeck/server/freshness.test.mjs` | pollOnce 单测（fake adapters） | 创建 |
| `petdeck/server/bridge.mjs` | poll 改用 pollOnce；health 加 sources | 修改 |
| `petdeck/server/adapters/opencode.mjs` | observe 契约修正：不可达时抛错 | 修改 |
| `petdeck/src/adapters/connection.ts` | 连接状态机（纯） | 创建 |
| `petdeck/src/adapters/connection.test.ts` | 状态机单测 | 创建 |
| `petdeck/src/adapters/snapshot-cache.ts` | 真实快照 localStorage 缓存（纯） | 创建 |
| `petdeck/src/adapters/snapshot-cache.test.ts` | 缓存单测 | 创建 |
| `petdeck/src/adapters/event-dedup.ts` | 事件 id 去重（纯） | 创建 |
| `petdeck/src/adapters/event-dedup.test.ts` | 去重单测 | 创建 |
| `petdeck/src/adapters/types.ts` | ObservedSession 加 stale/lastSeen | 修改 |
| `petdeck/src/flows/shared/types.ts` | Session 加 stale/lastSeen | 修改 |
| `petdeck/src/adapters/registry.ts` | selectSource(demo) + injectOrClipboard | 修改 |
| `petdeck/src/adapters/logic.test.ts` | selectSource 用例重写 + injectOrClipboard 用例 | 修改 |
| `petdeck/src/telemetry/core.ts` | EVENT 加 2 个连接事件 | 修改 |
| `petdeck/src/telemetry/core.test.ts` | 新事件存在性测试 | 修改 |
| `petdeck/src/adapters/bridge-client.ts` | subscribeEvents 加 onOpen/onError 钩子 | 修改 |
| `petdeck/src/adapters/pet-data-context.ts` | context 加 connState/savedAt/reconnect | 修改 |
| `petdeck/src/adapters/data.tsx` | Provider 重写：轮询/缓存/重同步/去重/demo prop | 修改 |
| `petdeck/src/flows/shared/ui-logic.ts` | fmtAgo 相对时间 | 修改 |
| `petdeck/src/flows/shared/ui-logic.test.ts` | fmtAgo 测试 | 修改 |
| `petdeck/src/flows/petdeck/petdeck.tsx` | Shell 四态 badge + demo 开关 + 真实离线 banner | 修改 |
| `petdeck/src/flows/flow-1-pet-surface/flow1-pet-surface.tsx` | offline 时宠物灰化（真实 connState 驱动） | 修改 |
| `petdeck/src/flows/flow-3-panel/flow3-panel.tsx` | stale Tag（线程头 + 侧栏行） | 修改 |
| `petdeck/src/flows/flow-4-relay/flow4-relay.tsx` | 追踪 stale 提示 | 修改 |
| `petdeck/package.json` | npm test 追加新测试文件（逐任务累加） | 修改 |

---

### Task 1: server/freshness.mjs — pollOnce 新鲜度纯函数

**Files:**
- Create: `petdeck/server/freshness.mjs`
- Test: `petdeck/server/freshness.test.mjs`
- Modify: `petdeck/package.json`（test 脚本）

**Interfaces:**
- Consumes: 无（纯函数，fake adapter 注入）
- Produces: `async pollOnce(adapters, lastGood, now) → { sessions, sources, lastGood, key }`。`adapters: [{id, observe()}]`（observe 可 sync/async）；`lastGood: Map<id, {at, rows}>`；返回 `sessions` 行带 `stale: boolean, lastSeen: number`；`sources: {[id]: {ok: boolean, lastSeen: number|null}}`；`lastGood` 为新 Map（不可变更新）；`key = JSON.stringify(sessions.map(r => [r.agent, r.session, r.status, r.lastMessage, r.stale]))`（**含 stale、不含 lastSeen**）。

- [ ] **Step 1: 写失败测试**

创建 `petdeck/server/freshness.test.mjs`：

```js
// RED tests for pollOnce freshness merge (bridge-authoritative partial sync).
// Run: node --test server/freshness.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pollOnce } from './freshness.mjs';

const ok = (id, rows) => ({ id, observe: () => rows });
const down = (id) => ({ id, observe: () => { throw new Error('source down'); } });
const row = (agent, session, status = 'running') => ({ agent, source: 'test', session, status, lastMessage: 'm' });

test('pollOnce: success marks rows fresh and records lastGood', async () => {
  const r = await pollOnce([ok('codex', [row('codex', 's1')])], new Map(), 1000);
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].stale, false);
  assert.equal(r.sessions[0].lastSeen, 1000);
  assert.deepEqual(r.sources.codex, { ok: true, lastSeen: 1000 });
  assert.deepEqual(r.lastGood.get('codex'), { at: 1000, rows: [row('codex', 's1')] });
});

test('pollOnce: failure after success keeps last rows as stale', async () => {
  const first = await pollOnce([ok('opencode', [row('opencode', 's1', 'done')])], new Map(), 1000);
  const second = await pollOnce([down('opencode')], first.lastGood, 6000);
  assert.equal(second.sessions.length, 1);
  assert.equal(second.sessions[0].stale, true);
  assert.equal(second.sessions[0].lastSeen, 1000);
  assert.equal(second.sessions[0].status, 'done');
  assert.deepEqual(second.sources.opencode, { ok: false, lastSeen: 1000 });
});

test('pollOnce: failure without prior success yields no rows', async () => {
  const r = await pollOnce([down('kimi')], new Map(), 1000);
  assert.equal(r.sessions.length, 0);
  assert.deepEqual(r.sources.kimi, { ok: false, lastSeen: null });
});

test('pollOnce: partial failure keeps healthy source fresh', async () => {
  const first = await pollOnce([ok('codex', [row('codex', 's1')]), ok('opencode', [row('opencode', 's2')])], new Map(), 1000);
  const second = await pollOnce([ok('codex', [row('codex', 's1')]), down('opencode')], first.lastGood, 6000);
  const byAgent = Object.fromEntries(second.sessions.map((r) => [r.agent, r]));
  assert.equal(byAgent.codex.stale, false);
  assert.equal(byAgent.codex.lastSeen, 6000);
  assert.equal(byAgent.opencode.stale, true);
  assert.equal(byAgent.opencode.lastSeen, 1000);
});

test('pollOnce: key includes stale flag but not lastSeen timestamp', async () => {
  const a = await pollOnce([ok('codex', [row('codex', 's1')])], new Map(), 1000);
  const b = await pollOnce([ok('codex', [row('codex', 's1')])], a.lastGood, 9000);
  assert.equal(a.key, b.key); // fresh->fresh, only lastSeen differs => no emit
  const c = await pollOnce([down('codex')], b.lastGood, 14000);
  assert.notEqual(b.key, c.key); // fresh->stale => must emit
});

test('pollOnce: recovery flips stale back to fresh', async () => {
  const first = await pollOnce([ok('opencode', [row('opencode', 's1')])], new Map(), 1000);
  const second = await pollOnce([down('opencode')], first.lastGood, 6000);
  const third = await pollOnce([ok('opencode', [row('opencode', 's1')])], second.lastGood, 11000);
  assert.equal(third.sessions[0].stale, false);
  assert.equal(third.sources.opencode.ok, true);
  assert.notEqual(second.key, third.key);
});

test('pollOnce: async observe is awaited', async () => {
  const a = { id: 'x', observe: async () => [row('x', 's1')] };
  const r = await pollOnce([a], new Map(), 1000);
  assert.equal(r.sessions.length, 1);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test server/freshness.test.mjs`
Expected: FAIL — `Cannot find module './freshness.mjs'`

- [ ] **Step 3: 最小实现**

创建 `petdeck/server/freshness.mjs`：

```js
// Bridge-authoritative freshness: merge live observe results with last-known-good.
// Pure (adapters injected, immutable lastGood update) — unit-tested with fakes.
// Contract: observe throws = source unreachable; returns [] = legitimately empty.

/**
 * @param {Array<{id: string, observe: () => any}>} adapters
 * @param {Map<string, {at: number, rows: any[]}>} lastGood
 * @param {number} now
 * @returns {Promise<{sessions: any[], sources: Record<string, {ok: boolean, lastSeen: number|null}>, lastGood: Map<string, {at: number, rows: any[]}>, key: string}>}
 */
export async function pollOnce(adapters, lastGood, now) {
  const sessions = [];
  const sources = {};
  const lg = new Map(lastGood);
  for (const a of adapters) {
    try {
      const rows = await a.observe();
      lg.set(a.id, { at: now, rows });
      sources[a.id] = { ok: true, lastSeen: now };
      for (const r of rows) sessions.push({ ...r, stale: false, lastSeen: now });
    } catch {
      const prev = lg.get(a.id);
      if (prev) {
        sources[a.id] = { ok: false, lastSeen: prev.at };
        for (const r of prev.rows) sessions.push({ ...r, stale: true, lastSeen: prev.at });
      } else {
        sources[a.id] = { ok: false, lastSeen: null };
      }
    }
  }
  // key 含 stale 不含 lastSeen：fresh->stale 转折触发推送，纯时间流逝不触发。
  const key = JSON.stringify(sessions.map((r) => [r.agent, r.session, r.status, r.lastMessage, r.stale]));
  return { sessions, sources, lastGood: lg, key };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test server/freshness.test.mjs`
Expected: PASS（7 tests）

- [ ] **Step 5: 加入 npm test 并全量跑**

修改 `petdeck/package.json` 的 test 脚本，在 `server/pure.test.mjs` 后追加 `server/freshness.test.mjs`：

```json
"test": "node --test server/pure.test.mjs server/freshness.test.mjs src/adapters/logic.test.ts src/adapters/live-sessions.test.ts src/adapters/relay-tracking.test.ts src/telemetry/core.test.ts src/flows/shared/ui-logic.test.ts"
```

Run: `npm test`
Expected: 全部 PASS（39 + 7 = 46）

- [ ] **Step 6: Commit**

```bash
git add petdeck/server/freshness.mjs petdeck/server/freshness.test.mjs petdeck/package.json
git commit -m "feat(bridge): pollOnce 新鲜度纯函数（stale 保留 + 部分同步语义）"
```

---

### Task 2: bridge 接入 pollOnce + opencode 契约修正

**Files:**
- Modify: `petdeck/server/bridge.mjs`（poll 函数、health 端点、顶部状态变量）
- Modify: `petdeck/server/adapters/opencode.mjs`（observe）

**Interfaces:**
- Consumes: Task 1 的 `pollOnce(adapters, lastGood, now)`
- Produces: `/api/health` → `{ok: true, agents: [...], sources: {[id]: {ok, lastSeen}}}`；`/api/sessions` 与 SSE `sessions` 事件的行带 `stale`/`lastSeen`（数组形状不变）。

- [ ] **Step 1: 修正 opencode observe 契约**

`petdeck/server/adapters/opencode.mjs` 的 observe 当前吞错返回 `[]`（违反「抛错=不可达」契约）。替换整个 observe 函数：

```js
export async function observe() {
  // 契约：fetch 失败/非 ok 抛错 = 源不可达（bridge 保留 stale）；ok 且空列表 = 合法为空。
  const r = await fetch('http://127.0.0.1:4096/session', { signal: AbortSignal.timeout(1500) });
  if (!r.ok) throw new Error(`opencode serve responded ${r.status}`);
  const list = await r.json();
  return (Array.isArray(list) ? list : []).slice(0, 5).map((s) => ({
    agent: id, source: 'serve-http', session: s.id ?? '', status: 'running', lastMessage: (s.title ?? '').slice(0, 200),
  }));
}
```

文件头注释第一行改为：`// opencode adapter — observe: local serve HTTP; throws when unreachable (freshness contract).`

- [ ] **Step 2: bridge.mjs 接入 pollOnce**

顶部 import 区追加：

```js
import { pollOnce } from './freshness.mjs';
```

状态变量区（`let sessions = []; let sessionsKey = ''; const lastStatus = new Map();`）追加两行：

```js
let lastGood = new Map();
let sources = {};
```

整个 `async function poll() { ... }` 替换为：

```js
async function poll() {
  const res = await pollOnce(ADAPTERS, lastGood, Date.now());
  lastGood = res.lastGood;
  sources = res.sources;
  for (const r of res.sessions) {
    const key = `${r.agent}:${r.session}`;
    const prev = lastStatus.get(key);
    if (prev !== r.status) {
      lastStatus.set(key, r.status);
      const type = r.status === 'done' ? 'task_complete' : r.status === 'stuck' ? 'turn_aborted' : 'task_started';
      bus.emit({
        agentId: r.agent,
        sessionId: r.session,
        type,
        petType: r.status === 'done' ? 'done' : r.status === 'stuck' ? 'stuck' : '',
        payload: { lastMessage: r.lastMessage },
      });
    }
  }
  if (res.key !== sessionsKey) {
    sessionsKey = res.key;
    bus.emit({ type: 'sessions', petType: 'sessions', payload: { sessions: res.sessions } });
  }
  sessions = res.sessions;
}
```

health 端点替换为：

```js
  if (url.pathname === '/api/health') {
    return json(res, 200, { ok: true, agents: ADAPTERS.map((a) => ({ id: a.id, name: a.name, tier: TIER[a.id] })), sources });
  }
```

- [ ] **Step 3: 全量测试 + 构建**

Run: `npm test`
Expected: 46 PASS（opencode parseRun 测试不受影响）

- [ ] **Step 4: 运行时验证协议形状**

启动 bridge（后台）：`node server/bridge.mjs`（若已有 bridge 在跑，先停掉自己启动的那个再重启；**不要动 5174 端口的应用**）。

Run: `curl -s http://127.0.0.1:5199/api/health`
Expected: JSON 含 `ok:true`、`agents`（4 项）、`sources`（codex/claude/opencode/kimi 各含 `ok` 与 `lastSeen`）。

Run: `curl -s http://127.0.0.1:5199/api/sessions`
Expected: 数组；每行含 `stale`（boolean）与 `lastSeen`（number）。opencode 未运行时 `sources.opencode = {ok:false, lastSeen:null}` 且无 opencode 行（从未成功）。

- [ ] **Step 5: Commit**

```bash
git add petdeck/server/bridge.mjs petdeck/server/adapters/opencode.mjs
git commit -m "feat(bridge): 接入 pollOnce + health sources；opencode observe 不可达时抛错"
```

---

### Task 3: connection.ts — 连接状态机

**Files:**
- Create: `petdeck/src/adapters/connection.ts`
- Test: `petdeck/src/adapters/connection.test.ts`
- Modify: `petdeck/package.json`（test 脚本）

**Interfaces:**
- Consumes: 无
- Produces: `type ConnState = 'live' | 'reconnecting' | 'offline'`；`type ConnEvent = {type:'health', ok:boolean} | {type:'sse', open:boolean}`；`interface ConnSnapshot {state: ConnState, fails: number}`；`const FAILS_TO_OFFLINE = 2`；`nextConnState(prev: ConnSnapshot, ev: ConnEvent): ConnSnapshot`（纯）。

- [ ] **Step 1: 写失败测试**

创建 `petdeck/src/adapters/connection.test.ts`：

```ts
// RED tests for connection state machine (live / reconnecting / offline).
// Run: node --test src/adapters/connection.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextConnState, FAILS_TO_OFFLINE, type ConnSnapshot } from './connection.ts';

const init: ConnSnapshot = { state: 'reconnecting', fails: 0 };

test('conn: health ok -> live, fails reset', () => {
  assert.deepEqual(nextConnState(init, { type: 'health', ok: true }), { state: 'live', fails: 0 });
});

test('conn: first health fail -> reconnecting', () => {
  const live: ConnSnapshot = { state: 'live', fails: 0 };
  assert.deepEqual(nextConnState(live, { type: 'health', ok: false }), { state: 'reconnecting', fails: 1 });
});

test('conn: second consecutive health fail -> offline', () => {
  const r: ConnSnapshot = { state: 'reconnecting', fails: 1 };
  assert.deepEqual(nextConnState(r, { type: 'health', ok: false }), { state: 'offline', fails: 2 });
});

test('conn: offline fails capped, stays offline', () => {
  const o: ConnSnapshot = { state: 'offline', fails: 2 };
  assert.deepEqual(nextConnState(o, { type: 'health', ok: false }), { state: 'offline', fails: FAILS_TO_OFFLINE });
});

test('conn: offline + health ok -> live', () => {
  const o: ConnSnapshot = { state: 'offline', fails: 2 };
  assert.deepEqual(nextConnState(o, { type: 'health', ok: true }), { state: 'live', fails: 0 });
});

test('conn: live + sse error -> reconnecting', () => {
  const live: ConnSnapshot = { state: 'live', fails: 0 };
  assert.deepEqual(nextConnState(live, { type: 'sse', open: false }), { state: 'reconnecting', fails: 0 });
});

test('conn: offline + sse error stays offline', () => {
  const o: ConnSnapshot = { state: 'offline', fails: 2 };
  assert.deepEqual(nextConnState(o, { type: 'sse', open: false }), o);
});

test('conn: reconnecting + sse open -> live', () => {
  const r: ConnSnapshot = { state: 'reconnecting', fails: 1 };
  assert.deepEqual(nextConnState(r, { type: 'sse', open: true }), { state: 'live', fails: 0 });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test src/adapters/connection.test.ts`
Expected: FAIL — `Cannot find module './connection.ts'`

- [ ] **Step 3: 最小实现**

创建 `petdeck/src/adapters/connection.ts`：

```ts
// Connection state machine (pure): bridge health + SSE liveness -> display state.
// Demo mode is an independent switch and never enters this machine.

export type ConnState = 'live' | 'reconnecting' | 'offline'
export type ConnEvent = { type: 'health'; ok: boolean } | { type: 'sse'; open: boolean }
export interface ConnSnapshot { state: ConnState; fails: number }

export const FAILS_TO_OFFLINE = 2

export function nextConnState(prev: ConnSnapshot, ev: ConnEvent): ConnSnapshot {
  if (ev.type === 'health') {
    if (ev.ok) return { state: 'live', fails: 0 }
    const fails = Math.min(prev.fails + 1, FAILS_TO_OFFLINE)
    return { state: fails >= FAILS_TO_OFFLINE ? 'offline' : 'reconnecting', fails }
  }
  if (ev.open) return { state: 'live', fails: 0 }
  return prev.state === 'offline' ? prev : { state: 'reconnecting', fails: prev.fails }
}
```

- [ ] **Step 4: 运行确认通过 + 加入 npm test**

Run: `node --test src/adapters/connection.test.ts`
Expected: PASS（8 tests）

`package.json` test 脚本在 `src/adapters/logic.test.ts` 后追加 `src/adapters/connection.test.ts`。

Run: `npm test`
Expected: 全部 PASS（54）

- [ ] **Step 5: Commit**

```bash
git add petdeck/src/adapters/connection.ts petdeck/src/adapters/connection.test.ts petdeck/package.json
git commit -m "feat(adapters): 连接状态机 live/reconnecting/offline（2 次失败阈值）"
```

---

### Task 4: snapshot-cache.ts — 真实快照本地缓存

**Files:**
- Create: `petdeck/src/adapters/snapshot-cache.ts`
- Test: `petdeck/src/adapters/snapshot-cache.test.ts`
- Modify: `petdeck/package.json`（test 脚本）

**Interfaces:**
- Consumes: `ObservedSession`（`./types.ts`）、`Agent`（`../flows/shared/types.ts`）——仅类型
- Produces: `interface SnapshotStorage {getItem(k:string):string|null; setItem(k:string,v:string):void; removeItem(k:string):void}`；`interface Snapshot {savedAt:number; sessions:ObservedSession[]; agents:Agent[]}`；`const SNAPSHOT_KEY='petdeck.snapshot.v1'`；`const SNAPSHOT_CAP=200`；`saveSnapshot(storage: SnapshotStorage|null, data: {sessions:ObservedSession[], agents:Agent[]}, now:number): void`；`loadSnapshot(storage: SnapshotStorage|null): Snapshot|null`。storage 为 null 时 save 无操作、load 返回 null；损坏/形状错误 → 清除 key 并返回 null。

- [ ] **Step 1: 写失败测试**

创建 `petdeck/src/adapters/snapshot-cache.test.ts`：

```ts
// RED tests for real-snapshot local cache (never caches demo data by contract of callers).
// Run: node --test src/adapters/snapshot-cache.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveSnapshot, loadSnapshot, SNAPSHOT_KEY, SNAPSHOT_CAP, type SnapshotStorage } from './snapshot-cache.ts';
import type { ObservedSession } from './types.ts';
import type { Agent } from '../flows/shared/types.ts';

function memStorage(): SnapshotStorage & { dump: Map<string, string> } {
  const m = new Map<string, string>();
  return { dump: m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } };
}

const row = (i: number): ObservedSession => ({ agent: 'codex', source: 't', session: `s${i}`, status: 'running', lastMessage: 'm' });
const agent: Agent = { id: 'codex', name: 'Codex', form: 'cli', capability: 'full', status: 'idle', projectIds: [] };

test('cache: round-trip preserves savedAt/sessions/agents', () => {
  const s = memStorage();
  saveSnapshot(s, { sessions: [row(1)], agents: [agent] }, 1234);
  assert.deepEqual(loadSnapshot(s), { savedAt: 1234, sessions: [row(1)], agents: [agent] });
});

test('cache: corrupt JSON discarded and key removed', () => {
  const s = memStorage();
  s.setItem(SNAPSHOT_KEY, '{bad json');
  assert.equal(loadSnapshot(s), null);
  assert.equal(s.dump.has(SNAPSHOT_KEY), false);
});

test('cache: wrong shape discarded', () => {
  const s = memStorage();
  s.setItem(SNAPSHOT_KEY, JSON.stringify({ savedAt: 'not-a-number', sessions: [], agents: [] }));
  assert.equal(loadSnapshot(s), null);
});

test('cache: sessions capped at 200', () => {
  const s = memStorage();
  const many = Array.from({ length: 250 }, (_, i) => row(i));
  saveSnapshot(s, { sessions: many, agents: [agent] }, 1);
  assert.equal(loadSnapshot(s)?.sessions.length, SNAPSHOT_CAP);
});

test('cache: null storage degrades gracefully', () => {
  saveSnapshot(null, { sessions: [row(1)], agents: [agent] }, 1);
  assert.equal(loadSnapshot(null), null);
});

test('cache: missing key returns null', () => {
  assert.equal(loadSnapshot(memStorage()), null);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test src/adapters/snapshot-cache.test.ts`
Expected: FAIL — `Cannot find module './snapshot-cache.ts'`

- [ ] **Step 3: 最小实现**

创建 `petdeck/src/adapters/snapshot-cache.ts`：

```ts
// Last-known-real snapshot cache (localStorage). Local-first: content never leaves the machine.
// Callers must only save live-bridge data — demo/mock data is never cached.
import type { Agent } from '../flows/shared/types'
import type { ObservedSession } from './types'

export interface SnapshotStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

export interface Snapshot {
  savedAt: number
  sessions: ObservedSession[]
  agents: Agent[]
}

export const SNAPSHOT_KEY = 'petdeck.snapshot.v1'
export const SNAPSHOT_CAP = 200

export function saveSnapshot(
  storage: SnapshotStorage | null,
  data: { sessions: ObservedSession[]; agents: Agent[] },
  now: number,
): void {
  if (!storage) return
  try {
    const snap: Snapshot = { savedAt: now, sessions: data.sessions.slice(0, SNAPSHOT_CAP), agents: data.agents }
    storage.setItem(SNAPSHOT_KEY, JSON.stringify(snap))
  } catch { /* storage full/unavailable => degrade to memory-only */ }
}

export function loadSnapshot(storage: SnapshotStorage | null): Snapshot | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(SNAPSHOT_KEY)
    if (!raw) return null
    const j = JSON.parse(raw) as Partial<Snapshot>
    if (typeof j.savedAt !== 'number' || !Array.isArray(j.sessions) || !Array.isArray(j.agents)) {
      storage.removeItem(SNAPSHOT_KEY)
      return null
    }
    return { savedAt: j.savedAt, sessions: j.sessions, agents: j.agents }
  } catch {
    try { storage.removeItem(SNAPSHOT_KEY) } catch { /* ignore */ }
    return null
  }
}
```

- [ ] **Step 4: 运行确认通过 + 加入 npm test**

Run: `node --test src/adapters/snapshot-cache.test.ts`
Expected: PASS（6 tests）

`package.json` test 脚本在 `src/adapters/connection.test.ts` 后追加 `src/adapters/snapshot-cache.test.ts`。

Run: `npm test`
Expected: 全部 PASS（60）

- [ ] **Step 5: Commit**

```bash
git add petdeck/src/adapters/snapshot-cache.ts petdeck/src/adapters/snapshot-cache.test.ts petdeck/package.json
git commit -m "feat(adapters): 真实快照 localStorage 缓存（损坏丢弃 + 200 上限 + 降级）"
```

---

### Task 5: event-dedup.ts — SSE 重放去重

**Files:**
- Create: `petdeck/src/adapters/event-dedup.ts`
- Test: `petdeck/src/adapters/event-dedup.test.ts`
- Modify: `petdeck/package.json`（test 脚本）

**Interfaces:**
- Consumes: 无
- Produces: `createDeduper(cap?: number): { seen(id: string): boolean }`——首次见到返回 true，重复返回 false；超 cap 按 FIFO 淘汰最旧 id。默认 cap 500。

- [ ] **Step 1: 写失败测试**

创建 `petdeck/src/adapters/event-dedup.test.ts`：

```ts
// RED tests for SSE replay dedup (bus re-subscribe replays recent events with same id).
// Run: node --test src/adapters/event-dedup.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeduper } from './event-dedup.ts';

test('dedup: first sighting true, repeat false', () => {
  const d = createDeduper();
  assert.equal(d.seen('a'), true);
  assert.equal(d.seen('a'), false);
});

test('dedup: distinct ids independent', () => {
  const d = createDeduper();
  assert.equal(d.seen('a'), true);
  assert.equal(d.seen('b'), true);
  assert.equal(d.seen('a'), false);
});

test('dedup: FIFO eviction beyond cap', () => {
  const d = createDeduper(2);
  d.seen('a'); d.seen('b'); d.seen('c'); // a evicted
  assert.equal(d.seen('a'), true);
  assert.equal(d.seen('c'), false);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test src/adapters/event-dedup.test.ts`
Expected: FAIL — `Cannot find module './event-dedup.ts'`

- [ ] **Step 3: 最小实现**

创建 `petdeck/src/adapters/event-dedup.ts`：

```ts
// Id-based dedup for SSE replay: bridge bus re-subscribe replays recent events.
export function createDeduper(cap = 500): { seen(id: string): boolean } {
  const set = new Set<string>()
  const order: string[] = []
  return {
    seen(id) {
      if (set.has(id)) return false
      set.add(id)
      order.push(id)
      if (order.length > cap) {
        const old = order.shift()
        if (old !== undefined) set.delete(old)
      }
      return true
    },
  }
}
```

- [ ] **Step 4: 运行确认通过 + 加入 npm test**

Run: `node --test src/adapters/event-dedup.test.ts`
Expected: PASS（3 tests）

`package.json` test 脚本在 `src/adapters/snapshot-cache.test.ts` 后追加 `src/adapters/event-dedup.test.ts`。

Run: `npm test`
Expected: 全部 PASS（63）

- [ ] **Step 5: Commit**

```bash
git add petdeck/src/adapters/event-dedup.ts petdeck/src/adapters/event-dedup.test.ts petdeck/package.json
git commit -m "feat(adapters): SSE 重放事件 id 去重（FIFO cap 500）"
```

---

### Task 6: 前端数据接缝重写（types + registry + telemetry + bridge-client + data.tsx + context）

**Files:**
- Modify: `petdeck/src/adapters/types.ts`（ObservedSession）
- Modify: `petdeck/src/flows/shared/types.ts`（Session）
- Modify: `petdeck/src/adapters/registry.ts`（selectSource 语义 + injectOrClipboard）
- Modify: `petdeck/src/adapters/logic.test.ts`（selectSource 用例重写 + injectOrClipboard 用例）
- Modify: `petdeck/src/telemetry/core.ts`（EVENT +2）
- Modify: `petdeck/src/telemetry/core.test.ts`（新事件测试）
- Modify: `petdeck/src/adapters/bridge-client.ts`（subscribeEvents 钩子）
- Modify: `petdeck/src/adapters/pet-data-context.ts`（+connState/savedAt/reconnect）
- Modify: `petdeck/src/adapters/data.tsx`（Provider 重写）

**Interfaces:**
- Consumes: Task 3 `nextConnState/ConnSnapshot`；Task 4 `saveSnapshot/loadSnapshot/SnapshotStorage`；Task 5 `createDeduper`；Task 2 协议（行带 stale/lastSeen，health 带 sources）
- Produces: `selectSource(demo: boolean): 'live'|'mock'`；`clipboardPackage(p: InjectPayload): InjectDecision`；`injectOrClipboard(p: InjectPayload, live: boolean, bridge: (p)=>Promise<InjectDecision>): Promise<InjectDecision>`；`EVENT.offlineEntered='offline_entered'`、`EVENT.connectionRecovered='connection_recovered'`；`subscribeEvents(fn, hooks?: {onOpen?: ()=>void; onError?: ()=>void}): ()=>void`；`PetDataContextValue` 增加 `connState: ConnState; savedAt: number|null; reconnect(): void`；`DataSourceProvider({demo?: boolean, children})`。Session/ObservedSession 增加 `stale?: boolean; lastSeen?: number`。

- [ ] **Step 1: 写失败测试（registry 新语义 + injectOrClipboard + EVENT）**

`petdeck/src/adapters/logic.test.ts`：import 行改为

```ts
import { selectSource, gateInject, injectOrClipboard } from './registry.ts';
```

把现有 `test('registry: selectSource live only when bridge healthy', ...)` 整个替换为：

```ts
test('registry: selectSource mock only on explicit demo', () => {
  assert.equal(selectSource(true), 'mock');
  assert.equal(selectSource(false), 'live');
});

test('registry: injectOrClipboard clipboard when not live', async () => {
  const d = await injectOrClipboard({ to: 'kimi', context: 'c', instruction: 'i' }, false, async () => { throw new Error('must not be called'); });
  assert.equal(d.mode, 'clipboard');
  assert.match(d.package ?? '', /Relay handoff package/);
});

test('registry: injectOrClipboard clipboard when bridge throws', async () => {
  const d = await injectOrClipboard({ to: 'codex' }, true, async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(d.mode, 'clipboard');
});

test('registry: injectOrClipboard passes through bridge decision', async () => {
  const d = await injectOrClipboard({ to: 'codex' }, true, async () => ({ mode: 'inject', response: 'ok' }));
  assert.equal(d.mode, 'inject');
  assert.equal(d.response, 'ok');
});
```

`petdeck/src/telemetry/core.test.ts` 末尾追加：

```ts
test('EVENT: offline connection events exist', () => {
  assert.equal(EVENT.offlineEntered, 'offline_entered');
  assert.equal(EVENT.connectionRecovered, 'connection_recovered');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test src/adapters/logic.test.ts src/telemetry/core.test.ts`
Expected: FAIL — selectSource(false) 返回 'mock' 而非 'live'；injectOrClipboard 未导出；EVENT.offlineEntered undefined

- [ ] **Step 3: GREEN — registry + types + EVENT**

`petdeck/src/adapters/registry.ts` 整个替换为：

```ts
// Adapter registry: source selection (explicit demo only) + capability gating + inject fallback.
// Pure logic, unit-tested in logic.test.ts.
import type { CapabilityTier } from '../flows/shared/types'
import type { InjectDecision, InjectPayload } from './types'

export type SourceMode = 'live' | 'mock'

/** 演示数据仅在显式开关时使用；bridge 健康与否由连接状态机处理，不再自动降级 mock。 */
export function selectSource(demo: boolean): SourceMode {
  return demo ? 'mock' : 'live'
}

/** full =双向 inject；observe-only / manual = 剪贴板交接。 */
export function gateInject(tier: CapabilityTier): boolean {
  return tier === 'full'
}

export function clipboardPackage(p: InjectPayload): InjectDecision {
  return { mode: 'clipboard', package: `Relay handoff package:\n${p.context ?? ''}\n${p.instruction ?? ''}` }
}

/** live 且 bridge 可达 → 真注入；否则（mock 模式 / bridge 断连）→ 剪贴板降级。 */
export async function injectOrClipboard(
  p: InjectPayload,
  live: boolean,
  bridge: (p: InjectPayload) => Promise<InjectDecision>,
): Promise<InjectDecision> {
  if (!live) return clipboardPackage(p)
  try { return await bridge(p) } catch { return clipboardPackage(p) }
}
```

`petdeck/src/adapters/types.ts` 的 ObservedSession 接口追加两个可选字段（`turn?: string` 之后）：

```ts
  stale?: boolean
  lastSeen?: number
```

`petdeck/src/flows/shared/types.ts` 的 Session 接口追加（`updatedAt: string` 之后）：

```ts
  stale?: boolean
  lastSeen?: number
```

`petdeck/src/telemetry/core.ts` 的 EVENT 对象追加（`panelDrilldown` 之后）：

```ts
  offlineEntered: 'offline_entered',
  connectionRecovered: 'connection_recovered',
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test src/adapters/logic.test.ts src/telemetry/core.test.ts`
Expected: PASS

- [ ] **Step 5: bridge-client 加 SSE 钩子**

`petdeck/src/adapters/bridge-client.ts` 的 subscribeEvents 替换为：

```ts
export function subscribeEvents(
  fn: (e: Record<string, unknown>) => void,
  hooks?: { onOpen?: () => void; onError?: () => void },
): () => void {
  const es = new EventSource(`${BRIDGE_URL}/api/events`)
  es.onmessage = (m) => {
    try { fn(JSON.parse(m.data)) } catch { /* ignore malformed */ }
  }
  if (hooks?.onOpen) es.onopen = hooks.onOpen
  if (hooks?.onError) es.onerror = hooks.onError
  return () => es.close()
}
```

- [ ] **Step 6: context 扩展**

`petdeck/src/adapters/pet-data-context.ts`：import 区追加

```ts
import type { ConnState } from './connection'
```

`PetDataContextValue` 接口追加（`inject` 声明之后）：

```ts
  connState: ConnState
  savedAt: number | null
  reconnect(): void
```

- [ ] **Step 7: data.tsx 整个替换**

`petdeck/src/adapters/data.tsx` 整个文件替换为：

```tsx
// Data-source seam: live bridge with offline cache + partial-sync freshness.
// Demo data only via explicit `demo` prop — never an automatic fallback.
// Only exports the provider component; context/hook live in pet-data-context.ts.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PetEvent, Project, Session } from '../flows/shared/types'
import { mockPetData } from './mock-adapter'
import { fetchAgents, fetchHealth, fetchSessions, inject as bridgeInject, subscribeEvents } from './bridge-client'
import { selectSource, injectOrClipboard } from './registry'
import { PetDataCtx, type PetDataContextValue } from './pet-data-context'
import { nextConnState, type ConnSnapshot } from './connection'
import { loadSnapshot, saveSnapshot, type SnapshotStorage } from './snapshot-cache'
import { createDeduper } from './event-dedup'
import { track, EVENT } from '../telemetry'
import type { ObservedSession, PetData, RawAgentEvent } from './types'

const STATUS_MAP: Record<string, Session['status']> = {
  done: 'done', running: 'active', stuck: 'stuck', waiting: 'waiting', unknown: 'active',
}

function observedToSessions(rows: ObservedSession[]): Session[] {
  return rows.map((r) => ({
    id: `${r.agent}:${r.session}`,
    projectId: 'live',
    agentId: r.agent,
    title: r.lastMessage || r.session,
    status: STATUS_MAP[r.status] ?? 'active',
    messages: r.lastMessage
      ? [{ id: `${r.session}-m`, role: 'agent' as const, content: r.lastMessage, timestamp: new Date().toISOString(), artifactIds: [] }]
      : [],
    artifactIds: [],
    updatedAt: new Date().toISOString(),
    stale: r.stale,
    lastSeen: r.lastSeen,
  }))
}

function liveProjects(sessions: Session[]): Project[] {
  return [{ id: 'live', name: '实时 Agent', description: '来自本地 bridge 的真实会话', sessionIds: sessions.map((s) => s.id), updatedAt: new Date().toISOString() }]
}

function emptyLive(): PetData {
  return { mode: 'live', agents: [], projects: [], sessions: [], events: [], artifacts: [] }
}

function browserStorage(): SnapshotStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

export function DataSourceProvider({ demo = false, children }: { demo?: boolean; children: ReactNode }) {
  const [data, setData] = useState<PetData>(emptyLive)
  const [agentEvents, setAgentEvents] = useState<RawAgentEvent[]>([])
  const [conn, setConn] = useState<ConnSnapshot>({ state: 'reconnecting', fails: 0 })
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const eventsRef = useRef<PetEvent[]>([])
  const dedupRef = useRef(createDeduper(500))
  const savedKeyRef = useRef('')
  const cacheShownRef = useRef(false)
  const tickRef = useRef<() => void>(() => {})
  const prevConnRef = useRef(conn.state)
  const mockData = useMemo(() => mockPetData(), [])

  useEffect(() => {
    if (selectSource(demo) === 'mock') return
    let alive = true
    let un: (() => void) | null = null
    const storage = browserStorage()
    const tick = async () => {
      const healthy = await fetchHealth()
      if (!alive) return
      setConn((prev) => nextConnState(prev, { type: 'health', ok: healthy }))
      if (healthy) {
        cacheShownRef.current = false
        const [agents, rows] = await Promise.all([fetchAgents(), fetchSessions()])
        if (!alive) return
        const sessions = observedToSessions(rows)
        setData({ mode: 'live', agents, projects: liveProjects(sessions), sessions, events: eventsRef.current, artifacts: [] })
        setSavedAt(null)
        const key = JSON.stringify(rows)
        if (key !== savedKeyRef.current) {
          savedKeyRef.current = key
          saveSnapshot(storage, { sessions: rows, agents }, Date.now())
        }
        if (!un) {
          un = subscribeEvents((e) => {
            if (e.type === 'sessions' || e.petType === 'sessions') {
              const sseRows = (e.payload as { sessions?: ObservedSession[] })?.sessions ?? []
              setData((prev) => ({ ...prev, sessions: observedToSessions(sseRows) }))
              return
            }
            const raw: RawAgentEvent = { id: String(e.id ?? Date.now()), agentId: String(e.agentId ?? ''), type: String(e.type ?? ''), ts: Date.now() }
            if (!dedupRef.current.seen(raw.id)) return
            setAgentEvents((prev) => [raw, ...prev].slice(0, 100))
            const pt = e.petType as string
            if (pt) {
              eventsRef.current = [{
                id: raw.id,
                type: pt as PetEvent['type'],
                projectId: 'live',
                sessionId: String(e.sessionId ?? ''),
                text: String((e.payload as { lastMessage?: string })?.lastMessage ?? ''),
                timestamp: new Date().toISOString(),
                handled: false,
              }, ...eventsRef.current].slice(0, 50)
              setData((prev) => ({ ...prev, events: eventsRef.current }))
            }
          }, {
            onOpen: () => { setConn((prev) => nextConnState(prev, { type: 'sse', open: true })); tickRef.current() },
            onError: () => { setConn((prev) => nextConnState(prev, { type: 'sse', open: false })) },
          })
        }
      } else if (!cacheShownRef.current) {
        cacheShownRef.current = true
        const cached = loadSnapshot(storage)
        if (cached) {
          const sessions = observedToSessions(cached.sessions)
          setData({ mode: 'live', agents: cached.agents, projects: liveProjects(sessions), sessions, events: eventsRef.current, artifacts: [] })
          setSavedAt(cached.savedAt)
        } else {
          setData(emptyLive())
          setSavedAt(null)
        }
      }
    }
    tickRef.current = () => { void tick() }
    void tick()
    const t = setInterval(() => { void tick() }, 5000)
    return () => { alive = false; clearInterval(t); if (un) un() }
  }, [demo])

  // 连接状态迁移埋点（行为-only，无内容字段）
  useEffect(() => {
    const prev = prevConnRef.current
    if (conn.state === 'offline' && prev !== 'offline') track('shell', EVENT.offlineEntered, { fails: conn.fails })
    if (conn.state === 'live' && prev === 'offline') track('shell', EVENT.connectionRecovered)
    prevConnRef.current = conn.state
  }, [conn.state, conn.fails])

  const shown = demo ? mockData : data
  const value = useMemo<PetDataContextValue>(() => ({
    ...shown,
    getAgent: (id) => shown.agents.find((a) => a.id === id),
    getProject: (id) => shown.projects.find((p) => p.id === id),
    getSession: (id) => shown.sessions.find((s) => s.id === id),
    getArtifact: (id) => shown.artifacts.find((a) => a.id === id),
    sessionsOfProject: (pid) => shown.sessions.filter((s) => s.projectId === pid),
    unhandledEvents: () => shown.events.filter((e) => !e.handled),
    agentEvents,
    connState: conn.state,
    savedAt,
    reconnect: () => tickRef.current(),
    inject: (p) => injectOrClipboard(p, shown.mode === 'live', bridgeInject),
  }), [shown, agentEvents, conn.state, savedAt])

  return <PetDataCtx.Provider value={value}>{children}</PetDataCtx.Provider>
}
```

- [ ] **Step 8: 全量测试 + 构建 + lint**

Run: `npm test`
Expected: 全部 PASS（63 + 4 新 registry 用例 - 1 旧用例 + 1 EVENT 用例 = 67）

Run: `npx vite build`
Expected: 构建成功，无 TS 错误

Run: `npx oxlint src server`
Expected: 0 warnings / 0 errors（若报 exhaustive-deps / set-state-in-effect / react-ref，修正代码而非禁用规则：ref 写入只发生在 effect 内；setState 均在 await 之后）

- [ ] **Step 9: Commit**

```bash
git add petdeck/src/adapters petdeck/src/flows/shared/types.ts petdeck/src/telemetry/core.ts petdeck/src/telemetry/core.test.ts
git commit -m "feat(adapters): 离线缓存接线 — demo 显式化 + 连接状态机 + 快照缓存 + 重同步去重 + inject 剪贴板降级"
```

---

### Task 7: UI 表面（Shell 四态 + demo 开关 + Flow1/3/4 stale）

**Files:**
- Modify: `petdeck/src/flows/shared/ui-logic.ts`（fmtAgo）
- Modify: `petdeck/src/flows/shared/ui-logic.test.ts`（fmtAgo 测试）
- Modify: `petdeck/src/flows/petdeck/petdeck.tsx`（Shell）
- Modify: `petdeck/src/flows/flow-1-pet-surface/flow1-pet-surface.tsx`
- Modify: `petdeck/src/flows/flow-3-panel/flow3-panel.tsx`
- Modify: `petdeck/src/flows/flow-4-relay/flow4-relay.tsx`

**Interfaces:**
- Consumes: Task 6 的 `usePetData()` 新字段 `connState / savedAt / reconnect`；`Session.stale/lastSeen`
- Produces: `fmtAgo(ts: number, now: number): string`（'刚刚' / 'N 分钟前' / 'N 小时前' / 'N 天前'）；Shell `DataSourceProvider demo={demo}`；四态 badge；真实离线 banner；Flow1 offline 灰化；Flow3 stale Tag；Flow4 stale 提示。

- [ ] **Step 1: 写 fmtAgo 失败测试**

`petdeck/src/flows/shared/ui-logic.test.ts` import 行改为：

```ts
import { stepperState, resolveMotionEnabled, fmtAgo } from './ui-logic.ts';
```

末尾追加：

```ts
test('fmtAgo: relative freshness buckets', () => {
  const now = 1_700_000_000_000;
  assert.equal(fmtAgo(now - 30_000, now), '刚刚');
  assert.equal(fmtAgo(now - 5 * 60_000, now), '5 分钟前');
  assert.equal(fmtAgo(now - 3 * 3_600_000, now), '3 小时前');
  assert.equal(fmtAgo(now - 2 * 86_400_000, now), '2 天前');
  assert.equal(fmtAgo(now + 10_000, now), '刚刚');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test src/flows/shared/ui-logic.test.ts`
Expected: FAIL — fmtAgo 未导出

- [ ] **Step 3: 实现 fmtAgo**

`petdeck/src/flows/shared/ui-logic.ts` 末尾追加：

```ts
/** 新鲜度相对时间（stale 标记用）。ts 在未来时按「刚刚」处理。 */
export function fmtAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 60) return '刚刚'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}
```

Run: `node --test src/flows/shared/ui-logic.test.ts`
Expected: PASS

- [ ] **Step 4: Shell 四态 + demo 开关 + 真实离线 banner**

`petdeck/src/flows/petdeck/petdeck.tsx`：

(a) lucide import 行：去掉 `WifiOff`，加 `FlaskConical`：

```tsx
import { Sun, Moon, FlaskConical } from 'lucide-react'
```

(b) Shell 签名与状态区替换：

```tsx
function Shell({ appearance, onToggleAppearance, demo, onToggleDemo }: { appearance: 'light' | 'dark'; onToggleAppearance: () => void; demo: boolean; onToggleDemo: () => void }) {
  const navigate = useNavigate()
  const { sessions, mode, connState, savedAt, reconnect } = usePetData()
  // mount-only：useRef 初始值即挂载时 mode，effect 内读取（不在 render 期写 ref）
  const modeRef = useRef(mode)
  useEffect(() => { track('shell', EVENT.appSessionStart, { mode: modeRef.current }) }, [])
  const running = sessions.filter((s) => s.status === 'active').length
  const waiting = sessions.filter((s) => s.status === 'waiting' || s.status === 'stuck').length
  const offline = connState === 'offline' && mode !== 'mock'
  const clock = savedAt !== null ? new Date(savedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : null
  const badge = mode === 'mock'
    ? { color: 'slate' as const, label: '演示' }
    : connState === 'live'
      ? { color: 'success' as const, label: '实时' }
      : connState === 'reconnecting'
        ? { color: 'warning' as const, label: '重连中' }
        : { color: 'error' as const, label: clock ? `离线 · 截至 ${clock}` : '离线' }
```

(c) header 里的 Tag 替换：

```tsx
        <Tag color={badge.color}>{badge.label}</Tag>
```

(d) header 右侧按钮区：删除「模拟离线」WifiOff 按钮，替换为 demo 开关：

```tsx
        <div className="ml-auto flex gap-1">
          <Button variant="ghost" aria-label="切换演示数据" aria-pressed={demo} onClick={onToggleDemo}>
            <FlaskConical className="h-4 w-4" />
          </Button>
          <Button variant="ghost" aria-label="切换亮暗色" onClick={onToggleAppearance}>
            {appearance === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </Button>
        </div>
```

(e) 离线 banner 替换（原 `{offline && (...)}` 块）：

```tsx
      {/* offline-no-network：真实连接状态驱动，不阻断缓存查看 */}
      {offline && (
        <div className="p-3">
          <EdgeAlert
            variant="info"
            title="当前离线"
            desc={clock ? `查看的是本地缓存（截至 ${clock}）；恢复后自动同步。` : '尚未连接本地 bridge；启动后自动同步。'}
            onRetry={reconnect}
            retryLabel="重连"
          />
        </div>
      )}
```

(f) PetDeckApp 替换为：

```tsx
export function PetDeckApp() {
  const [appearance, setAppearance] = useState<'light' | 'dark'>('light')
  const [demo, setDemo] = useState(false)
  return (
    <ThemeStyleProvider appearance={appearance} theme="mint" style="soft">
      <ErrorBoundary>
        <DataSourceProvider demo={demo}>
          <Shell
            appearance={appearance}
            onToggleAppearance={() => setAppearance((a) => (a === 'light' ? 'dark' : 'light'))}
            demo={demo}
            onToggleDemo={() => setDemo((d) => !d)}
          />
        </DataSourceProvider>
      </ErrorBoundary>
    </ThemeStyleProvider>
  )
}
```

(g) 底部浮动宠物按钮里的 `offline` 变量现在来自真实 connState（表达式不变，无需改动）；确认 `PetAvatar status={offline ? 'offline' : ...}` 与 Tag 仍引用同名变量。

- [ ] **Step 5: Flow1 真实 offline 驱动**

`petdeck/src/flows/flow-1-pet-surface/flow1-pet-surface.tsx` 的 Flow1_PetSurface 根组件：

`const { projects, unhandledEvents } = usePetData()` 改为：

```tsx
  const { projects, unhandledEvents, connState } = usePetData()
```

在 `const openPanel = ...` 之前追加：

```tsx
  // 真实离线覆盖预览状态：断连时宠物灰化 + 重连 CTA（edge offline-no-network 态）
  const effectiveStatus: AgentStatus = connState === 'offline' ? 'offline' : status
```

`<Screen1_AmbientIdle status={status}` 改为 `status={effectiveStatus}`。

- [ ] **Step 6: Flow3 stale 标记**

`petdeck/src/flows/flow-3-panel/flow3-panel.tsx`：

(a) ui-logic import 行改为：

```tsx
import { fmtCount, fmtAgo } from '../shared/ui-logic'
```

(b) Screen3_SessionThread 头部状态 Tag 之后（`<Tag color={STATUS_TAG[session.status].color}>...` 行后）追加：

```tsx
        {session.stale && <Tag color="slate">stale · {fmtAgo(session.lastSeen ?? Date.now(), Date.now())}</Tag>}
```

(c) 侧栏会话行按钮内、`<Tooltip content={s.title} side="right">...</Tooltip>` 之后追加：

```tsx
                                    {s.stale && <span className="ml-1 shrink-0 text-xs text-text-secondary">stale</span>}
```

- [ ] **Step 7: Flow4 追踪 stale 提示**

`petdeck/src/flows/flow-4-relay/flow4-relay.tsx`：

(a) Screen3_Tracking 参数解构加 `stale`，类型加 `stale: boolean`（放在 `liveStatus` 之后）：

```tsx
function Screen3_Tracking({
  source,
  target,
  error,
  isLive,
  liveStatus,
  stale,
  onRetry,
  onCopy,
  onDone,
  onSimFail,
  onStop,
}: {
  source: Session
  target: Agent
  error: boolean
  isLive: boolean
  liveStatus: TrackingStatus
  stale: boolean
  onRetry: () => void
  onCopy: () => void
  onDone: () => void
  onSimFail: () => void
  onStop: () => void
}) {
```

(b) 第一个 EdgeAlert（`已接力给 ${target.name}`）之后追加：

```tsx
      {stale && (
        <EdgeAlert variant="info" title="状态可能滞后" desc="目标 Agent 数据来自离线缓存，恢复连接后以实时状态为准。" />
      )}
```

(c) Flow4_Relay 根组件：`usePetData()` 解构追加 `sessions`：

```tsx
  const { getAgent, getArtifact, agents: mockAgents, inject, agentEvents, mode, sessions } = usePetData()
```

在 `const liveStatus = deriveTracking(...)` 之后追加：

```tsx
  const targetStale = sessions.some((s) => s.agentId === draft.targetAgentId && s.stale)
```

(d) `<Screen3_Tracking` 调用处追加 prop：`stale={targetStale}`（放在 `liveStatus={liveStatus}` 之后）。

- [ ] **Step 8: 全量测试 + 构建 + lint**

Run: `npm test`
Expected: 全部 PASS（68）

Run: `npx vite build`
Expected: 成功

Run: `npx oxlint src server`
Expected: 0 warnings / 0 errors

- [ ] **Step 9: Commit**

```bash
git add petdeck/src/flows
git commit -m "feat(ui): 连接四态 badge + 显式演示开关 + 真实离线灰化 + stale 新鲜度标记"
```

---

### Task 8: 端到端浏览器实证 + 质量门 + 推送

**Files:**
- 无新代码文件；验证脚本为一次性（throwaway），不入库。

**Interfaces:**
- Consumes: Task 1-7 全部产出
- Produces: spec §7 验收标准全部勾选；CI 绿；Phase 2 提交链推送完成。

- [ ] **Step 1: 启动环境**

确认 dev server 在 5173（`curl -s -o /dev/null -w "%{http_code}" http://localhost:5173` → 200；否则在 `petdeck/` 后台跑 `npm run dev`）。确认 bridge 在 5199（Task 2 启动的进程；若已停则后台重启 `node server/bridge.mjs`）。**不得触碰 5174。**

- [ ] **Step 2: 实证 1+2 — kill bridge → 离线缓存 → 重启自动恢复**

浏览器打开 `http://localhost:5173/panel`（browser-use MCP；`evaluate_script` 的参数名是 `function`）。等 badge 显示「实时」。记录当前会话列表文本。

停掉 bridge 进程。等 ~10s（2 次 health 失败）。用 evaluate_script 断言：

```js
() => {
  const badge = document.querySelector('header span.rounded-full, header [class*=tag]')?.textContent ?? document.querySelector('header')?.textContent ?? ''
  const banner = document.body.innerText.includes('当前离线')
  const cached = document.body.innerText.includes('实时 Agent') || document.body.innerText.length > 0
  return { header: document.querySelector('header')?.textContent, banner }
}
```

Expected: header 含「离线 · 截至」；banner true；面板仍显示之前的真实会话（不是演示数据——演示数据含「示例项目」类 mock 文案，真实数据项目名为「实时 Agent」）。Flow1（/pet）宠物 aria-label 含「离线」。

重启 bridge。等 ~10s。Expected: badge 回到「实时」，banner 消失。在 Flow3 先重命名一个会话（本地 overlay），再 kill/重启 bridge 一轮，确认重命名保留（mergeSessions overlay 生效）。

- [ ] **Step 3: 实证 3 — 单源失效部分同步（fake opencode serve）**

后台启动一次性 fake serve（throwaway）：

```bash
node -e "require('http').createServer((q,s)=>{s.setHeader('Content-Type','application/json');s.end(JSON.stringify([{id:'oc-fixture-1',title:'partial-sync fixture'}]))}).listen(4096,'127.0.0.1',()=>console.log('fake opencode serve on 4096'))"
```

等 5-10s（bridge poll）。Run: `curl -s http://127.0.0.1:5199/api/sessions`
Expected: 出现 `agent:'opencode', session:'oc-fixture-1', stale:false` 行；`/api/health` 的 `sources.opencode.ok === true`。

停掉 fake serve。等 5-10s。Run: `curl -s http://127.0.0.1:5199/api/sessions`
Expected: 该行仍在，`stale:true`，`lastSeen` 为上次成功时间；`sources.opencode = {ok:false, lastSeen:<上次>}`；其余 agent 行 `stale:false`。

浏览器 Flow3 打开该会话线程：Expected 头部出现「stale · N 分钟前」Tag；侧栏行有 stale 字样。

- [ ] **Step 4: 实证 4 — SSE 重连去重**

bridge 运行中，在浏览器 evaluate_script 记录 `window` 侧事件数不可直接取——改为：kill bridge → 重启（EventSource 自动重连，bus replay 重发近期事件）。在 Flow4 发起一次接力到 codex（真实 inject），观察追踪屏：Expected 无重复「已完成」跳变、无重复 toast；`curl -s http://127.0.0.1:5199/api/health` 正常。若 codex inject 不稳（spike 已知），降级剪贴板也算通过（injectOrClipboard 路径）。

- [ ] **Step 5: 实证 5 — 演示开关 + 无缓存空态**

点击 header 烧瓶按钮（aria-label「切换演示数据」）。Expected: badge「演示」，面板显示 mock 数据；再点一次回到「实时」。

无缓存空态：evaluate_script 执行 `() => { localStorage.removeItem('petdeck.snapshot.v1'); return 'cleared' }`，停 bridge，刷新页面。Expected: badge「离线」（无「截至」），banner 文案「尚未连接本地 bridge」，Flow3 显示「还没有项目」空态 + 连接 CTA，**不出现 mock 数据**。重启 bridge 恢复。

- [ ] **Step 6: 埋点隐私核查**

evaluate_script：

```js
() => {
  const raw = localStorage.getItem('petdeck.telemetry.v1') ?? '[]'
  const evts = JSON.parse(raw)
  const conn = evts.filter((e) => e.action === 'offline_entered' || e.action === 'connection_recovered')
  const forbidden = ['context', 'instruction', 'lastMessage', 'content', 'message', 'prompt']
  const leak = evts.some((e) => Object.keys(e.extra ?? {}).some((k) => forbidden.includes(k)))
  return { connEvents: conn.length, contentLeak: leak, sample: conn.slice(0, 2) }
}
```

Expected: `connEvents >= 1`（前面 kill/重启已触发），`contentLeak: false`，offline_entered 的 extra 仅 `{fails}`。

- [ ] **Step 7: 质量门**

Run: `npm test` → 68 PASS
Run: `npx vite build` → 干净
Run: `npx oxlint src server` → 0 warnings / 0 errors

- [ ] **Step 8: 推送 + CI**

```bash
git push origin master
```

用 `gh run list --limit 1` / `gh run watch` 确认本次 push 的 CI（job `ci`）成功。master 受保护，必需检查 `ci`。

- [ ] **Step 9: 收尾记录**

在 `archive/phase-1-2026-11-14/INDEX.md` 的「Phase 2 待办」节把 offline-partial-sync 标为已完成（一行注记：日期 + commit 范围 + 68 测试），或新建 `docs/superpowers/specs/` 旁的简短完成注记（不新建 README）。提交：

```bash
git add archive/phase-1-2026-11-14/INDEX.md
git commit -m "docs: Phase 2 offline-partial-sync 完成注记（验收 5 条 + 质量门）"
git push origin master
```

---

## Self-Review 结果（计划作者已执行）

1. **Spec 覆盖**：§3.1 pollOnce/协议 → Task 1-2；§3.2 connection/cache/dedup/registry/data → Task 3-6；§3.3 UI 四态 → Task 7；§3.4 埋点 2 事件 → Task 6 Step 1/3 + Task 8 Step 6 隐私核查；§5 错误处理（损坏丢弃/null storage/重启重同步/抖动 key/长期离线 savedAt/无缓存空态/inject 降级）→ Task 4/6/8 各有对应；§6 测试策略 → 各任务 TDD + Task 8 实证；§7 验收 7 条 → Task 8 Step 2-7 逐条映射。无遗漏。
2. **占位符扫描**：无 TBD/TODO；所有代码步骤含完整代码。
3. **类型一致性**：`pollOnce` 返回 `{sessions, sources, lastGood, key}` 在 Task 1/2 一致；`ConnSnapshot{state,fails}` 在 Task 3/6 一致；`SnapshotStorage` 三方法在 Task 4/6 一致；`seen(id)` 语义（首次 true）在 Task 5/6 一致；`selectSource(demo)` 在 Task 6 测试与实现一致；`connState/savedAt/reconnect` 在 Task 6 context 与 Task 7 消费一致；`stale/lastSeen` 可选字段贯穿 types→data→UI。