// Named connections on the Drizzle adapter (multi-connection Task 4).
//
// The provider registers a LAZY ConnectionManager factory per connection it
// claims (skipping other-engine connections) and the dev-HMR client cache keys
// per connection name. Read/write-split routing is covered in
// read-write-split.test.ts.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { ConfigRepository, setConfigRepository } from '@rudderjs/core'
import type { Application } from '@rudderjs/core'
import { ModelRegistry, ConnectionManager } from '@rudderjs/orm'
import { DatabaseProvider, drizzle, type DrizzleConfig } from './index.js'

const users = sqliteTable('users', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
})

const CACHE_KEY = '__rudderjs_drizzle_client__'
const G = globalThis as Record<string, unknown>

function fakeApp(): Application {
  return { instance: () => {} } as unknown as Application
}

/** Build through the public factory (driver path → the client cache). */
async function makeAdapter(cfg: DrizzleConfig): Promise<{ db: unknown }> {
  return (await drizzle(cfg).create()) as unknown as { db: unknown }
}

/** Raw exec on an adapter's underlying better-sqlite3 handle (tests only). */
function rawExec(adapter: { db: unknown }, sql: string): void {
  const client = (adapter.db as { $client?: { exec(sql: string): void } }).$client
  assert.ok(client?.exec, 'better-sqlite3 $client reachable')
  client.exec(sql)
}

beforeEach(() => {
  delete G[CACHE_KEY]
  delete G['__rudderjs_orm_connections__']
  ModelRegistry.reset()
})

describe('DrizzleAdapter — per-connection client cache', () => {
  it('two NAMED connections coexist (neither evicts the other)', async () => {
    const a = await makeAdapter({ driver: 'sqlite', url: ':memory:', connectionName: 'a', tables: { users } })
    const b = await makeAdapter({ driver: 'sqlite', url: ':memory:', connectionName: 'b', tables: { users } })

    assert.notStrictEqual(a.db, b.db, 'distinct clients per named connection')

    // Distinct :memory: databases — a table on 'a' is invisible on 'b'.
    rawExec(a, 'CREATE TABLE only_a (n INTEGER)')
    assert.throws(() => rawExec(b, 'SELECT * FROM only_a'), /no such table/)
  })

  it('same name + unchanged signature reuses the live client (re-boot fast path)', async () => {
    const cfg: DrizzleConfig = { driver: 'sqlite', url: ':memory:', connectionName: 'a', tables: { users } }
    const first  = await makeAdapter(cfg)
    const second = await makeAdapter(cfg)
    assert.strictEqual(second.db, first.db)
  })
})

describe('Drizzle DatabaseProvider — named-connection factories', () => {
  it('registers lazy factories for claimed connections; default opens eagerly through the manager', async () => {
    setConfigRepository(new ConfigRepository({ database: {
      default: 'main',
      connections: {
        main:  { driver: 'sqlite', url: ':memory:' },
        audit: { driver: 'sqlite', url: ':memory:' },
        // Claimed by the native engine — must NOT be registered here.
        nativeOne: { engine: 'native', driver: 'pg', url: 'postgres://x' },
      },
      tables: { users },
    } }))

    await new DatabaseProvider(fakeApp()).boot()

    assert.equal(ConnectionManager.defaultName(), 'main')
    assert.deepEqual(ConnectionManager.names().sort(), ['audit', 'main'])
    assert.strictEqual(ConnectionManager.peek('main'), ModelRegistry.get(), 'default shared with Models')
    assert.equal(ConnectionManager.peek('audit'), null, 'named connection stays lazy')

    // First use opens it; distinct database from the default.
    const audit = await ConnectionManager.ensure('audit') as unknown as { db: unknown }
    assert.notStrictEqual(audit, ModelRegistry.get())
    rawExec(ModelRegistry.get() as unknown as { db: unknown }, 'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)')
    rawExec(ModelRegistry.get() as unknown as { db: unknown }, "INSERT INTO users (name) VALUES ('on-main')")
    rawExec(audit, 'CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)')

    const qb = (a: unknown) => (a as { query<T>(t: string): { get(): Promise<T[]> } }).query<{ name: string }>('users')
    const mainRows  = await qb(ModelRegistry.get()).get()
    const auditRows = await qb(audit).get()
    assert.deepEqual(mainRows.map((r) => r.name), ['on-main'])
    assert.equal(auditRows.length, 0, 'audit database is empty — separate connection')
  })

})
