
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPanelI18n, getPanelDir, getActiveLocale } from '../i18n/index.js'
import { Panel } from '../Panel.js'
import { Text }    from '../schema/Text.js'
import { Heading } from '../schema/Heading.js'

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema')

// ─── getPanelI18n ─────────────────────────────────────────────

describe('getPanelI18n', () => {
  it('returns English strings for "en"', () => {
    const i18n = getPanelI18n('en')
    assert.equal(i18n.signOut, 'Sign out')
    assert.equal(i18n.yes, 'Yes')
    assert.equal(i18n.no, 'No')
    assert.equal(i18n.cancel, 'Cancel')
  })

  it('returns Arabic strings for "ar"', () => {
    const i18n = getPanelI18n('ar')
    assert.equal(i18n.yes, 'نعم')
    assert.equal(i18n.no, 'لا')
  })

  it('falls back to English for unknown locale', () => {
    const i18n = getPanelI18n('zh')
    assert.equal(i18n.yes, 'Yes')
  })

  it('resolves base locale from full tag (e.g. "ar-SA")', () => {
    const i18n = getPanelI18n('ar-SA')
    assert.equal(i18n.yes, 'نعم')
  })
})

describe('getPanelDir', () => {
  it('returns ltr for en', () => assert.equal(getPanelDir('en'), 'ltr'))
  it('returns rtl for ar', () => assert.equal(getPanelDir('ar'), 'rtl'))
  it('returns rtl for he', () => assert.equal(getPanelDir('he'), 'rtl'))
  it('returns rtl for fa', () => assert.equal(getPanelDir('fa'), 'rtl'))
  it('returns rtl for ar-SA', () => assert.equal(getPanelDir('ar-SA'), 'rtl'))
  it('returns ltr for fr', () => assert.equal(getPanelDir('fr'), 'ltr'))
  it('returns ltr for unknown locale', () => assert.equal(getPanelDir('xyz'), 'ltr'))
})

describe('getActiveLocale', () => {
  it('returns "en" when no global config set', () => {
    const g = globalThis as Record<string, unknown>
    const prev = g['__rudderjs_localization_config__']
    delete g['__rudderjs_localization_config__']
    assert.equal(getActiveLocale(), 'en')
    g['__rudderjs_localization_config__'] = prev
  })

  it('returns locale from global config', () => {
    const g = globalThis as Record<string, unknown>
    g['__rudderjs_localization_config__'] = { locale: 'ar' }
    assert.equal(getActiveLocale(), 'ar')
    delete g['__rudderjs_localization_config__']
  })
})

describe('Panel.locale()', () => {
  it('overrides locale in toMeta()', () => {
    const meta = Panel.make('x').path('/x').locale('ar').toMeta()
    assert.equal(meta.locale, 'ar')
  })

  it('sets dir to rtl for Arabic', () => {
    const meta = Panel.make('x').path('/x').locale('ar').toMeta()
    assert.equal(meta.dir, 'rtl')
  })

  it('sets dir to ltr for English', () => {
    const meta = Panel.make('x').path('/x').locale('en').toMeta()
    assert.equal(meta.dir, 'ltr')
  })

  it('i18n in toMeta() matches the set locale', () => {
    const meta = Panel.make('x').path('/x').locale('ar').toMeta()
    assert.equal(meta.i18n.yes, 'نعم')
  })

  it('falls back to getActiveLocale() when not set', () => {
    const g = globalThis as Record<string, unknown>
    const prev = g['__rudderjs_localization_config__']
    delete g['__rudderjs_localization_config__']
    const meta = Panel.make('x').path('/x').toMeta()
    assert.equal(meta.locale, 'en')
    g['__rudderjs_localization_config__'] = prev
  })
})

// ─── Global search — i18n keys ──────────────────────────────

describe('globalSearch i18n keys', () => {
  it('en has globalSearch key', () => {
    const i18n = getPanelI18n('en')
    assert.equal(typeof i18n.globalSearch, 'string')
    assert.ok(i18n.globalSearch.length > 0)
  })

  it('en globalSearchEmpty contains :query placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.globalSearchEmpty.includes(':query'))
  })

  it('en globalSearchShortcut is non-empty', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.globalSearchShortcut.length > 0)
  })

  it('ar has globalSearch key (non-empty)', () => {
    const i18n = getPanelI18n('ar')
    assert.ok(i18n.globalSearch.length > 0)
  })

  it('ar globalSearchEmpty contains :query placeholder', () => {
    const i18n = getPanelI18n('ar')
    assert.ok(i18n.globalSearchEmpty.includes(':query'))
  })
})

// ─── Bulk delete — i18n keys ────────────────────────────────

describe('bulk delete i18n keys', () => {
  it('en has deleteSelected key with :n placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.deleteSelected.includes(':n'))
  })

  it('en has bulkDeleteConfirm key with :n placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.bulkDeleteConfirm.includes(':n'))
  })

  it('en has bulkDeletedToast key with :n placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.bulkDeletedToast.includes(':n'))
  })

  it('ar has deleteSelected key (non-empty)', () => {
    const i18n = getPanelI18n('ar')
    assert.ok(i18n.deleteSelected.length > 0)
  })
})

// ─── Duplicate — i18n keys ───────────────────────────────────

describe('duplicate i18n keys', () => {
  it('en has duplicate key', () => {
    const i18n = getPanelI18n('en')
    assert.equal(typeof i18n.duplicate, 'string')
    assert.ok(i18n.duplicate.length > 0)
  })

  it('ar has duplicate key (non-empty)', () => {
    const i18n = getPanelI18n('ar')
    assert.ok(i18n.duplicate.length > 0)
  })
})

