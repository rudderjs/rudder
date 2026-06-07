// Through relations (hasOneThrough / hasManyThrough) on the Drizzle adapter —
// real SQLite end-to-end. The Model layer hands the adapter the same
// pivot-shaped predicate it uses for belongsToMany, with the INTERMEDIATE
// table in the through block and `fanOut: true` marking the 1:N
// intermediate→related cardinality:
//
//   whereRelationExists: the existing nested-EXISTS shape is already
//   fan-out-correct (a bare intermediate row never implies a far row).
//   withAggregate: `fanOut` forces the pivot fast path (COUNT(*) over the
//   intermediate) onto the JOIN branch so counts/sums see every FAR row.
//
// Topology: nations → citizens → essays.
//   N1: citizens 1,2 → essays 1,2 (c1) + 3 (c2)   — fan-out: 2 intermediates, 3 far rows
//   N2: citizen 3 → no essays                      — the false-positive trap
//   N3: no citizens

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import type { AggregateRequest, RelationExistencePredicate, QueryBuilder } from '@rudderjs/contracts'
import { drizzle, DrizzleAdapter, type DrizzleConfig } from './index.js'

const nations = sqliteTable('nations', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
})

const citizens = sqliteTable('citizens', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  nationId: integer('nationId').notNull(),
})

const essays = sqliteTable('essays', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  citizenId: integer('citizenId').notNull(),
  views:     integer('views').notNull(),
  published: integer('published', { mode: 'boolean' }).notNull(),
})

interface Nation { id: number; name: string }

