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
import { NativeQueryBuilder } from './query-builder.js'
import type { Executor, Row } from './driver.js'

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

describe('native compiler — lock options (SKIP LOCKED / NOWAIT)', () => {
  it('Postgres appends SKIP LOCKED after the lock clause', () => {
    const { sql } = compileSelect(state({ lock: 'update', lockOptions: { skipLocked: true } }), new PgDialect())
    assert.match(sql, /ORDER BY "id" ASC LIMIT 1 FOR UPDATE SKIP LOCKED$/)
  })

  it('Postgres appends NOWAIT', () => {
    const { sql } = compileSelect(state({ lock: 'update', lockOptions: { noWait: true } }), new PgDialect())
    assert.match(sql, /FOR UPDATE NOWAIT$/)
  })

  it('Postgres shared lock takes the options too', () => {
    const { sql } = compileSelect(state({ lock: 'shared', lockOptions: { skipLocked: true } }), new PgDialect())
    assert.match(sql, /FOR SHARE SKIP LOCKED$/)
  })

  it('MySQL appends SKIP LOCKED / NOWAIT', () => {
    assert.match(
      compileSelect(state({ lock: 'update', lockOptions: { skipLocked: true } }), new MysqlDialect()).sql,
      /FOR UPDATE SKIP LOCKED$/,
    )
    assert.match(
      compileSelect(state({ lock: 'shared', lockOptions: { noWait: true } }), new MysqlDialect()).sql,
      /FOR SHARE NOWAIT$/,
    )
  })

  it('SQLite stays a no-op, options included', () => {
    const { sql } = compileSelect(state({ lock: 'update', lockOptions: { skipLocked: true } }), new SqliteDialect())
    assert.doesNotMatch(sql, /FOR UPDATE|SKIP LOCKED|NOWAIT/)
  })

  it('false/empty options leave the plain lock clause byte-identical', () => {
    const plain = compileSelect(state({ lock: 'update' }), new PgDialect()).sql
    const empty = compileSelect(state({ lock: 'update', lockOptions: {} }), new PgDialect()).sql
    const falsy = compileSelect(state({ lock: 'update', lockOptions: { skipLocked: false, noWait: false } }), new PgDialect()).sql
    assert.equal(empty, plain)
    assert.equal(falsy, plain)
  })
})

describe('NativeQueryBuilder — lock options', () => {
  /** Executor that records every compiled SQL string. */
  function recordingExecutor(): { exec: Executor; seen: string[] } {
    const seen: string[] = []
    return {
      seen,
      exec: {
        async execute(sql: string): Promise<Row[]> {
          seen.push(sql)
          return []
        },
      },
    }
  }

  it('threads skipLocked from lockForUpdate() to the emitted SQL', async () => {
    const { exec, seen } = recordingExecutor()
    await new NativeQueryBuilder(exec, new PgDialect(), 'jobs', 'id').lockForUpdate({ skipLocked: true }).get()
    assert.match(seen[0] ?? '', /FOR UPDATE SKIP LOCKED$/)
  })

  it('threads noWait from sharedLock()', async () => {
    const { exec, seen } = recordingExecutor()
    await new NativeQueryBuilder(exec, new MysqlDialect(), 'jobs', 'id').sharedLock({ noWait: true }).get()
    assert.match(seen[0] ?? '', /FOR SHARE NOWAIT$/)
  })

  it('throws when skipLocked and noWait are both set (mutually exclusive)', () => {
    const { exec } = recordingExecutor()
    const qb = new NativeQueryBuilder(exec, new PgDialect(), 'jobs', 'id')
    assert.throws(
      () => qb.lockForUpdate({ skipLocked: true, noWait: true }),
      /lockForUpdate\(\) options skipLocked and noWait are mutually exclusive/,
    )
    assert.throws(
      () => qb.sharedLock({ skipLocked: true, noWait: true }),
      /sharedLock\(\) options skipLocked and noWait are mutually exclusive/,
    )
  })

  it('no-options call emits the plain lock clause (back-compat)', async () => {
    const { exec, seen } = recordingExecutor()
    await new NativeQueryBuilder(exec, new PgDialect(), 'jobs', 'id').lockForUpdate().get()
    assert.match(seen[0] ?? '', /FOR UPDATE$/)
  })
})
