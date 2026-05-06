import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, pruneModels, type QueryBuilder, type OrmAdapter, type ModelObserver } from './index.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface QbHooks {
  delete?:    (id: number | string) => Promise<void>
  deleteAll?: () => Promise<number>
  get?:       () => Promise<unknown[]>
  count?:     () => Promise<number>
  limit?:     (n: number) => unknown
}

function makeQb<T>(hooks: QbHooks = {}): QueryBuilder<T> {
  const qb: QueryBuilder<T> = {
    where: () => qb,
    orWhere: () => qb,
    orderBy: () => qb,
    limit: (n: number) => { hooks.limit?.(n); return qb },
    offset: () => qb,
    with: () => qb,
    withPivot: () => qb,
    first:  async () => null,
    find:   async () => null,
    get:    async () => (hooks.get ? (await hooks.get()) as T[] : []),
    all:    async () => [],
    count:  async () => (hooks.count ? hooks.count() : 0),
    create: async (data) => data as T,
    update: async (_id, data) => data as T,
    delete: async (id) => { await hooks.delete?.(id) },
    withTrashed: function() { return qb },
    onlyTrashed: function() { return qb },
    restore: async () => ({} as T),
    forceDelete: async () => undefined,
    increment: async () => ({} as T),
    decrement: async () => ({} as T),
    insertMany: async () => undefined,
    deleteAll:  async () => (hooks.deleteAll ? hooks.deleteAll() : 0),
    updateAll:  async () => 0,
    paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
    whereRelationExists: () => qb,
    withAggregate: () => qb,
    _aggregate: async () => 0,
  }
  return qb
}

function makeAdapter(qb: QueryBuilder<unknown>): OrmAdapter {
  return {
    query: <X>() => qb as unknown as QueryBuilder<X>,
    connect: async () => undefined,
    disconnect: async () => undefined,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('pruneModels — discovery', () => {
  beforeEach(() => ModelRegistry.reset())

  it('skips models without a static prunable()', async () => {
    class Plain extends Model { static override table = 'plain' }
    ModelRegistry.set(makeAdapter(makeQb()))
    ModelRegistry.register(Plain as unknown as typeof Model)

    const reports = await pruneModels()
    assert.deepEqual(reports, [])
  })

  it('returns [] when registry is empty (CLI prints "No prunable models")', async () => {
    ModelRegistry.set(makeAdapter(makeQb()))
    const reports = await pruneModels()
    assert.deepEqual(reports, [])
  })

  it('--model filter only prunes named models', async () => {
    let foosDeleted = 0, barsDeleted = 0

    class Foo extends Model {
      static override table = 'foos'
      static prunable() { return this.where('x', 1) }
    }
    class Bar extends Model {
      static override table = 'bars'
      static prunable() { return this.where('x', 1) }
    }

    const fooQb = makeQb({ get: async () => [{ id: 1 }], delete: async () => { foosDeleted++ } })
    const barQb = makeQb({ get: async () => [{ id: 2 }], delete: async () => { barsDeleted++ } })
    ModelRegistry.set({
      query: <X>(table: string) => (table === 'foos' ? fooQb : barQb) as unknown as QueryBuilder<X>,
      connect: async () => undefined, disconnect: async () => undefined,
    })
    ModelRegistry.register(Foo as unknown as typeof Model)
    ModelRegistry.register(Bar as unknown as typeof Model)

    const reports = await pruneModels({ models: ['Foo'] })
    assert.equal(reports.length, 1)
    assert.equal(reports[0]?.model, 'Foo')
    assert.equal(foosDeleted, 1)
    assert.equal(barsDeleted, 0)
  })

  it('--except filter excludes named models', async () => {
    class Foo extends Model {
      static override table = 'foos'
      static prunable() { return this.where('x', 1) }
    }
    class Bar extends Model {
      static override table = 'bars'
      static prunable() { return this.where('x', 1) }
    }
    ModelRegistry.set(makeAdapter(makeQb({ get: async () => [] })))
    ModelRegistry.register(Foo as unknown as typeof Model)
    ModelRegistry.register(Bar as unknown as typeof Model)

    const reports = await pruneModels({ except: ['Foo'] })
    assert.deepEqual(reports.map(r => r.model), ['Bar'])
  })
})

describe('pruneModels — instance mode', () => {
  beforeEach(() => ModelRegistry.reset())

  it('5 rows, chunk=2 → three queries (2+2+1), 5 delete calls, count = 5', async () => {
    let getCalls = 0, deletes = 0
    const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 4 }], [{ id: 5 }]]

    class Doc extends Model {
      static override table = 'docs'
      static prunable() { return this.where('x', 1) }
    }

    const qb = makeQb({
      get: async () => pages[getCalls++] ?? [],
      delete: async () => { deletes++ },
    })
    ModelRegistry.set(makeAdapter(qb))
    ModelRegistry.register(Doc as unknown as typeof Model)

    const [report] = await pruneModels({ chunk: 2 })
    assert.equal(report?.mode, 'instance')
    assert.equal(report?.count, 5)
    assert.equal(getCalls, 3)
    assert.equal(deletes, 5)
  })

  it('static pruning(model) hook fires per row', async () => {
    let pruningCalls = 0, getCalls = 0

    class Doc extends Model {
      static override table = 'docs'
      static prunable() { return this.where('x', 1) }
      static pruning(_m: Model) { pruningCalls++ }
    }

    const qb = makeQb({
      get: async () => getCalls++ === 0 ? [{ id: 1 }, { id: 2 }, { id: 3 }] : [],
      delete: async () => undefined,
    })
    ModelRegistry.set(makeAdapter(qb))
    ModelRegistry.register(Doc as unknown as typeof Model)

    const [report] = await pruneModels({ chunk: 100 })
    assert.equal(pruningCalls, 3)
    assert.equal(report?.count, 3)
  })

  it('pruning() throw skips that row, run continues', async () => {
    let getCalls = 0, deletes = 0
    const errs: string[] = []
    const origErr = console.error
    console.error = (msg: unknown) => { errs.push(String(msg)) }

    class Doc extends Model {
      static override table = 'docs'
      static prunable() { return this.where('x', 1) }
      static pruning(m: Model) {
        if ((m as unknown as { id: number }).id === 2) throw new Error('boom')
      }
    }

    const qb = makeQb({
      get: async () => getCalls++ === 0 ? [{ id: 1 }, { id: 2 }, { id: 3 }] : [],
      delete: async () => { deletes++ },
    })
    ModelRegistry.set(makeAdapter(qb))
    ModelRegistry.register(Doc as unknown as typeof Model)

    try {
      const [report] = await pruneModels({ chunk: 100 })
      assert.equal(report?.count, 2)        // 1 + 3 deleted; 2 skipped
      assert.equal(deletes, 2)
      assert.equal(errs.length, 1)
      assert.match(errs[0]!, /Doc pruning\(\) failed: boom/)
    } finally {
      console.error = origErr
    }
  })

  it('fires deleting/deleted observers on each delete', async () => {
    const events: string[] = []
    let getCalls = 0

    class Doc extends Model {
      static override table = 'docs'
      static prunable() { return this.where('x', 1) }
    }
    Doc.observe(class implements ModelObserver {
      deleting(id: string | number) { events.push(`deleting:${String(id)}`) }
      deleted (id: string | number) { events.push(`deleted:${String(id)}`)  }
    })

    const qb = makeQb({
      get: async () => getCalls++ === 0 ? [{ id: 7 }, { id: 8 }] : [],
      delete: async () => undefined,
    })
    ModelRegistry.set(makeAdapter(qb))
    ModelRegistry.register(Doc as unknown as typeof Model)

    await pruneModels({ chunk: 100 })
    assert.deepEqual(events, ['deleting:7', 'deleted:7', 'deleting:8', 'deleted:8'])
  })
})

