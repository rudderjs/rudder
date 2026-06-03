// whereNot / orWhereNot — negated groups: the callback's conditions compile as
// one parenthesized sub-tree wrapped in `NOT (…)` (Laravel's `whereNot`).
//
// Compiler units pin the SQL text + binding order (including nesting and the
// empty-group no-op); the sqlite E2E proves the path end-to-end through the
// Model layer, including named sugar (`whereIn`) inside the callback via the
// hydrating sub-builder wrap. The guard test proves the proxy throws a clear
// error on an adapter QB without the method.

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { OrmAdapter, QueryBuilder } from '@rudderjs/contracts'
import { compileSelect, type NativeQueryState, type ConditionNode } from './compiler.js'
import { SqliteDialect } from './dialect.js'
import { PgDialect } from './dialect-pg.js'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
import { BetterSqlite3Driver } from './drivers/better-sqlite3.js'
import type { Driver } from './driver.js'

const sqlite = new SqliteDialect()

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

function clause(boolean: 'AND' | 'OR', column: string, operator: '=' | '>' | '<', value: unknown): ConditionNode {
  return { kind: 'clause', boolean, clause: { column, operator, value } }
}

// ── Compiler units ──

describe('whereNot — compilation', () => {
  it('wraps the group in NOT (…)', () => {
    const state = baseState({ conditions: [
      { kind: 'group', boolean: 'AND', negated: true, children: [
        clause('AND', 'role', '=', 'admin'),
        clause('AND', 'active', '=', 1),
      ] },
    ] })
    const { sql, bindings } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE NOT ("role" = ? AND "active" = ?)')
    assert.deepStrictEqual(bindings, ['admin', 1])
  })

  it('OR-roots a negated group after a clause', () => {
    const state = baseState({ conditions: [
      clause('AND', 'name', '=', 'Ada'),
      { kind: 'group', boolean: 'OR', negated: true, children: [clause('AND', 'age', '>', 40)] },
    ] })
    const { sql, bindings } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "name" = ? OR NOT ("age" > ?)')
    assert.deepStrictEqual(bindings, ['Ada', 40])
  })

  it('a non-negated group still compiles without NOT (regression)', () => {
    const state = baseState({ conditions: [
      { kind: 'group', boolean: 'AND', children: [clause('AND', 'age', '>', 40)] },
    ] })
    const { sql } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE ("age" > ?)')
  })

  it('nests — a negated group inside a negated group', () => {
    const state = baseState({ conditions: [
      { kind: 'group', boolean: 'AND', negated: true, children: [
        clause('AND', 'a', '=', 1),
        { kind: 'group', boolean: 'OR', negated: true, children: [clause('AND', 'b', '=', 2)] },
      ] },
    ] })
    const { sql, bindings } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE NOT ("a" = ? OR NOT ("b" = ?))')
    assert.deepStrictEqual(bindings, [1, 2])
  })

  it('an empty negated group contributes nothing (no dangling NOT ())', () => {
    const state = baseState({ conditions: [
      clause('AND', 'name', '=', 'Ada'),
      { kind: 'group', boolean: 'AND', negated: true, children: [] },
    ] })
    const { sql } = compileSelect(state, sqlite)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "name" = ?')
  })

  it('keeps $n positional order across the NOT boundary (pg)', () => {
    const state = baseState({ conditions: [
      clause('AND', 'name', '=', 'Ada'),
      { kind: 'group', boolean: 'AND', negated: true, children: [
        clause('AND', 'age', '>', 30),
        clause('OR', 'age', '<', 20),
      ] },
    ] })
    const { sql, bindings } = compileSelect(state, new PgDialect())
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "name" = $1 AND NOT ("age" > $2 OR "age" < $3)')
    assert.deepStrictEqual(bindings, ['Ada', 30, 20])
  })
})

// ── sqlite E2E — Model layer ──

class Person extends Model {
  static override table = 'people'
  id!: number
  name!: string
  role!: string
  age!: number
}

let driver: Driver

// [name, role, age]
const seed: Array<[string, string, number]> = [
  ['Ada',    'admin',  36],
  ['Alan',   'member', 41],
  ['Grace',  'admin',  52],
  ['Edsger', 'member', 28],
]

describe('whereNot (native sqlite E2E)', () => {
  beforeEach(async () => {
    driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    await driver.execute(
      `CREATE TABLE people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT, age INTEGER)`,
      [],
    )
    ModelRegistry.reset()
    ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver }))
    for (const [name, role, age] of seed) await Person.create({ name, role, age })
  })

  afterEach(async () => { await driver.close() })

  const names = (rows: Person[]): string[] => rows.map(r => r.name).sort()

  it('negates a single condition', async () => {
    const rows = await Person.whereNot(q => { q.where('role', 'admin') }).get()
    assert.deepEqual(names(rows), ['Alan', 'Edsger'])
  })

  it('negates a compound AND group', async () => {
    // NOT (admin AND age > 40) → everyone except Grace
    const rows = await Person.whereNot(q => { q.where('role', 'admin').where('age', '>', 40) }).get()
    assert.deepEqual(names(rows), ['Ada', 'Alan', 'Edsger'])
  })

  it('negates an OR group', async () => {
    // NOT (admin OR age < 30) → member AND age >= 30 → Alan
    const rows = await Person.whereNot(q => { q.where('role', 'admin').orWhere('age', '<', 30) }).get()
    assert.deepEqual(names(rows), ['Alan'])
  })

  it('orWhereNot OR-roots the negated group', async () => {
    // name = Grace OR NOT (admin) → Grace + the members
    const rows = await Person.where('name', 'Grace').orWhereNot(q => { q.where('role', 'admin') }).get()
    assert.deepEqual(names(rows), ['Alan', 'Edsger', 'Grace'])
  })

  it('named sugar composes inside the callback (hydrating sub-builder)', async () => {
    const rows = await Person.whereNot(q => { q.whereIn('role', ['admin']) }).get()
    assert.deepEqual(names(rows), ['Alan', 'Edsger'])
  })

  it('chains with further clauses after the negated group', async () => {
    const rows = await Person.whereNot(q => { q.where('role', 'admin') }).where('age', '>', 30).get()
    assert.deepEqual(names(rows), ['Alan'])
  })

  it('an empty callback is a no-op', async () => {
    const rows = await Person.whereNot(() => { /* nothing */ }).get()
    assert.equal(rows.length, 4)
  })
})

// ── Adapter guard ──

describe('whereNot — unsupported-adapter guard', () => {
  it('throws a clear error when the adapter QB lacks the method', () => {
    const bareQb = {} as QueryBuilder<unknown>
    const adapter = {
      query: () => bareQb,
      connect: async () => {},
      disconnect: async () => {},
    } as unknown as OrmAdapter
    ModelRegistry.reset()
    ModelRegistry.set(adapter)

    class Thing extends Model {
      static override table = 'things'
    }

    assert.throws(
      () => Thing.query().whereNot(q => { q.where('a', 1) }),
      /whereNot\(\) is not supported on this adapter — use whereRaw\(\.\.\.\) or DB\.select\(\.\.\.\)/,
    )
  })
})
