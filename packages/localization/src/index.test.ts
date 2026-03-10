import { beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join as pathJoin } from 'node:path'

import {
  LocalizationRegistry,
  __,
  trans,
} from './index.js'

describe('interpolation', () => {
  beforeEach(() => LocalizationRegistry.reset())

  it('returns key as-is when namespace not loaded', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    assert.equal(__('messages.missing'), 'messages.missing')
  })

  it('resolves a simple key', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'messages', { greeting: 'Hello!' })
    assert.equal(__('messages.greeting'), 'Hello!')
  })

  it('resolves a nested key', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'messages', { user: { welcome: 'Welcome back!' } })
    assert.equal(__('messages.user.welcome'), 'Welcome back!')
  })

  it('interpolates :placeholder', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'messages', { greeting: 'Hello, :name!' })
    assert.equal(__('messages.greeting', { name: 'John' }), 'Hello, John!')
  })

  it('interpolates multiple placeholders', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'messages', { msg: ':a and :b' })
    assert.equal(__('messages.msg', { a: 'foo', b: 'bar' }), 'foo and bar')
  })

  it('falls back to fallback locale', () => {
    LocalizationRegistry.configure({ locale: 'es', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'messages', { greeting: 'Hello!' })
    assert.equal(__('messages.greeting'), 'Hello!')
  })
})

describe('pluralization', () => {
  beforeEach(() => LocalizationRegistry.reset())

  it('{0} zero case', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'msg', { apples: '{0} no apples|{1} one apple|{n} :count apples' })
    assert.equal(__('msg.apples', 0), 'no apples')
  })

  it('{1} singular case', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'msg', { apples: '{0} no apples|{1} one apple|{n} :count apples' })
    assert.equal(__('msg.apples', 1), 'one apple')
  })

  it('{n} plural case with :count', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'msg', { apples: '{0} no apples|{1} one apple|{n} :count apples' })
    assert.equal(__('msg.apples', 5), '5 apples')
  })

  it('simple two-part plural (singular|plural)', () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: '/tmp' })
    LocalizationRegistry.seed('en', 'msg', { item: 'one item|many items' })
    assert.equal(__('msg.item', 1), 'one item')
    assert.equal(__('msg.item', 2), 'many items')
  })
})

describe('file loading via trans()', () => {
  let tmpDir = ''

  beforeEach(async () => {
    LocalizationRegistry.reset()
    tmpDir = pathJoin(tmpdir(), `bk-i18n-test-${Date.now()}`)
    await mkdir(pathJoin(tmpDir, 'en'), { recursive: true })
    await mkdir(pathJoin(tmpDir, 'es'), { recursive: true })
    await writeFile(
      pathJoin(tmpDir, 'en', 'site.json'),
      JSON.stringify({ title: 'My App', nav: { home: 'Home' } }),
    )
    await writeFile(
      pathJoin(tmpDir, 'es', 'site.json'),
      JSON.stringify({ title: 'Mi App' }),
    )
  })

  it('loads and resolves a simple key from disk', async () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: tmpDir })
    assert.equal(await trans('site.title'), 'My App')
  })

  it('loads and resolves a nested key', async () => {
    LocalizationRegistry.configure({ locale: 'en', fallback: 'en', path: tmpDir })
    assert.equal(await trans('site.nav.home'), 'Home')
  })

  it('falls back to fallback locale when key missing', async () => {
    LocalizationRegistry.configure({ locale: 'es', fallback: 'en', path: tmpDir })
    assert.equal(await trans('site.nav.home'), 'Home')
  })

  it('resolves key in current locale when available', async () => {
    LocalizationRegistry.configure({ locale: 'es', fallback: 'en', path: tmpDir })
    assert.equal(await trans('site.title'), 'Mi App')
  })

  it('returns key string when not found in any locale', async () => {
    LocalizationRegistry.configure({ locale: 'es', fallback: 'en', path: tmpDir })
    assert.equal(await trans('site.missing.key'), 'site.missing.key')
  })
})
