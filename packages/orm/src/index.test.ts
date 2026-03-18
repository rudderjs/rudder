import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, type QueryBuilder, type OrmAdapter } from './index.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQb<T>(overrides: Partial<QueryBuilder<T>> = {}): QueryBuilder<T> {
  const qb: QueryBuilder<T> = {
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
    create: async (data) => data as T,
    update: async (_id, data) => data as T,
    delete: async () => undefined,
    paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
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

// ─── ModelRegistry ─────────────────────────────────────────────────────────────

describe('ModelRegistry', () => {
  beforeEach(() => ModelRegistry.reset())

  it('get() returns null before any adapter is registered', () => {
    assert.strictEqual(ModelRegistry.get(), null)
  })

  it('set/get/getAdapter stores and returns the adapter', () => {
    const adapter = makeAdapter()
    ModelRegistry.set(adapter)
    assert.strictEqual(ModelRegistry.get(), adapter)
    assert.strictEqual(ModelRegistry.getAdapter(), adapter)
  })

  it('getAdapter() throws when no adapter is registered', () => {
    assert.throws(() => ModelRegistry.getAdapter(), /No ORM adapter registered/)
  })

  it('getAdapter() error message mentions providers list', () => {
    assert.throws(() => ModelRegistry.getAdapter(), /providers list/)
  })

  it('reset() clears the adapter', () => {
    ModelRegistry.set(makeAdapter())
    assert.notStrictEqual(ModelRegistry.get(), null)
    ModelRegistry.reset()
    assert.strictEqual(ModelRegistry.get(), null)
  })

  it('set() replaces a previously registered adapter', () => {
    const first = makeAdapter()
    const second = makeAdapter()
    ModelRegistry.set(first)
    ModelRegistry.set(second)
    assert.strictEqual(ModelRegistry.get(), second)
  })
})

// ─── Model.getTable() ──────────────────────────────────────────────────────────

describe('Model.getTable()', () => {
  it('infers table as lowercase class name + s', () => {
    class User extends Model {}
    class Post extends Model {}
    class Category extends Model {}

    assert.strictEqual(User.getTable(), 'users')
    assert.strictEqual(Post.getTable(), 'posts')
    assert.strictEqual(Category.getTable(), 'categorys')
  })

  it('uses the static table property when set', () => {
    class BlogPost extends Model {
      static override table = 'blog_posts'
    }
    assert.strictEqual(BlogPost.getTable(), 'blog_posts')
  })

  it('custom table takes precedence over inferred name', () => {
    class Goose extends Model {
      static override table = 'geese'
    }
    assert.strictEqual(Goose.getTable(), 'geese')
  })
})

// ─── Model static methods ──────────────────────────────────────────────────────

describe('Model static methods', () => {
  beforeEach(() => ModelRegistry.reset())

  it('query() calls adapter.query with the correct table name', () => {
    const calls: string[] = []
    const adapter: OrmAdapter = {
      query: (table) => { calls.push(table); return makeQb() },
      connect: async () => undefined,
      disconnect: async () => undefined,
    }
    ModelRegistry.set(adapter)

    class Order extends Model {
      static override table = 'orders'
    }
    Order.query()
    assert.deepStrictEqual(calls, ['orders'])
  })

  it('query() uses inferred table name', () => {
    const calls: string[] = []
    const adapter: OrmAdapter = {
      query: (table) => { calls.push(table); return makeQb() },
      connect: async () => undefined,
      disconnect: async () => undefined,
    }
    ModelRegistry.set(adapter)

    class Product extends Model {}
    Product.query()
    assert.deepStrictEqual(calls, ['products'])
  })

  it('query() throws when no adapter is registered', () => {
    class User extends Model {}
    assert.throws(() => User.query(), /No ORM adapter registered/)
  })

  it('query() returns object with all QueryBuilder methods', () => {
    ModelRegistry.set(makeAdapter())
    class User extends Model {}
    const qb = User.query()
    const methods = ['where', 'orWhere', 'orderBy', 'limit', 'offset', 'with',
      'first', 'find', 'get', 'all', 'count', 'create', 'update', 'delete', 'paginate']
    for (const method of methods) {
      assert.strictEqual(typeof (qb as unknown as Record<string, unknown>)[method], 'function',
        `missing method: ${method}`)
    }
  })

  it('find() delegates to query().find()', async () => {
    const expected = { id: 42, name: 'Alice' }
    const qb = makeQb({ find: async () => expected as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class User extends Model {}
    const result = await User.find(42)
    assert.deepStrictEqual(result, expected)
  })

  it('find() returns null when not found', async () => {
    const qb = makeQb({ find: async () => null })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class User extends Model {}
    const result = await User.find(999)
    assert.strictEqual(result, null)
  })

  it('all() delegates to query().all()', async () => {
    const rows = [{ id: 1 }, { id: 2 }]
    const qb = makeQb({ all: async () => rows as unknown[] })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class User extends Model {}
    const result = await User.all()
    assert.deepStrictEqual(result, rows)
  })

  it('all() returns empty array when table is empty', async () => {
    const qb = makeQb({ all: async () => [] })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class User extends Model {}
    const result = await User.all()
    assert.deepStrictEqual(result, [])
  })

  it('where() returns a QueryBuilder', () => {
    const qb = makeQb()
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class User extends Model {}
    const builder = User.where('name', 'Alice')
    assert.ok(typeof builder.get === 'function')
  })

  it('where() chains back to the same query builder', () => {
    let receivedCol: string | undefined
    let receivedVal: unknown
    const qb: QueryBuilder<unknown> = makeQb({
      where: (col, val): QueryBuilder<unknown> => { receivedCol = col; receivedVal = val; return qb },
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class User extends Model {}
    User.where('email', 'test@example.com')
    assert.strictEqual(receivedCol, 'email')
    assert.strictEqual(receivedVal, 'test@example.com')
  })

  it('create() delegates to query().create()', async () => {
    const payload = { name: 'Bob', email: 'bob@example.com' }
    const created = { id: 1, ...payload }
    const qb = makeQb({ create: async () => created as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class User extends Model {}
    const result = await User.create(payload as unknown as Partial<InstanceType<typeof User>>)
    assert.deepStrictEqual(result, created)
  })

  it('with() returns a QueryBuilder', () => {
    const qb = makeQb()
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class Post extends Model {}
    const builder = Post.with('author', 'tags')
    assert.ok(typeof builder.get === 'function')
  })

  it('with() passes relation names through', () => {
    let receivedRelations: string[] = []
    const qb: QueryBuilder<unknown> = makeQb({
      with: (...rels): QueryBuilder<unknown> => { receivedRelations = rels; return qb },
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class Post extends Model {}
    Post.with('author', 'comments')
    assert.deepStrictEqual(receivedRelations, ['author', 'comments'])
  })
})

// ─── Model.toJSON() ────────────────────────────────────────────────────────────

describe('Model.toJSON()', () => {
  it('includes all fields when hidden is empty', () => {
    class Post extends Model {
      title = 'Hello'
      body = 'World'
    }
    const p = new Post()
    const json = p.toJSON()
    assert.ok('title' in json)
    assert.ok('body' in json)
  })

  it('excludes a single hidden field', () => {
    class User extends Model {
      static override hidden = ['password']
      name = 'Alice'
      password = 'secret'
    }
    const json = new User().toJSON()
    assert.ok('name' in json)
    assert.ok(!('password' in json))
  })

  it('excludes multiple hidden fields', () => {
    class User extends Model {
      static override hidden = ['password', 'rememberToken']
      name = 'Bob'
      password = 'secret'
      rememberToken = 'abc123'
    }
    const json = new User().toJSON()
    assert.ok('name' in json)
    assert.ok(!('password' in json))
    assert.ok(!('rememberToken' in json))
  })

  it('returns empty object when all fields are hidden', () => {
    class Secret extends Model {
      static override hidden = ['key', 'value']
      key = 'foo'
      value = 'bar'
    }
    const json = new Secret().toJSON()
    assert.strictEqual(Object.keys(json).length, 0)
  })

  it('preserves field values in output', () => {
    class User extends Model {
      static override hidden = ['password']
      name = 'Charlie'
      age = 30
    }
    const json = new User().toJSON()
    assert.strictEqual(json['name'], 'Charlie')
    assert.strictEqual(json['age'], 30)
  })

  it('uses the subclass hidden array, not Model.hidden', () => {
    class User extends Model {
      static override hidden = ['password']
      name = 'Dave'
      password = 'secret'
    }
    // Model.hidden is [] — only User should hide 'password'
    assert.deepStrictEqual(Model.hidden, [])
    const json = new User().toJSON()
    assert.ok(!('password' in json))
  })
})
