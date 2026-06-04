// Pessimistic-lock clause compilation — lockForUpdate() / sharedLock() emit the
// dialect's FOR UPDATE / FOR SHARE suffix (after ORDER BY / LIMIT), no-op on
// SQLite. This is the primitive behind the native database queue's atomic
// job reservation.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { compileSelect, type NativeQueryState } from './compiler.js'
import { SqliteDialect } from './dialect.js'
import { PgDialect } from './dialect-pg.js'
import { MysqlDialect } from './dialect-mysql.js'

function state(overrides: Partial<NativeQueryState> = {}): NativeQueryState {
  return {
    table:           'jobs',
    primaryKey:      'id',
    conditions:      [],
    orders:          [{ column: 'id', direction: 'ASC' }],
    limitN:          1,
    offsetN:         null,
    softDelete:      'with',
    deletedAtColumn: 'deletedAt',
    ...overrides,
  }
}

describe('native compiler — pessimistic locking', () => {
  it('SQLite emits no lock suffix (write transaction already serializes)', () => {
    const { sql } = compileSelect(state({ lock: 'update' }), new SqliteDialect())
    assert.doesNotMatch(sql, /FOR (UPDATE|SHARE)/)
    assert.match(sql, /ORDER BY "id" ASC LIMIT 1$/)
  })

  it('Postgres appends FOR UPDATE after ORDER BY / LIMIT', () => {
    const { sql } = compileSelect(state({ lock: 'update' }), new PgDialect())
    assert.match(sql, /ORDER BY "id" ASC LIMIT 1 FOR UPDATE$/)
  })

  it('Postgres appends FOR SHARE for a shared lock', () => {
    const { sql } = compileSelect(state({ lock: 'shared' }), new PgDialect())
    assert.match(sql, /FOR SHARE$/)
  })

  it('MySQL appends FOR UPDATE', () => {
    const { sql } = compileSelect(state({ lock: 'update' }), new MysqlDialect())
    assert.match(sql, /FOR UPDATE$/)
  })

  it('no lock clause when lock is unset/null', () => {
    assert.doesNotMatch(compileSelect(state(), new PgDialect()).sql, /FOR (UPDATE|SHARE)/)
    assert.doesNotMatch(compileSelect(state({ lock: null }), new PgDialect()).sql, /FOR (UPDATE|SHARE)/)
  })
})
