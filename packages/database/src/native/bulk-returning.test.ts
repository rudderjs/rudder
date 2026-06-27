// ─── Bulk write terminals that RETURN the rows (updateAllReturning / upsertReturning) ──
//
// The count variants (`updateAll`/`upsert`) already run `RETURNING *` on a
// RETURNING-capable dialect and then discard the rows for a `.length`. These
// terminals return the rows instead, so a caller gets the real post-write state
// (DB defaults, driver coercion, the conflict key even when a default generated
// it) for any primary-key shape, with no re-select. Driven over a real
// better-sqlite3 with the SqliteDialect (supportsReturning = true); the
// no-RETURNING (MySQL) branch is asserted to throw via the MysqlDialect.

import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import BetterSqlite3 from 'better-sqlite3'
import { NativeQueryBuilder } from './query-builder.js'
import { SqliteDialect } from './dialect.js'
import { MysqlDialect } from './dialect-mysql.js'
import type { Executor, Row } from './driver.js'

type Db = InstanceType<typeof BetterSqlite3>

/** A plain better-sqlite3 Executor. RETURNING statements report `stmt.reader`,
 *  so the same execute() handles both reads and write-with-RETURNING. */
class Bs3Executor implements Executor {
  constructor(private readonly db: Db) {}
  async execute(sql: string, bindings: readonly unknown[]): Promise<Row[]> {
    const stmt = this.db.prepare(sql)
    const params = bindings.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v))
    if (stmt.reader) return stmt.all(...params) as Row[]
    stmt.run(...params)
    return []
  }
}

interface Item { id: number; slug: string; name: string; n: number }

const dialect = new SqliteDialect()
let db: Db
let executor: Bs3Executor

function qb() {
  return new NativeQueryBuilder<Item>(executor, dialect, 'items', 'id')
}

before(() => {
  assert.strictEqual(dialect.supportsReturning, true)
})

beforeEach(() => {
  db = new BetterSqlite3(':memory:')
  db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT UNIQUE, name TEXT, n INTEGER DEFAULT 7)')
  executor = new Bs3Executor(db)
})

describe('updateAllReturning', () => {
  it('returns the updated rows reflecting the post-write state', async () => {
    await qb().create({ slug: 'a', name: 'A', n: 1 })
    await qb().create({ slug: 'b', name: 'B', n: 1 })
    await qb().create({ slug: 'c', name: 'C', n: 5 })

    const rows = await qb().where('n', '=', 1).updateAllReturning({ n: 2 })
    assert.strictEqual(rows.length, 2)
    assert.deepStrictEqual(rows.map((r) => r.slug).sort(), ['a', 'b'])
    // the RETURNING rows carry the NEW value, not the pre-write one.
    assert.deepStrictEqual(rows.map((r) => r.n), [2, 2])
    // and it actually landed.
    assert.strictEqual(await qb().where('n', '=', 2).count(), 2)
  })

  it('returns [] when no row matches (no throw)', async () => {
    await qb().create({ slug: 'a', name: 'A', n: 1 })
    const rows = await qb().where('slug', '=', 'nope').updateAllReturning({ n: 9 })
    assert.deepStrictEqual(rows, [])
  })

  it('works for a non-`id` primary key (the row identity is irrelevant to RETURNING)', async () => {
    db.exec('CREATE TABLE tokens (token TEXT PRIMARY KEY, used INTEGER)')
    const tqb = () => new NativeQueryBuilder<{ token: string; used: number }>(executor, dialect, 'tokens', 'token')
    await tqb().create({ token: 'tok_a', used: 0 })
    const rows = await tqb().where('token', '=', 'tok_a').updateAllReturning({ used: 1 })
    assert.deepStrictEqual(rows, [{ token: 'tok_a', used: 1 }])
  })
})

describe('upsertReturning', () => {
  it('returns the inserted row, including a DB default the input omitted', async () => {
    // `n` is omitted; the column defaults to 7. The RETURNING row carries it.
    const rows = await qb().upsertReturning([{ slug: 'k', name: 'First' }], ['slug'], ['name'])
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0]!.name, 'First')
    assert.strictEqual(rows[0]!.n, 7)
  })

  it('returns the converged row on a conflict', async () => {
    await qb().upsertReturning([{ slug: 'k', name: 'First', n: 1 }], ['slug'], ['name', 'n'])
    const rows = await qb().upsertReturning([{ slug: 'k', name: 'Second', n: 9 }], ['slug'], ['name', 'n'])
    assert.strictEqual(rows.length, 1)
    assert.strictEqual(rows[0]!.name, 'Second')
    assert.strictEqual(rows[0]!.n, 9)
    assert.strictEqual(await qb().count(), 1) // still ONE row
  })

  it('returns [] for an empty input set', async () => {
    assert.deepStrictEqual(await qb().upsertReturning([], ['slug'], ['name']), [])
  })
})

describe('no-RETURNING dialect (MySQL) throws a clear error', () => {
  const my = new MysqlDialect()
  function myqb() {
    // backtick identifiers (MysqlDialect emits them) are accepted by SQLite.
    return new NativeQueryBuilder<Item>(executor, my, 'items', 'id')
  }
  before(() => assert.strictEqual(my.supportsReturning, false))

  it('updateAllReturning throws NATIVE_RETURNING_UNSUPPORTED', async () => {
    await assert.rejects(myqb().where('n', '=', 1).updateAllReturning({ n: 2 }), (e: unknown) => {
      assert.match(String((e as Error).message), /requires a RETURNING-capable dialect/)
      assert.strictEqual((e as { code?: string }).code, 'NATIVE_RETURNING_UNSUPPORTED')
      return true
    })
  })

  it('upsertReturning throws NATIVE_RETURNING_UNSUPPORTED', async () => {
    await assert.rejects(myqb().upsertReturning([{ slug: 'k', name: 'x' }], ['slug'], ['name']), (e: unknown) => {
      assert.strictEqual((e as { code?: string }).code, 'NATIVE_RETURNING_UNSUPPORTED')
      return true
    })
  })
})
