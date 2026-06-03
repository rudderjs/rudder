// Date-component predicates — whereDate / whereTime / whereDay / whereMonth /
// whereYear (+ orWhere* forms), compiled through the per-dialect `dateExtract`
// seam (sqlite strftime, pg ::date/EXTRACT, mysql DATE()/YEAR()/…).
//
// Compiler units pin the SQL text + positional binding order per dialect; the
// sqlite E2E proves the path end-to-end on a real in-memory engine (string,
// Date, and numeric-string values; 2-arg equality + 3-arg operator forms); a
// gated live-pg block (PG_TEST_URL) exercises the Postgres extraction live.
// The adapter-guard test proves the Model-layer proxy throws a clear error on
// an adapter QB without the methods (Drizzle/Prisma until their follow-up).

import { describe, it, test, before, after, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter, QueryBuilder } from '@rudderjs/contracts'
import { compileSelect, type NativeQueryState, type ConditionNode } from './compiler.js'
import { SqliteDialect, type DatePart } from './dialect.js'
import { PgDialect } from './dialect-pg.js'
import { MysqlDialect } from './dialect-mysql.js'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
import { BetterSqlite3Driver } from './drivers/better-sqlite3.js'
import { PostgresDriver } from './drivers/postgres.js'
import type { Driver } from './driver.js'

const sqlite = new SqliteDialect()
const pg     = new PgDialect()
const mysql  = new MysqlDialect()

function baseState(overrides: Partial<NativeQueryState> = {}): NativeQueryState {
  return {
    table:           'users',
    primaryKey:      'id',
    conditions:      [],
    orders:          [],
    limitN:          null,
    offsetN:         null,
    softDelete:      'with',
    deletedAtColumn: 'deletedAt',
    ...overrides,
  }
}

function dateNode(part: DatePart, value: unknown, boolean: 'AND' | 'OR' = 'AND', operator = '=' as const): ConditionNode {
  return { kind: 'date', boolean, part, column: 'createdAt', operator, value }
}

// ── Compiler units — SQL text + binding order per dialect ──

describe('date helpers — sqlite compilation', () => {
  it('whereDate compiles via strftime, value binds', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [dateNode('date', '2026-01-15')] }), sqlite)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE strftime('%Y-%m-%d', "createdAt") = ?`)
    assert.deepStrictEqual(bindings, ['2026-01-15'])
  })

  it('whereTime compiles via strftime(%H:%M:%S)', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [dateNode('time', '11:20:45')] }), sqlite)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE strftime('%H:%M:%S', "createdAt") = ?`)
    assert.deepStrictEqual(bindings, ['11:20:45'])
  })

  it('whereDay/whereMonth/whereYear CAST to INTEGER', () => {
    for (const [part, fmt] of [['day', '%d'], ['month', '%m'], ['year', '%Y']] as const) {
      const { sql, bindings } = compileSelect(baseState({ conditions: [dateNode(part, 5)] }), sqlite)
      assert.strictEqual(sql, `SELECT * FROM "users" WHERE CAST(strftime('${fmt}', "createdAt") AS INTEGER) = ?`)
      assert.deepStrictEqual(bindings, [5])
    }
  })

  it('carries a non-equality operator and OR rooting', () => {
    const state = baseState({ conditions: [
      { kind: 'clause', boolean: 'AND', clause: { column: 'name', operator: '=', value: 'Ada' } },
      { kind: 'date', boolean: 'OR', part: 'year', column: 'createdAt', operator: '>=', value: 2026 },
    ] })
    const { sql, bindings } = compileSelect(state, sqlite)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE "name" = ? OR CAST(strftime('%Y', "createdAt") AS INTEGER) >= ?`)
    assert.deepStrictEqual(bindings, ['Ada', 2026])
  })
})

describe('date helpers — pg compilation ($n + casts)', () => {
  it('whereDate compiles via ::date with $n placeholders', () => {
    const { sql, bindings } = compileSelect(baseState({ conditions: [dateNode('date', '2026-01-15')] }), pg)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE "createdAt"::date = $1`)
    assert.deepStrictEqual(bindings, ['2026-01-15'])
  })

  it('whereTime compiles via ::time', () => {
    const { sql } = compileSelect(baseState({ conditions: [dateNode('time', '11:20:45')] }), pg)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE "createdAt"::time = $1`)
  })

  it('whereDay/whereMonth/whereYear compile via EXTRACT(...)::int', () => {
    for (const [part, comp] of [['day', 'DAY'], ['month', 'MONTH'], ['year', 'YEAR']] as const) {
      const { sql } = compileSelect(baseState({ conditions: [dateNode(part, 5)] }), pg)
      assert.strictEqual(sql, `SELECT * FROM "users" WHERE EXTRACT(${comp} FROM "createdAt")::int = $1`)
    }
  })

  it('keeps the shared positional $n order across mixed clauses', () => {
    const state = baseState({ conditions: [
      { kind: 'clause', boolean: 'AND', clause: { column: 'name', operator: '=', value: 'Ada' } },
      dateNode('year', 2026),
      { kind: 'clause', boolean: 'AND', clause: { column: 'age', operator: '>', value: 30 } },
    ] })
    const { sql, bindings } = compileSelect(state, pg)
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE "name" = $1 AND EXTRACT(YEAR FROM "createdAt")::int = $2 AND "age" > $3`)
    assert.deepStrictEqual(bindings, ['Ada', 2026, 30])
  })
})

