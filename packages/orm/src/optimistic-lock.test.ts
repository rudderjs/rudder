// Optimistic locking (`static version`) — Model-layer unit tests.
//
// The versioned update path is built entirely on the `where().updateAll()` /
// `increment` contract primitives, so these tests pin the EXACT calls the
// Model layer makes against a stub QueryBuilder: the conditional WHERE pair
// (pk + expected version), the bumped payload, the stale-write throw, and the
// no-baseline atomic-bump fallback. End-to-end engine proof lives in
// `native/optimistic-lock.test.ts` (sqlite) and the orm-drizzle mirror.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, ModelNotFoundError, OptimisticLockError, type QueryBuilder, type OrmAdapter } from './index.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function makeAdapter(qb: QueryBuilder<any> = makeQb()): OrmAdapter {
  return {
    query: () => qb,
    connect: async () => undefined,
    disconnect: async () => undefined,
  }
}

class Doc extends Model {
  static override table = 'docs'
  static override version = true
  id!: number
  title!: string
  version!: number
}

class LedgerRow extends Model {
  static override table = 'ledger_rows'
  static override version = 'lockVersion'
  id!: number
  amount!: number
  lockVersion!: number
}

class Plain extends Model {
  static override table = 'plains'
  id!: number
  title!: string
}

beforeEach(() => ModelRegistry.reset())

// ─── OptimisticLockError shape ────────────────────────────────────────────────

describe('OptimisticLockError', () => {
  it('carries a stable code, model/id/version fields, and httpStatus 409', () => {
    const err = new OptimisticLockError('Doc', 7, 3, 4)
    assert.ok(err instanceof OptimisticLockError)
    assert.ok(err instanceof Error)
    assert.strictEqual(err.name, 'OptimisticLockError')
    assert.strictEqual(err.code, 'OPTIMISTIC_LOCK')
    assert.strictEqual(err.model, 'Doc')
    assert.strictEqual(err.id, 7)
    assert.strictEqual(err.expectedVersion, 3)
    assert.strictEqual(err.actualVersion, 4)
    assert.strictEqual(err.httpStatus, 409)
    assert.match(err.message, /expected version 3/)
    assert.match(err.message, /found 4/)
  })

  it('omits actualVersion when unknown', () => {
    const err = new OptimisticLockError('Doc', 'u-1', 2)
    assert.strictEqual(err.actualVersion, undefined)
    assert.ok(!err.message.includes('found'))
  })
})

// ─── Create path ──────────────────────────────────────────────────────────────

describe('versioned create', () => {
  it('stamps version = 1 when the caller did not set it', async () => {
    let created: Record<string, unknown> | undefined
    ModelRegistry.set(makeAdapter(makeQb({
      create: async (data) => { created = data as Record<string, unknown>; return data as never },
    })))
    await Doc.create({ title: 'a' })
    assert.strictEqual(created?.['version'], 1)
  })

  it('respects a caller-supplied version value', async () => {
    let created: Record<string, unknown> | undefined
    ModelRegistry.set(makeAdapter(makeQb({
      create: async (data) => { created = data as Record<string, unknown>; return data as never },
    })))
    await Doc.create({ title: 'a', version: 9 })
    assert.strictEqual(created?.['version'], 9)
  })

  it('uses the custom column name when `static version` is a string', async () => {
    let created: Record<string, unknown> | undefined
    ModelRegistry.set(makeAdapter(makeQb({
      create: async (data) => { created = data as Record<string, unknown>; return data as never },
    })))
    await LedgerRow.create({ amount: 5 })
    assert.strictEqual(created?.['lockVersion'], 1)
    assert.ok(!('version' in (created ?? {})))
  })

  it('does not stamp anything on unversioned models', async () => {
    let created: Record<string, unknown> | undefined
    ModelRegistry.set(makeAdapter(makeQb({
      create: async (data) => { created = data as Record<string, unknown>; return data as never },
    })))
    await Plain.create({ title: 'a' })
    assert.ok(!('version' in (created ?? {})))
  })
})

// ─── Update path: conditional write ───────────────────────────────────────────

