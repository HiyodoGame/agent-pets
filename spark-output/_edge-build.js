const fs = require('fs');
const M = [];
const S = (screen,cat,type,sev,impl,crit,desc,fb,vis,copy)=>M.push({screen,category:cat,state_type:type,required:true,severity:sev,implemented:impl,critical_severity:crit||null,design_description:desc,fallback_behavior:fb,visual_hint:vis,copy_hint:copy});
// Flow1 桌宠
S('F1S1 AmbientIdle','offline','offline-no-network','must',false,'blocker','宠物灰化+离线badge+重连CTA；保留最后缓存状态','点击重连进接入flow检测；缓存状态可查看','PetAvatar offline + Tag error + Button 重连','Agent 失联 · 点击重连');
S('F1S1 AmbientIdle','boundary','boundary-zero','should',true,null,'计数0弱化为slate不误导','无操作，仅展示','Tag slate tabular-nums','暂无运行中任务');
S('F1S1 AmbientIdle','boundary','boundary-overflow','should',false,null,'计数999+封顶缩写','无操作','Tag tabular-nums + 999+','999+');
S('F1S1 AmbientIdle','loading','loading-refresh','should',false,null,'状态刷新badge微spinner','刷新完成自动消失','Spinner 12px on badge','同步中…');
S('F1S1 AmbientIdle','empty','dnd-silent-inbox','should',false,null,'DND静默事件进收件箱badge计数','点收件箱查看静默事件','宠物安静 + inbox dot 计数','免打扰中 · N 条静默进收件箱');
S('F1S2 EventTap','error','error-network','must',false,'high','事件拉取失败inline+Retry','重试保留上下文','Alert error inline + Retry','事件没拉取到 · 重试');
S('F1S2 EventTap','boundary','boundary-long-text','must',false,'high','事件文本超长截断+展开','点展开看全文','line-clamp-2 + 展开按钮','…展开');
S('F1S3 PokeExpand','empty','empty-collection','should',false,null,'无项目Empty+连接CTA','去接入flow','Empty + Button 连接Agent','还没有项目 · 连接Agent');
S('F1S3 PokeExpand','boundary','boundary-long-text','must',false,'high','项目名截断+tooltip','hover看全名','truncate + Tooltip','…');
S('F1S3 PokeExpand','loading','loading-submit','must',false,'high','快捷指令发送disabled+spinner','禁止重复点击','ChatInput sendButtonStatus=generating','发送中…');
S('F1S3 PokeExpand','error','error-network','must',false,'high','指令发送失败inline+Retry保留草稿','重试不重填','Alert error + Retry','发送失败 · 重试');
// Flow2 接入
S('F2S1 ColdHome','empty','empty-first-time','must',true,null,'Empty+建议Chips+连接CTA','点Chip或CTA进选择','Empty + PromptSuggestions + Button','还没有连接任何Agent');
S('F2S1 ColdHome','offline','offline-no-network','should',false,null,'离线仍可看缓存引导','连接需网络提示','Alert info','离线 · 连接需网络');
S('F2S2 SelectAgent','empty','empty-search','must',false,'high','搜索无结果Empty+换关键词+清除','清除搜索恢复列表','Empty + Button 清除搜索','没找到 · 换个关键词');
S('F2S2 SelectAgent','empty','empty-filter','should',false,null,'某形态筛选无结果提示','切换形态','TypographyMuted','该形态暂无可接Agent');
S('F2S2 SelectAgent','boundary','boundary-long-text','should',false,null,'agent名/detectHint截断','hover全名','truncate','…');
S('F2S2 SelectAgent','permission','permission-tier-limited','must',true,null,'能力分级Tag+unsupported待适配Alert','unsupported记录需求不跳转','Tag success/info/slate + Alert','观察+接力 / 仅观察 / 手动');
S('F2S3 Detect','loading','loading-initial','must',true,null,'检测状态流逐步可读','自动推进','状态流 icon+Spinner+Progress','检测本地安装…');
S('F2S3 Detect','error','error-network','must',true,null,'检测失败inline+Retry+手动兜底','重试或手动配置','Alert error + Retry + 手动','检测失败 · 重试或手动');
S('F2S3 Detect','error','error-permission','must',false,'high','用户拒绝授权inline说明+去系统设置','去系统设置授权后重试','Alert warning + Button 去设置','未授权 · 去系统设置开启');
S('F2S3 Detect','loading','loading-submit','must',false,'high','授权并连接disabled+spinner','禁止重复点击','Button loading','连接中…');
S('F2S3 Detect','error','error-rate-limit','should',false,null,'桥接限流退避重试倒计时','倒计时后自动重试','Progress + 倒计时','请求过频 · Ns后重试');
S('F2S4 Success','error','error-server','should',false,null,'首次同步失败inline+retry','重试同步','Alert error + Retry','同步失败 · 重试');
S('F2S4 Success','boundary','boundary-null','should',false,null,'agent无图标/名字fallback','显示默认avatar+名字占位','AvatarFallback','未命名Agent');
// Flow3 面板
S('F3S1 ProjectHome','empty','empty-collection','must',true,null,'无项目Empty+连接CTA+模拟预览','去接入flow','Empty + Button','还没有项目');
S('F3S1 ProjectHome','loading','loading-initial','must',false,'high','项目卡Skeleton占位','加载完替换','Skeleton h-24 ×3','加载中');
S('F3S1 ProjectHome','boundary','boundary-overflow','should',false,null,'会话数999+','无操作','Tag tabular-nums','999+');
S('F3S2 PanelTree','empty','empty-filter','should',false,null,'项目下无会话树空态+新建','新建会话','TypographyMuted + Button','该项目暂无会话');
S('F3S2 PanelTree','boundary','boundary-long-text','must',false,'high','会话标题truncate+tooltip','hover全名','truncate + Tooltip','…');
S('F3S2 PanelTree','error','error-not-found','must',false,'high','会话被删仍选中→not-found+回列表','回列表选其他','Alert warning + Button 回列表','会话已删除 · 回列表');
S('F3S2 PanelTree','permission','permission-read-only','must',false,'high','observe-only会话只读标识+禁用指挥','仅查看不能下指令','Tag info 仅观察 + disabled','仅观察 · 不可指挥');
S('F3S3 SessionThread','loading','loading-initial','must',false,'high','线程Skeleton段落占位','加载完替换','Skeleton 多行','加载中');
S('F3S3 SessionThread','error','error-network','must',false,'blocker','线程加载失败inline+Retry保留草稿','重试不重填','Alert error + Retry','加载失败 · 重试');
S('F3S3 SessionThread','error','error-not-found','must',false,'high','404/已删→not-found+回列表','回列表','Alert warning + Button','会话不存在 · 回列表');
S('F3S3 SessionThread','boundary','boundary-long-text','must',false,'high','消息/产物名截断或换行不破坏布局','展开/tooltip','line-clamp / break-words','…');
S('F3S3 SessionThread','loading','loading-submit','must',false,'high','追问发送disabled+spinner','禁止重复点击','ChatInput generating','发送中…');
S('F3S3 SessionThread','permission','permission-read-only','must',false,'high','observe-only→Composer禁用+仅观察提示','仅查看','ChatInput disabled + Tag','仅观察 · 不可追问');
S('F3S3 SessionThread','offline','offline-partial-sync','nice',false,null,'离线缓存线程+N条待同步','恢复后同步','Alert info + 计数','离线 · N条待同步');
// Flow4 接力
S('F4S1 Trigger','empty','empty-collection','should',true,null,'无产物仅文案不渲染空卡','无操作','TypographyMuted','无产物');
S('F4S2 PreviewDrawer','error','error-validation','must',false,'high','指令为空→发送disabled+字段提示','填指令后可发送','FieldError + Button disabled','请填写下一步指令');
S('F4S2 PreviewDrawer','boundary','boundary-long-text','must',false,'high','上下文摘要超长scroll/截断','展开编辑','Textarea rows + scroll','…');
S('F4S2 PreviewDrawer','boundary','boundary-null','should',true,null,'无产物占位「无产物」','无操作','TypographyMuted','无产物');
S('F4S2 PreviewDrawer','loading','loading-submit','must',false,'high','确认发送disabled+spinner','禁止重复点击','Button loading','发送中…');
S('F4S2 PreviewDrawer','permission','permission-tier-limited','must',true,null,'目标manual→剪贴板降级提示','复制交接包手动粘贴','Tag slate + Alert','手动Agent · 剪贴板交接');
S('F4S3 Tracking','error','error-network','must',true,null,'注入失败inline+Retry+复制交接包','重试或手动','Alert error + Retry + Copy','注入失败 · 重试或复制');
S('F4S3 Tracking','loading','loading-initial','must',true,null,'流式Response可读进度','自动推进','Response streaming','正在处理交接包…');
S('F4S3 Tracking','error','error-rate-limit','should',false,null,'目标限流退避+倒计时','倒计时重试','Progress + 倒计时','目标限流 · Ns后重试');
S('F4S3 Tracking','offline','offline-no-network','must',false,'blocker','追踪中断网→保留交接包+离线暂存+恢复重试','恢复后重试不丢包','Alert warning + 暂存标识','离线 · 交接包已暂存');
S('F4S3 Tracking','loading','loading-stop','should',false,null,'停止按钮中断追踪回退','中断回预览','Button 停止','停止');
S('F4S4 Complete','error','error-server','should',false,null,'回执拉取失败inline+retry','重试','Alert error + Retry','回执失败 · 重试');
// Shell
S('Shell','offline','offline-no-network','should',false,null,'全局离线banner+缓存查看','恢复自动同步','Alert info banner','当前离线 · 查看缓存');
S('Shell','error','error-server','must',true,null,'ErrorBoundary兜底错误面板+重试','刷新/重试','ErrorBoundary panel','页面发生错误');
S('Shell','permission','permission-anonymous','must',true,null,'N/A：local-first无登录系统','无需登录','—','—');

