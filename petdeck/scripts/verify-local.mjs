// 真机实测矩阵生成器 — 只读检查本机 Agent 环境并打印实测矩阵表格。
// 用法: node scripts/verify-local.mjs [--md]
// 红线：本脚本只做只读观察（observe），绝不调用 inject，不向任何 Agent 写入。
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import * as codex from '../server/adapters/codex.mjs';
import * as claude from '../server/adapters/claude.mjs';
import * as opencode from '../server/adapters/opencode.mjs';
import * as kimi from '../server/adapters/kimi.mjs';
import * as cursor from '../server/adapters/cursor.mjs';
import * as gemini from '../server/adapters/gemini.mjs';

const home = process.env.PETDECK_OBSERVE_HOME || os.homedir();
const md = process.argv.includes('--md');

// 版本探测仅用常量参数且不含任何用户输入，因此 shell 是安全的；命令行拼接为单一字符串
// 以避开 DEP0190（args 数组与 shell 同用时的转义歧义）。
function probe(cmd, args = ['--version']) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try { child = spawn([cmd, ...args].join(' '), { shell: true }); } catch { return resolve(null); }
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { out += d; });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.trim().split('\n')[0].slice(0, 80) : null));
  });
}

async function dirExists(p) { try { return (await fs.promises.stat(p)).isDirectory(); } catch { return false; } }

async function checkCodex() {
  const cli = await probe('codex');
  const dir = path.join(home, '.codex', 'sessions');
  let observeNote = '—';
  if (cli && (await dirExists(dir))) {
    try { observeNote = `observe: ${codex.observe().length} 个会话`; } catch (e) { observeNote = `observe 报错: ${e?.code ?? e?.name ?? '?'}`; }
  }
  return { cli, note: observeNote, dirOk: await dirExists(dir) };
}

async function checkClaude() {
  const cli = await probe('claude');
  const dir = path.join(home, '.claude', 'projects');
  let observeNote = '—';
  if (cli && (await dirExists(dir))) {
    try { observeNote = `observe: ${claude.observe().length} 个会话`; } catch (e) { observeNote = `observe 报错: ${e?.code ?? e?.name ?? '?'}`; }
  }
  return { cli, note: observeNote, dirOk: await dirExists(dir) };
}

async function checkOpencode() {
  const cli = await probe('opencode');
  const dir = path.join(home, '.opencode');
  let observeNote = '—';
  try { observeNote = `observe: ${(await opencode.observe()).length} 个会话`; } catch (e) { observeNote = `observe 报错: ${e?.code ?? e?.name ?? '?'}`; }
  return { cli, note: observeNote, dirOk: await dirExists(dir) };
}

async function checkCursor() {
  const cli = await probe('cursor');
  const dir = path.join(home, '.cursor', 'projects');
  let observeNote = '—';
  if (await dirExists(dir)) {
    try { observeNote = `observe: ${(await cursor.observe()).length} 个会话`; } catch (e) { observeNote = `observe 报错: ${e?.code ?? e?.name ?? '?'}`; }
  }
  return { cli, note: observeNote, dirOk: await dirExists(dir) };
}

async function checkGemini() {
  const cli = await probe('gemini');
  const dir = path.join(home, '.gemini', 'tmp');
  let observeNote = '—';
  if (await dirExists(dir)) {
    try { observeNote = `observe: ${(await gemini.observe()).length} 个会话`; } catch (e) { observeNote = `observe 报错: ${e?.code ?? e?.name ?? '?'}`; }
  }
  return { cli, note: observeNote, dirOk: await dirExists(dir) };
}

async function checkKimi() {
  return { cli: null, note: '托管网页 Agent，仅观察层（人工/扩展录入）', dirOk: true };
}

const rows = [
  { adapter: codex, home: '~/.codex/sessions', check: checkCodex },
  { adapter: claude, home: '~/.claude/projects', check: checkClaude },
  { adapter: opencode, home: '~/.opencode + serve', check: checkOpencode },
  { adapter: kimi, home: '—（托管）', check: checkKimi },
  { adapter: cursor, home: '~/.cursor/projects', check: checkCursor },
  { adapter: gemini, home: '~/.gemini/tmp', check: checkGemini },
];

const results = [];
for (const { adapter, home: h, check } of rows) {
  const r = await check();
  results.push({
    id: adapter.id, name: adapter.name, tier: adapter.tier,
    cli: r.cli ?? '未安装',
    sessionDir: h,
    dirOk: r.dirOk ? '存在' : '缺失',
    observe: r.note,
    inject: adapter.tier === 'observe-only' ? '恒剪贴板（设计内）' : '待实测（本脚本不注入）',
  });
}

const date = new Date().toISOString().slice(0, 10);
const osLine = `${os.platform()} ${os.release()}`;
const nodeLine = process.version;

if (md) {
  console.log(`# 真机实测矩阵 — ${date}`);
  console.log('');
  console.log(`- 环境: ${osLine} · Node ${nodeLine}`);
  console.log('- 本脚本只读观察，不执行注入；inject 列需人工小步实测后回填。');
  console.log('');
  console.log('| 适配器 | CLI | 版本 | 会话目录 | 目录 | observe | inject |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) {
    console.log(`| ${r.name} (${r.id}) | ${r.cli === '未安装' ? '—' : '✓'} | ${r.cli} | ${r.sessionDir} | ${r.dirOk} | ${r.observe} | ${r.inject} |`);
  }
} else {
  console.log(`真机环境: ${osLine} · Node ${nodeLine}`);
  for (const r of results) {
    console.log(`\n[${r.name} (${r.id})] tier=${r.tier}`);
    console.log(`  CLI: ${r.cli}`);
    console.log(`  会话目录: ${r.sessionDir} → ${r.dirOk}`);
    console.log(`  observe: ${r.observe}`);
    console.log(`  inject: ${r.inject}`);
  }
}
