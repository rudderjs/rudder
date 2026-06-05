// whereHas count/OR operators against real engines — audit P2-9.
//
// `where-has-ops.test.ts` proves orWhereHas / orWhereDoesntHave / has(rel, op, n)
// / orHas on sqlite only; only PLAIN nested whereHas had live pg/mysql coverage
// (nested-where-has.test.ts). This suite runs the count-comparison and OR-rooted
// forms through one shared scenario on sqlite (always) AND live Postgres + MySQL
// (gated on PG_TEST_URL / MYSQL_TEST_URL — CI's orm-pg / orm-mysql jobs).

import { describe, it, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import {
  NativeAdapter, BetterSqlite3Driver, PostgresDriver, MysqlDriver,
  PgDialect, MysqlDialect,
} from '@rudderjs/database/native'
import type { OrmAdapter } from '@rudderjs/contracts'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

type RawAdapter = OrmAdapter & {
  affectingStatement(sql: string, bindings: readonly unknown[]): Promise<number>
}

class WhoUser extends Model {
  static override table = 'rudder_who_users'
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => WhoPost, foreignKey: 'userId' },
  }
  id!: number
  name!: string
}
class WhoPost extends Model {
  static override table = 'rudder_who_posts'
  id!: number
  userId!: number
  published!: number
}

// Ada: 3 posts (2 published) · Alan: 1 post (0 published)
// Grace: 0 posts · Edsger: 2 posts (1 published)
async function seedRows(adapter: RawAdapter, quoted = true): Promise<void> {
  const run = (sql: string): Promise<number> =>
    adapter.affectingStatement(quoted ? sql : sql.replaceAll('"', ''), [])
  await run(`INSERT INTO rudder_who_users (id, name) VALUES (1, 'Ada'), (2, 'Alan'), (3, 'Grace'), (4, 'Edsger')`)
  await run(`INSERT INTO rudder_who_posts (id, "userId", published) VALUES
    (1, 1, 1), (2, 1, 1), (3, 1, 0),
    (4, 2, 0),
    (5, 4, 1), (6, 4, 0)`)
}

const names = (rows: WhoUser[]): string[] => rows.map(r => r.name).sort()

/** Shared scenario — the count-comparison and OR-rooted predicate forms. */
function defineScenario(): void {
  it('has(rel, op, n) count comparisons', async () => {
    assert.deepEqual(names(await WhoUser.has('posts', '>=', 2).get()), ['Ada', 'Edsger'])
    assert.deepEqual(names(await WhoUser.has('posts', '>=', 3).get()), ['Ada'])
    assert.deepEqual(names(await WhoUser.has('posts', '<', 1).get()), ['Grace'])
  })

  it('has() with a constraint counts only matching children', async () => {
    const rows = await WhoUser.has('posts', '>=', 2, q => q.where('published', 1)).get()
    assert.deepEqual(names(rows), ['Ada'])
  })

  it('orWhereHas OR-roots the existence predicate', async () => {
    const rows = await WhoUser.query()
      .where('name', 'Grace')
      .orWhereHas('posts', q => q.where('published', 1))
      .get()
    assert.deepEqual(names(rows), ['Ada', 'Edsger', 'Grace'])
  })

  it('orHas combines a where with an OR count comparison', async () => {
    const rows = await WhoUser.query()
      .where('name', 'Grace')
      .orHas('posts', '>=', 3)
      .get()
    assert.deepEqual(names(rows), ['Ada', 'Grace'])
  })

  it('orWhereDoesntHave OR-roots the negated predicate', async () => {
    // published >= 1 post ... OR has no posts at all
    const rows = await WhoUser.query()
      .whereHas('posts', q => q.where('published', 1))
      .orWhereDoesntHave('posts')
      .get()
    assert.deepEqual(names(rows), ['Ada', 'Edsger', 'Grace'])
  })

  it('count form composes with a plain where on the parent', async () => {
    const rows = await WhoUser.query()
      .where('id', '<', 4)
      .whereHas('posts')
      .get()
    assert.deepEqual(names(rows), ['Ada', 'Alan'])
  })
}

// ─── SQLite (always runs) ────────────────────────────────────────────────────

describe('whereHas ops — native sqlite', () => {
  let adapter: RawAdapter

  before(async () => {
    const driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    adapter = await NativeAdapter.make({ driverInstance: driver }) as RawAdapter
    await adapter.affectingStatement(`CREATE TABLE rudder_who_users (id INTEGER PRIMARY KEY, name TEXT)`, [])
    await adapter.affectingStatement(`CREATE TABLE rudder_who_posts (id INTEGER PRIMARY KEY, "userId" INTEGER, published INTEGER)`, [])
  })

  beforeEach(async () => {
    ModelRegistry.reset()
    ModelRegistry.set(adapter)
    await adapter.affectingStatement(`DELETE FROM rudder_who_posts`, [])
    await adapter.affectingStatement(`DELETE FROM rudder_who_users`, [])
    await seedRows(adapter)
  })

  defineScenario()
})

// ─── Postgres (live) ─────────────────────────────────────────────────────────

if (!PG_URL) {
  test('whereHas ops pg live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('whereHas ops — Postgres (live)', () => {
    let driver: PostgresDriver
    let adapter: RawAdapter

    before(async () => {
      driver = await PostgresDriver.open({ url: PG_URL })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new PgDialect() }) as RawAdapter
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_who_posts`, [])
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_who_users`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_who_users (id INT PRIMARY KEY, name TEXT)`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_who_posts (id INT PRIMARY KEY, "userId" INT, published INT)`, [])
    })

    after(async () => {
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_who_posts`, []).catch(() => {})
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_who_users`, []).catch(() => {})
      await driver.close()
    })

    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      await adapter.affectingStatement(`DELETE FROM rudder_who_posts`, [])
      await adapter.affectingStatement(`DELETE FROM rudder_who_users`, [])
      await seedRows(adapter)
    })

    defineScenario()
  })
}

// ─── MySQL (live) ────────────────────────────────────────────────────────────

if (!MYSQL_URL) {
  test('whereHas ops mysql live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('whereHas ops — MySQL (live)', () => {
    let driver: MysqlDriver
    let adapter: RawAdapter

    before(async () => {
      driver = await MysqlDriver.open({ url: MYSQL_URL })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new MysqlDialect() }) as RawAdapter
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_who_posts`, [])
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_who_users`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_who_users (id INT PRIMARY KEY, name TEXT)`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_who_posts (id INT PRIMARY KEY, userId INT, published INT)`, [])
    })

    after(async () => {
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_who_posts`, []).catch(() => {})
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_who_users`, []).catch(() => {})
      await driver.close()
    })

    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      await adapter.affectingStatement(`DELETE FROM rudder_who_posts`, [])
      await adapter.affectingStatement(`DELETE FROM rudder_who_users`, [])
      await seedRows(adapter, false)
    })

    defineScenario()
  })
}
