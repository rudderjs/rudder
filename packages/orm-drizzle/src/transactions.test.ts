// Cross-adapter transaction() conformance for the Drizzle adapter (gap §8 #1).
//
// Drizzle's `db.transaction(async (tx) => …)` hands the callback a transaction-
// scoped `db`; the adapter re-binds to it so every Model.* call inside the
// callback (threaded through the ORM's AsyncLocalStorage) runs on that one
// connection. Drizzle's `tx` is itself a `db`, so a nested transaction() opens a
// real SAVEPOINT — we assert inner rollback discards only the inner work.
//
// Runs against a real libsql (SQLite) in-memory database. better-sqlite3 is NOT
// usable here: its driver runs transactions synchronously and rejects async
// callbacks ("Transaction function cannot return a promise"). libsql does async
// transactions + savepoints, server-free.
//
// The DB.* RAW join (DB.insert/select inside a tx) needs an `execute()`-capable
// driver (Postgres / MySQL / neon) — libsql has none — so that path is covered by
// the native + Prisma suites. Here we prove the ALS one-connection guarantee with
// two models written in a single callback.

import { describe, it, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { sql } from 'drizzle-orm'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { Model, ModelRegistry, transaction } from '@rudderjs/orm'
// Side effect: registers the DB facade bridge + transaction runner.
import { drizzle as drizzleAdapter, type DrizzleConfig } from './index.js'

const accounts = sqliteTable('accounts', {
  id:    integer('id').primaryKey({ autoIncrement: true }),
  owner: text('owner').notNull(),
})
const ledgers = sqliteTable('ledgers', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  note: text('note').notNull(),
})

class Account extends Model {
  static override table = 'accounts'
  id!: number
  owner!: string
}
class Ledger extends Model {
  static override table = 'ledgers'
  id!: number
  note!: string
}

// One libsql connection for the whole file; tables are reset per test.
const client: Client = createClient({ url: 'file::memory:?cache=shared' })
const db = drizzle(client)

after(() => { client.close() })

beforeEach(async () => {
  await db.run(sql`DROP TABLE IF EXISTS accounts`)
  await db.run(sql`DROP TABLE IF EXISTS ledgers`)
  await db.run(sql`CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL)`)
  await db.run(sql`CREATE TABLE ledgers (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT NOT NULL)`)

  const cfg: DrizzleConfig = { client: db, dialect: 'sqlite', tables: { accounts, ledgers } }
  ModelRegistry.reset()
  ModelRegistry.set(await drizzleAdapter(cfg).create())
})

describe('Drizzle transaction() — commit', () => {
  it('persists writes across two models in one callback (single connection)', async () => {
    await transaction(async () => {
      const acct = await Account.create({ owner: 'Ada' })
      await Ledger.create({ note: `opened #${acct.id}` })
    })
    assert.equal(await Account.count(), 1)
    assert.equal(await Ledger.count(), 1)
  })

  it('returns the callback value', async () => {
    const id = await transaction(async () => {
      const acct = await Account.create({ owner: 'Grace' })
      return acct.id
    })
    assert.equal(typeof id, 'number')
    assert.equal((await Account.find(id))!.owner, 'Grace')
  })
})

describe('Drizzle transaction() — rollback', () => {
  it('rolls back every write when the callback throws, and re-throws', async () => {
    await assert.rejects(
      transaction(async () => {
        await Account.create({ owner: 'Ada' })
        await Ledger.create({ note: 'should vanish' })
        throw new Error('boom')
      }),
      /boom/,
    )
    assert.equal(await Account.count(), 0)
    assert.equal(await Ledger.count(), 0)
  })

  it('leaves the database usable after a rollback', async () => {
    await assert.rejects(transaction(async () => {
      await Account.create({ owner: 'doomed' })
      throw new Error('nope')
    }))
    await Account.create({ owner: 'survivor' })
    assert.equal(await Account.count(), 1)
  })
})

describe('Drizzle transaction() — nesting (savepoints)', () => {
  it('commits both levels when neither throws', async () => {
    await transaction(async () => {
      await Account.create({ owner: 'outer' })
      await transaction(async () => {
        await Account.create({ owner: 'inner' })
      })
    })
    assert.equal(await Account.count(), 2)
  })

  it('a caught inner rollback discards only the inner work', async () => {
    await transaction(async () => {
      await Account.create({ owner: 'kept' })
      await assert.rejects(transaction(async () => {
        await Account.create({ owner: 'discarded' })
        throw new Error('inner boom')
      }), /inner boom/)
      // Outer continues and commits.
    })
    const owners = (await Account.all()).map((a) => a.owner)
    assert.deepEqual(owners, ['kept'])
  })

  it('an uncaught inner error rolls back the whole outer transaction', async () => {
    await assert.rejects(transaction(async () => {
      await Account.create({ owner: 'outer' })
      await transaction(async () => {
        await Account.create({ owner: 'inner' })
        throw new Error('propagate')
      })
    }), /propagate/)
    assert.equal(await Account.count(), 0)
  })
})

describe('Drizzle transaction() — isolation level', () => {
  // The level must reach Drizzle's `db.transaction(fn, config)` second arg
  // verbatim (Drizzle's pg/mysql drivers use the same lowercase ANSI names as
  // the contract). A recording fake stands in for the db — no server needed.
  function recordingDb() {
    const seen: { config: unknown }[] = []
    const db = {
      transaction: async <T>(fn: (tx: unknown) => Promise<T>, config?: unknown): Promise<T> => {
        seen.push({ config })
        return fn({})
      },
    }
    return { db, seen }
  }

  it('passes isolationLevel through to db.transaction config (pg)', async () => {
    const { db: fake, seen } = recordingDb()
    const adapter = await drizzleAdapter({ client: fake, dialect: 'pg' }).create()
    await adapter.transaction!(async () => null, { isolationLevel: 'repeatable read' })
    assert.deepEqual(seen, [{ config: { isolationLevel: 'repeatable read' } }])
  })

  it('passes NO config when no level is requested (back-compat)', async () => {
    const { db: fake, seen } = recordingDb()
    const adapter = await drizzleAdapter({ client: fake, dialect: 'mysql' }).create()
    await adapter.transaction!(async () => null)
    assert.deepEqual(seen, [{ config: undefined }])
  })

  it('throws a clear unsupported error on sqlite (never a silent drop)', async () => {
    // The registered adapter is the real libsql/sqlite one from beforeEach.
    await assert.rejects(
      transaction(async () => {}, { isolationLevel: 'serializable' }),
      /SQLite does not support transaction isolation levels/,
    )
  })

  it('the ORM-level guard rejects isolationLevel on a nested transaction()', async () => {
    await transaction(async () => {
      await assert.rejects(
        transaction(async () => {}, { isolationLevel: 'read committed' }),
        /isolationLevel cannot be set on a nested transaction/,
      )
    })
  })
})
