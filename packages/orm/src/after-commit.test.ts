// afterCommit() — transaction-tree callback queue, unit tests.
//
// A stub adapter whose `transaction()` simply runs the callback (resolve =
// commit, reject = rollback) is enough to exercise the queue semantics: flush
// on outermost commit, drop on rollback, savepoint hand-off/discard, and the
// run-immediately path outside any transaction. Real-engine proof (actual
// BEGIN/SAVEPOINT/ROLLBACK + data visibility from inside the callbacks) lives
// in `native/after-commit.test.ts`.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { ModelRegistry, ConnectionManager, transaction, afterCommit, type QueryBuilder, type OrmAdapter } from './index.js'

function makeQb<T>(overrides: Partial<QueryBuilder<T>> = {}): QueryBuilder<T> {
  const qb: QueryBuilder<T> = {
    where: () => qb,
    orWhere: () => qb,
    selectRaw: () => qb,
    whereRaw: () => qb,
    orWhereRaw: () => qb,
    orderByRaw: () => qb,
    orderBy: () => qb,
    limit: () => qb,
    offset: () => qb,
    with: () => qb,
    withPivot: () => qb,
    first: async () => null,
    find: async () => null,
    get: async () => [],
    all: async () => [],
    count: async () => 0,
    create: async (data) => data as T,
    update: async (_id, data) => data as T,
    delete: async () => undefined,
    withTrashed: function() { return qb },
    onlyTrashed: function() { return qb },
    restore: async (_id) => ({} as T),
    forceDelete: async () => undefined,
    increment: async (_id, _col, _amount, _extra) => ({} as T),
    decrement: async (_id, _col, _amount, _extra) => ({} as T),
    insertMany: async () => undefined,
    deleteAll:  async () => 0,
    updateAll:  async () => 0,
    paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
    whereRelationExists: () => qb,
    withAggregate: () => qb,
    _aggregate: async () => 0,
    whereGroup:   () => qb,
    orWhereGroup: () => qb,
    ...overrides,
  }
  return qb
}

/** Stub adapter: `transaction()` runs the callback against itself — resolve = commit, reject = rollback. */
function makeTxAdapter(): OrmAdapter {
  const adapter: OrmAdapter = {
    query: () => makeQb(),
    connect: async () => undefined,
    disconnect: async () => undefined,
    transaction: async <T>(fn: (tx: OrmAdapter) => Promise<T>): Promise<T> => fn(adapter),
  }
  return adapter
}

beforeEach(() => {
  ModelRegistry.reset()
  ModelRegistry.set(makeTxAdapter())
})

describe('afterCommit — outside any transaction', () => {
  it('runs the callback immediately and settles with it', async () => {
    const ran: string[] = []
    await afterCommit(async () => { ran.push('now') })
    assert.deepStrictEqual(ran, ['now'])
  })

  it('propagates a throwing callback', async () => {
    await assert.rejects(afterCommit(() => { throw new Error('boom') }), /boom/)
  })

  it('with an explicit connection that has no open transaction, runs immediately', async () => {
    const ran: string[] = []
    await afterCommit(() => { ran.push('now') }, { connection: 'reporting' })
    assert.deepStrictEqual(ran, ['now'])
  })
})

