// ─── No-RETURNING write path (the MySQL branch) ────────────
//
// MySQL has no RETURNING, so the query builder's write terminals branch on
// `dialect.supportsReturning`: they run the bare INSERT/UPDATE/DELETE and read
// the result from the driver's metadata (AffectingExecutor) — `insertId` for
// `create`, `affectedRows` for `updateAll`/`deleteAll` — then re-SELECT by PK
// for terminals that must return the row.
//
// We can't run a real MySQL here, but the branch is dialect-driven, not
// driver-driven: drive it with the MysqlDialect (supportsReturning = false,
// backtick quoting — which SQLite also accepts) over a real better-sqlite3
// database wrapped to expose `affectingExecute` (insertId/affectedRows from
// better-sqlite3's `lastInsertRowid`/`changes`). This exercises the exact
// no-RETURNING code path end-to-end, locally, against a real engine. The live
// MySQL suite (drivers/mysql.test.ts) covers the real driver.

import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import BetterSqlite3 from 'better-sqlite3'
import { NativeQueryBuilder } from './query-builder.js'
import { MysqlDialect } from './dialect-mysql.js'
import type { Executor, Row, AffectingExecutor, AffectingResult } from './driver.js'

type Db = InstanceType<typeof BetterSqlite3>

/** A better-sqlite3-backed Executor that also reports write metadata — the
 *  SQLite stand-in for a no-RETURNING driver (MySQL). */
class Bs3AffectingExecutor implements Executor, AffectingExecutor {
  constructor(private readonly db: Db) {}

  private params(bindings: readonly unknown[]): unknown[] {
    return bindings.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v))
  }

  async execute(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
    const stmt = this.db.prepare(sql)
    const params = this.params(bindings)
    if (stmt.reader) return stmt.all(...params) as Row[]
    stmt.run(...params)
    return []
  }

  async affectingExecute(sql: string, bindings: readonly unknown[]): Promise<AffectingResult> {
    const info = this.db.prepare(sql).run(...this.params(bindings))
    const id = info.lastInsertRowid != null ? Number(info.lastInsertRowid) : null
    return { insertId: id !== null && id > 0 ? id : null, affectedRows: info.changes }
  }
}

interface Account { id: number; name: string; n: number; deletedAt: string | null }

const dialect = new MysqlDialect()
let db: Db
let executor: Bs3AffectingExecutor

function qb() {
  return new NativeQueryBuilder<Account>(executor, dialect, 'accounts', 'id')
}

before(() => {
  // Sanity: this whole suite only makes sense for a no-RETURNING dialect.
  assert.strictEqual(dialect.supportsReturning, false)
})

beforeEach(() => {
  db = new BetterSqlite3(':memory:')
  // backtick identifiers (MysqlDialect emits them) are accepted by SQLite.
  db.exec('CREATE TABLE `accounts` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name` TEXT, `n` INTEGER DEFAULT 0, `deletedAt` TEXT)')
  executor = new Bs3AffectingExecutor(db)
})

describe('no-RETURNING create()', () => {
  it('returns the input + the generated auto-increment id', async () => {
    const a = await qb().create({ name: 'Ada' })
    assert.strictEqual(a.name, 'Ada')
    assert.strictEqual(typeof a.id, 'number')
    assert.ok(a.id > 0)
    // The row really landed.
    const found = await qb().find(a.id)
    assert.strictEqual(found?.name, 'Ada')
  })

  it('assigns sequential ids across inserts', async () => {
    const a = await qb().create({ name: 'one' })
    const b = await qb().create({ name: 'two' })
    assert.strictEqual(b.id, a.id + 1)
  })

  it('does not overwrite an explicitly provided primary key', async () => {
    const a = await qb().create({ id: 42, name: 'explicit' })
    assert.strictEqual(a.id, 42)
    assert.ok(await qb().find(42))
  })
})

describe('no-RETURNING update() — re-SELECT', () => {
  it('returns the row reflecting the update', async () => {
    const a = await qb().create({ name: 'Linus', n: 1 })
    const updated = await qb().update(a.id, { n: 9 })
    assert.strictEqual(updated.id, a.id)
    assert.strictEqual(updated.n, 9)
  })

  it('throws when the target row does not exist', async () => {
    await assert.rejects(qb().update(999, { n: 1 }), /target row not found/)
  })
})

describe('no-RETURNING bulk terminals — affectedRows', () => {
  it('updateAll returns the number of rows changed', async () => {
    await qb().create({ name: 'a', n: 0 })
    await qb().create({ name: 'b', n: 0 })
    const changed = await qb().updateAll({ n: 5 })
    assert.strictEqual(changed, 2)
    assert.strictEqual((await qb().find(1))?.n, 5)
  })

  it('deleteAll returns the number of rows removed', async () => {
    await qb().create({ name: 'a' })
    await qb().create({ name: 'b' })
    await qb().create({ name: 'c' })
    const removed = await qb().where('name', '!=', 'a').deleteAll()
    assert.strictEqual(removed, 2)
    assert.strictEqual((await qb().get()).length, 1)
  })
})

describe('no-RETURNING increment/decrement — re-SELECT', () => {
  it('increment returns the updated row', async () => {
    const a = await qb().create({ name: 'c', n: 10 })
    const bumped = await qb().increment(a.id, 'n', 5)
    assert.strictEqual(bumped.n, 15)
  })

  it('decrement returns the updated row', async () => {
    const a = await qb().create({ name: 'c', n: 10 })
    const dropped = await qb().decrement(a.id, 'n', 3)
    assert.strictEqual(dropped.n, 7)
  })
})

describe('no-RETURNING restore() — re-SELECT', () => {
  it('clears deletedAt and returns the restored row', async () => {
    const a = await qb().create({ name: 'gone', deletedAt: new Date().toISOString() })
    const restored = await qb().restore(a.id)
    assert.strictEqual(restored.id, a.id)
    assert.strictEqual(restored.deletedAt, null)
  })
})
