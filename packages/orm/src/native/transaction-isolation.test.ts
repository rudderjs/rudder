// ─── transaction(fn, { isolationLevel }) — native engine ───
//
// Tier-1 gap #1 (db-orm-comparison §14): isolation levels on `transaction()`.
// Three layers under test:
//   • `isolationLevelSql` — the lowercase-ANSI → SQL-keyword map that doubles
//     as the injection gate (the keyword is spliced, never bound).
//   • SQLite — no isolation levels (single-writer is already serializable):
//     the driver throws a clear unsupported error instead of silently no-oping,
//     and the ORM-level nested guard fires before any driver is reached.
//   • LIVE Postgres / MySQL (gated on PG_TEST_URL / MYSQL_TEST_URL, same
//     pattern as drivers/postgres.test.ts) — prove the level is ACTUALLY in
//     effect by reading it back inside the transaction (pg `SHOW TRANSACTION
//     ISOLATION LEVEL`; mysql via performance_schema — see the in-suite note
//     for why `@@transaction_isolation` cannot work), that it does not leak
//     past the transaction (MySQL pins a pooled connection — the next
//     transaction must see the server default again), and that a SAVEPOINT
//     scope rejects a level change.

import { describe, it, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { ModelRegistry, transaction } from '../index.js'
import type { OrmAdapter, TransactionIsolationLevel } from '@rudderjs/contracts'
import {
  NativeAdapter, BetterSqlite3Driver, PostgresDriver, MysqlDriver,
  PgDialect, MysqlDialect, isolationLevelSql,
} from '@rudderjs/database/native'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

const ALL_LEVELS: TransactionIsolationLevel[] =
  ['read uncommitted', 'read committed', 'repeatable read', 'serializable']

/** The tx-scoped adapter inside a `transaction()` callback — `getAdapter()`
 *  resolves it through the ALS scope, so raw reads join the open transaction. */
function scopedSelect(sql: string): Promise<Record<string, unknown>[]> {
  const adapter = ModelRegistry.getAdapter() as OrmAdapter
  assert.ok(typeof adapter.selectRaw === 'function', 'native adapter implements selectRaw')
  return adapter.selectRaw(sql, [])
}

// ── isolationLevelSql — keyword map + injection gate ────────
describe('isolationLevelSql', () => {
  it('maps every contract level to its SQL keyword', () => {
    assert.strictEqual(isolationLevelSql('read uncommitted'), 'READ UNCOMMITTED')
    assert.strictEqual(isolationLevelSql('read committed'), 'READ COMMITTED')
    assert.strictEqual(isolationLevelSql('repeatable read'), 'REPEATABLE READ')
    assert.strictEqual(isolationLevelSql('serializable'), 'SERIALIZABLE')
  })

  it('throws on anything outside the union (the level is spliced, never bound)', () => {
    assert.throws(
      () => isolationLevelSql('serializable; DROP TABLE users' as TransactionIsolationLevel),
      /Unknown transaction isolation level/,
    )
  })
})

// ── SQLite — clear unsupported error, never a silent no-op ──
describe('transaction isolation — SQLite', () => {
  let driver: BetterSqlite3Driver

  before(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
  })

  after(async () => {
    await driver.close()
  })

  it('rejects isolationLevel with a clear unsupported error', async () => {
    await assert.rejects(
      transaction(async () => {}, { isolationLevel: 'serializable' }),
      /SQLite does not support transaction isolation levels/,
    )
  })

  it('rejects isolationLevel on a nested transaction() before reaching the driver', async () => {
    // The ORM-level guard is adapter-agnostic: nesting maps to a SAVEPOINT, so
    // the error names the nesting (not SQLite's missing support).
    await transaction(async () => {
      await assert.rejects(
        transaction(async () => {}, { isolationLevel: 'read committed' }),
        /isolationLevel cannot be set on a nested transaction/,
      )
    })
  })

  it('a plain transaction (no level) still works', async () => {
    const out = await transaction(async () => 'ok')
    assert.strictEqual(out, 'ok')
  })
})

// ── Postgres (live) ─────────────────────────────────────────
if (!PG_URL) {
  test('transaction isolation Postgres live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('transaction isolation — Postgres (live)', () => {
    let driver: PostgresDriver

    before(async () => {
      driver = await PostgresDriver.open({ url: PG_URL })
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver, dialect: new PgDialect() }))
    })

    after(async () => {
      await driver.close()
    })

    for (const level of ALL_LEVELS) {
      it(`'${level}' is in effect inside the transaction`, async () => {
        const seen = await transaction(async () => {
          const rows = await scopedSelect('SHOW TRANSACTION ISOLATION LEVEL')
          return String(rows[0]?.['transaction_isolation'])
        }, { isolationLevel: level })
        // Postgres reports 'read uncommitted' as the 'read uncommitted' level
        // even though it executes it as READ COMMITTED — the SHOW output still
        // echoes the requested level, which is what proves the SET took effect.
        assert.strictEqual(seen, level)
      })
    }

    it('does not leak the level past the transaction', async () => {
      const defaultLevel = await transaction(async () => {
        const rows = await scopedSelect('SHOW TRANSACTION ISOLATION LEVEL')
        return String(rows[0]?.['transaction_isolation'])
      })
      await transaction(async () => {}, { isolationLevel: 'serializable' })
      const seen = await transaction(async () => {
        const rows = await scopedSelect('SHOW TRANSACTION ISOLATION LEVEL')
        return String(rows[0]?.['transaction_isolation'])
      })
      assert.strictEqual(seen, defaultLevel)
    })

    it('a SAVEPOINT scope rejects an isolation level (driver-level guard)', async () => {
      await driver.transaction(async (tx) => {
        await assert.rejects(
          tx.transaction(async () => {}, { isolationLevel: 'serializable' }),
          /isolationLevel cannot be set on a nested transaction/,
        )
      })
    })
  })
}

