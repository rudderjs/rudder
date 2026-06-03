// Date-component predicates (whereDate/whereTime/whereDay/whereMonth/whereYear)
// + whereNot/orWhereNot negated groups on the Drizzle adapter.
//
// Same surface + semantics as the native engine (#857): two-arg = equality,
// three-arg carries the operator; Date values compare by their UTC components;
// numeric strings coerce on day/month/year. The per-dialect extraction SQL
// mirrors the native Dialect.dateExtract (sqlite strftime + CAST, pg ::date /
// ::time / EXTRACT(...)::int, mysql DATE()/TIME()/DAY()/MONTH()/YEAR()) — the
// pg/mysql shapes are pinned via the proxy drivers (no server needed), and the
// sqlite branch runs end-to-end on real better-sqlite3.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { drizzle as drizzlePgProxy } from 'drizzle-orm/pg-proxy'
import { drizzle as drizzleMysqlProxy } from 'drizzle-orm/mysql-proxy'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { pgTable, serial, text as pgText, timestamp as pgTimestamp } from 'drizzle-orm/pg-core'
import { mysqlTable, serial as mysqlSerial, text as mysqlText, datetime } from 'drizzle-orm/mysql-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { drizzle, type DrizzleConfig } from './index.js'

const events = sqliteTable('events', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  name:       text('name').notNull(),
  happenedAt: text('happenedAt').notNull(),
})

class Event extends Model {
  static override table = 'events'
  id!:         number
  name!:       string
  happenedAt!: string
}

const names = (rows: Event[]) => rows.map(e => e.name).sort()

