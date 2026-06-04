// insertUsing — `INSERT INTO table (cols) SELECT …` from a subquery body.
//
// Compiler units pin the SQL shape (quoted column list + subquery body +
// RETURNING toggle), the required-columns guard, and the raw-body ? rebinding;
// the sqlite E2E proves the archive-copy pattern end-to-end and the returned
// inserted-row count.

import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { compileInsertUsing, type NativeQueryState, type SubqueryBody } from './compiler.js'
import { SqliteDialect } from './dialect.js'
import { PgDialect } from './dialect-pg.js'
import { NativeAdapter } from './adapter.js'
import type { NativeQueryBuilder } from './query-builder.js'

const sqlite = new SqliteDialect()
const pg     = new PgDialect()

function baseState(overrides: Partial<NativeQueryState> = {}): NativeQueryState {
  return {
    table:           'archive',
    primaryKey:      'id',
    conditions:      [],
    orders:          [],
    limitN:          null,
    offsetN:         null,
    softDelete:      'with',
    deletedAtColumn: 'deletedAt',
    ...overrides,
  }
}

const rawBody = (sql: string, bindings: unknown[] = []): SubqueryBody =>
  ({ kind: 'raw', raw: { sql, bindings } })

describe('insertUsing compilation', () => {
  it('emits INSERT INTO (cols) <subquery>; RETURNING toggles; pg rebinds ?→$n', () => {
    const body = rawBody('SELECT name, total FROM orders WHERE total > ?', [100])
    const plain = compileInsertUsing(baseState(), sqlite, ['name', 'amount'], body)
    assert.strictEqual(plain.sql, `INSERT INTO "archive" ("name", "amount") SELECT name, total FROM orders WHERE total > ?`)
    assert.deepStrictEqual(plain.bindings, [100])

    const returning = compileInsertUsing(baseState(), pg, ['name', 'amount'], body, { returning: true })
    assert.strictEqual(returning.sql, `INSERT INTO "archive" ("name", "amount") SELECT name, total FROM orders WHERE total > $1 RETURNING *`)
  })

  it('builder-backed body compiles its state', () => {
    const inner = baseState({
      table:      'orders',
      selects:    ['name', 'total'],
      conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'total', operator: '>', value: 100 } }],
    })
    const { sql, bindings } = compileInsertUsing(baseState(), sqlite, ['name', 'amount'], { kind: 'state', state: inner })
    assert.strictEqual(sql, `INSERT INTO "archive" ("name", "amount") SELECT "name", "total" FROM "orders" WHERE "total" > ?`)
    assert.deepStrictEqual(bindings, [100])
  })

  it('requires an explicit column list; column names are identifier-validated', () => {
    assert.throws(() => compileInsertUsing(baseState(), sqlite, [], rawBody('SELECT 1')), /explicit target column list/)
    assert.throws(() => compileInsertUsing(baseState(), sqlite, ['bad"col'], rawBody('SELECT 1')), /identifier/i)
  })
})

// ── sqlite E2E — the real engine, adapter-level QB ──

describe('insertUsing (native sqlite E2E)', () => {
  let adapter: NativeAdapter
  const q = <T extends object>(table: string): NativeQueryBuilder<T> =>
    adapter.query<T>(table) as NativeQueryBuilder<T>

  before(async () => {
    adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
    await adapter.affectingStatement('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, total INTEGER)', [])
    await adapter.affectingStatement('CREATE TABLE archive (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, amount INTEGER)', [])
    for (const [name, total] of [['a', 120], ['b', 40], ['c', 300]] as const) {
      await adapter.affectingStatement('INSERT INTO orders (name, total) VALUES (?, ?)', [name, total])
    }
  })
  after(async () => { await adapter.disconnect() })

  it('copies subquery rows and returns the inserted count (builder body)', async () => {
    const inserted = await q('archive').insertUsing(
      ['name', 'amount'],
      q('orders').select('name', 'total').where('total', '>', 100),
    )
    assert.strictEqual(inserted, 2)
    const rows = await q<{ name: string; amount: number }>('archive').orderBy('amount', 'ASC').get()
    assert.deepStrictEqual(rows.map(r => [r.name, r.amount]), [['a', 120], ['c', 300]])
  })

  it('raw-SQL body binds; zero-match subquery inserts nothing', async () => {
    const inserted = await q('archive').insertUsing(
      ['name', 'amount'],
      'SELECT name, total FROM orders WHERE total > ?',
      [1000],
    )
    assert.strictEqual(inserted, 0)
  })

  it('builder body rejects stray bindings', async () => {
    // insertUsing is an async terminal — the guard surfaces as a rejection.
    await assert.rejects(
      q('archive').insertUsing(['name'], q('orders'), [1]),
      /raw-SQL body/,
    )
  })
})
