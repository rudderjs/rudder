// union / unionAll — native query-builder/compiler path.
//
// Compiler layer pins the combined SQL text + binding order (members share one
// positional Bindings; the base query's ORDER BY / LIMIT apply to the whole
// result; count() wraps the union to count combined rows). E2E drives the Model
// API against in-memory better-sqlite3.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { compileSelect, compileCount, type NativeQueryState, type ConditionNode } from '@rudderjs/database/native'
import { SqliteDialect } from '@rudderjs/database/native'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
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

function clause(boolean: 'AND' | 'OR', column: string, value: unknown): ConditionNode {
  return { kind: 'clause', boolean, clause: { column, operator: '=', value } }
}

// ─── compiler: SQL text + binding order ────────────────────

describe('native compiler — union (SQL text)', () => {
  it('joins two bodies with UNION, sharing positional bindings', () => {
    const member = baseState({ conditions: [clause('AND', 'role', 'admin')] })
    const state  = baseState({ conditions: [clause('AND', 'active', 1)], unions: [{ all: false, state: member }] })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "active" = ? UNION SELECT * FROM "users" WHERE "role" = ?')
    assert.deepStrictEqual(bindings, [1, 'admin']) // base binds first, then the member
  })

  it('UNION ALL keeps the ALL keyword', () => {
    const state = baseState({ unions: [{ all: true, state: baseState() }] })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" UNION ALL SELECT * FROM "users"')
  })

  it("the base query's ORDER BY / LIMIT apply after the whole union", () => {
    const member = baseState({ conditions: [clause('AND', 'role', 'admin')] })
    const state  = baseState({
      conditions: [clause('AND', 'active', 1)],
      unions: [{ all: false, state: member }],
      orders: [{ column: 'id', direction: 'DESC' }],
      limitN: 5,
    })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(
      sql,
      'SELECT * FROM "users" WHERE "active" = ? UNION SELECT * FROM "users" WHERE "role" = ? ORDER BY "id" DESC LIMIT 5',
    )
  })

  it("a member's own ORDER BY / LIMIT are dropped", () => {
    const member = baseState({ orders: [{ column: 'name', direction: 'ASC' }], limitN: 99 })
    const state  = baseState({ unions: [{ all: false, state: member }] })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" UNION SELECT * FROM "users"')
  })

  it('count() wraps the union to count combined rows', () => {
    const member = baseState({ conditions: [clause('AND', 'role', 'admin')] })
    const state  = baseState({ conditions: [clause('AND', 'active', 1)], unions: [{ all: true, state: member }] })
    const { sql, bindings } = compileCount(state, dialect)
    assert.strictEqual(
      sql,
      'SELECT COUNT(*) AS "count" FROM (SELECT * FROM "users" WHERE "active" = ? UNION ALL SELECT * FROM "users" WHERE "role" = ?) AS "aggregate"',
    )
    assert.deepStrictEqual(bindings, [1, 'admin'])
  })

  it('three-way union chains in order', () => {
    const state = baseState({
      conditions: [clause('AND', 'a', 1)],
      unions: [
        { all: false, state: baseState({ conditions: [clause('AND', 'b', 2)] }) },
        { all: true,  state: baseState({ conditions: [clause('AND', 'c', 3)] }) },
      ],
    })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(
      sql,
      'SELECT * FROM "users" WHERE "a" = ? UNION SELECT * FROM "users" WHERE "b" = ? UNION ALL SELECT * FROM "users" WHERE "c" = ?',
    )
    assert.deepStrictEqual(bindings, [1, 2, 3])
  })
})

// ─── end-to-end against better-sqlite3 ─────────────────────

class User extends Model {
  static override table = 'users'
  id!: number
  name!: string
  role!: string
  active!: number
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT, active INTEGER)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
  await driver.execute(
    `INSERT INTO users (name, role, active) VALUES ('Ada','admin',1),('Alan','user',1),('Grace','admin',0),('Edsger','user',0)`,
    [],
  )
})

afterEach(async () => { await driver.close() })

describe('union / unionAll (native, end-to-end)', () => {
  it('union merges two result sets and de-duplicates', async () => {
    // admins ∪ active users → Ada (both), Alan (active), Grace (admin) — distinct.
    const admins = User.query().where('role', 'admin')
    const rows = await User.query().where('active', 1).union(admins).get()
    const names = (rows as User[]).map(r => r.name).sort()
    assert.deepEqual(names, ['Ada', 'Alan', 'Grace'])
  })

  it('unionAll keeps duplicates', async () => {
    // Ada is both active and admin → appears twice under UNION ALL.
    const admins = User.query().where('role', 'admin')
    const rows = await User.query().where('active', 1).unionAll(admins).get()
    const names = (rows as User[]).map(r => r.name).filter(n => n === 'Ada')
    assert.deepEqual(names, ['Ada', 'Ada'])
  })

  it("the base query's orderBy + limit apply to the whole union", async () => {
    const admins = User.query().where('role', 'admin')
    const rows = await User.query().where('active', 1).union(admins).orderBy('name', 'ASC').limit(2).get()
    const names = (rows as User[]).map(r => r.name)
    assert.deepEqual(names, ['Ada', 'Alan']) // sorted across the union, capped at 2
  })

  it('count() returns the combined row count', async () => {
    const admins = User.query().where('role', 'admin')
    const n = await User.query().where('active', 1).union(admins).count()
    assert.equal(n, 3) // distinct: Ada, Alan, Grace
  })

  it('union rows hydrate as Model instances', async () => {
    const admins = User.query().where('role', 'admin')
    const rows = await User.query().where('active', 1).union(admins).get()
    assert.ok(rows.every(r => r instanceof User))
  })
})