describe('versioned update with a version baseline', () => {
  it('runs WHERE pk + WHERE version and writes expected + 1', async () => {
    const wheres: Array<[unknown, unknown]> = []
    const updateAllPayloads: Array<Record<string, unknown>> = []
    const qb: QueryBuilder<Record<string, unknown>> = makeQb<Record<string, unknown>>({
      where: ((col: string, val: unknown) => { wheres.push([col, val]); return qb }) as QueryBuilder<Record<string, unknown>>['where'],
      updateAll: async (data) => { updateAllPayloads.push(data as Record<string, unknown>); return 1 },
      find: async () => ({ id: 1, title: 'new', version: 4 }),
    })
    ModelRegistry.set(makeAdapter(qb))

    const updated = await Doc.update(1, { title: 'new', version: 3 })

    assert.deepStrictEqual(wheres, [['id', 1], ['version', 3]])
    assert.deepStrictEqual(updateAllPayloads, [{ title: 'new', version: 4 }])
    assert.ok(updated instanceof Doc)
    assert.strictEqual(updated.version, 4)
  })

  it('throws OptimisticLockError when zero rows match and the row still exists', async () => {
    const qb = makeQb<Record<string, unknown>>({
      updateAll: async () => 0,
      find: async () => ({ id: 1, title: 'theirs', version: 5 }),
    })
    ModelRegistry.set(makeAdapter(qb))

    await assert.rejects(
      Doc.update(1, { title: 'mine', version: 3 }),
      (err: unknown) => {
        assert.ok(err instanceof OptimisticLockError)
        assert.strictEqual(err.code, 'OPTIMISTIC_LOCK')
        assert.strictEqual(err.model, 'Doc')
        assert.strictEqual(err.id, 1)
        assert.strictEqual(err.expectedVersion, 3)
        assert.strictEqual(err.actualVersion, 5)
        return true
      },
    )
  })

  it('throws ModelNotFoundError when zero rows match and the row is gone', async () => {
    const qb = makeQb<Record<string, unknown>>({
      updateAll: async () => 0,
      find: async () => null,
    })
    ModelRegistry.set(makeAdapter(qb))
    await assert.rejects(Doc.update(1, { title: 'mine', version: 3 }), ModelNotFoundError)
  })

  it('does not fire updated/saved observers on a stale write', async () => {
    const fired: string[] = []
    Doc.on('updated', () => { fired.push('updated') })
    Doc.on('saved',   () => { fired.push('saved') })
    try {
      const qb = makeQb<Record<string, unknown>>({
        updateAll: async () => 0,
        find: async () => ({ id: 1, version: 9 }),
      })
      ModelRegistry.set(makeAdapter(qb))
      await assert.rejects(Doc.update(1, { title: 'x', version: 3 }), OptimisticLockError)
      assert.deepStrictEqual(fired, [])
    } finally {
      Doc.clearObservers()
    }
  })

  it('rejects a non-integer version value with a clear error', async () => {
    ModelRegistry.set(makeAdapter())
    await assert.rejects(
      Doc.update(1, { title: 'x', version: 'two' as never }),
      /Doc\.version must be an integer/,
    )
  })

  it('carries the version check across a fillable list that omits the column', async () => {
    class Guarded extends Model {
      static override table = 'guardeds'
      static override version = true
      static override fillable = ['title']
      id!: number
      title!: string
      version!: number
    }
    const wheres: Array<[unknown, unknown]> = []
    const updateAllPayloads: Array<Record<string, unknown>> = []
    const qb: QueryBuilder<Record<string, unknown>> = makeQb<Record<string, unknown>>({
      where: ((col: string, val: unknown) => { wheres.push([col, val]); return qb }) as QueryBuilder<Record<string, unknown>>['where'],
      updateAll: async (data) => { updateAllPayloads.push(data as Record<string, unknown>); return 1 },
      find: async () => ({ id: 1, title: 'new', secret: undefined, version: 3 }),
    })
    ModelRegistry.set(makeAdapter(qb))

    await Guarded.update(1, { title: 'new', secret: 'dropped', version: 2 } as never)

    assert.deepStrictEqual(wheres, [['id', 1], ['version', 2]])
    // `secret` dropped by fillable; version carried + bumped.
    assert.deepStrictEqual(updateAllPayloads, [{ title: 'new', version: 3 }])
  })
})

// ─── Update path: no baseline ─────────────────────────────────────────────────

describe('versioned update without a version baseline', () => {
  it('bumps atomically via increment(id, col, 1, rest)', async () => {
    let call: unknown[] | undefined
    const qb = makeQb<Record<string, unknown>>({
      increment: async (id, col, amount, extra) => {
        call = [id, col, amount, extra]
        return { id, title: 'new', version: 8 } as never
      },
    })
    ModelRegistry.set(makeAdapter(qb))

    const updated = await Doc.update(1, { title: 'new' })

    assert.deepStrictEqual(call, [1, 'version', 1, { title: 'new' }])
    assert.strictEqual(updated.version, 8)
  })
})

// ─── Unversioned models keep the plain path ───────────────────────────────────

describe('unversioned update path', () => {
  it('still routes through qb.update(id, data)', async () => {
    let updateCall: unknown[] | undefined
    let updateAllCalled = false
    const qb = makeQb<Record<string, unknown>>({
      update: async (id, data) => { updateCall = [id, data]; return data as never },
      updateAll: async () => { updateAllCalled = true; return 1 },
    })
    ModelRegistry.set(makeAdapter(qb))

    await Plain.update(1, { title: 'x' })

    assert.deepStrictEqual(updateCall, [1, { title: 'x' }])
    assert.strictEqual(updateAllCalled, false)
  })
})

// ─── Instance flows ───────────────────────────────────────────────────────────

describe('instance save() and replicate() on versioned models', () => {
  it('save() carries the hydrated version and merges the bumped row back', async () => {
    const wheres: Array<[unknown, unknown]> = []
    const qb: QueryBuilder<Record<string, unknown>> = makeQb<Record<string, unknown>>({
      where: ((col: string, val: unknown) => { wheres.push([col, val]); return qb }) as QueryBuilder<Record<string, unknown>>['where'],
      updateAll: async () => 1,
      find: async () => ({ id: 1, title: 'renamed', version: 2 }),
    })
    ModelRegistry.set(makeAdapter(qb))

    const doc = Doc.hydrate({ id: 1, title: 'orig', version: 1 })!
    doc.title = 'renamed'
    await doc.save()

    assert.deepStrictEqual(wheres, [['id', 1], ['version', 1]])
    assert.strictEqual(doc.version, 2)
    assert.strictEqual(doc.title, 'renamed')
  })

  it('replicate() drops the version column so the clone starts fresh', () => {
    const doc = Doc.hydrate({ id: 1, title: 'orig', version: 7 })!
    const clone = doc.replicate()
    assert.strictEqual(Object.prototype.hasOwnProperty.call(clone, 'version'), false)
    assert.strictEqual(clone.title, 'orig')
  })
})
