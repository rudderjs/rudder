// Window functions — `selectWindow` (`ROW_NUMBER`/`RANK`/`DENSE_RANK`/
// `PERCENT_RANK`/`CUME_DIST` … OVER).
//
// Compiler units pin the OVER-clause SQL (partition/order combinations, the
// ADDITIVE projection semantics vs select()/selectRaw, identifier quoting,
// per-dialect quoting parity), the builder's runtime injection gates (unknown
// function, bad direction, missing alias), and binding-order neutrality (window
// entries are bind-free — WHERE binds are unaffected). The sqlite E2E proves
// real partitioned numbering on the engine; gated live pg/mysql blocks prove
// the identical SQL executes there too.

import assert from 'node:assert/strict'
import { describe, it, test, before, after } from 'node:test'
import { compileSelect, type NativeQueryState, type WindowSelect } from './compiler.js'
import { SqliteDialect } from './dialect.js'
import { PgDialect } from './dialect-pg.js'
import { MysqlDialect } from './dialect-mysql.js'
import { NativeAdapter } from './adapter.js'
import type { NativeQueryBuilder } from './query-builder.js'

const sqlite = new SqliteDialect()

function baseState(overrides: Partial<NativeQueryState> = {}): NativeQueryState {
  return {
    table:           'posts',
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

function win(overrides: Partial<WindowSelect> = {}): WindowSelect {
  return { fn: 'rowNumber', as: 'rn', partitionBy: [], orderBy: [], ...overrides }
}

describe('window-function compilation', () => {
  it('appends the window to the default * projection (ADDITIVE, not REPLACE)', () => {
    const { sql, bindings } = compileSelect(
      baseState({ windows: [win({ partitionBy: ['userId'], orderBy: [{ column: 'createdAt', direction: 'desc' }] })] }),
      sqlite,
    )
    assert.strictEqual(
      sql,
      `SELECT *, ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC) AS "rn" FROM "posts"`,
    )
    assert.deepStrictEqual(bindings, [])
  })

  it('maps every supported function to its SQL name', () => {
    const fns: Array<[WindowSelect['fn'], string]> = [
      ['rowNumber', 'ROW_NUMBER'], ['rank', 'RANK'], ['denseRank', 'DENSE_RANK'],
      ['percentRank', 'PERCENT_RANK'], ['cumeDist', 'CUME_DIST'],
    ]
    for (const [fn, sqlName] of fns) {
      const { sql } = compileSelect(baseState({ windows: [win({ fn })] }), sqlite)
      assert.ok(sql.includes(`${sqlName}() OVER ()`), `${fn} → ${sqlName}: ${sql}`)
    }
  })

  it('empty OVER () when neither partitionBy nor orderBy is set', () => {
    const { sql } = compileSelect(baseState({ windows: [win()] }), sqlite)
    assert.strictEqual(sql, `SELECT *, ROW_NUMBER() OVER () AS "rn" FROM "posts"`)
  })

  it('multiple partition columns and multiple order entries', () => {
    const { sql } = compileSelect(
      baseState({ windows: [win({
        fn: 'rank', as: 'r',
        partitionBy: ['tenantId', 'userId'],
        orderBy: [{ column: 'score', direction: 'desc' }, { column: 'id', direction: 'asc' }],
      })] }),
      sqlite,
    )
    assert.strictEqual(
      sql,
      `SELECT *, RANK() OVER (PARTITION BY "tenantId", "userId" ORDER BY "score" DESC, "id" ASC) AS "r" FROM "posts"`,
    )
  })

  it('composes AFTER structured select() and selectRaw — and WHERE binds are unaffected', () => {
    const { sql, bindings } = compileSelect(
      baseState({
        selects:    ['id', 'title'],
        rawSelects: [{ sql: 'LENGTH(title) AS len', bindings: [] }],
        windows:    [win({ partitionBy: ['userId'] })],
        conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'published', operator: '=', value: 1 } }],
      }),
      sqlite,
    )
    assert.strictEqual(
      sql,
      `SELECT "id", "title", LENGTH(title) AS len, ROW_NUMBER() OVER (PARTITION BY "userId") AS "rn" FROM "posts" WHERE "published" = ?`,
    )
    assert.deepStrictEqual(bindings, [1])
  })

  it('quotes per dialect — pg double quotes, mysql backticks', () => {
    const state = baseState({ windows: [win({ partitionBy: ['userId'], orderBy: [{ column: 'createdAt', direction: 'desc' }] })] })
    assert.ok(compileSelect(state, new PgDialect()).sql.includes(
      `ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC) AS "rn"`,
    ))
    assert.ok(compileSelect(state, new MysqlDialect()).sql.includes(
      'ROW_NUMBER() OVER (PARTITION BY `userId` ORDER BY `createdAt` DESC) AS `rn`',
    ))
  })
})

// ── sqlite E2E — the real engine, adapter-level QB ──

