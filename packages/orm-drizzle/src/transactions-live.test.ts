// Live transaction conformance for the Drizzle adapter — pg + mysql.
//
// Audit P1-4 (docs/plans/2026-06-05-data-layer-test-audit.md):
// transactions.test.ts proves the ALS one-connection guarantee against libsql
// (sqlite), where isolation levels THROW by design — so the isolationLevel
// pass-through (adapter → drizzle's transaction config → `SET TRANSACTION
// ISOLATION LEVEL`) had never run against a database that accepts it. Same
// for SAVEPOINT nesting: drizzle opens real savepoints on pg/mysql, but no
// live test ever exercised them.
//
// Each gated block proves, against a real server:
//   - commit / rollback / nested-savepoint (inner-only rollback)
//   - all 4 ANSI isolation levels are IN EFFECT inside the transaction,
//     read back with the dialect's correct probe (SHOW TRANSACTION ISOLATION
//     LEVEL on pg; performance_schema on mysql — @@transaction_isolation is
//     a wrong probe there, see the native transaction-isolation suite)
//   - the level does not leak past the transaction
//
// The probes run through DB.select() inside the callback — which also gives
// the drizzle DB-raw join (DB.* inside a tx, execute-capable drivers only)
// its first live coverage.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pgTable, serial, text as pgText } from 'drizzle-orm/pg-core'
import { mysqlTable, serial as mysqlSerial, text as mysqlText } from 'drizzle-orm/mysql-core'
import type { TransactionIsolationLevel } from '@rudderjs/contracts'
import { Model, ModelRegistry, transaction } from '@rudderjs/orm'
import { DB } from '@rudderjs/database'
// Side effect: registers the DB facade bridge + transaction runner.
import { DrizzleAdapter } from './index.js'

const ALL_LEVELS: TransactionIsolationLevel[] = [
  'read uncommitted', 'read committed', 'repeatable read', 'serializable',
]

// ─── Postgres ────────────────────────────────────────────────────────────────

const PG_URL = process.env['PG_TEST_URL']

