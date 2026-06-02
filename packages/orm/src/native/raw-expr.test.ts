// Raw-expression support for the native engine.
//
// Two layers:
//  1. Compiler unit tests — raw WHERE / ORDER BY / SELECT fragments + `?`→
//     dialect-placeholder rebinding (sqlite `?`, pg `$n`) + Expression-as-value.
//  2. End-to-end through the Model surface against a real better-sqlite3 DB —
//     selectRaw / whereRaw / orWhereRaw / orderByRaw + orderBy(raw(...)).
//
// Gated pg round-trip at the bottom (PG_TEST_URL) exercises `$n` rebinding live.

import { describe, it, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { raw } from '@rudderjs/contracts'
import { compileSelect, type NativeQueryState, type ConditionNode } from './compiler.js'
import { SqliteDialect } from './dialect.js'
import { PgDialect } from './dialect-pg.js'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
import { BetterSqlite3Driver } from './drivers/better-sqlite3.js'
import { PostgresDriver } from './drivers/postgres.js'
import type { Driver } from './driver.js'

const sqlite = new SqliteDialect()
const pg = new PgDialect()

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

function rawNode(boolean: 'AND' | 'OR', sql: string, bindings: readonly unknown[] = []): ConditionNode {
  return { kind: 'raw', boolean, raw: { sql, bindings } }
}

describe('native compiler — whereRaw', () => {
  it('splices a raw fragment verbatim and rebinds its placeholder', () => {
    const state = baseState({ conditions: [rawNode('AND', 'age > ?', [18])] })
    const { sql, bindings } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE age > ?')
    assert.deepStrictEqual(bindings, [18])
  })

  it('rebinds multiple placeholders left-to-right', () => {
    const state = baseState({ conditions: [rawNode('AND', 'age between ? and ?', [18, 65])] })
    const { sql, bindings } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE age between ? and ?')
    assert.deepStrictEqual(bindings, [18, 65])
  })

  it('on Postgres rewrites ? to $n keeping positional order', () => {
    const state = baseState({
      conditions: [
        { kind: 'clause', boolean: 'AND', clause: { column: 'name', operator: '=', value: 'Ada' } },
        rawNode('AND', 'age > ? and score < ?', [18, 100]),
      ],
    })
    const { sql, bindings } = compileSelect(state, pg)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "name" = $1 AND age > $2 and score < $3')
    assert.deepStrictEqual(bindings, ['Ada', 18, 100])
  })

  it('orWhereRaw joins with OR', () => {
    const state = baseState({
      conditions: [
        { kind: 'clause', boolean: 'AND', clause: { column: 'active', operator: '=', value: true } },
        rawNode('OR', 'age > ?', [65]),
      ],
    })
    const { sql, bindings } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "active" = ? OR age > ?')
    assert.deepStrictEqual(bindings, [true, 65])
  })

  it('throws when binding count does not match ? placeholders', () => {
    const state = baseState({ conditions: [rawNode('AND', 'age > ? and x < ?', [18])] })
    assert.throws(() => compileSelect(state, sqlite), /expects 2 binding\(s\).*but got 1/)
  })
})

describe('native compiler — orderByRaw', () => {
  it('splices a raw order fragment verbatim', () => {
    const state = baseState({ orders: [{ kind: 'raw', raw: { sql: 'age desc nulls last', bindings: [] } }] })
    const { sql } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT * FROM "users" ORDER BY age desc nulls last')
  })

  it('preserves interleaved structured + raw order, binding after WHERE', () => {
    const state = baseState({
      conditions: [rawNode('AND', 'age > ?', [18])],
      orders: [
        { column: 'name', direction: 'ASC' },
        { kind: 'raw', raw: { sql: 'field(status, ?, ?)', bindings: ['urgent', 'high'] } },
      ],
    })
    const { sql, bindings } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE age > ? ORDER BY "name" ASC, field(status, ?, ?)')
    assert.deepStrictEqual(bindings, [18, 'urgent', 'high'])
  })
})

describe('native compiler — selectRaw', () => {
  it('replaces the default * projection', () => {
    const state = baseState({ rawSelects: [{ sql: 'count(*) as total', bindings: [] }] })
    const { sql } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT count(*) as total FROM "users"')
  })

  it('binds select fragment placeholders BEFORE where placeholders', () => {
    const state = baseState({
      rawSelects: [{ sql: 'age * ? as weighted', bindings: [2] }],
      conditions: [rawNode('AND', 'age > ?', [18])],
    })
    const { sql, bindings } = compileSelect(state, pg)
    assert.strictEqual(sql, 'SELECT age * $1 as weighted FROM "users" WHERE age > $2')
    assert.deepStrictEqual(bindings, [2, 18])
  })
})

describe('native compiler — raw Expression as a where value / order column', () => {
  it('splices DB.raw() in a where value without binding', () => {
    const state = baseState({
      conditions: [{ kind: 'clause', boolean: 'AND', clause: { column: 'createdAt', operator: '>', value: raw('NOW()') } }],
    })
    const { sql, bindings } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "createdAt" > NOW()')
    assert.deepStrictEqual(bindings, [])
  })
})

// ── End-to-end through the Model surface (real better-sqlite3) ──

class User extends Model {
  static override table = 'users'
  static override casts = { isActive: 'boolean' } as const
  id!: number
  name!: string
  age!: number
  isActive!: boolean
}

let driver: Driver

before(async () => {
  driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
  await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER, isActive INTEGER)`, [])
  const rows: Array<[number, string, number, number]> = [
    [1, 'Ada', 36, 1], [2, 'Alan', 41, 1], [3, 'Grace', 52, 0], [4, 'Edsger', 29, 1],
  ]
  for (const r of rows) await driver.execute(`INSERT INTO users (id, name, age, isActive) VALUES (?, ?, ?, ?)`, r)
})

after(async () => { await driver.close() })

beforeEach(async () => {
  ModelRegistry.reset()
  ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
})

describe('native raw expressions (sqlite E2E)', () => {
  it('whereRaw filters with a bound value', async () => {
    const rows = await User.query().whereRaw('age > ?', [40]).orderBy('id').get()
    assert.deepStrictEqual(rows.map(u => u.name), ['Alan', 'Grace'])
  })

  it('whereRaw + orWhereRaw compose', async () => {
    const rows = await User.query().whereRaw('age < ?', [30]).orWhereRaw('age > ?', [50]).orderBy('id').get()
    assert.deepStrictEqual(rows.map(u => u.name), ['Grace', 'Edsger'])
  })

  it('orderByRaw orders the result set', async () => {
    const rows = await User.query().orderByRaw('age desc').get()
    assert.deepStrictEqual(rows.map(u => u.name), ['Grace', 'Alan', 'Ada', 'Edsger'])
  })

  it('orderBy(raw(...)) orders verbatim', async () => {
    const rows = await User.query().orderBy(raw('age asc')).get()
    assert.deepStrictEqual(rows.map(u => u.age), [29, 36, 41, 52])
  })

  it('selectRaw projects a computed column', async () => {
    const rows = await User.query().selectRaw('name, age * 2 as doubled').orderBy('id').get()
    assert.strictEqual((rows[0] as unknown as { doubled: number }).doubled, 72)
  })
})

// ── Live Postgres round-trip ($n placeholder rebinding) ──

const PG_URL = process.env['PG_TEST_URL']

if (!PG_URL) {
  test('native raw-expr pg round-trip (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('native raw expressions (live pg)', () => {
    class PgUser extends Model {
      static override table = 'rudder_raw_expr_users'
      id!: number
      name!: string
      age!: number
    }
    let pgDriver: PostgresDriver

    before(async () => {
      pgDriver = await PostgresDriver.open({ url: PG_URL })
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_raw_expr_users`, [])
      await pgDriver.execute(`CREATE TABLE rudder_raw_expr_users (id SERIAL PRIMARY KEY, name TEXT, age INT)`, [])
      for (const [n, a] of [['Ada', 36], ['Alan', 41], ['Grace', 52]] as const) {
        await pgDriver.execute(`INSERT INTO rudder_raw_expr_users (name, age) VALUES ($1, $2)`, [n, a])
      }
    })
    after(async () => {
      await pgDriver.execute(`DROP TABLE IF EXISTS rudder_raw_expr_users`, [])
      await pgDriver.close()
    })
    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(await NativeAdapter.make({ driverInstance: pgDriver, dialect: new PgDialect() }))
    })

    it('whereRaw rebinds ? to $n live', async () => {
      const rows = await PgUser.query().where('name', '!=', 'nobody').whereRaw('age > ?', [40]).orderBy('id').get()
      assert.deepStrictEqual(rows.map(u => u.name), ['Alan', 'Grace'])
    })
  })
}
