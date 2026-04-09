import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { LocalizationRegistry } from '@rudderjs/localization'

import { getPanelI18n, _clearI18nCache, _setLocalizationRegistry } from '../i18n/index.js'
import { en } from '../i18n/en.js'
import { ar } from '../i18n/ar.js'

const SEEDED_LOCALES = ['en', 'ar', 'es', 'en-US', 'es-MX', 'xx']

function seed(locale: string, data: Record<string, unknown>): void {
  LocalizationRegistry.setCached(locale, 'pilotiq', data)
}

function clearOverrides(): void {
  for (const locale of SEEDED_LOCALES) {
    LocalizationRegistry.deleteCached(locale, 'pilotiq')
  }
}

describe('panels i18n override', () => {
  beforeEach(() => {
    // Wire the typed registry the same way PanelServiceProvider.boot() does.
    _setLocalizationRegistry(LocalizationRegistry)
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
