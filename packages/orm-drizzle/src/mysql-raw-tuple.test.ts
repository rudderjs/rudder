// Raw DB-facade seams on the mysql dialect — tuple normalization.
//
// mysql2 resolves `db.execute()` to the TUPLE `[rows, fields]` (reads) /
// `[ResultSetHeader, fields]` (writes). The adapter's `selectRaw` used a bare
// `Array.isArray(result)` check that returned the tuple itself as "rows" —
// every `DB.select()` on drizzle+mysql came back as `[rowsArray, fieldsArray]`
// — and `affectingStatement` reported the tuple `.length` (always 2) instead
// of `affectedRows`. Caught live by transactions-live.test.ts's isolation
// probe (`expected one ACTIVE instrumented transaction — 2 !== 1`).
//
// Pinned here with the no-server mysql-proxy driver returning the exact
// mysql2 result shapes. (The planetscale `{ rows }` object fallback can't be
// simulated through this driver — its session unconditionally indexes the
// tuple — so only the tuple path is pinned; the object fallback is the same
// code that always ran.)

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { drizzle as drizzleMysqlProxy } from 'drizzle-orm/mysql-proxy'
import { mysqlTable, serial as mysqlSerial, int as mysqlInt } from 'drizzle-orm/mysql-core'
import { ModelRegistry } from '@rudderjs/orm'
import { drizzle, type DrizzleAdapter, type DrizzleConfig } from './index.js'

const things = mysqlTable('things', {
  id:    mysqlSerial('id').primaryKey(),
  count: mysqlInt('count').notNull(),
})

let calls: Array<{ sql: string }> = []
/** What the next `db.execute()` resolves to (the mysql2 tuple shape). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nextResult: any

async function makeAdapter(): Promise<DrizzleAdapter> {
  const db = drizzleMysqlProxy(async (sql: string) => {
    calls.push({ sql })
    return { rows: nextResult }
  })
  const cfg: DrizzleConfig = { client: db, dialect: 'mysql', tables: { things } }
  return await drizzle(cfg).create() as DrizzleAdapter
}

beforeEach(() => {
  calls = []
  nextResult = undefined
  ModelRegistry.reset()
})

describe('mysql raw seams — [rows, fields] tuple normalization', () => {
  it('selectRaw unwraps rows from the mysql2 tuple', async () => {
    const adapter = await makeAdapter()
    nextResult = [[{ iso: 'REPEATABLE READ' }], [{ name: 'iso' /* FieldPacket */ }]]
    const rows = await adapter.selectRaw('SELECT iso FROM probe', [])
    assert.deepEqual(rows, [{ iso: 'REPEATABLE READ' }])
  })

  it('selectRaw returns [] for an empty tuple read', async () => {
    const adapter = await makeAdapter()
    nextResult = [[], [{ name: 'iso' }]]
    const rows = await adapter.selectRaw('SELECT iso FROM probe', [])
    assert.deepEqual(rows, [])
  })

  it('affectingStatement reads affectedRows from the header tuple, not tuple.length', async () => {
    const adapter = await makeAdapter()
    nextResult = [{ insertId: 0, affectedRows: 3 }, null]
    const n = await adapter.affectingStatement('UPDATE things SET count = 0', [])
    assert.equal(n, 3) // pre-fix this returned 2 — the tuple's length
  })
})