beforeEach(async () => {
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, happenedAt TEXT NOT NULL);`)
  sqlite.exec(`INSERT INTO events (name, happenedAt) VALUES
    ('launch',  '2026-01-15 09:30:00'),
    ('summit',  '2026-01-20 11:20:45'),
    ('kickoff', '2025-12-31 23:59:59');`)
  const cfg: DrizzleConfig = { client: drizzleSqlite(sqlite), dialect: 'sqlite', tables: { events } }
  ModelRegistry.reset()
  ModelRegistry.set(await drizzle(cfg).create())
})

// ─── sqlite end-to-end ─────────────────────────────────────

describe('Drizzle date helpers (sqlite E2E)', () => {
  it('whereDate 2-arg form matches the calendar date', async () => {
    assert.deepEqual(names(await Event.query().whereDate('happenedAt', '2026-01-15').get()), ['launch'])
  })

  it('whereDate 3-arg form carries the operator', async () => {
    assert.deepEqual(names(await Event.query().whereDate('happenedAt', '>=', '2026-01-16').get()), ['summit'])
  })

  it('whereDate accepts a Date (compares by UTC calendar date)', async () => {
    const rows = await Event.query().whereDate('happenedAt', new Date('2026-01-20T05:00:00Z')).get()
    assert.deepEqual(names(rows), ['summit'])
  })

  it('whereTime matches the time component', async () => {
    assert.deepEqual(names(await Event.query().whereTime('happenedAt', '11:20:45').get()), ['summit'])
    assert.deepEqual(names(await Event.query().whereTime('happenedAt', '>', '10:00:00').get()), ['kickoff', 'summit'])
  })

  it('whereDay / whereMonth / whereYear compare integers', async () => {
    assert.deepEqual(names(await Event.query().whereDay('happenedAt', 20).get()), ['summit'])
    assert.deepEqual(names(await Event.query().whereMonth('happenedAt', 1).get()), ['launch', 'summit'])
    assert.deepEqual(names(await Event.query().whereYear('happenedAt', 2025).get()), ['kickoff'])
    assert.deepEqual(names(await Event.query().whereYear('happenedAt', '>=', 2026).get()), ['launch', 'summit'])
  })

  it('numeric strings coerce so they match the INTEGER extraction', async () => {
    assert.deepEqual(names(await Event.query().whereMonth('happenedAt', '01').get()), ['launch', 'summit'])
  })

  it('orWhere* forms OR-root the predicate', async () => {
    const rows = await Event.query().whereYear('happenedAt', 2025).orWhereDay('happenedAt', 15).get()
    assert.deepEqual(names(rows), ['kickoff', 'launch'])
  })

  it('chains with other where clauses', async () => {
    const rows = await Event.query().where('name', '!=', 'launch').whereYear('happenedAt', 2026).get()
    assert.deepEqual(names(rows), ['summit'])
  })

  it('Model statics work', async () => {
    assert.deepEqual(names(await Event.whereDate('happenedAt', '2025-12-31').get()), ['kickoff'])
  })
})

describe('Drizzle whereNot / orWhereNot (sqlite E2E)', () => {
  it('negates a single condition', async () => {
    const rows = await Event.query().whereNot(q => q.where('name', 'launch')).get()
    assert.deepEqual(names(rows), ['kickoff', 'summit'])
  })

  it('negates a compound AND group', async () => {
    // NOT (name = launch AND year = 2026) → everything except launch
    const rows = await Event.query().whereNot(q => {
      q.where('name', 'launch').whereYear('happenedAt', 2026)
    }).get()
    assert.deepEqual(names(rows), ['kickoff', 'summit'])
  })

  it('orWhereNot OR-roots the negated group', async () => {
    // name = launch OR NOT (year = 2026) → launch + kickoff
    const rows = await Event.query().where('name', 'launch').orWhereNot(q => {
      q.whereYear('happenedAt', 2026)
    }).get()
    assert.deepEqual(names(rows), ['kickoff', 'launch'])
  })

  it('named sugar composes inside the callback (hydrating sub-builder)', async () => {
    const rows = await Event.query().whereNot(q => q.whereIn('name', ['launch', 'summit'])).get()
    assert.deepEqual(names(rows), ['kickoff'])
  })

  it('an empty callback is a no-op', async () => {
    assert.equal((await Event.query().whereNot(() => {}).get()).length, 3)
  })
})

// ─── pg / mysql SQL shapes (proxy drivers — no server) ─────

const pgEvents = pgTable('events', {
  id:         serial('id').primaryKey(),
  name:       pgText('name').notNull(),
  happenedAt: pgTimestamp('happenedAt').notNull(),
})

const mysqlEvents = mysqlTable('events', {
  id:         mysqlSerial('id').primaryKey(),
  name:       mysqlText('name').notNull(),
  happenedAt: datetime('happenedAt').notNull(),
})

describe('Drizzle date helpers — pg / mysql extraction SQL', () => {
  it('pg compiles ::date / ::time / EXTRACT(...)::int', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = []
    const db = drizzlePgProxy(async (sqlText: string, params: unknown[]) => {
      captured.push({ sql: sqlText, params }); return { rows: [] }
    })
    const adapter = await drizzle({ client: db, dialect: 'pg', tables: { events: pgEvents } }).create()
    ModelRegistry.reset(); ModelRegistry.set(adapter)

    await Event.query().whereDate('happenedAt', '2026-01-15').get()
    await Event.query().whereTime('happenedAt', '<', '10:00:00').get()
    await Event.query().whereYear('happenedAt', 2026).get()
    assert.match(captured[0]!.sql, /"happenedAt"::date = \$1/)
    assert.deepEqual(captured[0]!.params, ['2026-01-15'])
    assert.match(captured[1]!.sql, /"happenedAt"::time < \$1/)
    assert.match(captured[2]!.sql, /EXTRACT\(YEAR FROM [^)]*"happenedAt"\)::int = \$1/i)
    assert.deepEqual(captured[2]!.params, [2026])
  })

  it('mysql compiles DATE() / MONTH()', async () => {
    const captured: Array<{ sql: string; params: unknown[] }> = []
    const db = drizzleMysqlProxy(async (sqlText: string, params: unknown[]) => {
      captured.push({ sql: sqlText, params }); return { rows: [] }
    })
    const adapter = await drizzle({ client: db, dialect: 'mysql', tables: { events: mysqlEvents } }).create()
    ModelRegistry.reset(); ModelRegistry.set(adapter)

    await Event.query().whereDate('happenedAt', '2026-01-15').get()
    await Event.query().whereMonth('happenedAt', 5).get()
    assert.match(captured[0]!.sql, /DATE\([^)]*`happenedAt`\) = \?/i)
    assert.match(captured[1]!.sql, /MONTH\([^)]*`happenedAt`\) = \?/i)
    assert.deepEqual(captured[1]!.params, [5])
  })
})