// ── MySQL (live) ────────────────────────────────────────────
if (!MYSQL_URL) {
  test('transaction isolation MySQL live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('transaction isolation — MySQL (live)', () => {
    let driver: MysqlDriver

    before(async () => {
      driver = await MysqlDriver.open({ url: MYSQL_URL })
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver, dialect: new MysqlDialect() }))
    })

    after(async () => {
      await driver.close()
    })

    // `SELECT @@transaction_isolation` is the WRONG probe here: the un-scoped
    // `SET TRANSACTION` form sets a ONE-SHOT next-transaction value that BEGIN
    // consumes, after which the variable reverts to the SESSION value — so
    // inside the transaction it reports the default (REPEATABLE-READ) even
    // though the transaction IS running at the requested level (caught live in
    // CI: every non-default level "failed" with REPEATABLE-READ). Read the
    // ACTIVE transaction's level from the performance schema instead — the
    // transaction instrument + events_transactions_current consumer are
    // enabled by default on MySQL 8 (the CI image).
    const ACTIVE_LEVEL_SQL =
      'SELECT ISOLATION_LEVEL AS iso FROM performance_schema.events_transactions_current ' +
      "WHERE THREAD_ID = PS_CURRENT_THREAD_ID() AND STATE = 'ACTIVE'"

    // events_transactions_current reports space-separated upper-case
    // ('REPEATABLE READ').
    const mysqlName = (level: TransactionIsolationLevel): string => level.toUpperCase()

    async function activeLevel(): Promise<string> {
      const rows = await scopedSelect(ACTIVE_LEVEL_SQL)
      assert.equal(rows.length, 1, 'expected one ACTIVE instrumented transaction on this thread')
      return String(rows[0]?.['iso'])
    }

    for (const level of ALL_LEVELS) {
      it(`'${level}' is in effect inside the transaction`, async () => {
        const seen = await transaction(async () => activeLevel(), { isolationLevel: level })
        assert.strictEqual(seen, mysqlName(level))
      })
    }

    it('read uncommitted actually dirty-reads a concurrent uncommitted write (behavioral proof)', async () => {
      // Belt and braces independent of the performance schema: only READ
      // UNCOMMITTED can see another transaction's uncommitted row. Driver-level
      // (not the ALS path) so txA and txB coexist on separate pooled connections.
      const TABLE = 'rudder_iso_dirty_read'
      await driver.execute(`DROP TABLE IF EXISTS \`${TABLE}\``, [])
      await driver.execute(`CREATE TABLE \`${TABLE}\` (id int AUTO_INCREMENT PRIMARY KEY, name varchar(32))`, [])
      try {
        class Rollback extends Error {}
        await assert.rejects(driver.transaction(async (txA) => {
          await txA.execute(`INSERT INTO \`${TABLE}\` (name) VALUES ('dirty')`, [])
          const count = async (opts?: { isolationLevel: TransactionIsolationLevel }) => {
            const rows = await driver.transaction(
              async (txB) => txB.execute(`SELECT COUNT(*) AS n FROM \`${TABLE}\``, []), opts)
            return Number(rows[0]?.['n'])
          }
          assert.equal(await count({ isolationLevel: 'read uncommitted' }), 1, 'dirty read sees the uncommitted row')
          assert.equal(await count(), 0, 'default REPEATABLE READ does not')
          throw new Rollback('discard txA')
        }), Rollback)
      } finally {
        await driver.execute(`DROP TABLE IF EXISTS \`${TABLE}\``, [])
      }
    })

    it('does not leak the level onto the released pooled connection', async () => {
      // The un-scoped SET TRANSACTION form applies only to the NEXT transaction
      // on the connection — after commit, a fresh transaction must see the
      // server default again, even when the pool hands back the same connection.
      const defaultLevel = await transaction(async () => activeLevel())
      await transaction(async () => {}, { isolationLevel: 'read uncommitted' })
      const seen = await transaction(async () => activeLevel())
      assert.strictEqual(seen, defaultLevel)
    })

    it('a SAVEPOINT scope rejects an isolation level (driver-level guard)', async () => {
      await driver.transaction(async (tx) => {
        await assert.rejects(
          tx.transaction(async () => {}, { isolationLevel: 'serializable' }),
          /isolationLevel cannot be set on a nested transaction/,
        )
      })
    })
  })
}
