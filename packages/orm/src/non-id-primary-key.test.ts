import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from './index.js'
import type { OrmAdapter, OrmAdapterQueryOpts, QueryBuilder } from '@rudderjs/contracts'

// Capture the opts passed to adapter.query() — `_q()` and `query()` should
// thread `Model.primaryKey` through them. Adapters can then use the value to
// target the right PK column on find / update / delete / increment.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeQb<T>(): QueryBuilder<T> {
  // The QueryBuilder contract is large; cast through `unknown` so the test
  // doesn't have to re-derive every overload.
  const qb = {
    where:        () => qb,
    orWhere:      () => qb,
    orderBy:      () => qb,
    limit:        () => qb,
    offset:       () => qb,
    with:         () => qb,
    withPivot:    () => qb,
    first:        async () => null,
    find:         async () => null,
    get:          async () => [],
    all:          async () => [],
    count:        async () => 0,
    create:       async (data: unknown) => data,
    update:       async (_id: unknown, data: unknown) => data,
    delete:       async () => undefined,
    insertMany:   async () => undefined,
    increment:    async (_id: unknown, _col: unknown, _by: unknown, extra: unknown) => extra,
    decrement:    async (_id: unknown, _col: unknown, _by: unknown, extra: unknown) => extra,
    paginate:     async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 1, from: 0, to: 0 }),
    deleteAll:    async () => 0,
    updateAll:    async () => 0,
    restore:      async (id: unknown) => ({ id }),
    forceDelete:  async () => undefined,
    avg:          async () => null,
    sum:          async () => null,
    min:          async () => null,
    max:          async () => null,
    distinct:     () => qb,
    select:       () => qb,
    selectRaw:    () => qb,
    raw:          async () => [],
    rawFirst:     async () => null,
    _aggregate:   async () => null,
  } as unknown as QueryBuilder<T>
  return qb
}

interface CapturedCall { table: string; opts: OrmAdapterQueryOpts | undefined }

function makeCapturingAdapter(): { adapter: OrmAdapter; calls: CapturedCall[] } {
  const calls: CapturedCall[] = []
  const adapter: OrmAdapter = {
    query: <T>(table: string, opts?: OrmAdapterQueryOpts): QueryBuilder<T> => {
      calls.push({ table, opts })
      return makeQb<T>()
    },
    connect:    async () => undefined,
    disconnect: async () => undefined,
  }
  return { adapter, calls }
}

describe('Model.primaryKey threading through the adapter contract', () => {
  beforeEach(() => ModelRegistry.reset())

  it('Model._q() passes the default primaryKey "id" when not overridden', async () => {
    class DefaultPk extends Model { static override table = 'defaults' }
    const { adapter, calls } = makeCapturingAdapter()
    ModelRegistry.set(adapter)

    await DefaultPk.find(1)

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.table, 'defaults')
    assert.equal(calls[0]?.opts?.primaryKey, 'id')
  })

  it('Model._q() passes the overridden primaryKey through to the adapter', async () => {
    class UuidPk extends Model {
      static override table      = 'uuidThings'
      static override primaryKey = 'uuid'
    }
    const { adapter, calls } = makeCapturingAdapter()
    ModelRegistry.set(adapter)

    await UuidPk.find('x-1')

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.opts?.primaryKey, 'uuid', 'adapter should receive { primaryKey: "uuid" }')
  })

  it('Model.query() also threads the primaryKey (public path)', async () => {
    class CustomPk extends Model {
      static override table      = 'customs'
      static override primaryKey = 'slug'
    }
    const { adapter, calls } = makeCapturingAdapter()
    ModelRegistry.set(adapter)

    await CustomPk.query().where('archived', false).get()

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.opts?.primaryKey, 'slug')
  })

  it('each sibling Model class threads its own primaryKey independently', async () => {
    class A extends Model { static override table = 'a'; static override primaryKey = 'id' }
    class B extends Model { static override table = 'b'; static override primaryKey = 'uuid' }
    const { adapter, calls } = makeCapturingAdapter()
    ModelRegistry.set(adapter)

    await A.find(1)
    await B.find('u-1')

    assert.equal(calls.length, 2)
    assert.equal(calls[0]?.opts?.primaryKey, 'id')
    assert.equal(calls[1]?.opts?.primaryKey, 'uuid')
  })
})