describe('date helpers — mysql compilation (backticks + DATE()/YEAR()/…)', () => {
  it('compiles every part through its extraction function', () => {
    for (const [part, fn] of [['date', 'DATE'], ['time', 'TIME'], ['day', 'DAY'], ['month', 'MONTH'], ['year', 'YEAR']] as const) {
      const { sql } = compileSelect(baseState({ conditions: [dateNode(part, 1)] }), mysql)
      assert.strictEqual(sql, `SELECT * FROM \`users\` WHERE ${fn}(\`createdAt\`) = ?`)
    }
  })
})

// ── sqlite E2E — real engine, Model layer + statics ──

class Event extends Model {
  static override table = 'events'
  id!: number
  name!: string
  happenedAt!: string
}

let driver: Driver

// [name, happenedAt]
const seed: Array<[string, string]> = [
  ['launch',  '2026-01-15 09:30:00'],
  ['summit',  '2026-01-20 11:20:45'],
  ['retro',   '2026-03-05 16:00:00'],
  ['kickoff', '2025-12-31 23:59:59'],
]

describe('date helpers (native sqlite E2E)', () => {
  beforeEach(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    await driver.execute(
      `CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, happenedAt TEXT)`,
      [],
    )
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
    for (const [name, happenedAt] of seed) await Event.create({ name, happenedAt })
  })

  afterEach(async () => { await driver.close() })

  const names = (rows: Event[]): string[] => rows.map(r => r.name).sort()

  it('whereDate 2-arg form matches the calendar date', async () => {
    const rows = await Event.whereDate('happenedAt', '2026-01-15').get()
    assert.deepEqual(names(rows), ['launch'])
  })

  it('whereDate 3-arg form carries the operator', async () => {
    const rows = await Event.whereDate('happenedAt', '>=', '2026-01-20').get()
    assert.deepEqual(names(rows), ['retro', 'summit'])
  })

  it('whereDate accepts a Date (compares by UTC calendar date)', async () => {
    const rows = await Event.whereDate('happenedAt', new Date('2026-03-05T12:00:00Z')).get()
    assert.deepEqual(names(rows), ['retro'])
  })

  it('whereTime matches the time component', async () => {
    const rows = await Event.whereTime('happenedAt', '11:20:45').get()
    assert.deepEqual(names(rows), ['summit'])
  })

  it('whereTime 3-arg form compares lexicographic HH:MM:SS', async () => {
    const rows = await Event.whereTime('happenedAt', '<', '12:00:00').get()
    assert.deepEqual(names(rows), ['launch', 'summit'])
  })

  it('whereDay / whereMonth / whereYear compare integers', async () => {
    assert.deepEqual(names(await Event.whereDay('happenedAt', 15).get()), ['launch'])
    assert.deepEqual(names(await Event.whereMonth('happenedAt', 1).get()), ['launch', 'summit'])
    assert.deepEqual(names(await Event.whereYear('happenedAt', 2026).get()), ['launch', 'retro', 'summit'])
    assert.deepEqual(names(await Event.whereYear('happenedAt', '<', 2026).get()), ['kickoff'])
  })

  it('numeric strings coerce so they match the INTEGER extraction', async () => {
    const rows = await Event.whereMonth('happenedAt', '03').get()
    assert.deepEqual(names(rows), ['retro'])
  })

  it('orWhere* forms OR-root the predicate', async () => {
    const rows = await Event.where('name', 'kickoff').orWhereMonth('happenedAt', 3).get()
    assert.deepEqual(names(rows), ['kickoff', 'retro'])
  })

  it('chains with other where clauses (shared binding order)', async () => {
    const rows = await Event.query()
      .where('name', '!=', 'launch')
      .whereYear('happenedAt', 2026)
      .whereMonth('happenedAt', 1)
      .get()
    assert.deepEqual(names(rows), ['summit'])
  })
})