test('live pg: transaction commit/rollback/savepoint + isolation pass-through', { skip: !PG_URL }, async () => {
  const table = `dz_txn_${process.pid}`
  const rows = pgTable(table, {
    id:   serial('id').primaryKey(),
    name: pgText('name').notNull(),
  })
  class Row extends Model {
    static override table = table
    id!: number
    name!: string
  }
  const adapter = await DrizzleAdapter.make({
    driver: 'postgresql',
    url: PG_URL!,
    connectionName: `dz-txn-pg-${process.pid}`,
    tables: { [table]: rows },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  try {
    await adapter.affectingStatement(`drop table if exists ${table}`, [])
    await adapter.affectingStatement(`create table ${table} (id serial primary key, name text not null)`, [])

    // commit
    await transaction(async () => {
      await Row.create({ name: 'committed' })
    })
    assert.ok(await Row.where('name', 'committed').first())

    // rollback
    await assert.rejects(transaction(async () => {
      await Row.create({ name: 'rolledback' })
      throw new Error('boom')
    }), /boom/)
    assert.strictEqual(await Row.where('name', 'rolledback').first(), null)

    // nested SAVEPOINT — inner-only rollback
    await transaction(async () => {
      await Row.create({ name: 'outer' })
      await assert.rejects(transaction(async () => {
        await Row.create({ name: 'inner' })
        throw new Error('inner boom')
      }), /inner boom/)
    })
    assert.ok(await Row.where('name', 'outer').first(), 'outer should persist')
    assert.strictEqual(await Row.where('name', 'inner').first(), null, 'inner should roll back')

    // isolation levels in effect inside the transaction
    for (const level of ALL_LEVELS) {
      const seen = await transaction(async () => {
        const out = await DB.select('SHOW TRANSACTION ISOLATION LEVEL')
        return String(out[0]?.['transaction_isolation'])
      }, { isolationLevel: level })
      assert.strictEqual(seen, level, `expected '${level}' in effect`)
    }

    // the level does not leak past the transaction
    const defaultLevel = await transaction(async () => {
      const out = await DB.select('SHOW TRANSACTION ISOLATION LEVEL')
      return String(out[0]?.['transaction_isolation'])
    })
    await transaction(async () => {}, { isolationLevel: 'serializable' })
    const seenAfter = await transaction(async () => {
      const out = await DB.select('SHOW TRANSACTION ISOLATION LEVEL')
      return String(out[0]?.['transaction_isolation'])
    })
    assert.strictEqual(seenAfter, defaultLevel)
  } finally {
    await adapter.affectingStatement(`drop table if exists ${table}`, []).catch(() => {})
    await adapter.disconnect()
  }
})

// ─── MySQL ───────────────────────────────────────────────────────────────────

const MYSQL_URL = process.env['MYSQL_TEST_URL']

test('live mysql: transaction commit/rollback/savepoint + isolation pass-through', { skip: !MYSQL_URL }, async () => {
  const table = `dz_txn_${process.pid}`
  const rows = mysqlTable(table, {
    id:   mysqlSerial('id').primaryKey(),
    name: mysqlText('name').notNull(),
  })
  class Row extends Model {
    static override table = table
    id!: number
    name!: string
  }
  const adapter = await DrizzleAdapter.make({
    driver: 'mysql',
    url: MYSQL_URL!,
    connectionName: `dz-txn-mysql-${process.pid}`,
    tables: { [table]: rows },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)

  // `SELECT @@transaction_isolation` would report the SESSION default inside
  // the transaction (the un-scoped SET TRANSACTION form is one-shot and BEGIN
  // consumes it) — read the ACTIVE transaction's level from the performance
  // schema instead; the instrument is on by default on MySQL 8.
  const ACTIVE_LEVEL_SQL =
    'SELECT ISOLATION_LEVEL AS iso FROM performance_schema.events_transactions_current ' +
    "WHERE THREAD_ID = PS_CURRENT_THREAD_ID() AND STATE = 'ACTIVE'"
  async function activeLevel(): Promise<string> {
    const out = await DB.select(ACTIVE_LEVEL_SQL)
    assert.equal(out.length, 1, 'expected one ACTIVE instrumented transaction on this thread')
    return String(out[0]?.['iso'])
  }
  // events_transactions_current reports space-separated upper-case ('REPEATABLE READ').
  const mysqlName = (level: TransactionIsolationLevel): string => level.toUpperCase()

  try {
    await adapter.affectingStatement(`drop table if exists ${table}`, [])
    await adapter.affectingStatement(`create table ${table} (id serial primary key, name text not null)`, [])

    // commit
    await transaction(async () => {
      await Row.create({ name: 'committed' })
    })
    assert.ok(await Row.where('name', 'committed').first())

    // rollback
    await assert.rejects(transaction(async () => {
      await Row.create({ name: 'rolledback' })
      throw new Error('boom')
    }), /boom/)
    assert.strictEqual(await Row.where('name', 'rolledback').first(), null)

    // nested SAVEPOINT — inner-only rollback
    await transaction(async () => {
      await Row.create({ name: 'outer' })
      await assert.rejects(transaction(async () => {
        await Row.create({ name: 'inner' })
        throw new Error('inner boom')
      }), /inner boom/)
    })
    assert.ok(await Row.where('name', 'outer').first(), 'outer should persist')
    assert.strictEqual(await Row.where('name', 'inner').first(), null, 'inner should roll back')

    // isolation levels in effect inside the transaction
    for (const level of ALL_LEVELS) {
      const seen = await transaction(async () => activeLevel(), { isolationLevel: level })
      assert.strictEqual(seen, mysqlName(level), `expected '${level}' in effect`)
    }

    // the level does not leak past the transaction
    const defaultLevel = await transaction(async () => activeLevel())
    await transaction(async () => {}, { isolationLevel: 'serializable' })
    const seenAfter = await transaction(async () => activeLevel())
    assert.strictEqual(seenAfter, defaultLevel)
  } finally {
    await adapter.affectingStatement(`drop table if exists ${table}`, []).catch(() => {})
    await adapter.disconnect()
  }
})
