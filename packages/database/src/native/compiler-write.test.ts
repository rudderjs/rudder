import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  compileInsert,
  compileUpdate,
  compileIncrement,
  compileDelete,
  type NativeQueryState,
  type ConditionNode,
} from './compiler.js'
import { SqliteDialect } from './dialect.js'
import { NativeIdentifierError } from './errors.js'
import type { WhereOperator } from '@rudderjs/contracts'

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

function clause(boolean: 'AND' | 'OR', column: string, operator: WhereOperator, value: unknown): ConditionNode {
  return { kind: 'clause', boolean, clause: { column, operator, value } }
}

const pk = (id: number | string): ConditionNode[] => [clause('AND', 'id', '=', id)]

describe('native compiler — INSERT', () => {
  it('single row with RETURNING', () => {
    const { sql, bindings } = compileInsert(baseState(), dialect, [{ name: 'Ada', age: 36 }], { returning: true })
    assert.strictEqual(sql, 'INSERT INTO "users" ("name", "age") VALUES (?, ?) RETURNING *')
    assert.deepStrictEqual(bindings, ['Ada', 36])
  })

  it('single row without RETURNING', () => {
    const { sql } = compileInsert(baseState(), dialect, [{ name: 'Ada' }])
    assert.strictEqual(sql, 'INSERT INTO "users" ("name") VALUES (?)')
  })

  it('drops undefined values but keeps null', () => {
    const { sql, bindings } = compileInsert(baseState(), dialect, [{ name: 'Ada', age: undefined, email: null }])
    assert.strictEqual(sql, 'INSERT INTO "users" ("name", "email") VALUES (?, ?)')
    assert.deepStrictEqual(bindings, ['Ada', null])
  })

  it('multi-row uses the union of columns, binding null for gaps', () => {
    const { sql, bindings } = compileInsert(baseState(), dialect, [
      { name: 'Ada', age: 36 },
      { name: 'Alan' },
    ])
    assert.strictEqual(sql, 'INSERT INTO "users" ("name", "age") VALUES (?, ?), (?, ?)')
    assert.deepStrictEqual(bindings, ['Ada', 36, 'Alan', null])
  })

  it('all-empty row falls back to DEFAULT VALUES', () => {
    const { sql, bindings } = compileInsert(baseState(), dialect, [{}], { returning: true })
    assert.strictEqual(sql, 'INSERT INTO "users" DEFAULT VALUES RETURNING *')
    assert.deepStrictEqual(bindings, [])
  })

  it('throws on no rows', () => {
    assert.throws(() => compileInsert(baseState(), dialect, []), /no rows/)
  })

  // ── upsert (ON CONFLICT) ──────────────────────────────────
  it('sqlite upsert → ON CONFLICT (...) DO UPDATE SET col = excluded.col', () => {
    const { sql, bindings } = compileInsert(
      baseState(), dialect, [{ email: 'a@x.com', name: 'Ada' }],
      { returning: true, upsert: { uniqueBy: ['email'], update: ['name'] } },
    )
    assert.strictEqual(
      sql,
      'INSERT INTO "users" ("email", "name") VALUES (?, ?) ON CONFLICT ("email") DO UPDATE SET "name" = excluded."name" RETURNING *',
    )
    assert.deepStrictEqual(bindings, ['a@x.com', 'Ada'])
  })

  it('empty update set → ON CONFLICT (...) DO NOTHING', () => {
    const { sql } = compileInsert(
      baseState(), dialect, [{ email: 'a@x.com' }],
      { upsert: { uniqueBy: ['email'], update: [] } },
    )
    assert.strictEqual(sql, 'INSERT INTO "users" ("email") VALUES (?) ON CONFLICT ("email") DO NOTHING')
  })

  it('composite uniqueBy quotes every target column', () => {
    const { sql } = compileInsert(
      baseState(), dialect, [{ a: 1, b: 2, c: 3 }],
      { upsert: { uniqueBy: ['a', 'b'], update: ['c'] } },
    )
    assert.strictEqual(
      sql,
      'INSERT INTO "users" ("a", "b", "c") VALUES (?, ?, ?) ON CONFLICT ("a", "b") DO UPDATE SET "c" = excluded."c"',
    )
  })

  it('rejects an invalid column identifier', () => {
    assert.throws(() => compileInsert(baseState(), dialect, [{ 'name); DROP': 1 }]), NativeIdentifierError)
  })
})

describe('native compiler — UPDATE', () => {
  it('by-pk with RETURNING; SET bindings precede WHERE bindings', () => {
    const { sql, bindings } = compileUpdate(baseState(), dialect, { name: 'New', age: 40 }, { extraConditions: pk(5), returning: true })
    assert.strictEqual(sql, 'UPDATE "users" SET "name" = ?, "age" = ? WHERE "id" = ? RETURNING *')
    assert.deepStrictEqual(bindings, ['New', 40, 5])
  })

  it('by-predicate (updateAll) honors the current where', () => {
    const state = baseState({ conditions: [clause('AND', 'isActive', '=', 1)] })
    const { sql, bindings } = compileUpdate(state, dialect, { tier: 'pro' }, { returning: true })
    assert.strictEqual(sql, 'UPDATE "users" SET "tier" = ? WHERE "isActive" = ? RETURNING *')
    assert.deepStrictEqual(bindings, ['pro', 1])
  })

  it('drops undefined columns from SET', () => {
    const { sql, bindings } = compileUpdate(baseState(), dialect, { name: 'New', age: undefined }, { extraConditions: pk(1) })
    assert.strictEqual(sql, 'UPDATE "users" SET "name" = ? WHERE "id" = ?')
    assert.deepStrictEqual(bindings, ['New', 1])
  })

  it('throws when nothing to set', () => {
    assert.throws(() => compileUpdate(baseState(), dialect, { x: undefined }), /no columns to set/)
  })

  it('never interpolates values — payload sits in a binding', () => {
    const evil = "'; DROP TABLE users; --"
    const { sql, bindings } = compileUpdate(baseState(), dialect, { name: evil }, { extraConditions: pk(1) })
    assert.strictEqual(sql, 'UPDATE "users" SET "name" = ? WHERE "id" = ?')
    assert.deepStrictEqual(bindings, [evil, 1])
  })
})

