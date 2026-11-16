import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectLocale, setLocale, t } from './index.ts'

const store = (value: string | null) => ({
  getItem: () => value,
  setItem: () => {},
})

test('detectLocale: stored choice wins; non-zh system language maps to en; Node defaults to zh', () => {
  assert.equal(detectLocale(store('en'), 'zh-CN'), 'en')
  assert.equal(detectLocale(store('zh'), 'en-US'), 'zh')
  assert.equal(detectLocale(store(null), 'en-US'), 'en')
  assert.equal(detectLocale(store(null), 'zh-CN'), 'zh')
  assert.equal(detectLocale(store(null), 'zh'), 'zh')
})

test('t: zh/en catalogs and placeholder interpolation', () => {
  setLocale('zh')
  assert.equal(t('common.running', { n: 3 }), '3 运行')
  assert.equal(t('update.available', { version: '0.1.2' }), '发现新版本 0.1.2')
  setLocale('en')
  assert.equal(t('common.running', { n: 3 }), '3 running')
  assert.equal(t('update.error', { error: '404' }), 'Update check failed: 404')
  setLocale('zh')
})
