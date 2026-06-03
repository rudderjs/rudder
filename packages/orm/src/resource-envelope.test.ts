import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, CursorPaginator, JsonResource, ResourceCollection, type QueryBuilder, type OrmAdapter } from './index.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

class User extends Model {
  static override table = 'users'
}

// The stub generic mirrors `make:resource`'s posture — a hydrated Model
// instance doesn't satisfy `Record<string, unknown>`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class UserResource extends JsonResource<any> {
  toArray() {
    return { id: this.resource.id, name: this.resource.name }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
class AsyncResource extends JsonResource<any> {
  async toArray() {
    return { id: this.resource.id }
  }
}

const ROWS = [
  { id: 1, name: 'Ada' },
  { id: 2, name: 'Linus' },
]

/** Minimal adapter — only the paths these tests exercise. */
function makeAdapter(overrides: Partial<QueryBuilder<unknown>>): OrmAdapter {
  const qb = {
    where: () => qb,
    orderBy: () => qb,
    limit: () => qb,
    offset: () => qb,
    get: async () => [],
    first: async () => null,
    ...overrides,
  } as unknown as QueryBuilder<unknown>
  return {
    query: (() => qb) as OrmAdapter['query'],
    connect: async () => undefined,
    disconnect: async () => undefined,
  }
}

// ─── Paginator-aware collection() ─────────────────────────────────────────────

describe('Resource.collection() with paginators', () => {
  beforeEach(() => ModelRegistry.reset())

  it('derives meta from an offset paginator (Model.paginate result)', async () => {
    ModelRegistry.set(makeAdapter({
      paginate: async () => ({ data: [...ROWS], total: 7, perPage: 2, currentPage: 1, lastPage: 4, from: 1, to: 2 }),
    }))
    const page = await User.paginate(1, 2)
    const res = await UserResource.collection(page).toResponse()
    assert.deepEqual(res, {
      data: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }],
      meta: { total: 7, page: 1, perPage: 2, lastPage: 4 },
    })
  })

  it('derives meta from a cursor paginator', async () => {
    const paginator = new CursorPaginator([...ROWS], 2, 'abc123', null, true)
    const res = await UserResource.collection(paginator).toResponse()
    assert.deepEqual(res, {
      data: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }],
      meta: { perPage: 2, nextCursor: 'abc123', prevCursor: null, hasMore: true },
    })
  })

  it('explicit meta merges over (wins against) derived meta', async () => {
    ModelRegistry.set(makeAdapter({
      paginate: async () => ({ data: [...ROWS], total: 7, perPage: 2, currentPage: 1, lastPage: 4, from: 1, to: 2 }),
    }))
    const page = await User.paginate(1, 2)
    const res = await UserResource.collection(page, { page: 99, custom: 'x' }).toResponse()
    assert.deepEqual(res.meta, { total: 7, page: 99, perPage: 2, lastPage: 4, custom: 'x' })
  })

  it('plain-array path is unchanged (regression)', async () => {
    const bare = await UserResource.collection(ROWS).toResponse()
    assert.deepEqual(bare, { data: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }] })

    const withMeta = await UserResource.collection(ROWS, { total: 100 }).toResponse()
    assert.deepEqual(withMeta, { data: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }], meta: { total: 100 } })
  })
})

// ─── additional() ─────────────────────────────────────────────────────────────

describe('additional()', () => {
  it('lands top-level on a collection envelope, alongside data/meta', async () => {
    const res = await UserResource.collection(ROWS, { total: 2 })
      .additional({ status: 'ok' })
      .toResponse()
    assert.deepEqual(res, {
      status: 'ok',
      data: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }],
      meta: { total: 2 },
    })
  })

  it('returns this — chainable, and successive calls merge', async () => {
    const collection = UserResource.collection(ROWS)
    assert.equal(collection.additional({ a: 1 }), collection)
    const res = await collection.additional({ b: 2 }).toResponse()
    assert.equal(res['a'], 1)
    assert.equal(res['b'], 2)
  })

  it('cannot clobber the data/meta keys (envelope wins)', async () => {
    const res = await UserResource.collection(ROWS, { total: 2 })
      .additional({ data: 'nope', meta: 'nope' })
      .toResponse()
    assert.deepEqual(res.data, [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }])
    assert.deepEqual(res.meta, { total: 2 })
  })

  it('lands top-level on a single-resource envelope', async () => {
    const res = await new UserResource(ROWS[0]).additional({ status: 'ok' }).toResponse()
    assert.deepEqual(res, { status: 'ok', data: { id: 1, name: 'Ada' } })
  })
})

// ─── JsonResource.toResponse() ────────────────────────────────────────────────

describe('JsonResource.toResponse()', () => {
  it('wraps toArray() in a data envelope', async () => {
    const res = await new UserResource(ROWS[0]).toResponse()
    assert.deepEqual(res, { data: { id: 1, name: 'Ada' } })
  })

  it('is async-safe — works where toJSON() throws', async () => {
    const resource = new AsyncResource({ id: 5 })
    assert.throws(() => resource.toJSON(), /does not support an async toArray/)
    assert.deepEqual(await resource.toResponse(), { data: { id: 5 } })
  })
})

// ─── ResourceCollection.of (regression) ───────────────────────────────────────

describe('ResourceCollection.of', () => {
  it('still composes manually built resources', async () => {
    const collection = ResourceCollection.of(ROWS.map(r => new UserResource(r)), { total: 2 })
    assert.deepEqual(await collection.toResponse(), {
      data: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Linus' }],
      meta: { total: 2 },
    })
  })
})
