# Metric Blueprint — Agent Pets

- **生成时间**：2026-11-13T22:40:00+08:00
- **数据工具**：自建轻量埋点·本地优先（行为事件→本地 SQLite/JSON，不报会话内容）
- **现有埋点覆盖**：none（原型无 analytics 事件，全部需新建）
- **复盘节奏**：v1 头 2 周 daily，稳定后 weekly
- **Owner**：创始人/设计师自己

## 🌟 North Star Metric

**人均日接力次数** = count(relay_done) / 活跃用户数 / 天数（按周滚动）

- 目标：≥3，60 天达成
- 业务对齐：brief.business_goal[3]「人均日接力≥3」；牵引 B2 留存、B3 付费
- 为什么是这个：方向 B 的核心价值交换是「接力替代人肉消息总线」。它比 DAU 好（消除规模噪音、是行为不是态度），比付费转化好（领先指标），比瞥见时长好（直指核而非壳）。可被接力 UX 影响；配 Counter 防刷量/防误接力。

## 🚀 Driver Metrics（4 个）

### D1 接力 30 秒·≤3 步完成率
- 推动 NSM：接力越快越省力→越愿意高频接力
- 公式：count(relay_done 且 ≤30s 且 ≤3步)/count(relay_started)；目标 ≥80%（30 天）
- 切片：tier / agent 形态 / 首次vs回访
- 事件：relay_started / relay_preview_confirmed / relay_inject_result / relay_done ❌missing

### D2 3 秒瞥见状态识别准确率
- 推动 NSM：监控壳可信才敢不盯窗口，维持活跃支撑接力频次
- 公式：3s 内正确识别次数/总瞥见次数；目标 ≥90%（/test 基线+30 天复测）
- 切片：四态 / 动效开关
- 事件：ambient_glance / glance_identify_result ❌missing

### D3 首个 Agent 接入时长中位数
- 推动 NSM：接入是激活第一关，≤5 分钟扩大可接力用户池
- 公式：median(connect_success−connect_started)；目标 ≤300s（30 天）
- 切片：agent 形态 / tier
- 事件：connect_started / agent_detected / connect_success ❌missing

### D4 种子首周首次接力激活率
- 推动 NSM：growth 入口杠杆，种子完成首次接力才进入 NSM 统计
- 公式：首周 relay_done≥1 种子/种子注册；目标 ≥50%（4 周，B1 质量门槛）
- 切片：渠道 / agent 数量分桶
- 事件：app_session_start / connect_success / relay_done ❌missing

## ⚠️ Counter Metrics（4 个，每 Driver 配 1）

| Counter | 防止什么 | 阈值 |
| --- | --- | --- |
| 接力降级/失败率 | 为速度跳过预览/确认、注入不稳误接力 | ≤20% |
| 通知打扰率(DND 开启率) | 通知轰炸违背 calm tech | DND≤30% 且关闭率≤10% |
| 接入放弃率 | 强制 modal/跳检测拉速度 | ≤25% |
| 周流失率 | 增长黑客反噬 | ≤60%（留存≥40%） |

## 💊 Health Metrics（4 个）

| 指标 | 保护什么 | 阈值 | 告警 |
| --- | --- | --- | --- |
| observe→SSE 延迟 P95 | 实时感知底线 | ≤5s | 连续2天>5s |
| full-tier inject 失败率 | 接力可达性 | ≤10% | 单日>20% |
| 首屏加载 P95 | 可用性基线 | ≤3s | 连续2天>3s |
| JS 错误率/SSE 断连率 | 稳定性 | ≤0.5%/≤1% | 错误>10 或断连>3% |

## 🔧 埋点缺口清单（给工程师/自己）

### 🔴 Must（8）
| 事件 | 位置 | 关联指标 |
| --- | --- | --- |
| relay_started | flow4-relay.tsx Screen1 onOpen | D1+NSM |
| relay_preview_confirmed | flow4-relay.tsx Screen2 confirm | D1 |
| relay_inject_result | flow4 onSend inject.then + bridge /api/inject | Counter+Health |
| relay_done | flow4 Screen3 onDone/Screen4 | NSM+D4 |
| connect_started | flow2 SelectAgent/Detect | D3+Counter |
| connect_success | flow2 Success 挂载 | D3+D4 |
| ambient_glance | flow1 Screen1 挂载/poke | D2 |
| app_session_start | petdeck.tsx Shell 挂载 | D4+活跃分母 |

### 🟠 Should（3）
dnd_toggle / notification_suppressed（flow1 DND）· relay_stopped（flow4 onStop）

### 🟡 Nice-to-have（2）
pet_poke（flow1）· panel_drilldown（flow3 onOpen）

## 📊 Dashboard 建议

**首屏**：🌟人均日接力 · 🚀接力30秒完成率 · 🚀首接入时长 · ⚠️接力降级率 · 💊inject失败率
**钻取**：tier / agent 形态 / 平台 / 首次vs回访 / 周·月
**节奏**：daily→weekly；**Owner**：创始人自己

## 下一步建议

- 把 Must 8 事件落到 PRD Section 6 埋点字段，工程一并交付（本地优先，只报行为不报内容）。
- 用本蓝图替代 Brief 简版写入 PRD Section 4。
- Pitch.asks 之一：上线是否等 Must 埋点齐 vs 先上后补（建议 NSM/relay_done 必须先埋）。
- 失败信号：人均日接力<1 或 接力降级率>40% 视为方向/集成问题，触发 iteration。