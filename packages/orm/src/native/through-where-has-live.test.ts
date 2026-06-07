// whereHas / whereDoesntHave / has(op, n) / withCount on THROUGH relations
// (hasOneThrough / hasManyThrough) against real engines.
//
// The fan-out facts these pin (Country→User→Post; US reaches 3 posts via 2
// users; DE has a user with ZERO posts):
//   - a bare intermediate row never satisfies whereHas / withExists;
//   - count comparisons + withCount count FAR rows (3 for US), never
//     intermediates (2);
//   - constraint callbacks target the FAR table.
//
// Runs on sqlite always AND live Postgres + MySQL (gated on PG_TEST_URL /
// MYSQL_TEST_URL — CI's orm-pg / orm-mysql jobs).

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

class ThrCountry extends Model {
  static override table = 'rudder_thr_countries'
  static override relations = {
    posts: {
      type: 'hasManyThrough' as const, model: () => ThrPost, through: () => ThrUser,
      firstKey: 'countryId', secondKey: 'userId',
    },
  }
  id!: number
  name!: string
}
class ThrUser extends Model {
  static override table = 'rudder_thr_users'
  id!: number
  countryId!: number
}
class ThrPost extends Model {
  static override table = 'rudder_thr_posts'
  id!: number
  userId!: number
  published!: number
  views!: number
}

// US(1): users 1,2 → posts 1,2 (u1) + 3 (u2) — 3 posts via 2 users.
// UK(2): user 3 → post 4.
// FR(3): no users.  DE(4): user 4 with ZERO posts (false-positive trap).
async function seedRows(adapter: RawAdapter, quoted = true): Promise<void> {
  const run = (sql: string): Promise<number> =>
    adapter.affectingStatement(quoted ? sql : sql.replaceAll('"', ''), [])
  await run(`INSERT INTO rudder_thr_countries (id, name) VALUES (1, 'US'), (2, 'UK'), (3, 'FR'), (4, 'DE')`)
  await run(`INSERT INTO rudder_thr_users (id, "countryId") VALUES (1, 1), (2, 1), (3, 2), (4, 4)`)
  await run(`INSERT INTO rudder_thr_posts (id, "userId", published, views) VALUES
    (1, 1, 1, 10), (2, 1, 0, 20), (3, 2, 1, 30),
    (4, 3, 1, 40)`)
}

const names = (rows: ThrCountry[]): string[] => rows.map(r => r.name).sort()

function defineScenario(): void {
  it('whereHas matches far-row parents; a bare intermediate does not count', async () => {
    assert.deepEqual(names(await ThrCountry.whereHas('posts').get()), ['UK', 'US'])
  })

  it('whereDoesntHave includes via-intermediate-only parents', async () => {
    assert.deepEqual(names(await ThrCountry.whereDoesntHave('posts').get()), ['DE', 'FR'])
  })

  it('constraint callback targets the FAR table', async () => {
    assert.deepEqual(names(await ThrCountry.whereHas('posts', q => q.where('published', 0)).get()), ['US'])
  })

  it('has(rel, op, n) counts FAR rows, not intermediates', async () => {
    assert.deepEqual(names(await ThrCountry.has('posts', '>=', 3).get()), ['US']) // 2 users, 3 posts
    assert.deepEqual(names(await ThrCountry.has('posts', '=', 0).get()), ['DE', 'FR'])
  })

  it('count comparison composes with a far-table constraint', async () => {
    assert.deepEqual(names(await ThrCountry.has('posts', '>=', 2, q => q.where('published', 1)).get()), ['US'])
  })

  it('withCount counts far rows; withExists rejects bare intermediates; withSum sees every far row', async () => {
    const rows = await ThrCountry.withCount('posts').withSum('posts', 'views').withExists('posts').get()
    const by = new Map(rows.map(r => [(r as ThrCountry).name, r as unknown as Record<string, unknown>]))
    assert.equal(by.get('US')!['postsCount'], 3)
    assert.equal(by.get('DE')!['postsCount'], 0)
    assert.equal(Number(by.get('US')!['postsSumViews']), 60)
    assert.equal(by.get('US')!['postsExists'], true)
    assert.equal(by.get('DE')!['postsExists'], false)
  })
}

