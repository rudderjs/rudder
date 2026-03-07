import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, type QueryBuilder, type OrmAdapter } from './index.js'

describe('ORM contract baseline', () => {
  beforeEach(() => {
    ;(ModelRegistry as unknown as { adapter: OrmAdapter | null }).adapter = null
  })

  it('ModelRegistry.set/get/getAdapter stores and returns adapter', () => {
    const adapter = {
      query: () => ({}) as QueryBuilder<unknown>,
      connect: async () => undefined,
      disconnect: async () => undefined,
    } as OrmAdapter

    ModelRegistry.set(adapter)

    assert.strictEqual(ModelRegistry.get(), adapter)
    assert.strictEqual(ModelRegistry.getAdapter(), adapter)
  })

  it('ModelRegistry.getAdapter() throws when no adapter is registered', () => {
    assert.throws(() => ModelRegistry.getAdapter(), /No ORM adapter registered/)
  })

  it('Model.getTable() uses custom table or inferred pluralized name', () => {
    class User extends Model {}
    class BlogPost extends Model { static override table = 'blog_posts' }

    assert.strictEqual(User.getTable(), 'users')
    assert.strictEqual(BlogPost.getTable(), 'blog_posts')
  })

  it('Model.query() returns a QueryBuilder contract-shaped object', () => {
    const qb: QueryBuilder<{ id: number }> = {
      where: () => qb,
      orWhere: () => qb,
      orderBy: () => qb,
      limit: () => qb,
      offset: () => qb,
      with: () => qb,
      first: async () => null,
      find: async () => null,
      get: async () => [],
      all: async () => [],
      count: async () => 0,
      create: async (data: Partial<{ id: number }>) => ({ id: 1, ...(data as object) } as { id: number }),
      update: async (id: number | string, data: Partial<{ id: number }>) => ({ id: Number(id), ...(data as object) } as { id: number }),
      delete: async () => undefined,
      paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
    }

    const adapter = {
      query: () => qb,
      connect: async () => undefined,
      disconnect: async () => undefined,
    } as OrmAdapter

    ModelRegistry.set(adapter)
    class Account extends Model {}

    const builder = Account.query()
    for (const method of ['where', 'orWhere', 'orderBy', 'limit', 'offset', 'with', 'first', 'find', 'get', 'all', 'count', 'create', 'update', 'delete', 'paginate']) {
      assert.strictEqual(typeof (builder as unknown as Record<string, unknown>)[method], 'function')
    }
  })

  it('Model.toJSON() excludes hidden fields', () => {
    class User extends Model {
      static override hidden = ['password']
      name = 'Alice'
      password = 'secret'
    }
    const u = new User()
    const json = u.toJSON()
    assert.ok('name' in json)
    assert.ok(!('password' in json))
  })
})
