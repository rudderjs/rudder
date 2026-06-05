// ─── cursorPaginate — REAL-engine round-trips ────────────────────────────────
//
// Audit P2-12 (docs/plans/2026-06-05-data-layer-test-audit.md): cursorPaginate
// was tested only against an in-memory fake QB (index.test.ts) — it had never
// produced SQL through any engine on any dialect. The keyset predicate it
// composes (`(a < ?) OR (a = ? AND id > ?)` via whereGroup/orWhereGroup) is
// exactly the kind of compound that can compile fine in a fake and misbehave
// against a real WHERE — this pins the full walk on the native engine:
// sqlite always; pg/mysql gated.

import { describe, it, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, type CursorPaginator } from '../index.js'
import { NativeAdapter, BetterSqlite3Driver, PostgresDriver, MysqlDriver, PgDialect, MysqlDialect } from '@rudderjs/database/native'
import type { OrmAdapter } from '@rudderjs/contracts'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

type RawAdapter = OrmAdapter & {
  affectingStatement(sql: string, bindings: readonly unknown[]): Promise<number>
}

class Item extends Model {
  static override table = 'rudder_cp_items'
  id!: number
  score!: number
}

/** Walk every page; return ids in visit order (guard against infinite loops). */
async function walk(perPage: number, order: { column: string; dir: 'ASC' | 'DESC' }): Promise<number[]> {
  const seen: number[] = []
  let cursor: string | null = null
  for (let guard = 0; guard < 20; guard++) {
    const page: CursorPaginator<Item> =
      await Item.query().orderBy(order.column, order.dir).cursorPaginate(perPage, cursor)
    seen.push(...page.data.map((r) => r.id))
    if (!page.hasMore) return seen
    cursor = page.nextCursor
  }
  throw new Error('cursor walk did not terminate')
}

/** Shared scenario: seed ties, walk forward in both directions, never skip or
 *  repeat a row across page boundaries. */
function defineScenario(seed: (a: RawAdapter) => Promise<void>) {
  it('walks ASC pages without skips or repeats across tied scores', async () => {
    const seen = await walk(2, { column: 'score', dir: 'ASC' })
    // score ASC, id ASC tiebreaker: 5 (score 1), 3,4 (score 5), 1,2 (score 10)
    assert.deepStrictEqual(seen, [5, 3, 4, 1, 2])
  })

  it('walks DESC pages without skips or repeats across tied scores', async () => {
    const seen = await walk(2, { column: 'score', dir: 'DESC' })
    assert.deepStrictEqual(seen, [1, 2, 3, 4, 5])
  })

  it('a cursor is deterministic — resuming twice yields the identical page (v1 is forward-only)', async () => {
    const p1 = await Item.query().orderBy('score', 'DESC').cursorPaginate(2)
    const p2a = await Item.query().orderBy('score', 'DESC').cursorPaginate(2, p1.nextCursor)
    const p2b = await Item.query().orderBy('score', 'DESC').cursorPaginate(2, p1.nextCursor)
    assert.deepStrictEqual(p2a.data.map((r) => r.id), p2b.data.map((r) => r.id))
    // Forward-only v1 contract: prevCursor stays null on every page.
    assert.equal(p1.prevCursor, null)
    assert.equal(p2a.prevCursor, null)
  })

  void seed // seeding happens in the per-dialect before hooks
}

const SEED: Array<{ id: number; score: number }> = [
  { id: 1, score: 10 },
  { id: 2, score: 10 },
  { id: 3, score: 5 },
  { id: 4, score: 5 },
  { id: 5, score: 1 },
]

async function seedRows(adapter: RawAdapter): Promise<void> {
  for (const r of SEED) {
    await adapter.affectingStatement(
      `insert into rudder_cp_items (id, score) values (${r.id}, ${r.score})`, [],
    )
  }
}

// ── SQLite (always runs) ────────────────────────────────────
describe('cursorPaginate — native sqlite', () => {
  let adapter: RawAdapter

  before(async () => {
    const driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    adapter = await NativeAdapter.make({ driverInstance: driver }) as RawAdapter
    ModelRegistry.reset()
    ModelRegistry.set(adapter)
    await adapter.affectingStatement('create table rudder_cp_items (id integer primary key, score integer not null)', [])
  })

  beforeEach(async () => {
    await adapter.affectingStatement('delete from rudder_cp_items', [])
    await seedRows(adapter)
  })

  defineScenario(seedRows)
})

// ── Postgres (live) ─────────────────────────────────────────
if (!PG_URL) {
  test('cursorPaginate pg live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('cursorPaginate — Postgres (live)', () => {
    let driver: PostgresDriver
    let adapter: RawAdapter

    before(async () => {
      driver = await PostgresDriver.open({ url: PG_URL })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new PgDialect() }) as RawAdapter
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      await adapter.affectingStatement('drop table if exists rudder_cp_items', [])
      await adapter.affectingStatement('create table rudder_cp_items (id integer primary key, score integer not null)', [])
    })

    after(async () => {
      await adapter.affectingStatement('drop table if exists rudder_cp_items', []).catch(() => {})
      await driver.close()
    })

    beforeEach(async () => {
      await adapter.affectingStatement('truncate rudder_cp_items', [])
      await seedRows(adapter)
    })

    defineScenario(seedRows)
  })
}

// ── MySQL (live) ────────────────────────────────────────────
if (!MYSQL_URL) {
  test('cursorPaginate mysql live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('cursorPaginate — MySQL (live)', () => {
    let driver: MysqlDriver
    let adapter: RawAdapter

    before(async () => {
      driver = await MysqlDriver.open({ url: MYSQL_URL })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new MysqlDialect() }) as RawAdapter
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      await adapter.affectingStatement('drop table if exists rudder_cp_items', [])
      await adapter.affectingStatement('create table rudder_cp_items (id int primary key, score int not null)', [])
    })

    after(async () => {
      await adapter.affectingStatement('drop table if exists rudder_cp_items', []).catch(() => {})
      await driver.close()
    })

    beforeEach(async () => {
      await adapter.affectingStatement('truncate table rudder_cp_items', [])
      await seedRows(adapter)
    })

    defineScenario(seedRows)
  })
}
