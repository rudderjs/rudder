// groupBy + having — native query-builder/compiler path.
//
// Compiler layer pins the SQL text + binding order (GROUP BY after WHERE, HAVING
// after GROUP BY and before ORDER BY; count() wraps a grouped query to count the
// number of groups). E2E drives the Model API against in-memory better-sqlite3,
// grouping posts per user and filtering the groups with having / havingRaw.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { compileSelect, compileCount, type NativeQueryState, type HavingNode } from './compiler.js'
import { SqliteDialect } from './dialect.js'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
import { BetterSqlite3Driver } from './drivers/better-sqlite3.js'
import type { Driver } from './driver.js'

const dialect = new SqliteDialect()

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

// ─── compiler: SQL text + binding order ────────────────────

describe('native compiler — groupBy / having (SQL text)', () => {
  it('emits GROUP BY after WHERE, quoting each column', () => {
    const state = baseState({
      conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'published', operator: '=', value: 1 } }],
      groupBy: ['userId'],
    })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "posts" WHERE "published" = ? GROUP BY "userId"')
    assert.deepStrictEqual(bindings, [1])
  })

  it('HAVING follows GROUP BY; its value binds after the WHERE', () => {
    const having: HavingNode[] = [{ kind: 'clause', boolean: 'AND', clause: { column: 'total', operator: '>', value: 2 } }]
    const state = baseState({
      conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'published', operator: '=', value: 1 } }],
      groupBy: ['userId'],
      having,
    })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "posts" WHERE "published" = ? GROUP BY "userId" HAVING "total" > ?')
    assert.deepStrictEqual(bindings, [1, 2]) // WHERE binds before HAVING
  })

  it('havingRaw splices verbatim with its own bindings', () => {
    const having: HavingNode[] = [{ kind: 'raw', boolean: 'AND', raw: { sql: 'COUNT(*) > ?', bindings: [3] } }]
    const { sql, bindings } = compileSelect(baseState({ groupBy: ['userId'], having }), dialect)
    assert.strictEqual(sql, 'SELECT * FROM "posts" GROUP BY "userId" HAVING COUNT(*) > ?')
    assert.deepStrictEqual(bindings, [3])
  })

  it('AND/OR connectors join having siblings', () => {
    const having: HavingNode[] = [
      { kind: 'raw',    boolean: 'AND', raw: { sql: 'COUNT(*) > ?', bindings: [1] } },
      { kind: 'clause', boolean: 'OR',  clause: { column: 'userId', operator: '=', value: 5 } },
    ]
    const { sql, bindings } = compileSelect(baseState({ groupBy: ['userId'], having }), dialect)
    assert.strictEqual(sql, 'SELECT * FROM "posts" GROUP BY "userId" HAVING COUNT(*) > ? OR "userId" = ?')
    assert.deepStrictEqual(bindings, [1, 5])
  })

  it('GROUP BY + HAVING land between WHERE and ORDER BY / LIMIT', () => {
    const state = baseState({
      groupBy: ['userId'],
      having: [{ kind: 'raw', boolean: 'AND', raw: { sql: 'COUNT(*) > ?', bindings: [1] } }],
      orders: [{ column: 'userId', direction: 'ASC' }],
      limitN: 10,
    })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "posts" GROUP BY "userId" HAVING COUNT(*) > ? ORDER BY "userId" ASC LIMIT 10')
  })

  it('count() with GROUP BY wraps the grouped query to count groups', () => {
    const state = baseState({
      conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'published', operator: '=', value: 1 } }],
      groupBy: ['userId'],
      having: [{ kind: 'raw', boolean: 'AND', raw: { sql: 'COUNT(*) > ?', bindings: [1] } }],
    })
    const { sql, bindings } = compileCount(state, dialect)
    assert.strictEqual(
      sql,
      'SELECT COUNT(*) AS "count" FROM (SELECT 1 FROM "posts" WHERE "published" = ? GROUP BY "userId" HAVING COUNT(*) > ?) AS "aggregate"',
    )
    assert.deepStrictEqual(bindings, [1, 1])
  })

  it('count() with no GROUP BY stays a plain scalar COUNT(*)', () => {
    const { sql } = compileCount(baseState(), dialect)
    assert.strictEqual(sql, 'SELECT COUNT(*) AS "count" FROM "posts"')
  })
})

// ─── end-to-end against better-sqlite3 ─────────────────────

class Post extends Model {
  static override table = 'posts'
  id!: number
  userId!: number
  published!: number
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, published INTEGER)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
  // user 1 → 3 posts, user 2 → 1 post, user 3 → 2 posts.
  await driver.execute(
    `INSERT INTO posts (userId, published) VALUES (1,1),(1,1),(1,0),(2,1),(3,1),(3,0)`,
    [],
  )
})

afterEach(async () => { await driver.close() })

describe('groupBy / having (native, end-to-end)', () => {
  it('groups with an aggregate projection', async () => {
    const rows = await Post.query()
      .select('userId')
      .selectRaw('COUNT(*) as total')
      .groupBy('userId')
      .orderBy('userId')
      .get()
    const counts = (rows as unknown as Array<{ userId: number; total: number }>).map(r => [r.userId, Number(r.total)])
    assert.deepEqual(counts, [[1, 3], [2, 1], [3, 2]])
  })

  it('havingRaw filters groups by an aggregate', async () => {
    const rows = await Post.query()
      .select('userId')
      .selectRaw('COUNT(*) as total')
      .groupBy('userId')
      .havingRaw('COUNT(*) >= ?', [2])
      .orderBy('userId')
      .get()
    const ids = (rows as unknown as Array<{ userId: number }>).map(r => r.userId)
    assert.deepEqual(ids, [1, 3]) // users with 2+ posts
  })

  it('having on a SELECT alias (SQLite allows it)', async () => {
    const rows = await Post.query()
      .select('userId')
      .selectRaw('COUNT(*) as total')
      .groupBy('userId')
      .having('total', '>', 2)
      .get()
    const ids = (rows as unknown as Array<{ userId: number }>).map(r => r.userId)
    assert.deepEqual(ids, [1]) // only user 1 has > 2
  })

  it('count() returns the number of groups, not rows', async () => {
    const n = await Post.query().groupBy('userId').count()
    assert.equal(n, 3) // three distinct users
  })

  it('count() applies HAVING to the group count', async () => {
    const n = await Post.query().groupBy('userId').havingRaw('COUNT(*) >= ?', [2]).count()
    assert.equal(n, 2) // users 1 and 3
  })

  it('Model.groupBy static starts a grouped chain', async () => {
    const rows = await Post.groupBy('userId').select('userId').selectRaw('COUNT(*) as total').get()
    assert.equal(rows.length, 3)
  })
})
