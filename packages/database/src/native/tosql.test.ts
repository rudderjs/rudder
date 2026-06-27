// toSQL() compiles the current builder state to its { sql, bindings } pair
// WITHOUT executing it — the same SQL get() would run, plus the values bound to
// its placeholders. The executor here throws if touched, proving toSQL() is a
// pure compile step that never reaches the connection.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { compileSelect } from './compiler.js'
import { NativeQueryBuilder } from './query-builder.js'
import { SqliteDialect } from './dialect.js'
import type { Executor, Row } from './driver.js'

const explodingExecutor: Executor = {
  async execute(): Promise<Row[]> {
    throw new Error('toSQL() must not execute the query')
  },
}

const dialect = new SqliteDialect()

function builder(): NativeQueryBuilder<Row> {
  return new NativeQueryBuilder<Row>(explodingExecutor, dialect, 'users', 'id')
}

describe('NativeQueryBuilder.toSQL()', () => {
  it('returns { sql, bindings } without executing', () => {
    const { sql, bindings } = builder().toSQL()
    assert.strictEqual(sql, 'SELECT * FROM "users"')
    assert.deepStrictEqual(bindings, [])
  })

  it('bindings reflect where() and the SQL reflects orderBy()', () => {
    const qb = builder()
    qb.where('role', 'admin').where('age', '>', 18).orderBy('name', 'ASC')
    const { sql, bindings } = qb.toSQL()
    assert.match(sql, /WHERE "role" = \? AND "age" > \?/)
    assert.match(sql, /ORDER BY "name" ASC/)
    assert.deepStrictEqual(bindings, ['admin', 18])
  })

  it('compiles the exact SQL get() would run', () => {
    const qb = builder()
    qb.where('active', true).orderBy('id', 'DESC')
    assert.deepStrictEqual(qb.toSQL(), compileSelect((qb as unknown as { _state(): never })._state(), dialect))
  })
})
