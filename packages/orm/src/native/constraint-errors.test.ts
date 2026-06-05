// ─── Constraint-violation error shapes — native engine ──────────────────────
//
// Audit P1-6 (docs/plans/2026-06-05-data-layer-test-audit.md): nothing pinned
// what reaches user code on unique / FK / NOT NULL violations or a missing
// table. The native engine's contract is PASS-THROUGH: drivers wrap only
// load/open failures (NativeDriverError); query-time errors surface raw, so
// user `catch` blocks (and the queue's retry/backoff) key off the driver's
// own discriminating fields. A driver bump that changes these shapes should
// fail HERE, not in production:
//   • better-sqlite3 → `code: 'SQLITE_CONSTRAINT_*'`
//   • porsager postgres → `code: '23505' | '23503' | '23502' | '42P01'`
//     (+ `constraint_name` on constraint violations)
//   • mysql2 → `errno: 1062 | 1452 | 1048 | 1146` (+ `code: 'ER_*'`)
//
// sqlite runs everywhere; pg/mysql blocks gate on PG_TEST_URL / MYSQL_TEST_URL.

import { describe, it, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter } from '@rudderjs/contracts'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter, BetterSqlite3Driver, PostgresDriver, MysqlDriver, PgDialect, MysqlDialect } from '@rudderjs/database/native'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

/** Raw seams used for DDL/seeding without a Model in the way. */
type RawAdapter = OrmAdapter & {
  affectingStatement(sql: string, bindings: readonly unknown[]): Promise<number>
}

/** Structural views of each driver's error. */
type SqliteErr = { code?: string }
type PgErr     = { code?: string; constraint_name?: string }
type MysqlErr  = { code?: string; errno?: number }

// ── SQLite (always runs) ────────────────────────────────────
describe('constraint error shapes — sqlite (better-sqlite3)', () => {
  let adapter: RawAdapter

  before(async () => {
    const driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    adapter = await NativeAdapter.make({ driverInstance: driver }) as RawAdapter
    ModelRegistry.reset()
    ModelRegistry.set(adapter)
    // FK enforcement is OFF by default in sqlite — opt in for the FK test.
    await adapter.affectingStatement('PRAGMA foreign_keys = ON', [])
    await adapter.affectingStatement('CREATE TABLE rudder_ce_users (id integer primary key autoincrement, email text not null unique)', [])
    await adapter.affectingStatement('CREATE TABLE rudder_ce_posts (id integer primary key autoincrement, user_id integer not null references rudder_ce_users(id))', [])
  })

  it('unique violation surfaces SQLITE_CONSTRAINT_UNIQUE (QB and Model paths alike)', async () => {
    await adapter.query('rudder_ce_users').create({ email: 'a@x.io' })
    await assert.rejects(
      adapter.query('rudder_ce_users').create({ email: 'a@x.io' }),
      (err: unknown) => (err as SqliteErr).code === 'SQLITE_CONSTRAINT_UNIQUE',
    )
    // Same shape through Model.create — the wrap-free contract holds at the
    // user-facing layer too.
    class CeUser extends Model {
      static override table = 'rudder_ce_users'
      email!: string
    }
    await assert.rejects(
      CeUser.create({ email: 'a@x.io' }),
      (err: unknown) => (err as SqliteErr).code === 'SQLITE_CONSTRAINT_UNIQUE',
    )
  })

  it('NOT NULL violation surfaces SQLITE_CONSTRAINT_NOTNULL', async () => {
    await assert.rejects(
      adapter.query('rudder_ce_users').create({ email: null as unknown as string }),
      (err: unknown) => (err as SqliteErr).code === 'SQLITE_CONSTRAINT_NOTNULL',
    )
  })

  it('FK violation surfaces SQLITE_CONSTRAINT_FOREIGNKEY', async () => {
    await assert.rejects(
      adapter.query('rudder_ce_posts').create({ user_id: 99_999 }),
      (err: unknown) => (err as SqliteErr).code === 'SQLITE_CONSTRAINT_FOREIGNKEY',
    )
  })

  it('missing table surfaces a raw sqlite error (no such table)', async () => {
    await assert.rejects(
      adapter.query('rudder_ce_nope').first(),
      /no such table/,
    )
  })
})

