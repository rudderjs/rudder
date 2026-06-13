// `_idState()` builds the minimal query state for a by-id write
// (update/delete/restore/forceDelete/increment): the row is targeted by PK
// (passed as an extraCondition), so the accumulated where()/soft-delete scope is
// dropped — and so are any whereHas (relationExists) / withAggregate state, which
// have no place in a single-row write. Latent today (id-ops build a fresh QB),
// guarded here so it stays that way.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NativeQueryBuilder } from './query-builder.js'
import { SqliteDialect } from './dialect.js'
import type { Executor, Row } from './driver.js'

const inertExecutor: Executor = {
  async execute(): Promise<Row[]> { return [] },
}

describe('NativeQueryBuilder._idState()', () => {
  it('drops relationExists and aggregates from the by-id write state', () => {
    const qb = new NativeQueryBuilder(inertExecutor, new SqliteDialect(), 'users', 'id')
    qb.whereRelationExists({ relatedTable: 'posts' } as never)
    qb.withAggregate([{ fn: 'count', alias: 'postsCount' } as never])

    const idState = (qb as unknown as { _idState(): Record<string, unknown> })._idState()

    assert.strictEqual('relationExists' in idState, false, 'relationExists must not leak into a by-id write')
    assert.strictEqual('aggregates' in idState, false, 'aggregates must not leak into a by-id write')
    // The documented scope-reset still holds.
    assert.deepStrictEqual(idState.conditions, [])
    assert.strictEqual(idState.softDelete, 'with')
    assert.strictEqual(idState.lock, null)
    // Table/primaryKey are preserved.
    assert.strictEqual(idState.table, 'users')
    assert.strictEqual(idState.primaryKey, 'id')
  })
})
