
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { readPersistedState, slugify as slugifyPersist } from '../persist.js'
import { debugWarn } from '../debug.js'

// ─── persist helpers ───────────────────────────────────────

describe('persist helpers', () => {
  it('slugify converts to lowercase with hyphens', () => {
    assert.equal(slugifyPersist('Recent Content'), 'recent-content')
    assert.equal(slugifyPersist('Hello World!'), 'hello-world')
  })

  it('readPersistedState returns undefined for localStorage mode', () => {
    const ctx = { user: undefined, headers: {}, path: '/', params: {} }
    assert.equal(readPersistedState('localStorage', 'key', ctx), undefined)
  })

  it('readPersistedState returns undefined for false mode', () => {
    const ctx = { user: undefined, headers: {}, path: '/', params: {} }
    assert.equal(readPersistedState(false, 'key', ctx), undefined)
  })

  it('readPersistedState reads from urlSearch for url mode', () => {
    const ctx = { user: undefined, headers: {}, path: '/', params: {}, urlSearch: { 'my-table_page': '3', 'my-table_sort': 'name' } }
    const state = readPersistedState('url', 'table:my-table', ctx, 'my-table')
    assert.deepEqual(state, { page: '3', sort: 'name' })
  })

  it('readPersistedState returns undefined when no matching URL params', () => {
    const ctx = { user: undefined, headers: {}, path: '/', params: {}, urlSearch: { 'other_page': '3' } }
    const state = readPersistedState('url', 'table:my-table', ctx, 'my-table')
    assert.equal(state, undefined)
  })

  it('readPersistedState reads from sessionGet for session mode', () => {
    const ctx = { user: undefined, headers: {}, path: '/', params: {}, sessionGet: (key: string) => key === 'table:foo' ? { page: 2, sort: 'name' } : undefined }
    const state = readPersistedState('session', 'table:foo', ctx)
    assert.deepEqual(state, { page: 2, sort: 'name' })
  })

  it('readPersistedState wraps string session value', () => {
    const ctx = { user: undefined, headers: {}, path: '/', params: {}, sessionGet: (key: string) => key === 'tabs:my-tabs' ? 'charts' : undefined }
    const state = readPersistedState('session', 'tabs:my-tabs', ctx)
    assert.deepEqual(state, { value: 'charts' })
  })

  it('readPersistedState returns undefined when sessionGet throws', () => {
    const ctx = { user: undefined, headers: {}, path: '/', params: {}, sessionGet: () => { throw new Error('no session') } }
    const state = readPersistedState('session', 'key', ctx)
    assert.equal(state, undefined)
  })
})

// ─── DataSource / resolveDataSource ──────────────────────────────────────────

describe('resolveDataSource', () => {
  it('resolves static array', async () => {
    const { resolveDataSource } = await import('../datasource.js')
    const data = [{ a: 1 }, { a: 2 }]
    const ctx = { user: undefined, headers: {}, path: '/', params: {} }
    const result = await resolveDataSource(data, ctx)
    assert.deepEqual(result, data)
  })

  it('resolves async function', async () => {
    const { resolveDataSource } = await import('../datasource.js')
    const fn = async () => [{ a: 1 }, { a: 2 }]
    const ctx = { user: undefined, headers: {}, path: '/', params: {} }
    const result = await resolveDataSource(fn, ctx)
    assert.deepEqual(result, [{ a: 1 }, { a: 2 }])
  })

  it('passes context to async function', async () => {
    const { resolveDataSource } = await import('../datasource.js')
    const fn = async (ctx: { user: unknown }) => [{ user: ctx.user }]
    const ctx = { user: { id: '1' }, headers: {}, path: '/', params: {} }
    const result = await resolveDataSource(fn, ctx as import('../types.js').PanelContext)
    assert.deepEqual(result, [{ user: { id: '1' } }])
  })
})

// ─── debugWarn ─────────────────────────────────────────────

describe('debugWarn', () => {
  it('does not throw', () => {
    assert.doesNotThrow(() => debugWarn('test', new Error('test error')))
  })

  it('handles string errors', () => {
    assert.doesNotThrow(() => debugWarn('test', 'string error'))
  })
})