describe('native compiler — json bindings (plain objects/arrays stringify at the funnel)', () => {
  it('INSERT: a plain-object payload value binds as JSON text', () => {
    const meta = { tags: ['a', 'b'], depth: { n: 2 } }
    const { sql, bindings } = compileInsert(baseState(), dialect, [{ name: 'Ada', meta }])
    assert.strictEqual(sql, 'INSERT INTO "users" ("name", "meta") VALUES (?, ?)')
    assert.deepStrictEqual(bindings, ['Ada', JSON.stringify(meta)])
  })

  it('INSERT: an array payload value binds as JSON text', () => {
    const list = [1, 'two', { three: 3 }]
    const { bindings } = compileInsert(baseState(), dialect, [{ meta: list }])
    assert.deepStrictEqual(bindings, [JSON.stringify(list)])
  })

  it('UPDATE: a plain-object SET value binds as JSON text', () => {
    const meta = { theme: 'dark' }
    const { sql, bindings } = compileUpdate(baseState(), dialect, { meta }, { extraConditions: pk(1) })
    assert.strictEqual(sql, 'UPDATE "users" SET "meta" = ? WHERE "id" = ?')
    assert.deepStrictEqual(bindings, [JSON.stringify(meta), 1])
  })

  it('WHERE: a plain-object comparison value binds as JSON text', () => {
    const meta = { a: 1 }
    const state = baseState({ conditions: [clause('AND', 'meta', '=', meta)] })
    const { bindings } = compileUpdate(state, dialect, { name: 'x' })
    assert.deepStrictEqual(bindings, ['x', JSON.stringify(meta)])
  })

  it('a null-prototype object also stringifies', () => {
    const meta = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 })
    const { bindings } = compileInsert(baseState(), dialect, [{ meta }])
    assert.deepStrictEqual(bindings, ['{"a":1}'])
  })

  it('non-plain objects pass through untouched (Date, Buffer, class instances)', () => {
    const date = new Date('2026-01-01T00:00:00.000Z')
    const buf = Buffer.from('blob')
    class NotARecord { x = 1 }
    const inst = new NotARecord()
    const { bindings } = compileInsert(baseState(), dialect, [{ a: date, b: buf, c: inst }])
    assert.strictEqual(bindings[0], date)
    assert.strictEqual(bindings[1], buf)
    assert.strictEqual(bindings[2], inst)
  })

  it('pre-stringified JSON (the json cast path) is not double-encoded', () => {
    const text = JSON.stringify({ a: 1 })
    const { bindings } = compileInsert(baseState(), dialect, [{ meta: text }])
    assert.deepStrictEqual(bindings, [text])
  })
})

describe('native compiler — increment/decrement', () => {
  it('positive delta → col = col + ?', () => {
    const { sql, bindings } = compileIncrement(baseState(), dialect, 'views', 1, {}, { extraConditions: pk(7), returning: true })
    assert.strictEqual(sql, 'UPDATE "users" SET "views" = "views" + ? WHERE "id" = ? RETURNING *')
    assert.deepStrictEqual(bindings, [1, 7])
  })

  it('negative delta (decrement) binds the signed amount', () => {
    const { sql, bindings } = compileIncrement(baseState(), dialect, 'views', -3, {}, { extraConditions: pk(7) })
    assert.strictEqual(sql, 'UPDATE "users" SET "views" = "views" + ? WHERE "id" = ?')
    assert.deepStrictEqual(bindings, [-3, 7])
  })

  it('extra columns are written alongside, after the delta', () => {
    const { sql, bindings } = compileIncrement(baseState(), dialect, 'views', 5, { lastSeen: 'now' }, { extraConditions: pk(7) })
    assert.strictEqual(sql, 'UPDATE "users" SET "views" = "views" + ?, "lastSeen" = ? WHERE "id" = ?')
    assert.deepStrictEqual(bindings, [5, 'now', 7])
  })
})

describe('native compiler — DELETE', () => {
  it('by-pk', () => {
    const { sql, bindings } = compileDelete(baseState(), dialect, { extraConditions: pk(9) })
    assert.strictEqual(sql, 'DELETE FROM "users" WHERE "id" = ?')
    assert.deepStrictEqual(bindings, [9])
  })

  it('by-predicate with RETURNING (deleteAll count)', () => {
    const state = baseState({ conditions: [clause('AND', 'isActive', '=', 0)] })
    const { sql, bindings } = compileDelete(state, dialect, { returning: true })
    assert.strictEqual(sql, 'DELETE FROM "users" WHERE "isActive" = ? RETURNING *')
    assert.deepStrictEqual(bindings, [0])
  })

  it('deleteAll with no predicate deletes everything', () => {
    const { sql, bindings } = compileDelete(baseState(), dialect, { returning: true })
    assert.strictEqual(sql, 'DELETE FROM "users" RETURNING *')
    assert.deepStrictEqual(bindings, [])
  })

  it('rejects an invalid table identifier', () => {
    assert.throws(() => compileDelete(baseState({ table: 'bad table' }), dialect), NativeIdentifierError)
  })
})
