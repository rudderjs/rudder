// Postgres write paths on the Drizzle adapter.
//
// Audit P1-3 (docs/plans/2026-06-05-data-layer-test-audit.md): after #882 the
// mysql write paths got mysql-writes.test.ts, but pg never got the equivalent
// — live PG coverage on this adapter was JSON predicates + read-path blocks
// only. Postgres is the OTHER half of the write seam: drizzle's pg builders
// DO have `.returning()`, so create()/update()/restore() must stay
// single-statement (no header read, no re-SELECT) and the returned row must
// be the database's row (sequence id, DB defaults), not the synthesized
// input.
//
// Shape mirrors mysql-writes.test.ts: a no-server `drizzle-orm/pg-proxy`
// block pins the SQL sequence (exactly one statement, RETURNING present),
// plus a gated live block against a real Postgres for the full Model write
// round-trip the proxy can't prove.

import { describe, it, test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { drizzle as drizzlePgProxy } from 'drizzle-orm/pg-proxy'
import { pgTable, serial, text as pgText, integer as pgInteger, timestamp as pgTimestamp } from 'drizzle-orm/pg-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { DrizzleAdapter, drizzle, type DrizzleConfig } from './index.js'

// ─── Proxy-backed (no server) — pins the SQL sequence + result mapping ──────

const things = pgTable('things', {
  id:        serial('id').primaryKey(),
  name:      pgText('name').notNull(),
  count:     pgInteger('count').notNull(),
  deletedAt: pgTimestamp('deletedAt'),
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
/** Rows the next statement resolves to (array-of-arrays — the proxy's row form). */
let nextRows: unknown[][] = []

function makeProxyAdapter(): Promise<DrizzleAdapter> {
  const db = drizzlePgProxy(async (sql: string, params: unknown[], method: string) => {
    calls.push({ sql, params, method })
    return { rows: nextRows }
  })
  const cfg: DrizzleConfig = { client: db, dialect: 'pg', tables: { things } }
  return Promise.resolve(drizzle(cfg).create()) as Promise<DrizzleAdapter>
}

beforeEach(async () => {
  calls = []
  nextRows = []
  ModelRegistry.reset()
  ModelRegistry.set(await makeProxyAdapter())
})

describe('pg writes (proxy) — create()', () => {
  it('a single INSERT … RETURNING, no re-SELECT', async () => {
    nextRows = [[7, 'Ada', 0, null]]
    const created = await Thing.create({ name: 'Ada', count: 0 })

    assert.equal(calls.length, 1, 'pg create() must be one statement')
    assert.match(calls[0]!.sql, /^insert into "things"/i)
    assert.match(calls[0]!.sql, /returning/i)

    // The returned instance is the RETURNING row (sequence id included).
    assert.equal(created.id, 7)
    assert.equal(created.name, 'Ada')
  })
})

describe('pg writes (proxy) — update() / restore()', () => {
  it('update(): a single UPDATE … RETURNING', async () => {
    nextRows = [[3, 'Renamed', 5, null]]
    const updated = await Thing.query().update(3, { name: 'Renamed' })

    assert.equal(calls.length, 1, 'pg update() must be one statement')
    assert.match(calls[0]!.sql, /^update "things" set/i)
    assert.match(calls[0]!.sql, /returning/i)
    assert.equal(updated.name, 'Renamed')
  })

  it('restore(): a single UPDATE "deletedAt" = NULL … RETURNING', async () => {
    nextRows = [[3, 'Back', 5, null]]
    const restored = await Thing.query().restore(3)

    assert.equal(calls.length, 1, 'pg restore() must be one statement')
    assert.match(calls[0]!.sql, /^update "things" set "deletedAt" = /i)
    assert.match(calls[0]!.sql, /returning/i)
    assert.equal((restored as Thing).name, 'Back')
  })
})

// ─── Live Postgres (gated) — the round-trip the proxy can't prove ───────────

const PG_URL = process.env['PG_TEST_URL']

test('live pg: Model write round-trip — create/update/restore/increment/updateAll/upsert', { skip: !PG_URL }, async () => {
  const table = `dz_writes_${process.pid}`
  const liveThings = pgTable(table, {
    id:        serial('id').primaryKey(),
    name:      pgText('name').notNull(),
    count:     pgInteger('count').notNull().default(0),
    deletedAt: pgTimestamp('deletedAt'),
  })
  class LiveThing extends Model {
    static override table = table
    static override softDeletes = true
    id!: number
    name!: string
    count!: number
  }
  const adapter = await DrizzleAdapter.make({
    driver: 'postgresql',
    url: PG_URL!,
    connectionName: `dz-writes-pg-${process.pid}`,
    tables: { [table]: liveThings },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  try {
    await adapter.affectingStatement(`drop table if exists ${table}`, [])
    // "deletedAt" quoted — drizzle's column name is camelCase, and unquoted
    // identifiers lowercase on pg.
    await adapter.affectingStatement(
      `create table ${table} (id serial primary key, name text not null, count int not null default 0, "deletedAt" timestamp null)`,
      [],
    )

    // create() — returns the REAL stored row: sequence id + DB default.
    const a = await LiveThing.create({ name: 'Ada' })
    assert.ok(a.id > 0)
    assert.equal(a.name, 'Ada')
    assert.equal(Number(a.count), 0) // DB default reflected (no count in payload)

    // update() — returns the updated row from RETURNING.
    const updated = await LiveThing.query().update(a.id, { name: 'Lovelace' })
    assert.equal(updated.name, 'Lovelace')

    // increment() — atomic, merged-back value.
    const bumped = await LiveThing.query().increment(a.id, 'count', 4)
    assert.equal(Number(bumped.count), 4)

    // soft delete + restore round-trip.
    await LiveThing.delete(a.id)
    assert.equal(await LiveThing.find(a.id), null)
    const restored = await LiveThing.query().restore(a.id)
    assert.equal(restored.name, 'Lovelace')
    assert.ok((await LiveThing.find(a.id)) !== null)

    // updateAll/deleteAll — affected counts from the real postgres-js result.
    await LiveThing.create({ name: 'Bob' })
    const touched = await LiveThing.query().where('count', '>=', 0).updateAll({ name: 'all' })
    assert.equal(touched, 2)

    // upsert — ON CONFLICT path against a real pg.
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