const screens = [...new Set(M.map(m=>m.screen))];
const byCat = {empty:0,loading:0,error:0,boundary:0,permission:0,offline:0};
M.forEach(m=>byCat[m.category]++);
const critical = M.filter(m=>m.severity==='must' && !m.implemented && m.critical_severity);
const edge = {
  skill:'edge', generated_at:new Date().toISOString(), project_name:'Agent Pets',
  target_flows:['flow-1-pet-surface','flow-2-connect-agent','flow-3-panel','flow-4-relay','shell'],
  states_matrix: screens.map(sc=>({ screen:sc, states:M.filter(m=>m.screen===sc) })),
  coverage:{ total_screens:screens.length, total_states_planned:M.length,
    by_severity:{ must:M.filter(m=>m.severity==='must').length, should:M.filter(m=>m.severity==='should').length, nice:M.filter(m=>m.severity==='nice').length },
    by_category:byCat,
    implemented:M.filter(m=>m.implemented).length,
    critical_missing:critical.map(m=>({screen:m.screen,state_type:m.state_type,severity:m.critical_severity,reason:m.design_description})) },
};
fs.mkdirSync('spark-output/context',{recursive:true});
fs.writeFileSync('spark-output/context/edge.json',JSON.stringify(edge,null,2));
let md = '# Edge States — Agent Pets\n\n- 生成时间：' + edge.generated_at + '\n- 走查屏数：' + screens.length + '\n- 状态总数：' + M.length + '（must ' + edge.coverage.by_severity.must + ' / should ' + edge.coverage.by_severity.should + ' / nice ' + edge.coverage.by_severity.nice + '）\n- 已实现：' + edge.coverage.implemented + ' · 关键缺失：' + critical.length + '\n- 数据源：flow-web + brief + check(复跑)\n\n## 总览\n\n| 类别 | 状态数 |\n| --- | --- |\n' + Object.entries(byCat).map(([k,v])=>'| ' + k + ' | ' + v + ' |').join('\n') + '\n\n## 关键缺失（must 未实现）\n\n' + critical.map(m=>'- **[' + m.critical_severity + ']** ' + m.screen + ' · ' + m.state_type + '：' + m.design_description).join('\n') + '\n\n## 状态矩阵（按屏）\n';
for (const sc of screens) {
  md += '\n### Screen: ' + sc + '\n';
  for (const m of M.filter(x=>x.screen===sc)) {
    md += '\n#### ' + m.state_type + '（' + m.severity + (m.implemented?' · 已实现':' · 缺失') + '）\n- 设计描述：' + m.design_description + '\n- 用户能做什么：' + m.fallback_behavior + '\n- 视觉提示：' + m.visual_hint + '\n- 文案建议：' + m.copy_hint + '\n';
  }
}
fs.mkdirSync('spark-output/edge',{recursive:true});
fs.writeFileSync('spark-output/edge/agent-pets.md',md);
const ss=JSON.parse(fs.readFileSync('spark-output/context/_session-state.json','utf8'));
ss.current_skill='edge';ss.current_phase='完成';ss.updated_at=edge.generated_at;
if(!ss.completed_skills.includes('edge'))ss.completed_skills.push('edge');
fs.writeFileSync('spark-output/context/_session-state.json',JSON.stringify(ss,null,2));
fs.copyFileSync('spark-output/context/edge.json','petdeck/spark-output/context/edge.json');
fs.copyFileSync('spark-output/context/_session-state.json','petdeck/spark-output/context/_session-state.json');
const contexts={};
for(const f of fs.readdirSync('spark-output/context/')){
  if(!f.endsWith('.json')||f.startsWith('_'))continue;
  const j=JSON.parse(fs.readFileSync('spark-output/context/'+f,'utf8'));
  if(!j.skill)continue;
  const sum=j.skill==='frame'?'押方向B接力秘书':j.skill==='brief'?'7模块+4维策略':j.skill==='flow-web'?'4 flow+Shell':j.skill==='check'?'复跑0 major/7 minor':j.skill==='qa'?'11 deviations':'15屏'+M.length+'态，critical '+critical.length;
  contexts[j.skill]={done:true,summary:sum,fields:{}};
}
const STATE={project:'Agent Pets',generated_at:edge.generated_at,contexts};
const tpl=fs.readFileSync('C:/Users/Con_WKK/.qoder/plugins/cache/qoder-marketplace/product-design/0.5.10/_shared/dashboard-template.html','utf8');
fs.writeFileSync('spark-output/dashboard.html',tpl.replace(/\/\*__SPARK_STATE_INJECT__\*\/null/,'/*__SPARK_STATE_INJECT__*/'+JSON.stringify(STATE)));
console.log('edge written · screens='+screens.length+' states='+M.length+' must='+edge.coverage.by_severity.must+' critical='+critical.length+' · dashboard done='+Object.keys(contexts).length);
console.log('critical:', critical.map(c=>c.severity+':'+c.screen+'/'+c.state_type).join(' | '));