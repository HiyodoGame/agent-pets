# Edge States — Agent Pets

- 生成时间：2026-11-13T12:22:03.434Z
- 走查屏数：15
- 状态总数：53（must 33 / should 19 / nice 1）
- 已实现：13 · 关键缺失：23
- 数据源：flow-web + brief + check(复跑)

## 总览

| 类别 | 状态数 |
| --- | --- |
| empty | 8 |
| loading | 10 |
| error | 14 |
| boundary | 11 |
| permission | 5 |
| offline | 5 |

## 关键缺失（must 未实现）

- **[blocker]** F1S1 AmbientIdle · offline-no-network：宠物灰化+离线badge+重连CTA；保留最后缓存状态
- **[high]** F1S2 EventTap · error-network：事件拉取失败inline+Retry
- **[high]** F1S2 EventTap · boundary-long-text：事件文本超长截断+展开
- **[high]** F1S3 PokeExpand · boundary-long-text：项目名截断+tooltip
- **[high]** F1S3 PokeExpand · loading-submit：快捷指令发送disabled+spinner
- **[high]** F1S3 PokeExpand · error-network：指令发送失败inline+Retry保留草稿
- **[high]** F2S2 SelectAgent · empty-search：搜索无结果Empty+换关键词+清除
- **[high]** F2S3 Detect · error-permission：用户拒绝授权inline说明+去系统设置
- **[high]** F2S3 Detect · loading-submit：授权并连接disabled+spinner
- **[high]** F3S1 ProjectHome · loading-initial：项目卡Skeleton占位
- **[high]** F3S2 PanelTree · boundary-long-text：会话标题truncate+tooltip
- **[high]** F3S2 PanelTree · error-not-found：会话被删仍选中→not-found+回列表
- **[high]** F3S2 PanelTree · permission-read-only：observe-only会话只读标识+禁用指挥
- **[high]** F3S3 SessionThread · loading-initial：线程Skeleton段落占位
- **[blocker]** F3S3 SessionThread · error-network：线程加载失败inline+Retry保留草稿
- **[high]** F3S3 SessionThread · error-not-found：404/已删→not-found+回列表
- **[high]** F3S3 SessionThread · boundary-long-text：消息/产物名截断或换行不破坏布局
- **[high]** F3S3 SessionThread · loading-submit：追问发送disabled+spinner
- **[high]** F3S3 SessionThread · permission-read-only：observe-only→Composer禁用+仅观察提示
- **[high]** F4S2 PreviewDrawer · error-validation：指令为空→发送disabled+字段提示
- **[high]** F4S2 PreviewDrawer · boundary-long-text：上下文摘要超长scroll/截断
- **[high]** F4S2 PreviewDrawer · loading-submit：确认发送disabled+spinner
- **[blocker]** F4S3 Tracking · offline-no-network：追踪中断网→保留交接包+离线暂存+恢复重试

## 状态矩阵（按屏）

### Screen: F1S1 AmbientIdle

#### offline-no-network（must · 缺失）
- 设计描述：宠物灰化+离线badge+重连CTA；保留最后缓存状态
- 用户能做什么：点击重连进接入flow检测；缓存状态可查看
- 视觉提示：PetAvatar offline + Tag error + Button 重连
- 文案建议：Agent 失联 · 点击重连

#### boundary-zero（should · 已实现）
- 设计描述：计数0弱化为slate不误导
- 用户能做什么：无操作，仅展示
- 视觉提示：Tag slate tabular-nums
- 文案建议：暂无运行中任务

#### boundary-overflow（should · 缺失）
- 设计描述：计数999+封顶缩写
- 用户能做什么：无操作
- 视觉提示：Tag tabular-nums + 999+
- 文案建议：999+

#### loading-refresh（should · 缺失）
- 设计描述：状态刷新badge微spinner
- 用户能做什么：刷新完成自动消失
- 视觉提示：Spinner 12px on badge
- 文案建议：同步中…

#### dnd-silent-inbox（should · 缺失）
- 设计描述：DND静默事件进收件箱badge计数
- 用户能做什么：点收件箱查看静默事件
- 视觉提示：宠物安静 + inbox dot 计数
- 文案建议：免打扰中 · N 条静默进收件箱

### Screen: F1S2 EventTap

#### error-network（must · 缺失）
- 设计描述：事件拉取失败inline+Retry
- 用户能做什么：重试保留上下文
- 视觉提示：Alert error inline + Retry
- 文案建议：事件没拉取到 · 重试

#### boundary-long-text（must · 缺失）
- 设计描述：事件文本超长截断+展开
- 用户能做什么：点展开看全文
- 视觉提示：line-clamp-2 + 展开按钮
- 文案建议：…展开

### Screen: F1S3 PokeExpand

#### empty-collection（should · 缺失）
- 设计描述：无项目Empty+连接CTA
- 用户能做什么：去接入flow
- 视觉提示：Empty + Button 连接Agent
- 文案建议：还没有项目 · 连接Agent

#### boundary-long-text（must · 缺失）
- 设计描述：项目名截断+tooltip
- 用户能做什么：hover看全名
- 视觉提示：truncate + Tooltip
- 文案建议：…

