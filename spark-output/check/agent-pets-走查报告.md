# 设计走查报告

**走查目标**：Agent Pets / petdeck — flow-1-pet-surface / flow-2-connect-agent / flow-3-panel / flow-4-relay / App Shell
**走查时间**：2026-11-13
**走查模式**：Mode A 自动走查（Read + 静态检查 5 个代码文件 + shared；Brief 4 条设计标准 + 4 维策略作一致性基线）
**技术栈**：Spark Design（npm）+ Vite + React + Tailwind 4

## 总览

| 严重度 | 数量 |
| --- | --- |
| 🔴 Blocker | 0 |
| 🟠 Major | 3 |
| 🟡 Minor | 7 |
| ✅ Pass（类别无 finding） | 3（ia / components / copy） |

## 优先确认：Brief 策略维度落地核对

| 维度 | thesis | 落地位置 | 判定 |
| --- | --- | --- | --- |
| 信息架构 IA | 项目→任务→会话三级，余光可读 | Flow1 聚合徽章 + Flow3 两级树 + 瞥见→展开→钻取 | ✅ 通过 |
| 交互设计 | 接力一键确认，指挥不离开宠物 | Flow4 预览 Drawer+一键发送；Flow1 戳展开+快捷指令 | 🟡 部分（快捷指令语义死端，见 m7） |
| 情感化设计 | 陪伴式 calm tech，通知即轻拍 | Flow1 事件气泡 inline+宠物四态 | 🟡 部分（通知分级+免打扰未落地，见 M3） |
| 动效设计 | 状态动画余光可辨，克制不抢注意 | PetAvatar 四态+getReducedMotion | 🟡 部分（用户级动效开关缺失，见 m6） |

## Findings（按严重度排序）

### 🔴 Blocker
无。

### 🟠 Major
1. **[edge-states 5.1]** Flow3 项目概览 Home 无空状态：项目为空时渲染空白 grid，无引导。
   - 出现位置：flow3-panel.tsx Screen1_ProjectHome
   - 修复建议：加 Empty+EmptyTitle+EmptyDescription+「连接 Agent」CTA（参照 Flow2 冷启动）。
2. **[responsive 7.2]** Flow1 戳展开面板 `w-80` 固定 320px，叠加父级 p-6 在 320px 视口溢出。
   - 出现位置：flow1-pet-surface.tsx:217
   - 修复建议：改 `w-full max-w-sm`。
3. **[brief-consistency 10.3]** Brief 情感化 tactic「通知分级 + 免打扰」未落地（无 DND 开关/分级设置）。
   - 出现位置：flow1-pet-surface.tsx（情感化维度）
   - 修复建议：Flow1 增加免打扰 Toggle + 通知分级设置入口。

### 🟡 Minor
1. **[flow-continuity 1.5]** Flow2/Flow4 多步流程无 step indicator。→ 加 Stepper/步骤 Progress。
2. **[visual-hierarchy 4.3]** 全 flow 无语义 heading（h1/h2），主标题用 span/CardTitle。→ 改语义标签。
3. **[edge-states 5.4]** 长标题/产物名未 truncate；计数无 999+ 截断。→ truncate/EllipsisText + 999+ 封顶。
4. **[feedback 8.4]** Flow4 追踪长操作无停止/取消通道。→ 加「停止」Button。
5. **[accessibility 9.2]** Flow3 树四态圆点仅颜色传达状态。→ 加 aria-label/title 或状态文字。
6. **[brief-consistency 10.3]** 动效「可关」仅 OS reduced-motion，无用户开关。→ 设置加动效开关。
7. **[flow-continuity 1.3]** Flow1 快捷指令 onCommand 仅跳转未发送（语义死端）。→ 追加指令或 toast 反馈。

## 通过项（取证）
- components 3.4：无硬编码 hex / 任意 px（grep 零命中），颜色全走 token / CSS 变量。
- ia：导航命名一致、无孤立屏、Web 主导航 4 项 ≤7。
- copy：按钮动词开头、错误给可行动指引、无 placeholder 残留。
- 异常态：Flow2 冷启动 Empty+Chips、Flow3 无会话 Empty、检测/接力流式占位、删除 AlertDialog+Undo 均具备。
- brief-consistency 10.4：未做 out_of_scope 内容（无全自动管线/无团队协作/宠物本体存在）。

## 修复优先级建议
- 必须修复（Major 影响主流程/一致性）：3 项（M1 空态、M2 窄屏溢出、M3 免打扰落地）
- 建议修复（Minor 影响一致性/可达性）：m5 圆点双重标识、m7 指令死端、m3 truncate
- 可延后（不影响功能）：m1 stepper、m2 语义 heading、m4 停止、m6 动效开关

---

## 复跑（2026-11-13，修复 qa-1/2/3 后）

**结果**：🔴 0 · 🟠 0 · 🟡 7 · Pass 类别 4（ia / components / copy / responsive）

| 原 Major | 修复 | 运行时验证 |
| --- | --- | --- |
| M1 项目 Home 空态 | Screen1 加 Empty+EmptyMedia+「连接 Agent」CTA+「模拟无项目」预览 | ✅ empty/emptyCTA/restore 全 ok |
| M2 w-80 窄屏溢出 | 改 `w-full max-w-sm` | ✅ width ok（offsetWidth ≤ innerWidth） |
| M3 免打扰/通知分级 | Flow1 加 Switch(免打扰)+分级门控（DND 仅「需拍板」轻拍，其余静默不推进） | ✅ dndOn/dndSuppress/offShowsNonDecision 全 ok |

**剩余 7 minor**：stepper / 语义 heading / truncate+999+ / 追踪停止 / 圆点双重标识 / 动效用户开关 / 快捷指令死端。
**Check finding 解决率（QA 口径更新）**：3/10。