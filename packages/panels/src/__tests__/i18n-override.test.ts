import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { getPanelI18n, _clearI18nCache } from '../i18n/index.js'
import { en } from '../i18n/en.js'
import { ar } from '../i18n/ar.js'

type GMap = Map<string, Record<string, unknown>>

function getCache(): GMap {
  const g = globalThis as Record<string, unknown>
  if (!g['__rudderjs_localization_cache__']) {
    g['__rudderjs_localization_cache__'] = new Map<string, Record<string, unknown>>()
  }
  return g['__rudderjs_localization_cache__'] as GMap
}

function seed(locale: string, data: Record<string, unknown>): void {
  getCache().set(`${locale}:panels`, data)
}

function clearOverrides(): void {
  const cache = getCache()
  for (const key of [...cache.keys()]) {
    if (key.endsWith(':panels')) cache.delete(key)
  }
}

describe('panels i18n override', () => {
  beforeEach(() => {
    clearOverrides()
    _clearI18nCache()
  })

  it('returns bundled defaults when no override is present', () => {
    const i18n = getPanelI18n('en')
    assert.equal(i18n.signOut, en.signOut)
  })

  it('falls back to en for an unknown locale', () => {
    const i18n = getPanelI18n('xx')
    assert.equal(i18n.signOut, en.signOut)
  })

  it('resolves region-tagged locales by base (en-US -> en)', () => {
    const i18n = getPanelI18n('en-US')
    assert.equal(i18n.signOut, en.signOut)
  })

  it('merges override on top of bundled defaults', () => {
    seed('en', { signOut: 'Logout' })
    const i18n = getPanelI18n('en')
    assert.equal(i18n.signOut, 'Logout')
    // Untouched keys keep bundled values.
    assert.equal(i18n.search, en.search)
  })

  it('override applies to non-en bundled locale', () => {
    seed('ar', { signOut: 'تسجيل الخروج (مخصص)' })
    const i18n = getPanelI18n('ar')
    assert.equal(i18n.signOut, 'تسجيل الخروج (مخصص)')
    assert.equal(i18n.search, ar.search)
  })

  it('falls back to base locale override (es-MX -> es)', () => {
    seed('es', { signOut: 'Cerrar sesión' })
    const i18n = getPanelI18n('es-MX')
    assert.equal(i18n.signOut, 'Cerrar sesión')
    // Bundled fallback (en) fills the gaps because no Spanish bundle exists.
    assert.equal(i18n.search, en.search)
  })

  it('caches the merged result across calls', () => {
    seed('en', { signOut: 'Logout' })
    const a = getPanelI18n('en')
    const b = getPanelI18n('en')
    assert.equal(a, b)
  })

  it('_clearI18nCache forces re-merge', () => {
    seed('en', { signOut: 'Logout' })
    const a = getPanelI18n('en')

    seed('en', { signOut: 'Sign me out' })
    // Without clearing, cached value persists.
    assert.equal(getPanelI18n('en'), a)

    _clearI18nCache()
    const b = getPanelI18n('en')
    assert.equal(b.signOut, 'Sign me out')
  })

  it('ignores empty override objects', () => {
    seed('en', {})
    const i18n = getPanelI18n('en')
    assert.equal(i18n.signOut, en.signOut)
  })
})
