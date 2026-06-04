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
//     effect by reading it back inside the transaction (`SHOW TRANSACTION
//     ISOLATION LEVEL` / `SELECT @@transaction_isolation`), that it does not
//     leak past the transaction (MySQL pins a pooled connection — the next
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

    // @@transaction_isolation reports hyphenated upper-case ('REPEATABLE-READ').
    const mysqlName = (level: TransactionIsolationLevel): string =>
      level.toUpperCase().replace(' ', '-')

    for (const level of ALL_LEVELS) {
      it(`'${level}' is in effect inside the transaction`, async () => {
        const seen = await transaction(async () => {
          const rows = await scopedSelect('SELECT @@transaction_isolation AS iso')
          return String(rows[0]?.['iso'])
        }, { isolationLevel: level })
        assert.strictEqual(seen, mysqlName(level))
      })
    }

    it('does not leak the level onto the released pooled connection', async () => {
      // The un-scoped SET TRANSACTION form applies only to the NEXT transaction
      // on the connection — after commit, a fresh transaction must see the
      // server default again, even when the pool hands back the same connection.
      const defaultLevel = await transaction(async () => {
        const rows = await scopedSelect('SELECT @@transaction_isolation AS iso')
        return String(rows[0]?.['iso'])
      })
      await transaction(async () => {}, { isolationLevel: 'read uncommitted' })
      const seen = await transaction(async () => {
        const rows = await scopedSelect('SELECT @@transaction_isolation AS iso')
        return String(rows[0]?.['iso'])
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