// ── Postgres (live) ─────────────────────────────────────────
if (!PG_URL) {
  test('constraint error shapes pg live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('constraint error shapes — Postgres (live)', () => {
    let driver: PostgresDriver
    let adapter: RawAdapter

    before(async () => {
      driver = await PostgresDriver.open({ url: PG_URL })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new PgDialect() }) as RawAdapter
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      await adapter.affectingStatement('DROP TABLE IF EXISTS rudder_ce_posts', [])
      await adapter.affectingStatement('DROP TABLE IF EXISTS rudder_ce_users', [])
      await adapter.affectingStatement('CREATE TABLE rudder_ce_users (id serial primary key, email text not null, constraint rudder_ce_users_email_uq unique (email))', [])
      await adapter.affectingStatement('CREATE TABLE rudder_ce_posts (id serial primary key, user_id integer not null references rudder_ce_users(id))', [])
    })

    after(async () => {
      await adapter.affectingStatement('DROP TABLE IF EXISTS rudder_ce_posts', []).catch(() => {})
      await adapter.affectingStatement('DROP TABLE IF EXISTS rudder_ce_users', []).catch(() => {})
      await driver.close()
    })

    it('unique violation: code 23505 + the constraint name', async () => {
      await adapter.query('rudder_ce_users').create({ email: 'a@x.io' })
      await assert.rejects(
        adapter.query('rudder_ce_users').create({ email: 'a@x.io' }),
        (err: unknown) => {
          const e = err as PgErr
          return e.code === '23505' && e.constraint_name === 'rudder_ce_users_email_uq'
        },
      )
    })

    it('FK violation: code 23503', async () => {
      await assert.rejects(
        adapter.query('rudder_ce_posts').create({ user_id: 99_999 }),
        (err: unknown) => (err as PgErr).code === '23503',
      )
    })

    it('NOT NULL violation: code 23502', async () => {
      await assert.rejects(
        adapter.query('rudder_ce_users').create({ email: null as unknown as string }),
        (err: unknown) => (err as PgErr).code === '23502',
      )
    })

    it('missing table: code 42P01', async () => {
      await assert.rejects(
        adapter.query('rudder_ce_nope').first(),
        (err: unknown) => (err as PgErr).code === '42P01',
      )
    })
  })
}

// ── MySQL (live) ────────────────────────────────────────────
if (!MYSQL_URL) {
  test('constraint error shapes mysql live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('constraint error shapes — MySQL (live)', () => {
    let driver: MysqlDriver
    let adapter: RawAdapter

    before(async () => {
      driver = await MysqlDriver.open({ url: MYSQL_URL })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new MysqlDialect() }) as RawAdapter
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      await adapter.affectingStatement('DROP TABLE IF EXISTS rudder_ce_posts', [])
      await adapter.affectingStatement('DROP TABLE IF EXISTS rudder_ce_users', [])
      await adapter.affectingStatement('CREATE TABLE rudder_ce_users (id int auto_increment primary key, email varchar(191) not null unique)', [])
      await adapter.affectingStatement('CREATE TABLE rudder_ce_posts (id int auto_increment primary key, user_id int not null, foreign key (user_id) references rudder_ce_users(id))', [])
    })

    after(async () => {
      await adapter.affectingStatement('DROP TABLE IF EXISTS rudder_ce_posts', []).catch(() => {})
      await adapter.affectingStatement('DROP TABLE IF EXISTS rudder_ce_users', []).catch(() => {})
      await driver.close()
    })

    it('unique violation: errno 1062 / ER_DUP_ENTRY', async () => {
      await adapter.query('rudder_ce_users').create({ email: 'a@x.io' })
      await assert.rejects(
        adapter.query('rudder_ce_users').create({ email: 'a@x.io' }),
        (err: unknown) => {
          const e = err as MysqlErr
          return e.errno === 1062 && e.code === 'ER_DUP_ENTRY'
        },
      )
    })

    it('FK violation: errno 1452', async () => {
      await assert.rejects(
        adapter.query('rudder_ce_posts').create({ user_id: 99_999 }),
        (err: unknown) => (err as MysqlErr).errno === 1452,
      )
    })

    it('NOT NULL violation: errno 1048', async () => {
      await assert.rejects(
        adapter.query('rudder_ce_users').create({ email: null as unknown as string }),
        (err: unknown) => (err as MysqlErr).errno === 1048,
      )
    })

    it('missing table: errno 1146 / ER_NO_SUCH_TABLE', async () => {
      await assert.rejects(
        adapter.query('rudder_ce_nope').first(),
        (err: unknown) => (err as MysqlErr).errno === 1146,
      )
    })
  })
}