describe('selectWindow (native sqlite E2E)', () => {
  let adapter: NativeAdapter

  // adapter.query() is typed as the `QueryBuilder` CONTRACT — selectWindow is
  // concrete-class surface (HydratingQueryBuilder/Model-layer in apps), so the
  // adapter-level E2E narrows to the implementation class.
  const q = <T extends object>(table: string): NativeQueryBuilder<T> =>
    adapter.query<T>(table) as NativeQueryBuilder<T>

  before(async () => {
    adapter = await NativeAdapter.make({ driver: 'sqlite', url: ':memory:' })
    await adapter.affectingStatement(`CREATE TABLE posts (id INTEGER PRIMARY KEY, userId INTEGER, title TEXT, views INTEGER)`, [])
    const rows: Array<[number, string, number]> = [
      [1, 'a1', 30], [1, 'a2', 20], [1, 'a3', 10],
      [2, 'b1', 50], [2, 'b2', 40],
    ]
    for (const [userId, title, views] of rows) {
      await adapter.affectingStatement(`INSERT INTO posts (userId, title, views) VALUES (?, ?, ?)`, [userId, title, views])
    }
  })
  after(async () => { await adapter.disconnect() })

  it('numbers rows per partition in order', async () => {
    const rows = await q<{ title: string; rn: number }>('posts')
      .selectWindow('rowNumber', { as: 'rn', partitionBy: 'userId', orderBy: { column: 'views', direction: 'desc' } })
      .orderBy('id', 'ASC')
      .get()
    const byTitle = new Map(rows.map((r) => [r.title, Number(r.rn)]))
    // user 1: a1 (30) → 1, a2 (20) → 2, a3 (10) → 3; user 2: b1 (50) → 1, b2 (40) → 2
    assert.deepStrictEqual(
      ['a1', 'a2', 'a3', 'b1', 'b2'].map((t) => byTitle.get(t)),
      [1, 2, 3, 1, 2],
    )
  })

  it('rows still hydrate with their base columns alongside the alias', async () => {
    const rows = await q<{ id: number; userId: number; title: string; rank: number }>('posts')
      .selectWindow('rank', { as: 'rank', orderBy: { column: 'views', direction: 'desc' } })
      .where('userId', '=', 2)
      .get()
    assert.strictEqual(rows.length, 2)
    for (const r of rows) {
      assert.ok(r.id !== undefined && r.title !== undefined, 'base columns present')
      assert.ok(Number(r.rank) >= 1)
    }
  })

  it('rejects an unknown function, a bad direction, and a missing alias', async () => {
    const builder = q('posts')
    assert.throws(() => builder.selectWindow('evil() --' as never, { as: 'x' }), /unknown window function/)
    assert.throws(
      () => builder.selectWindow('rowNumber', { as: 'x', orderBy: { column: 'id', direction: 'desc; DROP TABLE posts' as never } }),
      /direction must be 'asc' or 'desc'/,
    )
    assert.throws(() => builder.selectWindow('rowNumber', { as: '' }), /non-empty 'as' alias/)
  })
})

// ── live pg (gated) ──

const PG_URL = process.env['PG_TEST_URL']

if (!PG_URL) {
  test('selectWindow live pg (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('selectWindow (live pg)', () => {
    let adapter: NativeAdapter
    const q = <T extends object>(table: string): NativeQueryBuilder<T> =>
      adapter.query<T>(table) as NativeQueryBuilder<T>

    before(async () => {
      adapter = await NativeAdapter.make({ driver: 'pg', url: PG_URL })
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_window_posts`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_window_posts (id SERIAL PRIMARY KEY, "userId" INT, title TEXT, views INT)`, [])
      await adapter.affectingStatement(
        `INSERT INTO rudder_window_posts ("userId", title, views) VALUES (1, 'a1', 30), (1, 'a2', 20), (2, 'b1', 50)`, [])
    })
    after(async () => {
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_window_posts`, [])
      await adapter.disconnect()
    })

    it('partitioned ROW_NUMBER round-trips on pg', async () => {
      const rows = await q<{ title: string; rn: number }>('rudder_window_posts')
        .selectWindow('rowNumber', { as: 'rn', partitionBy: 'userId', orderBy: { column: 'views', direction: 'desc' } })
        .get()
      const byTitle = new Map(rows.map((r) => [r.title, Number(r.rn)]))
      assert.deepStrictEqual([byTitle.get('a1'), byTitle.get('a2'), byTitle.get('b1')], [1, 2, 1])
    })
  })
}

// ── live mysql (gated) ──

const MYSQL_URL = process.env['MYSQL_TEST_URL']

if (!MYSQL_URL) {
  test('selectWindow live mysql (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('selectWindow (live mysql)', () => {
    let adapter: NativeAdapter
    const q = <T extends object>(table: string): NativeQueryBuilder<T> =>
      adapter.query<T>(table) as NativeQueryBuilder<T>

    before(async () => {
      adapter = await NativeAdapter.make({ driver: 'mysql', url: MYSQL_URL })
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_window_posts`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_window_posts (id INT AUTO_INCREMENT PRIMARY KEY, userId INT, title TEXT, views INT)`, [])
      await adapter.affectingStatement(
        `INSERT INTO rudder_window_posts (userId, title, views) VALUES (1, 'a1', 30), (1, 'a2', 20), (2, 'b1', 50)`, [])
    })
    after(async () => {
      await adapter.affectingStatement(`DROP TABLE IF EXISTS rudder_window_posts`, [])
      await adapter.disconnect()
    })

    it('partitioned ROW_NUMBER round-trips on mysql 8', async () => {
      const rows = await q<{ title: string; rn: number }>('rudder_window_posts')
        .selectWindow('rowNumber', { as: 'rn', partitionBy: 'userId', orderBy: { column: 'views', direction: 'desc' } })
        .get()
      const byTitle = new Map(rows.map((r) => [r.title, Number(r.rn)]))
      assert.deepStrictEqual([byTitle.get('a1'), byTitle.get('a2'), byTitle.get('b1')], [1, 2, 1])
    })
  })
}
