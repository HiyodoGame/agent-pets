import { test } from 'node:test'
import assert from 'node:assert/strict'
import { updateStatusText, updateAvailable } from './updater.ts'

test('updateStatusText: every phase has an honest label', () => {
  assert.equal(updateStatusText('unsupported'), '自动更新仅在桌面版可用')
  assert.equal(updateStatusText('checking'), '正在检查更新…')
  assert.equal(updateStatusText('available', { available: true, version: '0.1.2' }), '发现新版本 0.1.2')
  assert.equal(updateStatusText('available', { available: true }), '发现新版本')
  assert.equal(updateStatusText('uptodate'), '已是最新版本')
  assert.equal(updateStatusText('installing'), '正在下载并安装，应用将会自动重启…')
  assert.equal(updateStatusText('error', null, '404'), '检查更新失败：404')
  assert.equal(updateStatusText('error'), '检查更新失败')
  assert.equal(updateStatusText('idle'), '从 GitHub Releases 检查新版本')
})

test('updateAvailable: requires both flag and version', () => {
  assert.equal(updateAvailable({ available: true, version: '0.1.2' }), true)
  assert.equal(updateAvailable({ available: true }), false)
  assert.equal(updateAvailable({ available: false, version: '0.1.2' }), false)
  assert.equal(updateAvailable(null), false)
})
