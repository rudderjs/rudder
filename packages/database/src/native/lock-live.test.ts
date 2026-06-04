// ─── Lock options — LIVE concurrency tests ─────────────────
//
// SKIP LOCKED / NOWAIT only mean anything against a real server with two
// concurrent transactions: transaction A locks a row (`FOR UPDATE`), then
// transaction B — on a separate pooled connection — proves the wait behavior:
//   • `skipLocked` → B's locking read returns every row EXCEPT the locked one,
//     immediately (the job-reservation pattern).
//   • `noWait`     → B's locking read errors immediately (pg 55P03 "could not
//     obtain lock"; mysql ER_LOCK_NOWAIT 3572) instead of blocking.
// The plain (no-options) form is deliberately NOT exercised concurrently — it
// would block until A commits, hanging the test.
//
// Gated on PG_TEST_URL / MYSQL_TEST_URL (same pattern as schema/pg-introspect):
// unset → a single skipped placeholder, nothing connects.
//
//   PG_TEST_URL=postgres://localhost:5432/rudder_native_pg_test pnpm --filter @rudderjs/database test
//   MYSQL_TEST_URL="mysql://root:rudder@localhost:3306/rudder_native_mysql_test" pnpm --filter @rudderjs/database test

import { describe, it, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { NativeQueryBuilder } from './query-builder.js'
import { PostgresDriver } from './drivers/postgres.js'
import { MysqlDriver } from './drivers/mysql.js'
import { PgDialect } from './dialect-pg.js'
import { MysqlDialect } from './dialect-mysql.js'
import type { Dialect } from './dialect.js'
import type { Executor } from './driver.js'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

interface JobRow { id: number; name: string }

/** A fresh builder over `exec` — one per query, like the adapter does. */
function qb(exec: Executor, dialect: Dialect, table: string): NativeQueryBuilder<JobRow> {
  return new NativeQueryBuilder<JobRow>(exec, dialect, table, 'id')
}

// ── Postgres ────────────────────────────────────────────────
if (!PG_URL) {
  test('lock options Postgres live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('lock options — Postgres (live)', () => {
    const TABLE = 'rudder_lock_opts_pg'
    const dialect = new PgDialect()
    let driver: PostgresDriver

    before(async () => {
      driver = await PostgresDriver.open({ url: PG_URL })
      await driver.execute(`DROP TABLE IF EXISTS "${TABLE}"`, [])
      await driver.execute(`CREATE TABLE "${TABLE}" (id serial PRIMARY KEY, name text NOT NULL)`, [])
      await driver.execute(`INSERT INTO "${TABLE}" (name) VALUES ('locked'), ('free')`, [])
    })

    after(async () => {
      await driver.execute(`DROP TABLE IF EXISTS "${TABLE}"`, [])
      await driver.close()
    })

    it('skipLocked: a concurrent locking read sees every row but the locked one', async () => {
      await driver.transaction(async (txA) => {
        await qb(txA, dialect, TABLE).where('id', 1).lockForUpdate().get()
        // txB runs on a separate pooled connection (driver.transaction opens a
        // fresh BEGIN) — without SKIP LOCKED it would block on row 1.
        const seen = await driver.transaction(async (txB) =>
          qb(txB, dialect, TABLE).orderBy('id').lockForUpdate({ skipLocked: true }).get(),
        )
        assert.deepEqual(seen.map((r) => r.name), ['free'])
      })
    })

    it('noWait: a concurrent locking read fails immediately on the locked row', async () => {
      await driver.transaction(async (txA) => {
        await qb(txA, dialect, TABLE).where('id', 1).lockForUpdate().get()
        await assert.rejects(
          driver.transaction(async (txB) =>
            qb(txB, dialect, TABLE).where('id', 1).lockForUpdate({ noWait: true }).get(),
          ),
          /could not obtain lock/,
        )
      })
    })

    it('both rows visible again after the locking transaction commits', async () => {
      const rows = await driver.transaction(async (tx) =>
        qb(tx, dialect, TABLE).orderBy('id').lockForUpdate({ skipLocked: true }).get(),
      )
      assert.equal(rows.length, 2)
    })
  })
}

// ── MySQL ───────────────────────────────────────────────────
if (!MYSQL_URL) {
  test('lock options MySQL live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('lock options — MySQL (live)', () => {
    const TABLE = 'rudder_lock_opts_mysql'
    const dialect = new MysqlDialect()
    let driver: MysqlDriver

    before(async () => {
      driver = await MysqlDriver.open({ url: MYSQL_URL })
      await driver.execute(`DROP TABLE IF EXISTS \`${TABLE}\``, [])
      await driver.execute(`CREATE TABLE \`${TABLE}\` (id int AUTO_INCREMENT PRIMARY KEY, name varchar(32) NOT NULL)`, [])
      await driver.execute(`INSERT INTO \`${TABLE}\` (name) VALUES ('locked'), ('free')`, [])
    })

    after(async () => {
      await driver.execute(`DROP TABLE IF EXISTS \`${TABLE}\``, [])
      await driver.close()
    })

    it('skipLocked: a concurrent locking read sees every row but the locked one', async () => {
      await driver.transaction(async (txA) => {
        await qb(txA, dialect, TABLE).where('id', 1).lockForUpdate().get()
        const seen = await driver.transaction(async (txB) =>
          qb(txB, dialect, TABLE).orderBy('id').lockForUpdate({ skipLocked: true }).get(),
        )
        assert.deepEqual(seen.map((r) => r.name), ['free'])
      })
    })

    it('noWait: a concurrent locking read fails immediately on the locked row', async () => {
      await driver.transaction(async (txA) => {
        await qb(txA, dialect, TABLE).where('id', 1).lockForUpdate().get()
        await assert.rejects(
          driver.transaction(async (txB) =>
            qb(txB, dialect, TABLE).where('id', 1).lockForUpdate({ noWait: true }).get(),
          ),
          // ER_LOCK_NOWAIT (3572)
          /NOWAIT is set|could not be acquired/,
        )
      })
    })

    it('both rows visible again after the locking transaction commits', async () => {
      const rows = await driver.transaction(async (tx) =>
        qb(tx, dialect, TABLE).orderBy('id').lockForUpdate({ skipLocked: true }).get(),
      )
      assert.equal(rows.length, 2)
    })
  })
}
