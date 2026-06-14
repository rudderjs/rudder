import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { WhereOperator } from '@rudderjs/contracts'
import { raw } from '@rudderjs/contracts'
import { compileSelect, compileCount, type NativeQueryState, type ConditionNode } from './compiler.js'
import { SqliteDialect, validateIdentifier } from './dialect.js'
import { PgDialect } from './dialect-pg.js'
import { MysqlDialect } from './dialect-mysql.js'
import { NativeIdentifierError } from './errors.js'

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

describe('native compiler — SELECT basics', () => {
  it('compiles SELECT * with no clauses', () => {
    const { sql, bindings } = compileSelect(baseState(), dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users"')
    assert.deepStrictEqual(bindings, [])
  })

  it('quotes the table identifier', () => {
    const { sql } = compileSelect(baseState({ table: 'order_items' }), dialect)
    assert.match(sql, /FROM "order_items"/)
  })

  it('parameterizes a single equality where', () => {
    const state = baseState({ conditions: [clause('AND', 'name', '=', 'Ada')] })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "name" = ?')
    assert.deepStrictEqual(bindings, ['Ada'])
  })

  it('maps every comparison operator', () => {
    for (const [op, expected] of [['>', '>'], ['>=', '>='], ['<', '<'], ['<=', '<='], ['!=', '!='], ['LIKE', 'LIKE'], ['NOT LIKE', 'NOT LIKE']] as const) {
      const state = baseState({ conditions: [clause('AND', 'age', op, 18)] })
      const { sql } = compileSelect(state, dialect)
      assert.strictEqual(sql, `SELECT * FROM "users" WHERE "age" ${expected} ?`)
    }
  })
})

describe('native compiler — IN / NOT IN', () => {
  it('expands IN to a placeholder list', () => {
    const state = baseState({ conditions: [clause('AND', 'id', 'IN', [1, 2, 3])] })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "id" IN (?, ?, ?)')
    assert.deepStrictEqual(bindings, [1, 2, 3])
  })

  it('empty IN compiles to a constant-false predicate', () => {
    const state = baseState({ conditions: [clause('AND', 'id', 'IN', [])] })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE 1 = 0')
    assert.deepStrictEqual(bindings, [])
  })

  it('empty NOT IN compiles to a constant-true predicate', () => {
    const state = baseState({ conditions: [clause('AND', 'id', 'NOT IN', [])] })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE 1 = 1')
  })
})

describe('native compiler — null comparisons', () => {
  it('= null becomes IS NULL with no binding', () => {
    const state = baseState({ conditions: [clause('AND', 'deletedAt', '=', null)] })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "deletedAt" IS NULL')
    assert.deepStrictEqual(bindings, [])
  })

  it('!= null becomes IS NOT NULL', () => {
    const state = baseState({ conditions: [clause('AND', 'deletedAt', '!=', null)] })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "deletedAt" IS NOT NULL')
  })
})

describe('native compiler — boolean precedence', () => {
  it('joins flat AND clauses', () => {
    const state = baseState({ conditions: [clause('AND', 'a', '=', 1), clause('AND', 'b', '=', 2)] })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "a" = ? AND "b" = ?')
    assert.deepStrictEqual(bindings, [1, 2])
  })

  it('joins an orWhere with OR', () => {
    const state = baseState({ conditions: [clause('AND', 'a', '=', 1), clause('OR', 'b', '=', 2)] })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "a" = ? OR "b" = ?')
  })

  it('parenthesizes a whereGroup and respects inner OR (Laravel precedence)', () => {
    const group: ConditionNode = {
      kind: 'group',
      boolean: 'AND',
      children: [clause('AND', 'priority', '=', 'high'), clause('OR', 'starred', '=', true)],
    }
    const state = baseState({ conditions: [clause('AND', 'status', '=', 'active'), group] })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "status" = ? AND ("priority" = ? OR "starred" = ?)')
    assert.deepStrictEqual(bindings, ['active', 'high', true])
  })

  it('orWhereGroup joins with OR', () => {
    const group: ConditionNode = {
      kind: 'group',
      boolean: 'OR',
      children: [clause('AND', 'a', '=', 1), clause('AND', 'b', '=', 2)],
    }
    const state = baseState({ conditions: [clause('AND', 'x', '=', 0), group] })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "x" = ? OR ("a" = ? AND "b" = ?)')
  })

  it('drops an empty group entirely', () => {
    const empty: ConditionNode = { kind: 'group', boolean: 'AND', children: [] }
    const state = baseState({ conditions: [clause('AND', 'a', '=', 1), empty] })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "a" = ?')
  })
})

describe('native compiler — ordering, limit, offset', () => {
  it('emits ORDER BY with direction', () => {
    const state = baseState({ orders: [{ column: 'name', direction: 'ASC' }, { column: 'age', direction: 'DESC' }] })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" ORDER BY "name" ASC, "age" DESC')
  })

  it('emits LIMIT and OFFSET', () => {
    const state = baseState({ limitN: 10, offsetN: 20 })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" LIMIT 10 OFFSET 20')
  })

  it('supplies LIMIT -1 when offset is set without a limit', () => {
    const state = baseState({ offsetN: 5 })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" LIMIT -1 OFFSET 5')
  })

  it('the limit override beats state.limitN (first() → 1)', () => {
    const state = baseState({ limitN: 50 })
    const { sql } = compileSelect(state, dialect, { limit: 1 })
    assert.match(sql, /LIMIT 1$/)
  })

  it('rejects a non-integer limit', () => {
    assert.throws(() => compileSelect(baseState(), dialect, { limit: 1.5 }), /non-negative integer/)
  })

  it('offset without a limit is dialect-specific (sqlite/pg/mysql)', () => {
    const state = baseState({ offsetN: 5 })
    // SQLite requires a LIMIT before OFFSET; -1 means unbounded.
    assert.strictEqual(compileSelect(state, new SqliteDialect()).sql, 'SELECT * FROM "users" LIMIT -1 OFFSET 5')
    // Postgres accepts a bare OFFSET (a negative LIMIT would error).
    assert.strictEqual(compileSelect(state, new PgDialect()).sql, 'SELECT * FROM "users" OFFSET 5')
    // MySQL needs a LIMIT before OFFSET and rejects a negative one → max-rows sentinel.
    assert.strictEqual(compileSelect(state, new MysqlDialect()).sql, 'SELECT * FROM `users` LIMIT 18446744073709551615 OFFSET 5')
  })
})

describe('native compiler — IN with raw expressions', () => {
  it('splices raw Expression elements verbatim instead of binding them', () => {
    const state = baseState({ conditions: [clause('AND', 'id', 'IN', [raw('1'), raw('2')])] })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "id" IN (1, 2)')
    assert.deepStrictEqual(bindings, [])
  })

  it('mixes raw expressions and bound values in one IN list', () => {
    const state = baseState({ conditions: [clause('AND', 'id', 'IN', [raw('1'), 2, 3])] })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "id" IN (1, ?, ?)')
    assert.deepStrictEqual(bindings, [2, 3])
  })
})

describe('native compiler — soft deletes', () => {
  it('exclude adds deletedAt IS NULL', () => {
    const state = baseState({ softDelete: 'exclude' })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "deletedAt" IS NULL')
  })

  it('only adds deletedAt IS NOT NULL', () => {
    const state = baseState({ softDelete: 'only' })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "deletedAt" IS NOT NULL')
  })

  it('with omits the soft-delete predicate', () => {
    const state = baseState({ softDelete: 'with' })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users"')
  })

  it('ANDs soft-delete around a top-level OR (parenthesized)', () => {
    const state = baseState({
      softDelete: 'exclude',
      conditions: [clause('AND', 'a', '=', 1), clause('OR', 'b', '=', 2)],
    })
    const { sql } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE ("a" = ? OR "b" = ?) AND "deletedAt" IS NULL')
  })
})

describe('native compiler — find() extra condition', () => {
  it('ANDs the primary-key match outside the user predicate', () => {
    const state = baseState({ conditions: [clause('AND', 'tenantId', '=', 7)] })
    const extra: ConditionNode[] = [clause('AND', 'id', '=', 5)]
    const { sql, bindings } = compileSelect(state, dialect, { limit: 1, extraConditions: extra })
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "tenantId" = ? AND "id" = ? LIMIT 1')
    assert.deepStrictEqual(bindings, [7, 5])
  })

  it('find() with soft-delete composes all three', () => {
    const state = baseState({ softDelete: 'exclude', conditions: [clause('AND', 'tenantId', '=', 7)] })
    const extra: ConditionNode[] = [clause('AND', 'id', '=', 5)]
    const { sql } = compileSelect(state, dialect, { limit: 1, extraConditions: extra })
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "tenantId" = ? AND "deletedAt" IS NULL AND "id" = ? LIMIT 1')
  })
})

describe('native compiler — COUNT', () => {
  it('compiles COUNT(*) with the where predicate', () => {
    const state = baseState({ conditions: [clause('AND', 'active', '=', true)] })
    const { sql, bindings } = compileCount(state, dialect)
    assert.strictEqual(sql, 'SELECT COUNT(*) AS "count" FROM "users" WHERE "active" = ?')
    assert.deepStrictEqual(bindings, [true])
  })
})

describe('native compiler — identifier safety (security gate)', () => {
  it('rejects an identifier with a quote', () => {
    const state = baseState({ conditions: [clause('AND', 'name"; DROP TABLE users; --', '=', 1)] })
    assert.throws(() => compileSelect(state, dialect), NativeIdentifierError)
  })

  it('rejects a table name with a space', () => {
    assert.throws(() => compileSelect(baseState({ table: 'user table' }), dialect), NativeIdentifierError)
  })

  it('rejects an order-by column with a paren', () => {
    const state = baseState({ orders: [{ column: 'count(*)', direction: 'ASC' }] })
    assert.throws(() => compileSelect(state, dialect), NativeIdentifierError)
  })

  it('accepts dotted identifiers, quoting each segment', () => {
    assert.strictEqual(dialect.quoteId('users.name'), '"users"."name"')
  })

  it('validateIdentifier rejects a leading digit', () => {
    assert.throws(() => validateIdentifier('1col'), NativeIdentifierError)
  })

  it('values are never inlined — only bindings carry them', () => {
    const evil = "'; DROP TABLE users; --"
    const state = baseState({ conditions: [clause('AND', 'name', '=', evil)] })
    const { sql, bindings } = compileSelect(state, dialect)
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "name" = ?')
    assert.deepStrictEqual(bindings, [evil]) // the payload sits in a bound param, inert
  })
})
