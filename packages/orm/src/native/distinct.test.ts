// distinct() — SELECT DISTINCT on the native query builder.
//
// Compiler pins the `SELECT DISTINCT` text + the wrapped distinct count; E2E
// de-duplicates real rows against in-memory better-sqlite3.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { compileSelect, compileCount, type NativeQueryState } from '@rudderjs/database/native'
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

describe('native compiler — distinct (SQL text)', () => {
  it('emits SELECT DISTINCT', () => {
    const { sql } = compileSelect(baseState({ distinct: true }), dialect)
    assert.strictEqual(sql, 'SELECT DISTINCT * FROM "users"')
  })

  it('DISTINCT applies to a structured projection', () => {
    const { sql } = compileSelect(baseState({ distinct: true, selects: ['role'] }), dialect)
    assert.strictEqual(sql, 'SELECT DISTINCT "role" FROM "users"')
  })

  it('no distinct → plain SELECT (unchanged)', () => {
    const { sql } = compileSelect(baseState(), dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users"')
  })

  it('count() wraps the DISTINCT body to count distinct rows', () => {
    const { sql } = compileCount(baseState({ distinct: true, selects: ['role'] }), dialect)
    assert.strictEqual(sql, 'SELECT COUNT(*) AS "count" FROM (SELECT DISTINCT "role" FROM "users") AS "aggregate"')
  })

  it('count() with no distinct stays a plain scalar COUNT(*)', () => {
    const { sql } = compileCount(baseState(), dialect)
    assert.strictEqual(sql, 'SELECT COUNT(*) AS "count" FROM "users"')
  })
})

class User extends Model {
  static override table = 'users'
  id!: number
  name!: string
  role!: string
}

let driver: Driver

beforeEach(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT)`, [])
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
  // roles: admin, admin, user, user, guest → 3 distinct.
  await driver.execute(
    `INSERT INTO users (name, role) VALUES ('Ada','admin'),('Alan','admin'),('Grace','user'),('Edsger','user'),('Linus','guest')`,
    [],
  )
})

afterEach(async () => { await driver.close() })

describe('distinct() (native, end-to-end)', () => {
  it('de-duplicates projected rows', async () => {
    const rows = await User.query().select('role').distinct().orderBy('role').get()
    const roles = (rows as unknown as Array<{ role: string }>).map(r => r.role)
    assert.deepEqual(roles, ['admin', 'guest', 'user'])
  })

  it('distinct().count() counts distinct rows', async () => {
    const n = await User.query().select('role').distinct().count()
    assert.equal(n, 3)
  })

  it('Model.distinct static starts a distinct chain', async () => {
    const rows = await User.distinct().select('role').get()
    assert.equal(rows.length, 3)
  })
})