describe('pruneModels — mass mode', () => {
  beforeEach(() => ModelRegistry.reset())

  it('uses deleteAll(), never get(); 2500 rows / chunk=1000 → 3 deleteAll calls (1000+1000+500)', async () => {
    let deleteAllCalls = 0, getCalls = 0
    const pages = [1000, 1000, 500]

    class Event extends Model {
      static override table = 'events'
      static override pruneMode = 'mass' as const
      static prunable() { return this.where('x', 1) }
    }

    const qb = makeQb({
      get: async () => { getCalls++; return [] },
      deleteAll: async () => pages[deleteAllCalls++] ?? 0,
    })
    ModelRegistry.set(makeAdapter(qb))
    ModelRegistry.register(Event as unknown as typeof Model)

    const [report] = await pruneModels({ chunk: 1000 })
    assert.equal(report?.mode, 'mass')
    assert.equal(report?.count, 2500)
    assert.equal(deleteAllCalls, 3)
    assert.equal(getCalls, 0)
  })

  it('does NOT fire deleting/deleted observers', async () => {
    const events: string[] = []
    let deleteAllCalls = 0

    class Event extends Model {
      static override table = 'events'
      static override pruneMode = 'mass' as const
      static prunable() { return this.where('x', 1) }
    }
    Event.observe(class implements ModelObserver {
      deleting(id: string | number) { events.push(`deleting:${String(id)}`) }
      deleted (id: string | number) { events.push(`deleted:${String(id)}`)  }
    })

    const qb = makeQb({ deleteAll: async () => deleteAllCalls++ === 0 ? 0 : 0 })
    ModelRegistry.set(makeAdapter(qb))
    ModelRegistry.register(Event as unknown as typeof Model)

    await pruneModels({ chunk: 1000 })
    assert.deepEqual(events, [])
  })
})

describe('pruneModels — pretend', () => {
  beforeEach(() => ModelRegistry.reset())

  it('runs count() only; never delete / deleteAll', async () => {
    let counts = 0, deletes = 0, deleteAlls = 0

    class Doc extends Model {
      static override table = 'docs'
      static prunable() { return this.where('x', 1) }
    }

    const qb = makeQb({
      count: async () => { counts++; return 42 },
      delete: async () => { deletes++ },
      deleteAll: async () => { deleteAlls++; return 0 },
    })
    ModelRegistry.set(makeAdapter(qb))
    ModelRegistry.register(Doc as unknown as typeof Model)

    const [report] = await pruneModels({ pretend: true })
    assert.equal(report?.count, 42)
    assert.equal(counts, 1)
    assert.equal(deletes, 0)
    assert.equal(deleteAlls, 0)
  })
})

describe('pruneModels — chunk option flows through', () => {
  beforeEach(() => ModelRegistry.reset())

  it('passes --chunk into qb.limit()', async () => {
    let lastLimit = -1, getCalls = 0

    class Doc extends Model {
      static override table = 'docs'
      static prunable() { return this.where('x', 1) }
    }

    const qb = makeQb({
      limit: (n) => { lastLimit = n },
      get: async () => getCalls++ === 0 ? [{ id: 1 }] : [],
      delete: async () => undefined,
    })
    ModelRegistry.set(makeAdapter(qb))
    ModelRegistry.register(Doc as unknown as typeof Model)

    await pruneModels({ chunk: 50 })
    assert.equal(lastLimit, 50)
  })
})
