// ─── Lock options on the Drizzle adapter — LIVE concurrency tests ───────────
//
// Audit P1-5 (docs/plans/2026-06-05-data-layer-test-audit.md): lock.test.ts
// asserts the rendered SQL shape on sqlite; SKIP LOCKED / NOWAIT only mean
// anything against a real server with two concurrent transactions. This is
// the drizzle twin of packages/database/src/native/lock-live.test.ts —
// transaction A locks a row (`FOR UPDATE`), transaction B on a separate
// pooled connection proves the wait behavior:
//   • `skipLocked` → B's locking read returns every row EXCEPT the locked one,
//     immediately (the job-reservation pattern, #899/#901).
//   • `noWait`     → B's locking read errors immediately (pg 55P03; mysql
//     ER_LOCK_NOWAIT 3572) instead of blocking.
// The plain (no-options) form is deliberately NOT exercised concurrently — it
// would block until A commits, hanging the test.
//
// adapter.transaction() is called directly (NOT the ALS-bound orm
// `transaction()` helper) so the inner call opens an INDEPENDENT drizzle
// transaction on a second pooled connection instead of a SAVEPOINT.

import { describe, it, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { pgTable, serial, text as pgText } from 'drizzle-orm/pg-core'
import { mysqlTable, serial as mysqlSerial, varchar as mysqlVarchar } from 'drizzle-orm/mysql-core'
import type { LockOptions, OrmAdapter, QueryBuilder } from '@rudderjs/contracts'
import { ModelRegistry } from '@rudderjs/orm'
import { DrizzleAdapter } from './index.js'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

interface JobRow { id: number; name: string }

/** The contracts type marks the lock methods optional (capability surface);
 *  the drizzle QB always implements them — narrow once instead of `!`-ing
 *  every chain. */
type LockingQb = QueryBuilder<JobRow> & {
  lockForUpdate(opts?: LockOptions): LockingQb
  sharedLock(opts?: LockOptions): LockingQb
}
function jobs(a: OrmAdapter, table: string): LockingQb {
  return a.query<JobRow>(table) as LockingQb
}

// ── Postgres ────────────────────────────────────────────────
if (!PG_URL) {
  test('drizzle lock options Postgres live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('drizzle lock options — Postgres (live)', () => {
    const TABLE = `dz_lock_${process.pid}`
    let adapter: DrizzleAdapter

    before(async () => {
      const jobsTable = pgTable(TABLE, {
        id:   serial('id').primaryKey(),
        name: pgText('name').notNull(),
      })
      adapter = await DrizzleAdapter.make({
        driver: 'postgresql',
        url: PG_URL,
        connectionName: `dz-lock-pg-${process.pid}`,
        tables: { [TABLE]: jobsTable },
      })
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      await adapter.affectingStatement(`drop table if exists ${TABLE}`, [])
      await adapter.affectingStatement(`create table ${TABLE} (id serial primary key, name text not null)`, [])
      await adapter.affectingStatement(`insert into ${TABLE} (name) values ('locked'), ('free')`, [])
    })

    after(async () => {
      await adapter.affectingStatement(`drop table if exists ${TABLE}`, []).catch(() => {})
      await adapter.disconnect()
    })

    it('skipLocked: a concurrent locking read sees every row but the locked one', async () => {
      await adapter.transaction!(async (txA) => {
        await jobs(txA, TABLE).where('id', 1).lockForUpdate().get()
        // adapter.transaction on the ROOT adapter → an independent drizzle
        // transaction on a second pooled connection. Without SKIP LOCKED it
        // would block on row 1.
        const seen = await adapter.transaction!(async (txB) =>
          jobs(txB, TABLE).orderBy('id').lockForUpdate({ skipLocked: true }).get(),
        )
        assert.deepEqual(seen.map((r) => r.name), ['free'])
      })
    })

    it('noWait: a concurrent locking read fails immediately on the locked row', async () => {
      await adapter.transaction!(async (txA) => {
        await jobs(txA, TABLE).where('id', 1).lockForUpdate().get()
        await assert.rejects(
          adapter.transaction!(async (txB) =>
            jobs(txB, TABLE).where('id', 1).lockForUpdate({ noWait: true }).get(),
          ),
          /could not obtain lock/,
        )
      })
    })

    it('sharedLock(skipLocked) coexists with another shared lock but skips an exclusive one', async () => {
      await adapter.transaction!(async (txA) => {
        await jobs(txA, TABLE).where('id', 1).lockForUpdate().get()
        const seen = await adapter.transaction!(async (txB) =>
          jobs(txB, TABLE).orderBy('id').sharedLock({ skipLocked: true }).get(),
        )
        assert.deepEqual(seen.map((r) => r.name), ['free'])
      })
    })

    it('both rows visible again after the locking transaction commits', async () => {
      const rows = await adapter.transaction!(async (tx) =>
        jobs(tx, TABLE).orderBy('id').lockForUpdate({ skipLocked: true }).get(),
      )
      assert.equal(rows.length, 2)
    })
  })
}

// ── MySQL ───────────────────────────────────────────────────
if (!MYSQL_URL) {
  test('drizzle lock options MySQL live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('drizzle lock options — MySQL (live)', () => {
    const TABLE = `dz_lock_${process.pid}`
    let adapter: DrizzleAdapter

    before(async () => {
      const jobsTable = mysqlTable(TABLE, {
        id:   mysqlSerial('id').primaryKey(),
        name: mysqlVarchar('name', { length: 32 }).notNull(),
      })
      adapter = await DrizzleAdapter.make({
        driver: 'mysql',
        url: MYSQL_URL,
        connectionName: `dz-lock-mysql-${process.pid}`,
        tables: { [TABLE]: jobsTable },
      })
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      await adapter.affectingStatement(`drop table if exists ${TABLE}`, [])
      await adapter.affectingStatement(`create table ${TABLE} (id int auto_increment primary key, name varchar(32) not null)`, [])
      await adapter.affectingStatement(`insert into ${TABLE} (name) values ('locked'), ('free')`, [])
    })

    after(async () => {
      await adapter.affectingStatement(`drop table if exists ${TABLE}`, []).catch(() => {})
      await adapter.disconnect()
    })

    it('skipLocked: a concurrent locking read sees every row but the locked one', async () => {
      await adapter.transaction!(async (txA) => {
        await jobs(txA, TABLE).where('id', 1).lockForUpdate().get()
        const seen = await adapter.transaction!(async (txB) =>
          jobs(txB, TABLE).orderBy('id').lockForUpdate({ skipLocked: true }).get(),
        )
        assert.deepEqual(seen.map((r) => r.name), ['free'])
      })
    })

    it('noWait: a concurrent locking read fails immediately on the locked row', async () => {
      await adapter.transaction!(async (txA) => {
        await jobs(txA, TABLE).where('id', 1).lockForUpdate().get()
        await assert.rejects(
          adapter.transaction!(async (txB) =>
            jobs(txB, TABLE).where('id', 1).lockForUpdate({ noWait: true }).get(),
          ),
          // ER_LOCK_NOWAIT (3572)
          /NOWAIT is set|could not be acquired/,
        )
      })
    })

    it('both rows visible again after the locking transaction commits', async () => {
      const rows = await adapter.transaction!(async (tx) =>
        jobs(tx, TABLE).orderBy('id').lockForUpdate({ skipLocked: true }).get(),
      )
      assert.equal(rows.length, 2)
    })
  })
}
