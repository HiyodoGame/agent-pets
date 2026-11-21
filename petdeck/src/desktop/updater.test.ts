import { test } from 'node:test'
import assert from 'node:assert/strict'
import { updateStatusText, updateAvailable, classifyUpdateError, progressPercent } from './updater.ts'

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

test('classifyUpdateError: buckets signature, disk, network and unknown', () => {
  assert.equal(classifyUpdateError('signature verification failed'), 'signature')
  assert.equal(classifyUpdateError('Minisign public key mismatch'), 'signature')
  assert.equal(classifyUpdateError('No space left on device (os error 28)'), 'disk')
  assert.equal(classifyUpdateError('failed to write downloaded file: Access is denied'), 'disk')
  assert.equal(classifyUpdateError('error sending request for url: connection timed out'), 'network')
  assert.equal(classifyUpdateError('HTTP status 503 Service Unavailable'), 'network')
  assert.equal(classifyUpdateError('unexpected updater response'), 'unknown')
  assert.equal(classifyUpdateError(''), 'unknown')
  assert.equal(classifyUpdateError(undefined), 'unknown')
})

test('progressPercent: clamps and reports null without a total', () => {
  assert.equal(progressPercent(0, 100), 0)
  assert.equal(progressPercent(25, 100), 25)
  assert.equal(progressPercent(100, 100), 100)
  assert.equal(progressPercent(120, 100), 100)
  assert.equal(progressPercent(5, null), null)
  assert.equal(progressPercent(5, 0), null)
})
