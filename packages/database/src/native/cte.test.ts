// Common table expressions — `withExpression` / `withRecursiveExpression`.
//
// Compiler units pin the WITH-prefix SQL + the bindings order (CTE bodies bind
// FIRST — the WITH clause precedes the main SELECT in text order), the
// builder-backed vs raw-SQL body forms, the RECURSIVE flag semantics (one
// recursive member marks the whole list), and the compileCount variants. The
// sqlite E2E proves the path end-to-end on the real engine — a CTE referenced
// via join, and a recursive hierarchy walk.

import assert from 'node:assert/strict'
import { describe, it, before, after } from 'node:test'
import { compileSelect, compileCount, type NativeQueryState, type CteNode } from './compiler.js'
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

function rawCte(name: string, sql: string, bindings: unknown[] = [], recursive = false, columns?: string[]): CteNode {
  return { name, recursive, body: { kind: 'raw', raw: { sql, bindings } }, ...(columns ? { columns } : {}) }
}

describe('CTE compilation', () => {
  it('emits a WITH prefix before the main SELECT (raw body)', () => {
    const { sql, bindings } = compileSelect(
      baseState({ ctes: [rawCte('active', 'SELECT id FROM logins WHERE at > ?', ['2026-01-01'])] }),
      sqlite,
    )
    assert.strictEqual(sql, `WITH "active" AS (SELECT id FROM logins WHERE at > ?) SELECT * FROM "users"`)
    assert.deepStrictEqual(bindings, ['2026-01-01'])
  })

  it('CTE bindings come FIRST — before join and WHERE bindings (text order)', () => {
    const { sql, bindings } = compileSelect(
      baseState({
        ctes:       [rawCte('hot', 'SELECT userId FROM posts WHERE views > ?', [100])],
        joins:      [{ type: 'inner', table: 'hot', conditions: [{ kind: 'on', boolean: 'AND', left: 'users.id', operator: '=', right: 'hot.userId' }] }],
        conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'active', operator: '=', value: 1 } }],
      }),
      sqlite,
    )
    assert.strictEqual(
      sql,
      `WITH "hot" AS (SELECT userId FROM posts WHERE views > ?) ` +
        `SELECT * FROM "users" INNER JOIN "hot" ON "users"."id" = "hot"."userId" WHERE "active" = ?`,
    )
    assert.deepStrictEqual(bindings, [100, 1])
  })

  it('multiple CTEs join with commas; one recursive member marks the whole list RECURSIVE', () => {
    const { sql } = compileSelect(
      baseState({
        ctes: [
          rawCte('a', 'SELECT 1'),
          rawCte('tree', 'SELECT id FROM users UNION ALL SELECT u.id FROM users u JOIN tree t ON u.managerId = t.id', [], true, ['id']),
        ],
      }),
      sqlite,
    )
    assert.ok(sql.startsWith(`WITH RECURSIVE "a" AS (SELECT 1), "tree" ("id") AS (`), sql)
  })

  it('builder-backed body compiles its state (WHERE binds inside the CTE) and rebinds on pg', () => {
    const inner = baseState({
      table:      'posts',
      conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'views', operator: '>', value: 100 } }],
    })
    const cte: CteNode = { name: 'hot', recursive: false, body: { kind: 'state', state: inner } }
    const { sql, bindings } = compileSelect(baseState({ ctes: [cte] }), pg)
    assert.strictEqual(sql, `WITH "hot" AS (SELECT * FROM "posts" WHERE "views" > $1) SELECT * FROM "users"`)
    assert.deepStrictEqual(bindings, [100])
  })

  it('compileCount carries the WITH prefix on every variant', () => {
    const ctes = [rawCte('c', 'SELECT ? AS x', [7])]
    // plain
    const plain = compileCount(baseState({ ctes }), sqlite)
    assert.strictEqual(plain.sql, `WITH "c" AS (SELECT ? AS x) SELECT COUNT(*) AS "count" FROM "users"`)
    assert.deepStrictEqual(plain.bindings, [7])
    // grouped (wraps), distinct (wraps) — prefix stays at statement head
    const grouped = compileCount(baseState({ ctes, groupBy: ['role'] }), sqlite)
    assert.ok(grouped.sql.startsWith(`WITH "c" AS (SELECT ? AS x) SELECT COUNT(*) AS "count" FROM (`), grouped.sql)
    const distinct = compileCount(baseState({ ctes, distinct: true }), sqlite)
    assert.ok(distinct.sql.startsWith(`WITH "c" AS (SELECT ? AS x) SELECT COUNT(*) AS "count" FROM (`), distinct.sql)
  })

  it('CTE names are identifier-validated (injection guard)', () => {
    assert.throws(
      () => compileSelect(baseState({ ctes: [rawCte('bad"name', 'SELECT 1')] }), sqlite),
      /identifier/i,
    )
  })
})

