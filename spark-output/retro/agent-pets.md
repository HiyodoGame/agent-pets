# Retro — Agent Pets（阶段复盘 · 未上线）

- **生成时间**：2026-11-14T01:20:00+08:00
- **项目周期**：2026-11-13 → 2026-11-14（阶段交付：原型+adapter+SSE+设计链 11/27）
- **计划 vs 实际**：1 周 spike → 实际 <1 天（observe+inject 闭环实证）
- **复盘时间**：阶段复盘（未上线，无真实 NSM 数据；上线指标标 inconclusive）
- **团队规模**：1（单人全职）

## 📊 Project Summary

押方向 B「接力秘书」。spike 先行消除集成不确定性，设计链与实现并行；用户跳过用研直接开发（创始人亲历即证据）。stories/sitemap 后补补强 PRD 至 strong。QA 复跑 0 major。

## ⚖️ Decision Validation

### ✅ Validated（6）
| 决策 | 实际结果 | Lesson |
| --- | --- | --- |
| 押 B 接力 | spike 跨 Agent 闭环；竞品空白 | 接力是唯一蓝海且可行 |
| C 延后 | 集成不支持全自动 | 延后正确 |
| IA 三级 | Flow3 QA pass | 项目优先心智成立 |
| 接力≤3步 | Flow4 实现 | 可达成 |
| 砍 macOS/团队 | 资源集中 | 单人砍范围正确 |
| P0=接力/监控 | 与 spike 能力匹配 | 优先级对齐能力 |

### ⚠️ Partially（3）
calm tech「轻拍」（机制落地、体验待验证）；动效「可关」（缺用户级开关）；跳过用研（方向成立、Value 待校准）。

### ❓ Inconclusive（1）
offline-partial-sync 延后（未上线不知弱网占比）。

## 🎯 Assumption Validation

| 假设 | 目标 | 实际 | 判定 |
| --- | --- | --- | --- |
| 集成可行性 | 每类 observe+1 类闭环 | spike 达成（CLI 全链路/网页观察） | ✅ validated |
| OPC 愿付费 | 转化≥5% | 未上线无数据 | ❓ inconclusive |
| NSM 人均日接力≥3 | ≥3 | 未上线、埋点 missing | ❓ inconclusive |

## ✨ What Worked（5）
1. spike 先行再画 UI（避免不可行集成上设计）。
2. 能力分级+剪贴板降级（不确定性变产品分级）。
3. TDD 27 测试+SSE 双模式实证（0 major）。
4. 链式双通道+dashboard（11 skill 不漂移）。
5. check→qa→edge 闭环修 3 major。

## ⚠️ What Didn't（5）
1. 凭 skill 映射写 import 白屏 → 读 registry d.ts。
2. 埋点事后补 → Metric 前置。
3. stories/sitemap 后补 PRD thin → 按链顺序。
4. a11y 语义/stepper/动效开关留 minor → Flow 阶段纳 AC。
5. 端口 5174 冲突 → 先探测+可配置。

## 💡 Surprises（4）
1. Spark skill 映射过时致白屏 → 以 installed 包为准。
2. Radix 隐藏 viewport 不激活 → DOM 级验证+Button group。
3. codex inject 不稳 observe 稳 → observe/inject 分离分级。
4. 5174 被占 → 端口探测+不杀他人进程。

## 🛠 Skill Usage
used/high：frame/brief/flow-web/check/qa/edge/metric/retro；moderate：prd/stories/sitemap（后补）。
unused：probe/test（用户跳过，上线后补 /test）；scope/audit（na）；pitch（单人无汇报）。
friction：flow-web 组件映射过时；metric 跑太晚。

## 🎯 Recommendations
- **自己**：Brief 后立即 Metric+must 埋点随 MVP；写 Spark import 前读 d.ts。
- **团队**：installed 包 API 快照 memory；端口先探测+env 可配置。
- **下个项目**：按 Brief→Stories→Sitemap→Flow；集成先 spike+分级；a11y 进 Flow AC。
- **组织**：flow-web component-map 与包版本对齐、Metric 前置 沉淀为 skill 改进项。

## Lessons Learned 卡片
1. 第三方集成产品：spike 先行 + 能力分级降级，把不确定性变产品分级。
2. 设计链按序跑 + Metric 前置，避免 PRD thin 与埋点事后补。
3. 组件 API 以 installed 包为准；自动化验证用 DOM 级，不依赖隐藏 viewport 的 CDP click。