const DDL = {
  sqlite: [
    `CREATE TABLE rudder_thr_countries (id INTEGER PRIMARY KEY, name TEXT)`,
    `CREATE TABLE rudder_thr_users (id INTEGER PRIMARY KEY, "countryId" INTEGER)`,
    `CREATE TABLE rudder_thr_posts (id INTEGER PRIMARY KEY, "userId" INTEGER, published INTEGER, views INTEGER)`,
  ],
  pg: [
    `CREATE TABLE rudder_thr_countries (id INT PRIMARY KEY, name TEXT)`,
    `CREATE TABLE rudder_thr_users (id INT PRIMARY KEY, "countryId" INT)`,
    `CREATE TABLE rudder_thr_posts (id INT PRIMARY KEY, "userId" INT, published INT, views INT)`,
  ],
  mysql: [
    `CREATE TABLE rudder_thr_countries (id INT PRIMARY KEY, name TEXT)`,
    `CREATE TABLE rudder_thr_users (id INT PRIMARY KEY, countryId INT)`,
    `CREATE TABLE rudder_thr_posts (id INT PRIMARY KEY, userId INT, published INT, views INT)`,
  ],
}

const TABLES = ['rudder_thr_posts', 'rudder_thr_users', 'rudder_thr_countries']

// ─── SQLite (always runs) ────────────────────────────────────────────────────

describe('through whereHas/withCount — native sqlite', () => {
  let adapter: RawAdapter

  before(async () => {
    const driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    adapter = await NativeAdapter.make({ driverInstance: driver }) as RawAdapter
    for (const ddl of DDL.sqlite) await adapter.affectingStatement(ddl, [])
  })

  beforeEach(async () => {
    ModelRegistry.reset()
    ModelRegistry.set(adapter)
    for (const t of TABLES) await adapter.affectingStatement(`DELETE FROM ${t}`, [])
    await seedRows(adapter)
  })

  defineScenario()
})

// ─── Postgres (live) ─────────────────────────────────────────────────────────

if (!PG_URL) {
  test('through whereHas pg live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('through whereHas/withCount — Postgres (live)', () => {
    let driver: PostgresDriver
    let adapter: RawAdapter

    before(async () => {
      driver = await PostgresDriver.open({ url: PG_URL })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new PgDialect() }) as RawAdapter
      for (const t of TABLES) await adapter.affectingStatement(`DROP TABLE IF EXISTS ${t}`, [])
      for (const ddl of DDL.pg) await adapter.affectingStatement(ddl, [])
    })

    after(async () => {
      for (const t of TABLES) await adapter.affectingStatement(`DROP TABLE IF EXISTS ${t}`, []).catch(() => {})
      await driver.close()
    })

    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      for (const t of TABLES) await adapter.affectingStatement(`DELETE FROM ${t}`, [])
      await seedRows(adapter)
    })

    defineScenario()
  })
}

// ─── MySQL (live) ────────────────────────────────────────────────────────────

if (!MYSQL_URL) {
  test('through whereHas mysql live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('through whereHas/withCount — MySQL (live)', () => {
    let driver: MysqlDriver
    let adapter: RawAdapter

    before(async () => {
      driver = await MysqlDriver.open({ url: MYSQL_URL })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new MysqlDialect() }) as RawAdapter
      for (const t of TABLES) await adapter.affectingStatement(`DROP TABLE IF EXISTS ${t}`, [])
      for (const ddl of DDL.mysql) await adapter.affectingStatement(ddl, [])
    })

    after(async () => {
      for (const t of TABLES) await adapter.affectingStatement(`DROP TABLE IF EXISTS ${t}`, []).catch(() => {})
      await driver.close()
    })

    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      for (const t of TABLES) await adapter.affectingStatement(`DELETE FROM ${t}`, [])
      await seedRows(adapter, false)
    })

    defineScenario()
  })
}
