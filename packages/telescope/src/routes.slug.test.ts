import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toApiSlug, type EntryType } from './types.js'

/**
 * Regression test for the `EntryType → URL slug` contract shared between
 * the server (`routes.ts`) and the client (`EntryList.ts`). Both sites
 * call `toApiSlug(type)` since PR #432; a drift between them historically
 * 404s the listing API silently and the dashboard renders empty.
 *
 * If you add a new `EntryType`, add it to `EXPECTED` below — the test
 * will fail loudly until the slug is decided.
 */

const EXPECTED: Record<EntryType, string> = {
  request:      'requests',
  query:        'queries',
  job:          'jobs',
  exception:    'exceptions',
  log:          'logs',
  mail:         'mails',
  notification: 'notifications',
  event:        'events',
  cache:        'caches',
  schedule:     'schedules',
  model:        'models',
  command:      'commands',
  broadcast:    'broadcasts',
  sync:         'syncs',
  http:         'http',
  gate:         'gates',
  dump:         'dumps',
  ai:           'ai',
  mcp:          'mcp',
  view:         'views',
}

describe('toApiSlug', () => {
  for (const [type, expected] of Object.entries(EXPECTED) as [EntryType, string][]) {
    it(`maps ${type} → ${expected}`, () => {
      assert.equal(toApiSlug(type), expected)
    })
  }

  it('keeps http/ai/mcp singular (collision risk if pluralized)', () => {
    assert.equal(toApiSlug('http'), 'http')
    assert.equal(toApiSlug('ai'),   'ai')
    assert.equal(toApiSlug('mcp'),  'mcp')
  })

  it('special-cases query → queries (irregular plural)', () => {
    assert.equal(toApiSlug('query'), 'queries')
  })

  it('special-cases view → views (file-view is not file-views, but URL is)', () => {
    assert.equal(toApiSlug('view'), 'views')
  })
})