// ── Adapter guard — clear error instead of a bare TypeError ──

describe('date helpers — unsupported-adapter guard', () => {
  it('throws a clear error when the adapter QB lacks the method', async () => {
    // A minimal adapter whose QB has none of the date helpers (the Drizzle /
    // Prisma shape until their own implementations land).
    const bareQb = {} as QueryBuilder<unknown>
    const adapter = {
      query: () => bareQb,
      connect: async () => {},
      disconnect: async () => {},
    } as unknown as OrmAdapter
    ModelRegistry.reset()
    ModelRegistry.set(adapter)

    class Thing extends Model {
      static override table = 'things'
    }

    assert.throws(
      () => Thing.query().whereDate('createdAt', '2026-01-01'),
      /whereDate\(\) is not supported on this adapter — use whereRaw\(\.\.\.\) or DB\.select\(\.\.\.\)/,
    )
    assert.throws(
      () => Thing.query().orWhereYear('createdAt', 2026),
      /orWhereYear\(\) is not supported on this adapter/,
    )
  })
})

// ── Live Postgres round-trip (::date / EXTRACT live) ──

const PG_URL = process.env['PG_TEST_URL']

if (!PG_URL) {
  test('native date helpers pg round-trip (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('date helpers (live pg)', () => {
    class PgEvent extends Model {
      static override table = 'rudder_date_helpers_events'
      id!: number
      name!: string
      happenedAt!: string
    }
    let pgDriver: PostgresDriver

    before(async () => {
      pgDriver = await PostgresDriver.open({ url: PG_URL })
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_date_helpers_events`, [])
      // Plain TIMESTAMP (no TZ) so ::date / EXTRACT are server-TZ independent.
      await pgDriver.execute(`CREATE TABLE rudder_date_helpers_events (id SERIAL PRIMARY KEY, name TEXT, "happenedAt" TIMESTAMP)`, [])
      for (const [n, at] of [['launch', '2026-01-15 09:30:00'], ['summit', '2026-01-20 11:20:45'], ['kickoff', '2025-12-31 23:59:59']] as const) {
        await pgDriver.execute(`INSERT INTO rudder_date_helpers_events (name, "happenedAt") VALUES ($1, $2)`, [n, at])
      }
    })
    after(async () => {
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_date_helpers_events`, [])
      await pgDriver.close()
    })
    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: pgDriver, dialect: new PgDialect() }))
    })

    it('whereDate / whereYear / whereTime run live through ::date and EXTRACT', async () => {
      const byDate = await PgEvent.whereDate('happenedAt', '2026-01-15').get()
      assert.deepStrictEqual(byDate.map(e => e.name), ['launch'])

      const byYear = await PgEvent.whereYear('happenedAt', 2026).orderBy('id').get()
      assert.deepStrictEqual(byYear.map(e => e.name), ['launch', 'summit'])

      const byTime = await PgEvent.whereTime('happenedAt', '11:20:45').get()
      assert.deepStrictEqual(byTime.map(e => e.name), ['summit'])
    })
  })
}