describe('afterCommit — single transaction', () => {
  it('queues during the transaction and flushes in order after commit', async () => {
    const log: string[] = []
    await transaction(async () => {
      await afterCommit(() => { log.push('cb1') })
      await afterCommit(async () => { log.push('cb2') })
      log.push('body')
    })
    log.push('returned')
    assert.deepStrictEqual(log, ['body', 'cb1', 'cb2', 'returned'])
  })

  it('drops the queue on rollback', async () => {
    const ran: string[] = []
    await assert.rejects(
      transaction(async () => {
        await afterCommit(() => { ran.push('cb') })
        throw new Error('rollback')
      }),
      /rollback/,
    )
    assert.deepStrictEqual(ran, [])
  })

  it('a throwing callback propagates to the transaction() caller and skips the rest', async () => {
    const ran: string[] = []
    await assert.rejects(
      transaction(async () => {
        await afterCommit(() => { ran.push('cb1'); throw new Error('cb-boom') })
        await afterCommit(() => { ran.push('cb2') })
      }),
      /cb-boom/,
    )
    assert.deepStrictEqual(ran, ['cb1'])
  })

  it('an afterCommit issued FROM a flushing callback runs immediately (tree already drained)', async () => {
    const log: string[] = []
    await transaction(async () => {
      await afterCommit(async () => {
        log.push('outer-cb')
        await afterCommit(() => { log.push('inner-cb') })
      })
    })
    assert.deepStrictEqual(log, ['outer-cb', 'inner-cb'])
  })

  it('does not leak the queue across sequential transactions', async () => {
    const ran: string[] = []
    await assert.rejects(transaction(async () => {
      await afterCommit(() => { ran.push('dropped') })
      throw new Error('rollback')
    }))
    await transaction(async () => {
      await afterCommit(() => { ran.push('kept') })
    })
    assert.deepStrictEqual(ran, ['kept'])
  })
})

describe('afterCommit — nested transactions (savepoints)', () => {
  it('callbacks queued in a nested transaction run only at the OUTERMOST commit', async () => {
    const log: string[] = []
    await transaction(async () => {
      await transaction(async () => {
        await afterCommit(() => { log.push('inner-cb') })
      })
      // The savepoint released, but nothing may run until the outer commits.
      log.push('after-inner')
    })
    assert.deepStrictEqual(log, ['after-inner', 'inner-cb'])
  })

  it('a rolled-back savepoint discards ITS callbacks; the outer ones still flush', async () => {
    const log: string[] = []
    await transaction(async () => {
      await afterCommit(() => { log.push('outer-cb') })
      await transaction(async () => {
        await afterCommit(() => { log.push('inner-cb') })
        throw new Error('savepoint-rollback')
      }).catch(() => { log.push('caught') })
    })
    assert.deepStrictEqual(log, ['caught', 'outer-cb'])
  })

  it('a released savepoint hands its callbacks to the parent — a LATER sibling rollback cannot discard them', async () => {
    const log: string[] = []
    await transaction(async () => {
      await transaction(async () => {
        await afterCommit(() => { log.push('sp1-cb') })
      })
      await transaction(async () => {
        await afterCommit(() => { log.push('sp2-cb') })
        throw new Error('sp2-rollback')
      }).catch(() => {})
    })
    assert.deepStrictEqual(log, ['sp1-cb'])
  })

  it('outermost rollback drops everything queued at every level', async () => {
    const ran: string[] = []
    await assert.rejects(
      transaction(async () => {
        await afterCommit(() => { ran.push('outer') })
        await transaction(async () => {
          await afterCommit(() => { ran.push('inner') })
        })
        throw new Error('outer-rollback')
      }),
    )
    assert.deepStrictEqual(ran, [])
  })

  it('three levels deep: double hand-off still flushes at the outermost commit only', async () => {
    const log: string[] = []
    await transaction(async () => {
      await transaction(async () => {
        await transaction(async () => {
          await afterCommit(() => { log.push('deep-cb') })
        })
      })
      log.push('body-end')
    })
    assert.deepStrictEqual(log, ['body-end', 'deep-cb'])
  })
})

describe('afterCommit — named connections', () => {
  it('a transaction on a named connection keeps its own queue', async () => {
    ConnectionManager.__reset()
    ConnectionManager.register('reporting', async () => makeTxAdapter())
    const log: string[] = []
    try {
      await transaction(async () => {
        await transaction(async () => {
          // Bare call attaches to the innermost (reporting) tree → flushes
          // when the reporting transaction commits, before the outer default
          // transaction does.
          await afterCommit(() => { log.push('reporting-cb') })
          // Explicit targeting reaches the enclosing default tree instead.
          await afterCommit(() => { log.push('default-cb') }, { connection: '__default__' })
        }, { connection: 'reporting' })
        log.push('reporting-committed')
      })
      assert.deepStrictEqual(log, ['reporting-cb', 'reporting-committed', 'default-cb'])
    } finally {
      ConnectionManager.__reset()
    }
  })
})