// ── sqlite E2E — the real engine, adapter-level QB ──

describe('CTE (native sqlite E2E)', () => {
  let adapter: NativeAdapter

  // adapter.query() is typed as the `QueryBuilder` CONTRACT — the CTE methods
  // are concrete-class surface (HydratingQueryBuilder/Model-layer in apps), so
  // the adapter-level E2E narrows to the implementation class.
  const q = <T extends object>(table: string): NativeQueryBuilder<T> =>
    adapter.query<T>(table) as NativeQueryBuilder<T>

  before(async () => {
    adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
    await adapter.affectingStatement(
      'CREATE TABLE employees (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, managerId INTEGER)', [])
    // alice (1) → bob (2) → carol (3); dave (4) reports to alice directly.
    for (const [name, managerId] of [['alice', null], ['bob', 1], ['carol', 2], ['dave', 1]] as const) {
      await adapter.affectingStatement('INSERT INTO employees (name, managerId) VALUES (?, ?)', [name, managerId])
    }
  })
  after(async () => { await adapter.disconnect() })

  it('plain CTE referenced via join filters the main query', async () => {
    const rows = await q<{ name: string }>('employees')
      .withExpression('managers', 'SELECT DISTINCT managerId AS id FROM employees WHERE managerId IS NOT NULL')
      .join('managers', 'employees.id', '=', 'managers.id')
      .orderBy('name', 'ASC')
      .get()
    assert.deepStrictEqual(rows.map(r => r.name), ['alice', 'bob'])
  })

  it('builder-backed CTE body works (another adapter query as the body)', async () => {
    const body = q('employees').where('managerId', 1)
    const rows = await q<{ name: string }>('employees')
      .withExpression('reports', body)
      .join('reports', 'employees.id', '=', 'reports.id')
      .orderBy('name', 'ASC')
      .get()
    assert.deepStrictEqual(rows.map(r => r.name), ['bob', 'dave'])
  })

  it('recursive CTE walks the hierarchy; count() agrees', async () => {
    const qb = (): NativeQueryBuilder<{ name: string }> =>
      q<{ name: string }>('employees')
        .withRecursiveExpression(
          'subtree',
          'SELECT id FROM employees WHERE id = ? UNION ALL SELECT e.id FROM employees e JOIN subtree s ON e.managerId = s.id',
          { bindings: [1], columns: ['id'] },
        )
        .join('subtree', 'employees.id', '=', 'subtree.id')
    const rows = await qb().orderBy('name', 'ASC').get()
    assert.deepStrictEqual(rows.map(r => r.name), ['alice', 'bob', 'carol', 'dave'])
    assert.strictEqual(await qb().count(), 4)
  })

  it('builder body rejects stray bindings; non-native body rejects', () => {
    const body = q('employees')
    assert.throws(
      () => q('employees').withExpression('x', body, { bindings: [1] }),
      /raw-SQL body/,
    )
    assert.throws(
      () => q('employees').withExpression('x', {} as never),
      /native query builder or a raw SQL string/,
    )
  })
})