#### loading-submit（must · 缺失）
- 设计描述：快捷指令发送disabled+spinner
- 用户能做什么：禁止重复点击
- 视觉提示：ChatInput sendButtonStatus=generating
- 文案建议：发送中…

#### error-network（must · 缺失）
- 设计描述：指令发送失败inline+Retry保留草稿
- 用户能做什么：重试不重填
- 视觉提示：Alert error + Retry
- 文案建议：发送失败 · 重试

### Screen: F2S1 ColdHome

#### empty-first-time（must · 已实现）
- 设计描述：Empty+建议Chips+连接CTA
- 用户能做什么：点Chip或CTA进选择
- 视觉提示：Empty + PromptSuggestions + Button
- 文案建议：还没有连接任何Agent

#### offline-no-network（should · 缺失）
- 设计描述：离线仍可看缓存引导
- 用户能做什么：连接需网络提示
- 视觉提示：Alert info
- 文案建议：离线 · 连接需网络

### Screen: F2S2 SelectAgent

#### empty-search（must · 缺失）
- 设计描述：搜索无结果Empty+换关键词+清除
- 用户能做什么：清除搜索恢复列表
- 视觉提示：Empty + Button 清除搜索
- 文案建议：没找到 · 换个关键词

#### empty-filter（should · 缺失）
- 设计描述：某形态筛选无结果提示
- 用户能做什么：切换形态
- 视觉提示：TypographyMuted
- 文案建议：该形态暂无可接Agent

#### boundary-long-text（should · 缺失）
- 设计描述：agent名/detectHint截断
- 用户能做什么：hover全名
- 视觉提示：truncate
- 文案建议：…

#### permission-tier-limited（must · 已实现）
- 设计描述：能力分级Tag+unsupported待适配Alert
- 用户能做什么：unsupported记录需求不跳转
- 视觉提示：Tag success/info/slate + Alert
- 文案建议：观察+接力 / 仅观察 / 手动

### Screen: F2S3 Detect

#### loading-initial（must · 已实现）
- 设计描述：检测状态流逐步可读
- 用户能做什么：自动推进
- 视觉提示：状态流 icon+Spinner+Progress
- 文案建议：检测本地安装…

#### error-network（must · 已实现）
- 设计描述：检测失败inline+Retry+手动兜底
- 用户能做什么：重试或手动配置
- 视觉提示：Alert error + Retry + 手动
- 文案建议：检测失败 · 重试或手动

#### error-permission（must · 缺失）
- 设计描述：用户拒绝授权inline说明+去系统设置
- 用户能做什么：去系统设置授权后重试
- 视觉提示：Alert warning + Button 去设置
- 文案建议：未授权 · 去系统设置开启

#### loading-submit（must · 缺失）
- 设计描述：授权并连接disabled+spinner
- 用户能做什么：禁止重复点击
- 视觉提示：Button loading
- 文案建议：连接中…

#### error-rate-limit（should · 缺失）
- 设计描述：桥接限流退避重试倒计时
- 用户能做什么：倒计时后自动重试
- 视觉提示：Progress + 倒计时
- 文案建议：请求过频 · Ns后重试

### Screen: F2S4 Success

#### error-server（should · 缺失）
- 设计描述：首次同步失败inline+retry
- 用户能做什么：重试同步
- 视觉提示：Alert error + Retry
- 文案建议：同步失败 · 重试

#### boundary-null（should · 缺失）
- 设计描述：agent无图标/名字fallback
- 用户能做什么：显示默认avatar+名字占位
- 视觉提示：AvatarFallback
- 文案建议：未命名Agent

### Screen: F3S1 ProjectHome

#### empty-collection（must · 已实现）
- 设计描述：无项目Empty+连接CTA+模拟预览
- 用户能做什么：去接入flow
- 视觉提示：Empty + Button
- 文案建议：还没有项目

#### loading-initial（must · 缺失）
- 设计描述：项目卡Skeleton占位
- 用户能做什么：加载完替换
- 视觉提示：Skeleton h-24 ×3
- 文案建议：加载中

#### boundary-overflow（should · 缺失）
- 设计描述：会话数999+
- 用户能做什么：无操作
- 视觉提示：Tag tabular-nums
- 文案建议：999+

### Screen: F3S2 PanelTree

#### empty-filter（should · 缺失）
- 设计描述：项目下无会话树空态+新建
- 用户能做什么：新建会话
- 视觉提示：TypographyMuted + Button
- 文案建议：该项目暂无会话

#### boundary-long-text（must · 缺失）
- 设计描述：会话标题truncate+tooltip
- 用户能做什么：hover全名
- 视觉提示：truncate + Tooltip
- 文案建议：…

#### error-not-found（must · 缺失）
- 设计描述：会话被删仍选中→not-found+回列表
- 用户能做什么：回列表选其他
- 视觉提示：Alert warning + Button 回列表
- 文案建议：会话已删除 · 回列表