// ─── i18n — autosave & persist keys ─────────────────────────

describe('i18n — autosave & persist strings', () => {
  it('en has all autosave/persist keys', () => {
    const i18n = getPanelI18n('en')
    assert.equal(typeof i18n.autosaved, 'string')
    assert.equal(typeof i18n.autosaving, 'string')
    assert.equal(typeof i18n.unsavedChanges, 'string')
    assert.equal(typeof i18n.restoreDraft, 'string')
    assert.equal(typeof i18n.restoreDraftButton, 'string')
    assert.equal(typeof i18n.discardDraft, 'string')
    assert.equal(typeof i18n.unsavedWarning, 'string')
  })

  it('ar has all autosave/persist keys', () => {
    const i18n = getPanelI18n('ar')
    assert.equal(typeof i18n.autosaved, 'string')
    assert.equal(typeof i18n.autosaving, 'string')
    assert.equal(typeof i18n.unsavedChanges, 'string')
    assert.equal(typeof i18n.restoreDraft, 'string')
    assert.equal(typeof i18n.restoreDraftButton, 'string')
    assert.equal(typeof i18n.discardDraft, 'string')
    assert.equal(typeof i18n.unsavedWarning, 'string')
  })

  it('restoreDraft contains :time placeholder', () => {
    const i18n = getPanelI18n('en')
    assert.ok(i18n.restoreDraft.includes(':time'))
  })

  it('en has all dashboard keys', () => {
    const i18n = getPanelI18n('en')
    assert.equal(typeof i18n.customizeDashboard, 'string')
    assert.equal(typeof i18n.doneDashboard, 'string')
    assert.equal(typeof i18n.addWidget, 'string')
    assert.equal(typeof i18n.removeWidget, 'string')
    assert.equal(typeof i18n.noWidgets, 'string')
    assert.equal(typeof i18n.availableWidgets, 'string')
  })

  it('ar has all dashboard keys', () => {
    const i18n = getPanelI18n('ar')
    assert.equal(typeof i18n.customizeDashboard, 'string')
    assert.equal(typeof i18n.doneDashboard, 'string')
    assert.equal(typeof i18n.addWidget, 'string')
    assert.equal(typeof i18n.removeWidget, 'string')
    assert.equal(typeof i18n.noWidgets, 'string')
    assert.equal(typeof i18n.availableWidgets, 'string')
  })
})

// ─── Schema files ─────────────────────────────────────────

describe('panels schema files', () => {
  it('ships panels.prisma with PanelVersion and PanelGlobal', () => {
    const file = join(schemaDir, 'panels.prisma')
    assert.ok(existsSync(file), 'panels.prisma should exist')
    const content = readFileSync(file, 'utf8')
    assert.ok(content.includes('model PanelVersion'), 'should contain PanelVersion model')
    assert.ok(content.includes('model PanelGlobal'), 'should contain PanelGlobal model')
  })

  it('ships drizzle schemas for all 3 drivers', () => {
    for (const variant of ['sqlite', 'pg', 'mysql']) {
      const file = join(schemaDir, `panels.drizzle.${variant}.ts`)
      assert.ok(existsSync(file), `panels.drizzle.${variant}.ts should exist`)
      const content = readFileSync(file, 'utf8')
      assert.ok(content.includes('export const panelVersion'), `${variant}: should export panelVersion`)
      assert.ok(content.includes('export const panelGlobal'), `${variant}: should export panelGlobal`)
    }
  })

  it('sqlite schema imports from sqlite-core', () => {
    const content = readFileSync(join(schemaDir, 'panels.drizzle.sqlite.ts'), 'utf8')
    assert.ok(content.includes('drizzle-orm/sqlite-core'))
  })

  it('pg schema imports from pg-core', () => {
    const content = readFileSync(join(schemaDir, 'panels.drizzle.pg.ts'), 'utf8')
    assert.ok(content.includes('drizzle-orm/pg-core'))
  })

  it('mysql schema imports from mysql-core', () => {
    const content = readFileSync(join(schemaDir, 'panels.drizzle.mysql.ts'), 'utf8')
    assert.ok(content.includes('drizzle-orm/mysql-core'))
  })
})

// ─── Schema elements: Text, Heading ─────────────────────────

describe('Text', () => {
  it('type is text', () => {
    assert.equal(Text.make('hello').getType(), 'text')
  })

  it('toMeta returns content', () => {
    const m = Text.make('Hello world').toMeta()
    assert.equal(m.type, 'text')
    assert.equal(m.content, 'Hello world')
  })
})

describe('Heading', () => {
  it('type is heading', () => {
    assert.equal(Heading.make('Title').getType(), 'heading')
  })

  it('defaults to level 1', () => {
    const m = Heading.make('Title').toMeta()
    assert.equal(m.level, 1)
  })

  it('respects explicit level', () => {
    const m = Heading.make('Subtitle').level(2).toMeta()
    assert.equal(m.level, 2)
  })

  it('toMeta includes content', () => {
    const m = Heading.make('Dashboard').toMeta()
    assert.equal(m.content, 'Dashboard')
    assert.equal(m.type, 'heading')
  })
})

describe('Heading description', () => {
  it('description sets value', () => {
    const meta = Heading.make('Title').description('Subtitle').toMeta()
    assert.equal(meta.description, 'Subtitle')
  })

  it('description omitted when not set', () => {
    const meta = Heading.make('Title').toMeta()
    assert.equal(meta.description, undefined)
  })
})