async function makeAdapter(opts: { registerThrough?: boolean } = {}): Promise<DrizzleAdapter> {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE nations  (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE citizens (id INTEGER PRIMARY KEY AUTOINCREMENT, nationId INTEGER NOT NULL);
    CREATE TABLE essays   (id INTEGER PRIMARY KEY AUTOINCREMENT, citizenId INTEGER NOT NULL, views INTEGER NOT NULL, published INTEGER NOT NULL);
  `)
  const db = drizzleSqlite(sqlite)
  const tables: DrizzleConfig['tables'] = opts.registerThrough === false
    ? { nations, essays } // citizens deliberately unregistered
    : { nations, citizens, essays }
  return drizzle({ client: db, tables }).create() as Promise<DrizzleAdapter>
}

async function seed(adapter: DrizzleAdapter): Promise<void> {
  const n = adapter.query<Nation>('nations')
  await n.create({ id: 1, name: 'N1' })
  await n.create({ id: 2, name: 'N2' })
  await n.create({ id: 3, name: 'N3' })

  const c = adapter.query<{ id: number; nationId: number }>('citizens')
  await c.create({ id: 1, nationId: 1 })
  await c.create({ id: 2, nationId: 1 })
  await c.create({ id: 3, nationId: 2 })

  const e = adapter.query<{ id: number; citizenId: number; views: number; published: boolean }>('essays')
  await e.create({ citizenId: 1, views: 10, published: true  })
  await e.create({ citizenId: 1, views: 20, published: false })
  await e.create({ citizenId: 2, views: 30, published: true  })
}

/** The predicate `buildRelationPredicate` emits for `Nation.whereHas('essays')`. */
function throughPredicate(overrides: Partial<RelationExistencePredicate> = {}): RelationExistencePredicate {
  return {
    relation: 'essays', exists: true,
    relatedTable: 'essays', parentColumn: 'id', relatedColumn: 'citizenId',
    constraintWheres: [],
    through: { pivotTable: 'citizens', foreignPivotKey: 'nationId', relatedPivotKey: 'id', fanOut: true },
    ...overrides,
  }
}

let adapter: DrizzleAdapter

describe('DrizzleQueryBuilder.whereRelationExists — through relation (fanOut)', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('matches parents whose FAR rows exist; a bare intermediate does not count', async () => {
    const rows = await (adapter.query<Nation>('nations') as QueryBuilder<Nation>)
      .whereRelationExists(throughPredicate())
      .get()
    // N2 has a citizen but no essays — must not match.
    assert.deepEqual(rows.map(r => r.name).sort(), ['N1'])
  })

  it('whereDoesntHave matches no-far-rows parents, including via-intermediate-only', async () => {
    const rows = await (adapter.query<Nation>('nations') as QueryBuilder<Nation>)
      .whereRelationExists(throughPredicate({ exists: false }))
      .get()
    assert.deepEqual(rows.map(r => r.name).sort(), ['N2', 'N3'])
  })

  it('constraint wheres apply to the FAR table', async () => {
    const rows = await (adapter.query<Nation>('nations') as QueryBuilder<Nation>)
      .whereRelationExists(throughPredicate({
        constraintWheres: [{ column: 'published', operator: '=', value: false }],
      }))
      .get()
    assert.deepEqual(rows.map(r => r.name), ['N1'])
  })

  it('throws a clear error when the intermediate table is not registered', async () => {
    const bare = await makeAdapter({ registerThrough: false })
    assert.throws(
      () => (bare.query<Nation>('nations') as QueryBuilder<Nation>).whereRelationExists(throughPredicate()),
      /no table schema registered for pivot "citizens"/,
    )
  })
})

describe('DrizzleQueryBuilder.withAggregate — through relation (fanOut forces the join)', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  const joinShape = {
    relatedTable: 'essays', parentColumn: 'id', relatedColumn: 'citizenId',
    through: { pivotTable: 'citizens', foreignPivotKey: 'nationId', relatedPivotKey: 'id', fanOut: true },
  }

  it('count counts FAR rows, not intermediates', async () => {
    const req: AggregateRequest = {
      relation: 'essays', fn: 'count', alias: 'essaysCount',
      joinShape, constraintWheres: [],
    }
    const rows = await (adapter.query<Nation & { essaysCount: number }>('nations') as QueryBuilder<Nation & { essaysCount: number }>)
      .withAggregate([req])
      .get()
    const byName = new Map(rows.map(r => [r.name, r.essaysCount]))
    assert.equal(byName.get('N1'), 3) // 2 citizens → 3 essays: must be 3, not 2
    assert.equal(byName.get('N2'), 0) // citizen with zero essays
    assert.equal(byName.get('N3'), 0)
  })

  it('exists is false for an intermediate with zero far rows', async () => {
    const req: AggregateRequest = {
      relation: 'essays', fn: 'exists', alias: 'essaysExists',
      joinShape, constraintWheres: [],
    }
    const rows = await (adapter.query<Nation & { essaysExists: boolean }>('nations') as QueryBuilder<Nation & { essaysExists: boolean }>)
      .withAggregate([req])
      .get()
    // Adapter-level result — sqlite surfaces (… > 0) as 0/1; the Model layer
    // converts on stamping (same convention as the direct withExists test).
    const byName = new Map(rows.map(r => [r.name, Boolean(r.essaysExists)]))
    assert.equal(byName.get('N1'), true)
    assert.equal(byName.get('N2'), false)
    assert.equal(byName.get('N3'), false)
  })

  it('sum sees every far row across all intermediates', async () => {
    const req: AggregateRequest = {
      relation: 'essays', fn: 'sum', alias: 'essaysSumViews', column: 'views',
      joinShape, constraintWheres: [],
    }
    const rows = await (adapter.query<Nation & { essaysSumViews: number }>('nations') as QueryBuilder<Nation & { essaysSumViews: number }>)
      .withAggregate([req])
      .get()
    const byName = new Map(rows.map(r => [r.name, r.essaysSumViews]))
    assert.equal(byName.get('N1'), 60) // 10+20+30
    assert.equal(byName.get('N2'), 0)
  })

  it('count composes with a far-table constraint', async () => {
    const req: AggregateRequest = {
      relation: 'essays', fn: 'count', alias: 'essaysCount',
      joinShape, constraintWheres: [{ column: 'published', operator: '=', value: true }],
    }
    const rows = await (adapter.query<Nation & { essaysCount: number }>('nations') as QueryBuilder<Nation & { essaysCount: number }>)
      .withAggregate([req])
      .get()
    const byName = new Map(rows.map(r => [r.name, r.essaysCount]))
    assert.equal(byName.get('N1'), 2) // essays 1 + 3
  })
})
