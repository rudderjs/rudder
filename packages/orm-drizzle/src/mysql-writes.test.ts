// MySQL write paths on the Drizzle adapter.
//
// Drizzle's mysql builders have NO `.returning()` (it's a pg/sqlite method),
// and mysql2 resolves a drizzle write to the TUPLE `[ResultSetHeader, null]`
// (header at index 0). Historically `create()` / `update()` / `restore()`
// called `.returning()` unconditionally (TypeError on mysql) and
// `affectedRowCount` read `affectedRows` off the tuple itself (always
// undefined → 0 for updateAll/deleteAll/upsert). Both went unnoticed because
// the live-mysql tests seed via SQL literals and never exercised Model writes.
//
// The fix mirrors the native engine: run the write, read the header via
// `mysqlWriteHeader` (tuple- and planetscale-shape aware), then re-SELECT by
// primary key on the write connection. These tests pin the SQL sequence with
// the no-server `drizzle-orm/mysql-proxy` driver (which passes header tuples
// through verbatim — same trick as date-helpers-not.test.ts), plus a gated
// live block against a real MySQL.

import { describe, it, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { drizzle as drizzleMysqlProxy } from 'drizzle-orm/mysql-proxy'
import { mysqlTable, serial as mysqlSerial, text as mysqlText, int as mysqlInt, timestamp as mysqlTimestamp } from 'drizzle-orm/mysql-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { DrizzleAdapter, drizzle, type DrizzleConfig } from './index.js'

// ─── Proxy-backed (no server) — pins the SQL sequence + result mapping ──────

const things = mysqlTable('things', {
  id:        mysqlSerial('id').primaryKey(),
  name:      mysqlText('name').notNull(),
  count:     mysqlInt('count').notNull(),
  deletedAt: mysqlTimestamp('deletedAt'),
})

class Thing extends Model {
  static override table = 'things'
  static override softDeletes = true
  id!: number
  name!: string
  count!: number
}

/** Recorded statements + canned responses for the proxy driver. */
let calls: Array<{ sql: string; params: unknown[]; method: string }> = []
/** Rows the next SELECT resolves to (array-of-arrays — the proxy's row form). */
let selectRows: unknown[][] = []
let nextInsertId = 1

function makeProxyAdapter(): Promise<DrizzleAdapter> {
  const db = drizzleMysqlProxy(async (sql: string, params: unknown[], method: string) => {
    calls.push({ sql, params, method })
    if (/^insert/i.test(sql)) return { rows: [{ insertId: nextInsertId, affectedRows: 1 }, null] }
    if (/^(update|delete)/i.test(sql)) return { rows: [{ insertId: 0, affectedRows: 1 }, null] }
    return { rows: selectRows }
  })
  const cfg: DrizzleConfig = { client: db, dialect: 'mysql', tables: { things } }
  return Promise.resolve(drizzle(cfg).create()) as Promise<DrizzleAdapter>
}

beforeEach(async () => {
  calls = []
  selectRows = []
  nextInsertId = 1
  ModelRegistry.reset()
  ModelRegistry.set(await makeProxyAdapter())
})

describe('mysql writes (proxy) — create()', () => {
  it('INSERT (no RETURNING) then re-SELECT by the header insertId', async () => {
    nextInsertId = 7
    selectRows = [[7, 'Ada', 0, null]]
    const created = await Thing.create({ name: 'Ada', count: 0 })

    assert.equal(calls.length, 2)
    assert.match(calls[0]!.sql, /^insert into `things`/i)
    assert.doesNotMatch(calls[0]!.sql, /returning/i)
    assert.match(calls[1]!.sql, /^select .* from `things` where .*`id` = \?/i)
    assert.equal(calls[1]!.params[0], 7) // [pk, limit-1 binding]

    // The returned instance is the re-selected row, not the synthesized input.
    assert.equal(created.id, 7)
    assert.equal(created.name, 'Ada')
  })

  it('falls back to the caller-supplied key when there is no auto-increment id', async () => {
    nextInsertId = 0 // no auto-increment column populated
    selectRows = [[42, 'Manual', 1, null]]
    const created = await Thing.create({ id: 42, name: 'Manual', count: 1 })
    assert.equal(calls[1]!.params[0], 42) // [pk, limit-1 binding]
    assert.equal(created.id, 42)
  })
})

describe('mysql writes (proxy) — update() / restore()', () => {
  it('update(): UPDATE (no RETURNING) then re-SELECT by primary key', async () => {
    selectRows = [[3, 'Renamed', 5, null]]
    const updated = await Thing.query().update(3, { name: 'Renamed' })

    assert.equal(calls.length, 2)
    assert.match(calls[0]!.sql, /^update `things` set/i)
    assert.doesNotMatch(calls[0]!.sql, /returning/i)
    assert.match(calls[1]!.sql, /^select/i)
    assert.equal(updated.name, 'Renamed')
  })

  it('restore(): UPDATE deletedAt = NULL then re-SELECT', async () => {
    selectRows = [[3, 'Back', 5, null]]
    const restored = await Thing.query().restore(3)

    assert.match(calls[0]!.sql, /^update `things` set `deletedAt` = \?/i)
    assert.match(calls[1]!.sql, /^select/i)
    assert.equal((restored as Thing).name, 'Back')
  })
})

describe('mysql writes (proxy) — affected-row counts read the header tuple', () => {
  it('updateAll() returns affectedRows from [header, null]', async () => {
    const n = await Thing.query().where('count', '>', 0).updateAll({ name: 'bulk' })
    assert.equal(n, 1)
  })

  it('deleteAll() returns affectedRows from [header, null]', async () => {
    const n = await Thing.query().where('count', '>', 0).deleteAll()
    assert.equal(n, 1)
  })
})

// ─── Live MySQL (gated) — the round-trip the proxy can't prove ──────────────

const MYSQL_URL = process.env['MYSQL_TEST_URL']

test('live mysql: Model write round-trip — create/update/restore/increment/updateAll/upsert', { skip: !MYSQL_URL }, async () => {
  const table = `dz_writes_${process.pid}`
  const liveThings = mysqlTable(table, {
    id:        mysqlSerial('id').primaryKey(),
    name:      mysqlText('name').notNull(),
    count:     mysqlInt('count').notNull().default(0),
    deletedAt: mysqlTimestamp('deletedAt'),
  })
  class LiveThing extends Model {
    static override table = table
    static override softDeletes = true
    id!: number
    name!: string
    count!: number
  }
  const adapter = await DrizzleAdapter.make({
    driver: 'mysql',
    url: MYSQL_URL!,
    connectionName: `dz-writes-mysql-${process.pid}`,
    tables: { [table]: liveThings },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  try {
    await adapter.affectingStatement(`drop table if exists ${table}`, [])
    await adapter.affectingStatement(
      `create table ${table} (id serial primary key, name text not null, count int not null default 0, deletedAt timestamp null)`,
      [],
    )

    // create() — returns the REAL stored row: auto-increment id + DB default.
    const a = await LiveThing.create({ name: 'Ada' })
    assert.ok(a.id > 0)
    assert.equal(a.name, 'Ada')
    assert.equal(Number(a.count), 0) // DB default reflected (no count in payload)

    // update() — returns the updated row via re-select.
    const updated = await LiveThing.query().update(a.id, { name: 'Lovelace' })
    assert.equal(updated.name, 'Lovelace')

    // increment() — pre-existing mysql branch still green.
    const bumped = await LiveThing.query().increment(a.id, 'count', 4)
    assert.equal(Number(bumped.count), 4)

    // soft delete + restore round-trip.
    await LiveThing.delete(a.id)
    assert.equal(await LiveThing.find(a.id), null)
    const restored = await LiveThing.query().restore(a.id)
    assert.equal(restored.name, 'Lovelace')
    assert.ok((await LiveThing.find(a.id)) !== null)

    // updateAll/deleteAll — counts come from the header tuple now.
    await LiveThing.create({ name: 'Bob' })
    const touched = await LiveThing.query().where('count', '>=', 0).updateAll({ name: 'all' })
    assert.equal(touched, 2)

    // upsert count (rows-touched: 1/insert + 2/update — documented quirk).
    const n = await LiveThing.upsert([{ id: a.id, name: 'upserted', count: 9 }], 'id', ['name', 'count'])
    assert.ok(n >= 1)
    assert.equal((await LiveThing.find(a.id))!.name, 'upserted')

    const removed = await LiveThing.query().where('count', '>=', 0).withTrashed().deleteAll()
    assert.ok(removed >= 1)
  } finally {
    await adapter.affectingStatement(`drop table if exists ${table}`, []).catch(() => {})
    await adapter.disconnect()
  }
})
