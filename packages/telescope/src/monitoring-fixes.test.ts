import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { AppRequest, AppResponse } from '@rudderjs/contracts'
import { ALL_ENTRY_TYPES } from './types.js'
import type { EntryType, TelescopeStorage } from './types.js'
import { prune, overview } from './api/routes.js'
import { ExceptionCollector } from './collectors/exception.js'
import { setExceptionReporter, report } from '@rudderjs/core'

// ─── Entry-type completeness ──────────────────────────────

describe('ALL_ENTRY_TYPES', () => {
  it('contains all 20 entry types including the formerly-missing ones', () => {
    assert.equal(ALL_ENTRY_TYPES.length, 20)
    // These six were dropped from the truncated api/routes copy, which made
    // prune() wipe the whole store and hid their overview tiles.
    for (const t of ['http', 'gate', 'dump', 'ai', 'mcp', 'view'] as const) {
      assert.ok(ALL_ENTRY_TYPES.includes(t), `missing ${t}`)
    }
  })
})

// ─── prune handler does not nuke the whole store ──────────

function fakeReq(query: Record<string, string>): AppRequest {
  return { query } as unknown as AppRequest
}
function fakeRes(): AppResponse {
  return { json() { return this } } as unknown as AppResponse
}

describe('prune handler', () => {
  it('prunes only the requested type for every entry type (no fall-through to prune-all)', async () => {
    for (const type of ALL_ENTRY_TYPES) {
      const calls: Array<EntryType | undefined> = []
      const storage = {
        prune(t?: EntryType) { calls.push(t) },
      } as unknown as TelescopeStorage

      await prune(storage, fakeReq({ type }), fakeRes())

      // Must scope the prune to the one type — never the all-store prune().
      assert.deepEqual(calls, [type], `prune?type=${type} should scope to ${type}`)
    }
  })

  it('prunes everything when no type is given', async () => {
    const calls: Array<EntryType | undefined> = []
    const storage = {
      prune(t?: EntryType) { calls.push(t) },
    } as unknown as TelescopeStorage

    await prune(storage, fakeReq({}), fakeRes())
    assert.deepEqual(calls, [undefined])
  })
})

// ─── overview counts every type ───────────────────────────

describe('overview handler', () => {
  it('counts all 20 entry types', async () => {
    const counted: Array<EntryType | undefined> = []
    const storage = {
      count(t?: EntryType) { counted.push(t); return 0 },
    } as unknown as TelescopeStorage

    await overview(storage, fakeRes())

    for (const t of ALL_ENTRY_TYPES) {
      assert.ok(counted.includes(t), `overview omitted ${t}`)
    }
  })
})

// ─── exception forwarding ─────────────────────────────────

describe('ExceptionCollector', () => {
  afterEach(() => {
    setExceptionReporter(() => {})
  })

  it('forwards to the real previous reporter instead of swallowing it', async () => {
    const forwarded: unknown[] = []
    // Reporter installed before the collector (e.g. the log channel).
    setExceptionReporter((err) => { forwarded.push(err) })

    const stored: Array<Record<string, unknown>> = []
    const storage = {
      store(entry: Record<string, unknown>) { stored.push(entry) },
    } as unknown as TelescopeStorage

    await new ExceptionCollector(storage).register()

    const err = new RangeError('kaboom')
    report(err)

    // Recorded once...
    assert.equal(stored.length, 1)
    // ...and forwarded to the previous reporter exactly once (the bug left this
    // empty because the wrapper re-entered itself and the guard bailed).
    assert.deepEqual(forwarded, [err])
  })
})
