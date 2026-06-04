// joins + structured select() — native query-builder/compiler path.
//
// Two layers:
//   1. Pure compiler assertions on the emitted SQL text + positional binding
//      order (joins sit between FROM and WHERE; a join `where` value binds in
//      that slot, before the WHERE's).
//   2. End-to-end against a real in-memory better-sqlite3 engine, driving the
//      Model API (`User.join(...)`, `User.query().select(...)`, the callback
//      form, left/cross joins).

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { compileSelect, compileCount, type NativeQueryState, type JoinNode } from '@rudderjs/database/native'
import { SqliteDialect } from '@rudderjs/database/native'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from '@rudderjs/database/native'
import { BetterSqlite3Driver } from '@rudderjs/database/native'
import type { Driver } from '@rudderjs/database/native'

const dialect = new SqliteDialect()

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

// ─── compiler: SQL text + binding order ────────────────────

describe('native compiler — joins (SQL text)', () => {
  it('emits an INNER JOIN with a column-vs-column ON, nothing bound', () => {
    const joins: JoinNode[] = [
      { type: 'inner', table: 'posts', conditions: [{ kind: 'on', boolean: 'AND', left: 'posts.userId', operator: '=', right: 'users.id' }] },
    ]
    const { sql, bindings } = compileSelect(baseState({ joins }), dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" INNER JOIN "posts" ON "posts"."userId" = "users"."id"')
    assert.deepStrictEqual(bindings, [])
  })

  it('emits LEFT / RIGHT / CROSS join keywords', () => {
    const mk = (type: JoinNode['type']): string =>
      compileSelect(baseState({ joins: [{ type, table: 'posts', conditions: type === 'cross' ? [] : [{ kind: 'on', boolean: 'AND', left: 'posts.userId', operator: '=', right: 'users.id' }] }] }), dialect).sql

    assert.match(mk('left'),  /LEFT JOIN "posts" ON/)
    assert.match(mk('right'), /RIGHT JOIN "posts" ON/)
    assert.strictEqual(mk('cross'), 'SELECT * FROM "users" CROSS JOIN "posts"')
  })

  it('a join `where` value binds between the SELECT list and the WHERE', () => {
    const joins: JoinNode[] = [
      { type: 'left', table: 'posts', conditions: [
        { kind: 'on',    boolean: 'AND', left: 'posts.userId', operator: '=', right: 'users.id' },
        { kind: 'where', boolean: 'AND', clause: { column: 'posts.published', operator: '=', value: true } },
      ] },
    ]
    const state = baseState({ joins, conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'users.active', operator: '=', value: 1 } }] })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(
      sql,
      'SELECT * FROM "users" LEFT JOIN "posts" ON "posts"."userId" = "users"."id" AND "posts"."published" = ? WHERE "users"."active" = ?',
    )
    // join's value binds first (it precedes WHERE in the text), then the WHERE's.
    assert.deepStrictEqual(bindings, [true, 1])
  })

  it('multiple joins emit in declaration order', () => {
    const joins: JoinNode[] = [
      { type: 'inner', table: 'posts',    conditions: [{ kind: 'on', boolean: 'AND', left: 'posts.userId',    operator: '=', right: 'users.id' }] },
      { type: 'inner', table: 'comments', conditions: [{ kind: 'on', boolean: 'AND', left: 'comments.postId', operator: '=', right: 'posts.id'  }] },
    ]
    const { sql } = compileSelect(baseState({ joins }), dialect)
    assert.match(sql, /INNER JOIN "posts" ON .* INNER JOIN "comments" ON/)
  })

  it('structured select() replaces * and quotes qualified columns', () => {
    const { sql } = compileSelect(baseState({ selects: ['users.id', 'posts.title'] }), dialect)
    assert.strictEqual(sql, 'SELECT "users"."id", "posts"."title" FROM "users"')
  })

  it('select() + selectRaw combine (structured first, then raw)', () => {
    const state = baseState({ selects: ['users.id'], rawSelects: [{ sql: 'COUNT(*) as n', bindings: [] }] })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT "users"."id", COUNT(*) as n FROM "users"')
  })

  it('count() includes the joins', () => {
    const joins: JoinNode[] = [
      { type: 'inner', table: 'posts', conditions: [{ kind: 'on', boolean: 'AND', left: 'posts.userId', operator: '=', right: 'users.id' }] },
    ]
    const { sql } = compileCount(baseState({ joins }), dialect)
    assert.strictEqual(sql, 'SELECT COUNT(*) AS "count" FROM "users" INNER JOIN "posts" ON "posts"."userId" = "users"."id"')
  })

  it('a non-cross join with no ON conditions throws', () => {
    const joins: JoinNode[] = [{ type: 'inner', table: 'posts', conditions: [] }]
    assert.throws(() => compileSelect(baseState({ joins }), dialect), /requires at least one ON condition/)
  })
})

// ─── end-to-end against better-sqlite3 ─────────────────────

class User extends Model {
  static override table = 'users'
  id!: number
  name!: string
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)`, [])
  await driver.execute(`CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER, title TEXT, published INTEGER)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))

  // Ada → 2 posts (1 published), Alan → 1 post (unpublished), Grace → 0 posts.
  await driver.execute(`INSERT INTO users (id, name) VALUES (1,'Ada'),(2,'Alan'),(3,'Grace')`, [])
  await driver.execute(`INSERT INTO posts (userId, title, published) VALUES (1,'A1',1),(1,'A2',0),(2,'B1',0)`, [])
})

afterEach(async () => { await driver.close() })

describe('joins (native, end-to-end)', () => {
  it('INNER JOIN keeps only users with a matching post; select() picks columns', async () => {
    const rows = await User.query()
      .select('users.name', 'posts.title')
      .join('posts', 'posts.userId', '=', 'users.id')
      .get()
    const titles = (rows as unknown as Array<{ title: string }>).map(r => r.title).sort()
    assert.deepEqual(titles, ['A1', 'A2', 'B1'])
  })

  it('two-arg ON form (callback) defaults the operator to =', async () => {
    const rows = await User.query()
      .join('posts', (j) => { j.on('posts.userId', 'users.id') })
      .select('posts.title')
      .get()
    assert.equal(rows.length, 3)
  })

  it('callback form composes ON + a bound where', async () => {
    const rows = await User.query()
      .select('users.name', 'posts.title')
      .join('posts', (j) => { j.on('posts.userId', '=', 'users.id').where('posts.published', 1) })
      .get()
    const titles = (rows as unknown as Array<{ title: string }>).map(r => r.title)
    assert.deepEqual(titles, ['A1'])
  })

  it('LEFT JOIN keeps users with no posts (null related columns)', async () => {
    const rows = await User.query()
      .select('users.name', 'posts.title')
      .leftJoin('posts', 'posts.userId', '=', 'users.id')
      .get()
    const names = (rows as unknown as Array<{ name: string }>).map(r => r.name).sort()
    // Ada×2 + Alan×1 + Grace×1 (null post) = 4 rows; Grace present via the LEFT side.
    assert.equal(rows.length, 4)
    assert.ok(names.includes('Grace'))
  })

  it('count() reflects the join fan-out', async () => {
    const n = await User.query().join('posts', 'posts.userId', '=', 'users.id').count()
    assert.equal(n, 3) // three post rows match
  })

  it('CROSS JOIN produces the Cartesian product', async () => {
    const n = await User.query().crossJoin('posts').count()
    assert.equal(n, 9) // 3 users × 3 posts
  })

  it('Model.select static starts a projection chain', async () => {
    const rows = await User.select('users.id', 'users.name').get()
    assert.equal(rows.length, 3)
  })
})
