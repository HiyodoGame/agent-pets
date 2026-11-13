// Regenerate chain dashboard with metric added (8/27).
const fs = require('fs');
const path = require('path');
const root = __dirname;
const ctxDir = path.join(root, 'context');
const summaries = {
  frame: '押B接力秘书，spike验证条件',
  brief: '7模块4维策略，B1-B4',
  'flow-web': '4flow+Shell，Spark Design',
  check: '复跑0major/7minor',
  qa: '复跑0major/4minor，3/6解决',
  edge: '15屏53态，23critical',
  retro: '阶段复盘10决策/4surprises',
  metric: 'NSM人均日接力+4D/4C/4H',
  prd: '8段PRD，MVP=S1/2/5/6',
  stories: '6故事P0x3，AC+设计触点',
  sitemap: '4导航14页3层4flow',
};
const contexts = {};
for (const f of fs.readdirSync(ctxDir)) {
  if (!f.endsWith('.json') || f.startsWith('_')) continue;
  const name = f.replace('.json', '');
  if (name === 'session-state') continue;
  contexts[name] = { done: true, summary: summaries[name] || name, fields: {} };
}
const STATE = { project: 'Agent Pets', generated_at: new Date().toISOString(), contexts };
const tplPath = 'C:/Users/Con_WKK/.qoder/plugins/cache/qoder-marketplace/product-design/0.5.10/_shared/dashboard-template.html';
let tpl = fs.readFileSync(tplPath, 'utf8');
const injected = tpl.replace(/\/\*__SPARK_STATE_INJECT__\*\/null/, '/*__SPARK_STATE_INJECT__*/' + JSON.stringify(STATE));
fs.writeFileSync(path.join(root, 'dashboard.html'), injected);
console.log('dashboard updated, done =', Object.keys(contexts).length);