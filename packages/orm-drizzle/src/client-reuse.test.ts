import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'
import { drizzle, DrizzleAdapter, type DrizzleConfig } from './index.js'

// ─── Dev HMR: drizzle client reuse across re-boots ─────────
//
// Before the fix, every dev re-boot ran DrizzleAdapter.make() → opened a fresh
// driver connection (postgres socket / mysql2 pool / libsql client / sqlite
// handle) and never closed the previous one — the per-re-boot connection leak
// that exhausted MySQL max_connections for orm-prisma (#652). These tests pin
// the lifecycle contract that closes that leak, against the real better-sqlite3
// driver (cheap, in-memory):
//   1. same connection signature  → reuse the live client (no new connection)
//   2. changed signature          → fresh client + dispose the superseded one
//   3. an app-supplied config.client opts out of the cache entirely

const CACHE_KEY = '__rudderjs_drizzle_client__'
const G = globalThis as Record<string, unknown>
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10))

async function makeAdapter(cfg: DrizzleConfig): Promise<DrizzleAdapter> {
  return (await drizzle(cfg).create()) as DrizzleAdapter
}

/** drizzle-orm exposes the underlying better-sqlite3 Database as `db.$client`. */
const underlying = (a: DrizzleAdapter): { open: boolean } =>
  (a.db as unknown as { $client: { open: boolean } }).$client

const tmpFiles: string[] = []
function tmpDbUrl(): string {
  const p = join(tmpdir(), `drizzle-reuse-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  tmpFiles.push(p)
  return p
}

describe('DrizzleAdapter.make — dev HMR client reuse', () => {
  beforeEach(() => { delete G[CACHE_KEY] })
  afterEach(() => {
    delete G[CACHE_KEY]
    for (const f of tmpFiles.splice(0)) {
      try { if (existsSync(f)) rmSync(f) } catch { /* best effort */ }
    }
  })

  it('reuses one client across re-boots with the same connection signature', async () => {
    const cfg: DrizzleConfig = { driver: 'sqlite', url: ':memory:' }

    const a1 = await makeAdapter(cfg)
    const a2 = await makeAdapter(cfg) // simulates the next dev re-boot

    assert.strictEqual(a2.db, a1.db, 'second re-boot must reuse the same live client')
    assert.equal(underlying(a1).open, true, 'the reused connection stays open')
  })

  it('builds a fresh client and disposes the superseded one when the signature changes', async () => {
    const a1 = await makeAdapter({ driver: 'sqlite', url: ':memory:' })
    const old = underlying(a1)

    const a2 = await makeAdapter({ driver: 'sqlite', url: tmpDbUrl() })
    await settle() // the superseded dispose() is fire-and-forget on a microtask

    assert.notStrictEqual(a2.db, a1.db, 'a changed connection url builds a new client')
    assert.equal(old.open, false, 'the superseded connection was closed')
    assert.equal(underlying(a2).open, true, 'the new connection stays open')
  })

  it('does not cache or reuse an app-supplied config.client', async () => {
    const Database = (await import('better-sqlite3')).default
    const { drizzle: dz } = await import('drizzle-orm/better-sqlite3')
    const clientA = dz(new Database(':memory:')) as unknown as NonNullable<DrizzleConfig['client']>

    const a1 = await makeAdapter({ client: clientA, dialect: 'sqlite' })

    assert.strictEqual(a1.db, clientA, 'passes through the supplied client untouched')
    assert.equal(G[CACHE_KEY], undefined, 'config.client path leaves the reuse cache empty')
  })
})