#### permission-read-only（must · 缺失）
- 设计描述：observe-only会话只读标识+禁用指挥
- 用户能做什么：仅查看不能下指令
- 视觉提示：Tag info 仅观察 + disabled
- 文案建议：仅观察 · 不可指挥

### Screen: F3S3 SessionThread

#### loading-initial（must · 缺失）
- 设计描述：线程Skeleton段落占位
- 用户能做什么：加载完替换
- 视觉提示：Skeleton 多行
- 文案建议：加载中

#### error-network（must · 缺失）
- 设计描述：线程加载失败inline+Retry保留草稿
- 用户能做什么：重试不重填
- 视觉提示：Alert error + Retry
- 文案建议：加载失败 · 重试

#### error-not-found（must · 缺失）
- 设计描述：404/已删→not-found+回列表
- 用户能做什么：回列表
- 视觉提示：Alert warning + Button
- 文案建议：会话不存在 · 回列表

#### boundary-long-text（must · 缺失）
- 设计描述：消息/产物名截断或换行不破坏布局
- 用户能做什么：展开/tooltip
- 视觉提示：line-clamp / break-words
- 文案建议：…

#### loading-submit（must · 缺失）
- 设计描述：追问发送disabled+spinner
- 用户能做什么：禁止重复点击
- 视觉提示：ChatInput generating
- 文案建议：发送中…

#### permission-read-only（must · 缺失）
- 设计描述：observe-only→Composer禁用+仅观察提示
- 用户能做什么：仅查看
- 视觉提示：ChatInput disabled + Tag
- 文案建议：仅观察 · 不可追问

#### offline-partial-sync（nice · 缺失）
- 设计描述：离线缓存线程+N条待同步
- 用户能做什么：恢复后同步
- 视觉提示：Alert info + 计数
- 文案建议：离线 · N条待同步

### Screen: F4S1 Trigger

#### empty-collection（should · 已实现）
- 设计描述：无产物仅文案不渲染空卡
- 用户能做什么：无操作
- 视觉提示：TypographyMuted
- 文案建议：无产物

### Screen: F4S2 PreviewDrawer

#### error-validation（must · 缺失）
- 设计描述：指令为空→发送disabled+字段提示
- 用户能做什么：填指令后可发送
- 视觉提示：FieldError + Button disabled
- 文案建议：请填写下一步指令

#### boundary-long-text（must · 缺失）
- 设计描述：上下文摘要超长scroll/截断
- 用户能做什么：展开编辑
- 视觉提示：Textarea rows + scroll
- 文案建议：…

#### boundary-null（should · 已实现）
- 设计描述：无产物占位「无产物」
- 用户能做什么：无操作
- 视觉提示：TypographyMuted
- 文案建议：无产物

#### loading-submit（must · 缺失）
- 设计描述：确认发送disabled+spinner
- 用户能做什么：禁止重复点击
- 视觉提示：Button loading
- 文案建议：发送中…

#### permission-tier-limited（must · 已实现）
- 设计描述：目标manual→剪贴板降级提示
- 用户能做什么：复制交接包手动粘贴
- 视觉提示：Tag slate + Alert
- 文案建议：手动Agent · 剪贴板交接

### Screen: F4S3 Tracking

#### error-network（must · 已实现）
- 设计描述：注入失败inline+Retry+复制交接包
- 用户能做什么：重试或手动
- 视觉提示：Alert error + Retry + Copy
- 文案建议：注入失败 · 重试或复制

#### loading-initial（must · 已实现）
- 设计描述：流式Response可读进度
- 用户能做什么：自动推进
- 视觉提示：Response streaming
- 文案建议：正在处理交接包…

#### error-rate-limit（should · 缺失）
- 设计描述：目标限流退避+倒计时
- 用户能做什么：倒计时重试
- 视觉提示：Progress + 倒计时
- 文案建议：目标限流 · Ns后重试

#### offline-no-network（must · 缺失）
- 设计描述：追踪中断网→保留交接包+离线暂存+恢复重试
- 用户能做什么：恢复后重试不丢包
- 视觉提示：Alert warning + 暂存标识
- 文案建议：离线 · 交接包已暂存

#### loading-stop（should · 缺失）
- 设计描述：停止按钮中断追踪回退
- 用户能做什么：中断回预览
- 视觉提示：Button 停止
- 文案建议：停止

### Screen: F4S4 Complete

#### error-server（should · 缺失）
- 设计描述：回执拉取失败inline+retry
- 用户能做什么：重试
- 视觉提示：Alert error + Retry
- 文案建议：回执失败 · 重试

### Screen: Shell

#### offline-no-network（should · 缺失）
- 设计描述：全局离线banner+缓存查看
- 用户能做什么：恢复自动同步
- 视觉提示：Alert info banner
- 文案建议：当前离线 · 查看缓存

#### error-server（must · 已实现）
- 设计描述：ErrorBoundary兜底错误面板+重试
- 用户能做什么：刷新/重试
- 视觉提示：ErrorBoundary panel
- 文案建议：页面发生错误

#### permission-anonymous（must · 已实现）
- 设计描述：N/A：local-first无登录系统
- 用户能做什么：无需登录
- 视觉提示：—
- 文案建议：—
