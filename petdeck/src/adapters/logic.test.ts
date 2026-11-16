// RED tests for frontend adapter pure logic (registry).
// Run: node --test src/adapters/logic.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectSource, gateInject, injectOrClipboard, clipboardPackage, handoffPackageText } from './registry.ts';
import { handoffPackage } from '../../server/tiers.mjs';

test('registry: selectSource mock only on explicit demo', () => {
  assert.equal(selectSource(true), 'mock');
  assert.equal(selectSource(false), 'live');
});

test('registry: injectOrClipboard clipboard when not live', async () => {
  const d = await injectOrClipboard({ to: 'kimi', context: 'c', instruction: 'i' }, false, async () => { throw new Error('must not be called'); });
  assert.equal(d.mode, 'clipboard');
  assert.equal(d.package, 'Relay handoff from petdeck\n上下文：\nc\n指令：\ni');
});

// Task 4 parity fixture: 前端 clipboard 包必须与 server handoffPackage 行为完全一致
// （同一字段顺序与中文标签；不得丢 from 或 artifacts）。字面量 want，手工推导。
test('registry: clipboardPackage keeps from + artifacts in unified format', () => {
  const d = clipboardPackage({ from: 'codex', to: 'kimi', context: 'c', instruction: 'i', artifacts: ['a.png', 'b.md'] });
  assert.equal(d.package, 'Relay handoff from codex\n上下文：\nc\n指令：\ni\n产物：\na.png\nb.md');
});

// 单一来源守卫（P2-11）：handoffPackageText 必须就是 server 的 handoffPackage 本体，
// 而不是再复制一份逐字镜像——之前是双份手工镜像靠 parity 测试兜底，脆弱。
test('registry: handoffPackageText is the server builder itself, not a mirror', () => {
  assert.equal(handoffPackageText, handoffPackage);
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

test('registry: gateInject mirrors capability tiers', () => {
  assert.equal(gateInject('full'), true);
  assert.equal(gateInject('observe-only'), false);
  assert.equal(gateInject('manual'), false);
});

// --- Task 7: 可信降级原因 + 漏斗 live 标记 ---

test('registry: injectOrClipboard bridge throw => clipboard with fallbackReason bridge-error', async () => {
  const d = await injectOrClipboard({ to: 'codex' }, true, async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(d.mode, 'clipboard');
  assert.equal(d.fallbackReason, 'bridge-error');
});

test('registry: demo-mode clipboard is not a degradation (no fallbackReason)', async () => {
  const d = await injectOrClipboard({ to: 'kimi', context: 'c' }, false, async () => { throw new Error('must not be called'); });
  assert.equal(d.mode, 'clipboard');
  assert.equal(d.fallbackReason, undefined);
});

test('registry: clipboardPackage carries a tier fallbackReason without touching the package', () => {
  const d = clipboardPackage({ to: 'kimi', context: 'c' }, 'tier');
  assert.equal(d.fallbackReason, 'tier');
  assert.equal(d.package, 'Relay handoff from petdeck\n上下文：\nc');
});

test('registry: a clipboard decision with fallbackReason from the bridge passes through', async () => {
  const d = await injectOrClipboard({ to: 'codex' }, true, async () => ({ mode: 'clipboard', package: 'p', fallbackReason: 'cli' }));
  assert.deepEqual(d, { mode: 'clipboard', package: 'p', fallbackReason: 'cli' });
});