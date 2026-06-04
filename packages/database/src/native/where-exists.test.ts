// whereExists / whereNotExists / orWhere* — arbitrary [NOT] EXISTS subqueries.
//
// Compiler units pin the EXISTS fragment, the raw-body ? rebinding through the
// shared positional Bindings (subquery binds sit exactly where the predicate
// sits in the WHERE), correlation via qualified whereColumn refs, and
// composition inside groups. The sqlite E2E proves it on the real engine.

import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { compileSelect, type NativeQueryState, type ConditionNode, type SubqueryBody } from './compiler.js'
import { SqliteDialect } from './dialect.js'
import { PgDialect } from './dialect-pg.js'
import { NativeAdapter } from './adapter.js'
import type { NativeQueryBuilder } from './query-builder.js'

const sqlite = new SqliteDialect()
const pg     = new PgDialect()

function baseState(overrides: Partial<NativeQueryState> = {}): NativeQueryState {
  return {
    table:           'users',
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

function existsNode(body: SubqueryBody, negated = false, boolean: 'AND' | 'OR' = 'AND'): ConditionNode {
  return { kind: 'exists', boolean, negated, body }
}

const rawBody = (sql: string, bindings: unknown[] = []): SubqueryBody =>
  ({ kind: 'raw', raw: { sql, bindings } })

describe('whereExists compilation', () => {
  it('raw body emits EXISTS with rebound placeholders in WHERE position', () => {
    const { sql, bindings } = compileSelect(
      baseState({
        conditions: [
          { kind: 'clause', boolean: 'AND', clause: { column: 'active', operator: '=', value: 1 } },
          existsNode(rawBody('SELECT 1 FROM orders WHERE orders.userId = users.id AND total > ?', [50])),
        ],
      }),
      pg,
    )
    assert.strictEqual(
      sql,
      `SELECT * FROM "users" WHERE "active" = $1 AND EXISTS (SELECT 1 FROM orders WHERE orders.userId = users.id AND total > $2)`,
    )
    assert.deepStrictEqual(bindings, [1, 50])
  })

  it('NOT EXISTS + OR-rooted forms', () => {
    const { sql } = compileSelect(
      baseState({
        conditions: [
          { kind: 'clause', boolean: 'AND', clause: { column: 'role', operator: '=', value: 'admin' } },
          existsNode(rawBody('SELECT 1'), true, 'OR'),
        ],
      }),
      sqlite,
    )
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE "role" = ? OR NOT EXISTS (SELECT 1)`)
  })

  it('builder-backed body compiles its state — correlation via qualified whereColumn', () => {
    const inner = baseState({
      table: 'orders',
      conditions: [
        { kind: 'column', boolean: 'AND', left: 'orders.userId', operator: '=', right: 'users.id' },
        { kind: 'clause', boolean: 'AND', clause: { column: 'total', operator: '>', value: 100 } },
      ],
    })
    const { sql, bindings } = compileSelect(
      baseState({ conditions: [existsNode({ kind: 'state', state: inner })] }),
      sqlite,
    )
    assert.strictEqual(
      sql,
      `SELECT * FROM "users" WHERE EXISTS (SELECT * FROM "orders" WHERE "orders"."userId" = "users"."id" AND "total" > ?)`,
    )
    assert.deepStrictEqual(bindings, [100])
  })

  it('composes inside groups (parenthesized sub-trees)', () => {
    const { sql } = compileSelect(
      baseState({
        conditions: [{
          kind: 'group', boolean: 'AND', children: [
            existsNode(rawBody('SELECT 1')),
            { kind: 'clause', boolean: 'OR', clause: { column: 'vip', operator: '=', value: 1 } },
          ],
        }],
      }),
      sqlite,
    )
    assert.strictEqual(sql, `SELECT * FROM "users" WHERE (EXISTS (SELECT 1) OR "vip" = ?)`)
  })
})

// ── sqlite E2E — the real engine, adapter-level QB ──

describe('whereExists (native sqlite E2E)', () => {
  let adapter: NativeAdapter
  const q = <T extends object>(table: string): NativeQueryBuilder<T> =>
    adapter.query<T>(table) as NativeQueryBuilder<T>

  before(async () => {
    adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
    await adapter.affectingStatement('CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)', [])
    await adapter.affectingStatement('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, total INTEGER)', [])
    for (const name of ['alice', 'bob', 'carol']) {
      await adapter.affectingStatement('INSERT INTO users (name) VALUES (?)', [name])
    }
    // alice: 120 + 30; bob: 40; carol: none.
    for (const [userId, total] of [[1, 120], [1, 30], [2, 40]]) {
      await adapter.affectingStatement('INSERT INTO orders (userId, total) VALUES (?, ?)', [userId, total])
    }
  })
  after(async () => { await adapter.disconnect() })

  const names = async (qb: NativeQueryBuilder<{ name: string }>): Promise<string[]> =>
    (await qb.get()).map(r => r.name).sort()

  it('raw-body EXISTS correlates and binds', async () => {
    assert.deepStrictEqual(
      await names(q<{ name: string }>('users')
        .whereExists('SELECT 1 FROM orders WHERE orders.userId = users.id AND total > ?', [50])),
      ['alice'],
    )
  })

  it('builder-backed EXISTS via whereColumn correlation; NOT EXISTS inverts', async () => {
    const hasOrders = (): NativeQueryBuilder<object> =>
      q('orders').whereColumn('orders.userId', '=', 'users.id')
    assert.deepStrictEqual(
      await names(q<{ name: string }>('users').whereExists(hasOrders())),
      ['alice', 'bob'],
    )
    assert.deepStrictEqual(
      await names(q<{ name: string }>('users').whereNotExists(hasOrders())),
      ['carol'],
    )
  })

  it('orWhereExists composes; count() agrees', async () => {
    const big = (): NativeQueryBuilder<object> =>
      q('orders').whereColumn('orders.userId', '=', 'users.id').where('total', '>', 100)
    assert.deepStrictEqual(
      await names(q<{ name: string }>('users').where('name', 'carol').orWhereExists(big())),
      ['alice', 'carol'],
    )
    assert.strictEqual(
      await q('users').where('name', 'carol').orWhereExists(big()).count(),
      2,
    )
  })

  it('builder body rejects stray bindings; non-native body rejects', () => {
    assert.throws(() => q('users').whereExists(q('orders'), [1]), /raw-SQL body/)
    assert.throws(() => q('users').whereExists({} as never), /native query builder or a raw SQL string/)
  })
})
