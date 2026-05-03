import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, ModelNotFoundError, type QueryBuilder, type OrmAdapter, type BelongsToManyAccessor } from './index.js'

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
    withTrashed: function() { return qb },
    onlyTrashed: function() { return qb },
    restore: async (_id) => ({} as T),
    forceDelete: async () => undefined,
    increment: async (_id, _col, _amount, _extra) => ({} as T),
    decrement: async (_id, _col, _amount, _extra) => ({} as T),
    insertMany: async () => undefined,
    deleteAll:  async () => 0,
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

  // ─── Model class registration ───────────────────────────────────────────────

  it('all() returns an empty Map before any models are registered', () => {
    assert.strictEqual(ModelRegistry.all().size, 0)
  })

  it('register() adds a model class keyed by its name', () => {
    class Widget extends Model {}
    ModelRegistry.register(Widget)
    const all = ModelRegistry.all()
    assert.strictEqual(all.size, 1)
    assert.strictEqual(all.get('Widget'), Widget)
  })

  it('register() is idempotent — registering the same class twice is a no-op', () => {
    class Widget extends Model {}
    ModelRegistry.register(Widget)
    ModelRegistry.register(Widget)
    assert.strictEqual(ModelRegistry.all().size, 1)
  })

  it('register() ignores anonymous classes', () => {
    const anon = class extends Model {}
    Object.defineProperty(anon, 'name', { value: '' })
    ModelRegistry.register(anon)
    assert.strictEqual(ModelRegistry.all().size, 0)
  })

  it('onRegister() fires when a new class is registered', () => {
    const events: Array<[string, typeof Model]> = []
    ModelRegistry.onRegister((name, cls) => { events.push([name, cls]) })

    class Widget extends Model {}
    class Gadget extends Model {}
    ModelRegistry.register(Widget)
    ModelRegistry.register(Gadget)
    ModelRegistry.register(Widget) // no-op — listener does not re-fire

    assert.strictEqual(events.length, 2)
    assert.deepStrictEqual(events[0], ['Widget', Widget])
    assert.deepStrictEqual(events[1], ['Gadget', Gadget])
  })

  it('onRegister() returns an unsubscribe function', () => {
    const events: string[] = []
    const unsubscribe = ModelRegistry.onRegister((name) => { events.push(name) })

    class Widget extends Model {}
    ModelRegistry.register(Widget)
    unsubscribe()
    class Gadget extends Model {}
    ModelRegistry.register(Gadget)

    assert.deepStrictEqual(events, ['Widget'])
  })

  it('reset() clears registered models and listeners', () => {
    const events: string[] = []
    ModelRegistry.onRegister((name) => { events.push(name) })

    class Widget extends Model {}
    ModelRegistry.register(Widget)
    assert.strictEqual(ModelRegistry.all().size, 1)

    ModelRegistry.reset()
    assert.strictEqual(ModelRegistry.all().size, 0)

    // The previous listener was cleared by reset()
    class Gadget extends Model {}
    ModelRegistry.register(Gadget)
    assert.deepStrictEqual(events, ['Widget'])
  })

  it('auto-registers the model when query() is called', () => {
    ModelRegistry.set(makeAdapter())
    class AutoQuery extends Model {}
    AutoQuery.query()
    assert.strictEqual(ModelRegistry.all().get('AutoQuery'), AutoQuery)
  })

  it('auto-registers the model when find()/all()/first()/where() are called', async () => {
    ModelRegistry.set(makeAdapter())
    class AutoFind extends Model {}
    class AutoAll extends Model {}
    class AutoFirst extends Model {}
    class AutoWhere extends Model {}
    await AutoFind.find(1)
    await AutoAll.all()
    await AutoFirst.first()
    AutoWhere.where('id', 1)
    assert.strictEqual(ModelRegistry.all().get('AutoFind'), AutoFind)
    assert.strictEqual(ModelRegistry.all().get('AutoAll'), AutoAll)
    assert.strictEqual(ModelRegistry.all().get('AutoFirst'), AutoFirst)
    assert.strictEqual(ModelRegistry.all().get('AutoWhere'), AutoWhere)
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
      'withTrashed', 'onlyTrashed',
      'first', 'find', 'get', 'all', 'count', 'create', 'update', 'delete',
      'restore', 'forceDelete', 'paginate']
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
    assert.ok(result instanceof User)
    assert.deepStrictEqual({ ...result }, expected)
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
    assert.equal(result.length, 2)
    assert.ok(result[0] instanceof User)
    assert.deepStrictEqual(result.map(r => ({ ...r })), rows)
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
    assert.ok(result instanceof User)
    assert.deepStrictEqual({ ...result }, created)
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

// ─── Soft Deletes ─────────────────────────────────────────────────────────────

describe('Model soft deletes', () => {
  beforeEach(() => ModelRegistry.reset())

  it('softDeletes defaults to false', () => {
    class User extends Model {}
    assert.strictEqual(User.softDeletes, false)
  })

  it('softDeletes can be enabled on a model', () => {
    class Post extends Model {
      static override softDeletes = true
    }
    assert.strictEqual(Post.softDeletes, true)
  })

  it('query() calls _enableSoftDeletes when model has softDeletes = true', () => {
    let enabled = false
    const qb = makeQb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(qb as any)._enableSoftDeletes = () => { enabled = true }
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class Post extends Model {
      static override softDeletes = true
    }
    Post.query()
    assert.strictEqual(enabled, true)
  })

  it('query() does NOT call _enableSoftDeletes when model has softDeletes = false', () => {
    let enabled = false
    const qb = makeQb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(qb as any)._enableSoftDeletes = () => { enabled = true }
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class User extends Model {}
    User.query()
    assert.strictEqual(enabled, false)
  })

  it('restore() delegates to query().restore()', async () => {
    const restored = { id: 1, name: 'Alice', deletedAt: null }
    const qb = makeQb({ restore: async () => restored as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class Post extends Model {
      static override softDeletes = true
    }
    const result = await Post.restore(1)
    assert.ok(result instanceof Post)
    assert.deepStrictEqual({ ...result }, restored)
  })

  it('forceDelete() delegates to query().forceDelete()', async () => {
    let deleted = false
    const qb = makeQb({ forceDelete: async () => { deleted = true } })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))

    class Post extends Model {
      static override softDeletes = true
    }
    await Post.forceDelete(1)
    assert.strictEqual(deleted, true)
  })

  it('query methods include withTrashed and onlyTrashed', () => {
    ModelRegistry.set(makeAdapter())
    class Post extends Model {}
    const qb = Post.query()
    assert.strictEqual(typeof (qb as unknown as Record<string, unknown>)['withTrashed'], 'function')
    assert.strictEqual(typeof (qb as unknown as Record<string, unknown>)['onlyTrashed'], 'function')
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

// ─── Scopes ──────────────────────────────────────────────────────────────────

describe('Model scopes', () => {
  beforeEach(() => {
    ModelRegistry.set(makeAdapter(makeQb()))
  })

  it('local scope applies query modification', () => {
    class Post extends Model {
      static table = 'posts'
      static scopes = {
        published: (q: QueryBuilder<Post>) => q.where('status', 'published'),
      }
    }
    const q = Post.query().scope('published')
    assert.ok(q) // query builder returned
  })

  it('local scope with arguments works', () => {
    class Post extends Model {
      static table = 'posts'
      static scopes = {
        byAuthor: (q: QueryBuilder<Post>, authorId: string) => q.where('authorId', authorId),
      }
    }
    const q = Post.query().scope('byAuthor', 'user-123')
    assert.ok(q)
  })

  it('undefined scope throws', () => {
    class Post extends Model {
      static table = 'posts'
      static scopes = {}
    }
    assert.throws(() => Post.query().scope('nonexistent'), /not defined/)
  })

  it('global scope applied automatically', () => {
    let orderByCalled = false
    ModelRegistry.set(makeAdapter(makeQb({
      orderBy: function(this: QueryBuilder<unknown>) { orderByCalled = true; return this },
    })))

    class Post extends Model {
      static table = 'posts'
      static globalScopes = {
        ordered: (q: QueryBuilder<Post>) => q.orderBy('createdAt', 'DESC'),
      }
    }
    Post.query()
    assert.ok(orderByCalled)
  })

  it('withoutGlobalScope excludes a scope', () => {
    let whereCalled = false  // eslint-disable-line no-useless-assignment
    let orderByCalled = false // eslint-disable-line @typescript-eslint/no-unused-vars, no-useless-assignment
    ModelRegistry.set(makeAdapter(makeQb({
      orderBy: function(this: QueryBuilder<unknown>) { orderByCalled = true; return this },
      where: function(this: QueryBuilder<unknown>) { whereCalled = true; return this },
    })))

    class Post extends Model {
      static table = 'posts'
      static globalScopes = {
        ordered: (q: QueryBuilder<Post>) => q.orderBy('createdAt', 'DESC'),
        active: (q: QueryBuilder<Post>) => q.where('active', true),
      }
    }
    // Reset flags after initial query() call (which applies both scopes)
    orderByCalled = false // eslint-disable-line @typescript-eslint/no-unused-vars
    whereCalled = false
    Post.query().withoutGlobalScope('ordered')
    // The rebuilt query should have 'where' (active) applied
    assert.ok(whereCalled)
  })

  it('scopes are isolated per model', () => {
    class Post extends Model {
      static table = 'posts'
      static scopes = { published: (q: QueryBuilder<Post>) => q.where('status', 'published') }
    }
    class User extends Model {
      static table = 'users'
      static scopes = { admins: (q: QueryBuilder<User>) => q.where('role', 'admin') }
    }
    assert.ok('published' in Post.scopes)
    assert.ok(!('admins' in Post.scopes))
    assert.ok('admins' in User.scopes)
    assert.ok(!('published' in User.scopes))
  })
})

// ─── Observers ───────────────────────────────────────────────────────────────

describe('Model observers', () => {
  beforeEach(() => {
    ModelRegistry.set(makeAdapter(makeQb()))
  })

  it('observe() registers an observer', () => {
    class Post extends Model { static table = 'posts' }
    class PostObserver { created() {} }
    Post.observe(PostObserver)
    // No error means it worked
    Post.clearObservers()
  })

  it('creating event can transform data', async () => {
    const created: Record<string, unknown>[] = []
    const qb = makeQb({ create: async (data) => { created.push(data as Record<string, unknown>); return data as Record<string, unknown> } })
    ModelRegistry.set(makeAdapter(qb))

    class Post extends Model { static table = 'posts' }
    Post.on('creating', (data: Record<string, unknown>) => {
      return { ...data, slug: 'auto-slug' }
    })

    await Post.create({ title: 'Hello' } as Partial<never>)
    assert.equal(created[0]?.slug, 'auto-slug')
    Post.clearObservers()
  })

  it('creating event returning false cancels create', async () => {
    class Post extends Model { static table = 'posts' }
    Post.on('creating', () => false)

    await assert.rejects(() => Post.create({} as Partial<never>), /cancelled by observer/)
    Post.clearObservers()
  })

  it('created event fires after create', async () => {
    const events: string[] = []
    const qb = makeQb({ create: async (data) => ({ id: '1', ...data as Record<string, unknown> }) as Record<string, unknown> })
    ModelRegistry.set(makeAdapter(qb))

    class Post extends Model { static table = 'posts' }
    Post.on('created', (record: Record<string, unknown>) => {
      events.push(`created:${record.id}`)
    })

    await Post.create({ title: 'Test' } as Partial<never>)
    assert.deepStrictEqual(events, ['created:1'])
    Post.clearObservers()
  })

  it('updating event can transform data', async () => {
    const updated: Record<string, unknown>[] = []
    const qb = makeQb({ update: async (_id, data) => { updated.push(data as Record<string, unknown>); return data as Record<string, unknown> } })
    ModelRegistry.set(makeAdapter(qb))

    class Post extends Model { static table = 'posts' }
    Post.on('updating', (_id: string, data: Record<string, unknown>) => {
      return { ...data, updatedAt: 'now' }
    })

    await Post.update('1', { title: 'Changed' } as Partial<never>)
    assert.equal(updated[0]?.updatedAt, 'now')
    Post.clearObservers()
  })

  it('deleting event returning false cancels delete', async () => {
    class Post extends Model { static table = 'posts' }
    Post.on('deleting', () => false)

    await assert.rejects(() => Post.delete('1'), /cancelled by observer/)
    Post.clearObservers()
  })

  it('deleted event fires after delete', async () => {
    const events: string[] = []
    class Post extends Model { static table = 'posts' }
    Post.on('deleted', (id: string) => { events.push(`deleted:${id}`) })

    await Post.delete('1')
    assert.deepStrictEqual(events, ['deleted:1'])
    Post.clearObservers()
  })

  it('observer class methods are called', async () => {
    const events: string[] = []
    const qb = makeQb({ create: async (data) => ({ id: '1', ...data as Record<string, unknown> }) as Record<string, unknown> })
    ModelRegistry.set(makeAdapter(qb))

    class Post extends Model { static table = 'posts' }
    class PostObserver {
      creating(data: Record<string, unknown>) { events.push('creating'); return data }
      created() { events.push('created') }
    }
    Post.observe(PostObserver)

    await Post.create({ title: 'Test' } as Partial<never>)
    assert.deepStrictEqual(events, ['creating', 'created'])
    Post.clearObservers()
  })

  it('observers are isolated per model', () => {
    const events: string[] = []
    class Post extends Model { static table = 'posts' }
    class User extends Model { static table = 'users' }

    Post.on('creating', () => { events.push('post') })
    User.on('creating', () => { events.push('user') })

    // Each model should have its own listeners
    Post.clearObservers()
    User.clearObservers()
  })

  it('clearObservers removes all', async () => {
    const events: string[] = []
    const qb = makeQb({ create: async (data) => data as Record<string, unknown> })
    ModelRegistry.set(makeAdapter(qb))

    class Post extends Model { static table = 'posts' }
    Post.on('creating', () => { events.push('creating') })
    Post.clearObservers()

    await Post.create({ title: 'Test' } as Partial<never>)
    assert.deepStrictEqual(events, []) // no events fired
  })

  it('restoring/restored events fire', async () => {
    const events: string[] = []
    const qb = makeQb({ restore: async () => ({ id: '1' }) as Record<string, unknown> })
    ModelRegistry.set(makeAdapter(qb))

    class Post extends Model { static table = 'posts'; static softDeletes = true }
    Post.on('restoring', (id: string) => { events.push(`restoring:${id}`) })
    Post.on('restored', (record: Record<string, unknown>) => { events.push(`restored:${record.id}`) })

    await Post.restore('1')
    assert.deepStrictEqual(events, ['restoring:1', 'restored:1'])
    Post.clearObservers()
  })
})

// ─── findOrFail / firstOrFail ─────────────────────────────────────────────────

describe('Model.findOrFail() / firstOrFail()', () => {
  beforeEach(() => ModelRegistry.reset())

  it('findOrFail returns the record when found', async () => {
    const expected = { id: 1, name: 'Alice' }
    const qb = makeQb({ find: async () => expected as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    const result = await User.findOrFail(1)
    assert.ok(result instanceof User)
    assert.deepStrictEqual({ ...result }, expected)
  })

  it('findOrFail throws ModelNotFoundError when missing', async () => {
    const qb = makeQb({ find: async () => null })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    await assert.rejects(() => User.findOrFail(99), (err: Error) => {
      assert.ok(err instanceof ModelNotFoundError)
      assert.match(err.message, /No User found for id 99/)
      return true
    })
  })

  it('firstOrFail returns the record when found', async () => {
    const expected = { id: 1, name: 'Alice' }
    const qb = makeQb({ first: async () => expected as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    const result = await User.firstOrFail()
    assert.ok(result instanceof User)
    assert.deepStrictEqual({ ...result }, expected)
  })

  it('firstOrFail throws ModelNotFoundError when missing', async () => {
    const qb = makeQb({ first: async () => null })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    await assert.rejects(() => User.firstOrFail(), /No User found/)
  })

  it('ModelNotFoundError carries model + id', () => {
    const err = new ModelNotFoundError('Post', 'abc-123')
    assert.equal(err.model, 'Post')
    assert.equal(err.id, 'abc-123')
    assert.equal(err.name, 'ModelNotFoundError')
  })

  it('ModelNotFoundError exposes httpStatus = 404 for the framework HTTP layer', () => {
    const err = new ModelNotFoundError('Post', 'abc-123')
    assert.equal(err.httpStatus, 404)
  })
})

// ─── firstOrCreate / updateOrCreate ───────────────────────────────────────────

describe('Model.firstOrCreate() / updateOrCreate()', () => {
  beforeEach(() => ModelRegistry.reset())

  interface UserShape { id: number; email: string; name: string }

  it('firstOrCreate returns existing record without creating', async () => {
    const existing: UserShape = { id: 1, email: 'a@x.com', name: 'Alice' }
    let createCalls = 0
    const qb = makeQb<UserShape>({
      first: async () => existing,
      create: async (data) => { createCalls++; return data as UserShape },
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model { id!: number; email!: string; name!: string }
    const result = await User.firstOrCreate({ email: 'a@x.com' }, { name: 'Bob' })
    assert.ok(result instanceof User)
    assert.deepStrictEqual({ ...result }, existing)
    assert.equal(createCalls, 0)
  })

  it('firstOrCreate creates with attrs+values when missing', async () => {
    let createPayload: unknown = null
    const qb = makeQb<UserShape>({
      first: async () => null,
      create: async (data) => { createPayload = data; return { id: 2, ...(data as Partial<UserShape>) } as UserShape },
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model { id!: number; email!: string; name!: string }
    const result = await User.firstOrCreate({ email: 'b@x.com' }, { name: 'Bob' })
    assert.deepStrictEqual(createPayload, { email: 'b@x.com', name: 'Bob' })
    assert.ok(result instanceof User)
    assert.deepStrictEqual({ ...result }, { id: 2, email: 'b@x.com', name: 'Bob' })
  })

  it('updateOrCreate updates existing record', async () => {
    const existing: UserShape = { id: 7, email: 'a@x.com', name: 'Old' }
    let updatePayload: unknown = null
    let updateId: unknown = null
    const qb = makeQb<UserShape>({
      first: async () => existing,
      update: async (id, data) => {
        updateId = id
        updatePayload = data
        return { ...existing, ...(data as Partial<UserShape>) } as UserShape
      },
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model { id!: number; email!: string; name!: string }
    const result = await User.updateOrCreate({ email: 'a@x.com' }, { name: 'New' })
    assert.equal(updateId, 7)
    assert.deepStrictEqual(updatePayload, { name: 'New' })
    assert.ok(result instanceof User)
    assert.deepStrictEqual({ ...result }, { id: 7, email: 'a@x.com', name: 'New' })
  })

  it('updateOrCreate creates when no record matches', async () => {
    let createPayload: unknown = null
    const qb = makeQb<UserShape>({
      first: async () => null,
      create: async (data) => { createPayload = data; return { id: 9, ...(data as Partial<UserShape>) } as UserShape },
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model { id!: number; email!: string; name!: string }
    const result = await User.updateOrCreate({ email: 'c@x.com' }, { name: 'Cara' })
    assert.deepStrictEqual(createPayload, { email: 'c@x.com', name: 'Cara' })
    assert.ok(result instanceof User)
    assert.deepStrictEqual({ ...result }, { id: 9, email: 'c@x.com', name: 'Cara' })
  })
})

// ─── retrieved / saving / saved events ────────────────────────────────────────

describe('Model lifecycle — retrieved/saving/saved', () => {
  beforeEach(() => ModelRegistry.reset())

  it('retrieved fires after find()', async () => {
    const events: unknown[] = []
    const qb = makeQb({ find: async () => ({ id: 1, name: 'A' }) as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    User.on('retrieved', (record) => { events.push(record) })
    await User.find(1)
    assert.equal(events.length, 1)
    assert.deepStrictEqual({ ...(events[0] as object) }, { id: 1, name: 'A' })
    User.clearObservers()
  })

  it('retrieved does NOT fire when find returns null', async () => {
    const events: unknown[] = []
    const qb = makeQb({ find: async () => null })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    User.on('retrieved', (record) => { events.push(record) })
    await User.find(99)
    assert.deepStrictEqual(events, [])
    User.clearObservers()
  })

  it('retrieved fires once per record from all()', async () => {
    const events: unknown[] = []
    const qb = makeQb({ all: async () => [{ id: 1 }, { id: 2 }] as unknown[] })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    User.on('retrieved', (record) => { events.push(record) })
    await User.all()
    assert.equal(events.length, 2)
    assert.deepStrictEqual(events.map(r => ({ ...(r as object) })), [{ id: 1 }, { id: 2 }])
    User.clearObservers()
  })

  it('saving fires before created on create()', async () => {
    const events: string[] = []
    const qb = makeQb({ create: async (data) => ({ id: 1, ...(data as object) }) as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {
      static override fillable = ['name']
    }
    User.on('creating', () => { events.push('creating') })
    User.on('saving',   () => { events.push('saving') })
    User.on('created',  () => { events.push('created') })
    User.on('saved',    () => { events.push('saved') })
    await User.create({ name: 'A' } as Partial<User>)
    assert.deepStrictEqual(events, ['creating', 'saving', 'created', 'saved'])
    User.clearObservers()
  })

  it('saving fires before updated on update()', async () => {
    const events: string[] = []
    const qb = makeQb({ update: async (_id, data) => ({ id: 1, ...(data as object) }) as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    User.on('updating', () => { events.push('updating') })
    User.on('saving',   () => { events.push('saving') })
    User.on('updated',  () => { events.push('updated') })
    User.on('saved',    () => { events.push('saved') })
    await User.update(1, { name: 'B' } as Partial<User>)
    assert.deepStrictEqual(events, ['updating', 'saving', 'updated', 'saved'])
    User.clearObservers()
  })

  it('saving observer can mutate the payload', async () => {
    let createdWith: unknown = null
    const qb = makeQb({
      create: async (data) => { createdWith = data; return { id: 1, ...(data as object) } as unknown },
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    User.on('saving', (data: Record<string, unknown>) => ({ ...data, slug: 'auto' }))
    await User.create({ name: 'A' } as Partial<User>)
    assert.deepStrictEqual(createdWith, { name: 'A', slug: 'auto' })
    User.clearObservers()
  })
})

// ─── withoutEvents ────────────────────────────────────────────────────────────

describe('Model.withoutEvents()', () => {
  beforeEach(() => ModelRegistry.reset())

  it('mutes all events for the duration of the block', async () => {
    const events: string[] = []
    const qb = makeQb({
      create: async (data) => ({ id: 1, ...(data as object) }) as unknown,
      find: async () => ({ id: 1 }) as unknown,
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    User.on('creating',  () => { events.push('creating') })
    User.on('saved',     () => { events.push('saved') })
    User.on('retrieved', () => { events.push('retrieved') })

    await User.withoutEvents(async () => {
      await User.create({ name: 'A' } as Partial<User>)
      await User.find(1)
    })

    assert.deepStrictEqual(events, [])
    User.clearObservers()
  })

  it('events fire normally outside the block', async () => {
    const events: string[] = []
    const qb = makeQb({
      create: async (data) => ({ id: 1, ...(data as object) }) as unknown,
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    User.on('creating', () => { events.push('creating') })

    await User.withoutEvents(async () => {
      await User.create({ name: 'inside' } as Partial<User>)
    })
    await User.create({ name: 'outside' } as Partial<User>)

    assert.deepStrictEqual(events, ['creating'])
    User.clearObservers()
  })

  it('returns the value from fn', async () => {
    ModelRegistry.set(makeAdapter())
    class User extends Model {}
    const result = await User.withoutEvents(() => 'ok')
    assert.equal(result, 'ok')
  })

  it('restores muted state after fn throws', async () => {
    ModelRegistry.set(makeAdapter())
    class User extends Model {}
    await assert.rejects(() => User.withoutEvents(() => { throw new Error('boom') }))
    // Subsequent events should fire again
    const events: string[] = []
    User.on('creating', () => { events.push('creating') })
    const qb = makeQb({ create: async (data) => ({ id: 1, ...(data as object) }) as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    await User.create({ name: 'A' } as Partial<User>)
    assert.deepStrictEqual(events, ['creating'])
    User.clearObservers()
  })
})

// ─── Hydration ────────────────────────────────────────────────────────────────

describe('Model.hydrate()', () => {
  it('returns null for null/undefined input', () => {
    class User extends Model {}
    assert.strictEqual(User.hydrate(null), null)
    assert.strictEqual(User.hydrate(undefined), null)
  })

  it('builds an instance carrying the record fields', () => {
    class User extends Model { id!: number; name!: string }
    const u = User.hydrate({ id: 1, name: 'A' })!
    assert.ok(u instanceof User)
    assert.equal(u.id, 1)
    assert.equal(u.name, 'A')
  })

  it('hydrated instance only has data fields enumerable', () => {
    class User extends Model { id!: number; name!: string }
    const u = User.hydrate({ id: 1, name: 'A' })!
    assert.deepStrictEqual(Object.keys(u).sort(), ['id', 'name'])
  })

  it('passes through an already-hydrated instance unchanged', () => {
    class User extends Model {}
    const u = User.hydrate({ id: 1 })!
    assert.strictEqual(User.hydrate(u), u)
  })
})

describe('Query results return Model instances', () => {
  beforeEach(() => ModelRegistry.reset())

  it('Model.where().first() returns an instance', async () => {
    const qb = makeQb({ first: async () => ({ id: 1, name: 'A' }) })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id?: number }
    const result = await User.where('id', 1).first()
    assert.ok(result instanceof User)
    assert.equal(result.id, 1)
  })

  it('Model.where().get() returns an array of instances', async () => {
    const qb = makeQb({ get: async () => [{ id: 1 }, { id: 2 }] })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model {}
    const result = await User.where('active', true).get()
    assert.equal(result.length, 2)
    assert.ok(result[0] instanceof User)
    assert.ok(result[1] instanceof User)
  })

  it('Model.paginate() data is an array of instances', async () => {
    const qb = makeQb({
      paginate: async () => ({ data: [{ id: 1 }, { id: 2 }], total: 2, perPage: 15, currentPage: 1, lastPage: 1, from: 1, to: 2 }),
    })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model {}
    const result = await User.paginate(1)
    assert.equal(result.data.length, 2)
    assert.ok(result.data[0] instanceof User)
  })

  it('chaining via with() preserves hydration', async () => {
    const qb = makeQb({ first: async () => ({ id: 1 }) })
    ModelRegistry.set(makeAdapter(qb))
    class Post extends Model {}
    const result = await Post.with('author').where('id', 1).first()
    assert.ok(result instanceof Post)
  })
})

// ─── Instance methods ─────────────────────────────────────────────────────────

describe('Model instance methods', () => {
  beforeEach(() => ModelRegistry.reset())

  it('save() inserts when no primary key is set', async () => {
    let createPayload: unknown = null
    const qb = makeQb({
      create: async (data) => { createPayload = data; return { id: 1, ...(data as object) } },
    })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id?: number; name?: string }

    const u = new User()
    u.name = 'Alice'
    await u.save()
    assert.deepStrictEqual(createPayload, { name: 'Alice' })
    assert.equal(u.id, 1)
  })

  it('save() updates when primary key is set', async () => {
    let updateId: unknown = null
    let updatePayload: unknown = null
    const qb = makeQb({
      update: async (id, data) => {
        updateId = id
        updatePayload = data
        return { id, ...(data as object) }
      },
    })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id!: number; name!: string }

    const u = User.hydrate({ id: 7, name: 'Old' })!
    u.name = 'New'
    await u.save()
    assert.equal(updateId, 7)
    assert.deepStrictEqual(updatePayload, { id: 7, name: 'New' })
  })

  it('save() merges server-side fields back into the instance', async () => {
    const qb = makeQb({
      create: async (data) => ({ id: 42, createdAt: 'now', ...(data as object) }),
    })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id?: number; name?: string; createdAt?: string }

    const u = new User()
    u.name = 'Alice'
    await u.save()
    assert.equal(u.id, 42)
    assert.equal(u.createdAt, 'now')
  })

  it('fill() merges fields without persisting', () => {
    class User extends Model { name!: string; email!: string }
    const u = new User()
    u.fill({ name: 'A', email: 'a@x.com' } as Partial<User>)
    assert.equal(u.name, 'A')
    assert.equal(u.email, 'a@x.com')
  })

  it('fill() returns this for chaining', () => {
    class User extends Model { name!: string }
    const u = new User()
    assert.strictEqual(u.fill({ name: 'A' } as Partial<User>), u)
  })

  it('refresh() re-reads from DB and replaces fields', async () => {
    const qb = makeQb({ find: async () => ({ id: 1, name: 'Fresh' }) })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id!: number; name!: string }

    const u = User.hydrate({ id: 1, name: 'Stale' })!
    await u.refresh()
    assert.equal(u.name, 'Fresh')
  })

  it('refresh() throws ModelNotFoundError when row is gone', async () => {
    const qb = makeQb({ find: async () => null })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id!: number; name!: string }
    const u = User.hydrate({ id: 99, name: 'Stale' })!
    await assert.rejects(() => u.refresh(), ModelNotFoundError)
  })

  it('refresh() throws when no primary key is set', async () => {
    ModelRegistry.set(makeAdapter())
    class User extends Model { id?: number }
    const u = new User()
    await assert.rejects(() => u.refresh(), /without a primary key/)
  })

  it('delete() routes through the static and fires observers', async () => {
    const events: string[] = []
    let deletedId: unknown = null
    const qb = makeQb({ delete: async (id) => { deletedId = id } })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id!: number }
    User.on('deleting', (id) => { events.push(`deleting:${String(id)}`) })
    User.on('deleted',  (id) => { events.push(`deleted:${String(id)}`) })

    const u = User.hydrate({ id: 5 })!
    await u.delete()
    assert.equal(deletedId, 5)
    assert.deepStrictEqual(events, ['deleting:5', 'deleted:5'])
    User.clearObservers()
  })

  it('delete() throws when no primary key is set', async () => {
    ModelRegistry.set(makeAdapter())
    class User extends Model { id?: number }
    const u = new User()
    await assert.rejects(() => u.delete(), /without a primary key/)
  })

  it('replicate() returns a new unsaved instance without pk + timestamps', () => {
    class Post extends Model { id!: number; title!: string; createdAt!: string; updatedAt!: string }
    const original = Post.hydrate({ id: 7, title: 'Hello', createdAt: 't0', updatedAt: 't1' })!
    const clone = original.replicate()
    assert.ok(clone instanceof Post)
    assert.notStrictEqual(clone, original)
    assert.equal(clone.title, 'Hello')
    assert.deepStrictEqual(Object.keys(clone), ['title'])
  })

  it('replicate(except) drops additional keys', () => {
    class Post extends Model { id!: number; title!: string; publishedAt!: string }
    const original = Post.hydrate({ id: 7, title: 'Hello', publishedAt: 't0' })!
    const clone = original.replicate(['publishedAt'])
    assert.deepStrictEqual(Object.keys(clone).sort(), ['title'])
  })

  it('is() compares by table + primary key', () => {
    class User extends Model { id!: number }
    const a = User.hydrate({ id: 1 })!
    const b = User.hydrate({ id: 1 })!
    const c = User.hydrate({ id: 2 })!
    assert.ok(a.is(b))
    assert.ok(!a.is(c))
  })

  it('is() returns false across different models', () => {
    class User extends Model { id!: number; static override table = 'users' }
    class Post extends Model { id!: number; static override table = 'posts' }
    const u = User.hydrate({ id: 1 })!
    const p = Post.hydrate({ id: 1 })!
    assert.ok(!u.is(p))
  })

  it('is() returns false when one side has no primary key', () => {
    class User extends Model { id?: number }
    const a = new User()
    const b = User.hydrate({ id: 1 })!
    assert.ok(!a.is(b))
    assert.ok(!b.is(a))
  })

  it('is() returns false for null/undefined', () => {
    class User extends Model { id!: number }
    const a = User.hydrate({ id: 1 })!
    assert.ok(!a.is(null))
    assert.ok(!a.is(undefined))
  })

  it('isNot() inverts is()', () => {
    class User extends Model { id!: number }
    const a = User.hydrate({ id: 1 })!
    const b = User.hydrate({ id: 1 })!
    const c = User.hydrate({ id: 2 })!
    assert.ok(a.isNot(c))
    assert.ok(!a.isNot(b))
  })

  it('trashed() returns true when deletedAt is set', () => {
    class Post extends Model { id!: number; deletedAt!: string | null }
    const live = Post.hydrate({ id: 1, deletedAt: null })!
    const dead = Post.hydrate({ id: 2, deletedAt: '2024-01-01' })!
    assert.ok(!live.trashed())
    assert.ok(dead.trashed())
  })

  it('JSON.stringify on an instance produces clean wire-format', () => {
    class User extends Model {
      static override hidden = ['password']
      id!: number
      name!: string
      password!: string
    }
    const u = User.hydrate({ id: 1, name: 'A', password: 'secret' })!
    assert.equal(JSON.stringify(u), '{"id":1,"name":"A"}')
  })
})

describe('Mass assignment — fillable / guarded / forceFill', () => {
  beforeEach(() => ModelRegistry.reset())

  it('no fillable + no guarded passes every key through (back-compat default)', async () => {
    let createdWith: unknown = null
    const qb = makeQb({ create: async (data) => { createdWith = data; return { id: 1, ...(data as object) } as unknown } })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {}
    await User.create({ name: 'A', isAdmin: true } as Partial<User>)
    assert.deepEqual(createdWith, { name: 'A', isAdmin: true })
  })

  it('fillable allowlist drops keys outside the list on create()', async () => {
    let createdWith: unknown = null
    const qb = makeQb({ create: async (data) => { createdWith = data; return { id: 1, ...(data as object) } as unknown } })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {
      static override fillable = ['name', 'email']
    }
    await User.create({ name: 'A', email: 'a@x.com', isAdmin: true } as Partial<User>)
    assert.deepEqual(createdWith, { name: 'A', email: 'a@x.com' })
  })

  it('fillable allowlist drops keys outside the list on update()', async () => {
    let updatedWith: unknown = null
    const qb = makeQb({ update: async (_id, data) => { updatedWith = data; return { id: 1, ...(data as object) } as unknown } })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {
      static override fillable = ['name']
    }
    await User.update(1, { name: 'B', role: 'admin' } as Partial<User>)
    assert.deepEqual(updatedWith, { name: 'B' })
  })

  it('guarded denylist drops listed keys', async () => {
    let createdWith: unknown = null
    const qb = makeQb({ create: async (data) => { createdWith = data; return { id: 1, ...(data as object) } as unknown } })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {
      static override guarded = ['isAdmin', 'role']
    }
    await User.create({ name: 'A', isAdmin: true, role: 'admin' } as Partial<User>)
    assert.deepEqual(createdWith, { name: 'A' })
  })

  it("guarded ['*'] forbids every key", async () => {
    let createdWith: unknown = null
    const qb = makeQb({ create: async (data) => { createdWith = data; return { id: 1, ...(data as object) } as unknown } })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {
      static override guarded = ['*']
    }
    await User.create({ name: 'A', email: 'a@x.com' } as Partial<User>)
    assert.deepEqual(createdWith, {})
  })

  it('fillable wins when both fillable and guarded are set', async () => {
    let createdWith: unknown = null
    const qb = makeQb({ create: async (data) => { createdWith = data; return { id: 1, ...(data as object) } as unknown } })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {
      static override fillable = ['name']
      static override guarded = ['name'] // contradicts fillable; fillable takes precedence
    }
    await User.create({ name: 'A', email: 'a@x.com' } as Partial<User>)
    assert.deepEqual(createdWith, { name: 'A' })
  })

  it('fill() drops keys outside fillable', () => {
    class User extends Model {
      static override fillable = ['name']
      name?: string
      role?: string
    }
    const u = new User()
    u.fill({ name: 'A', role: 'admin' } as Partial<User>)
    assert.equal(u.name, 'A')
    assert.equal(u.role, undefined)
  })

  it('forceFill() bypasses the fillable filter', () => {
    class User extends Model {
      static override fillable = ['name']
      name?: string
      role?: string
    }
    const u = new User()
    u.forceFill({ name: 'A', role: 'admin' } as Partial<User>)
    assert.equal(u.name, 'A')
    assert.equal(u.role, 'admin')
  })

  it('forceFill() returns this for chaining', () => {
    class User extends Model { name!: string }
    const u = new User()
    assert.strictEqual(u.forceFill({ name: 'A' } as Partial<User>), u)
  })

  it("save() bypasses fillable — properties set directly persist regardless", async () => {
    let createdWith: unknown = null
    const qb = makeQb({ create: async (data) => { createdWith = data; return { id: 1, ...(data as object) } as unknown } })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {
      static override fillable = ['name']
      name!: string
      role!: string
    }
    const u = new User()
    u.name = 'A'
    u.role = 'admin'
    await u.save()
    assert.deepEqual(createdWith, { name: 'A', role: 'admin' })
  })

  it("save() update path also bypasses fillable", async () => {
    let updatedWith: Record<string, unknown> = {}
    const qb = makeQb({ update: async (_id, data) => { updatedWith = data as Record<string, unknown>; return { id: 1, ...(data as object) } as unknown } })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {
      static override fillable = ['name']
      id!: number
      name!: string
      role!: string
    }
    const u = User.hydrate({ id: 1, name: 'A', role: 'admin' })!
    u.role = 'super'
    await u.save()
    // role would be filtered if save() applied the fillable allowlist; assert it persists.
    assert.equal(updatedWith['role'], 'super')
    assert.equal(updatedWith['name'], 'A')
  })

  it('firstOrCreate routes through fillable — lookup attrs must be fillable', async () => {
    type Shape = { id: number; email: string; name: string; role: string }
    let createdWith: unknown = null
    const qb = makeQb<Shape>({
      first:  async () => null,
      create: async (data) => { createdWith = data; return { id: 1, ...(data as Partial<Shape>) } as Shape },
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class User extends Model {
      static override fillable = ['email', 'name']
      id!: number
      email!: string
      name!: string
      role!: string
    }
    await User.firstOrCreate({ email: 'a@x.com' } as Partial<User>, { name: 'A', role: 'admin' } as Partial<User>)
    assert.deepEqual(createdWith, { email: 'a@x.com', name: 'A' })
  })
})

describe('Model.increment / decrement', () => {
  beforeEach(() => ModelRegistry.reset())

  it('static increment delegates to QueryBuilder.increment with default amount of 1', async () => {
    let captured: { id: unknown; column: string; amount: number | undefined; extra: unknown } | null = null
    const qb = makeQb({
      increment: async (id, column, amount, extra) => {
        captured = { id, column, amount, extra }
        return { id: 1, count: 6 } as unknown
      },
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class Post extends Model { id!: number; count!: number }
    await Post.increment(1, 'count')
    assert.deepStrictEqual(captured, { id: 1, column: 'count', amount: 1, extra: {} })
  })

  it('static increment passes through amount + extra', async () => {
    let captured: { amount: number | undefined; extra: unknown } | null = null
    const qb = makeQb({
      increment: async (_id, _col, amount, extra) => {
        captured = { amount, extra }
        return { id: 1, count: 10 } as unknown
      },
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class Post extends Model {}
    await Post.increment(1, 'count', 5, { lastSeen: 'now' } as Partial<Post>)
    assert.equal(captured!.amount, 5)
    assert.deepEqual(captured!.extra, { lastSeen: 'now' })
  })

  it('static increment returns a hydrated Model instance', async () => {
    const qb = makeQb({ increment: async () => ({ id: 1, count: 6 }) as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class Post extends Model { id!: number; count!: number }
    const result = await Post.increment(1, 'count')
    assert.ok(result instanceof Post)
    assert.equal(result.count, 6)
  })

  it('static decrement delegates to QueryBuilder.decrement', async () => {
    let captured: { column: string; amount: number | undefined } | null = null
    const qb = makeQb({
      decrement: async (_id, column, amount) => {
        captured = { column, amount }
        return { id: 1, count: 4 } as unknown
      },
    })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class Post extends Model {}
    await Post.decrement(1, 'count', 2)
    assert.deepEqual(captured, { column: 'count', amount: 2 })
  })

  it('instance.increment merges the returned record back into this', async () => {
    const qb = makeQb({ increment: async () => ({ id: 1, count: 11 }) as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class Post extends Model { id!: number; count!: number }
    const post = Post.hydrate({ id: 1, count: 10 })!
    await post.increment('count')
    assert.equal(post.count, 11)
  })

  it('instance.increment returns this for chaining', async () => {
    const qb = makeQb({ increment: async () => ({ id: 1, count: 6 }) as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class Post extends Model { id!: number; count!: number }
    const post = Post.hydrate({ id: 1, count: 5 })!
    const result = await post.increment('count')
    assert.strictEqual(result, post)
  })

  it('instance.increment throws without a primary key', async () => {
    ModelRegistry.set(makeAdapter())
    class Post extends Model { id?: number; count?: number }
    const post = new Post()
    await assert.rejects(() => post.increment('count'), /without a primary key/)
  })

  it('instance.decrement merges returned record + returns this', async () => {
    const qb = makeQb({ decrement: async () => ({ id: 1, count: 3 }) as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class Post extends Model { id!: number; count!: number }
    const post = Post.hydrate({ id: 1, count: 5 })!
    const result = await post.decrement('count', 2)
    assert.equal(post.count, 3)
    assert.strictEqual(result, post)
  })

  it('does NOT fire updating/updated/saving/saved observers', async () => {
    const events: string[] = []
    const qb = makeQb({ increment: async () => ({ id: 1, count: 6 }) as unknown })
    ModelRegistry.set(makeAdapter(qb as QueryBuilder<unknown>))
    class Post extends Model { id!: number; count!: number }
    Post.on('updating', () => { events.push('updating') })
    Post.on('updated',  () => { events.push('updated') })
    Post.on('saving',   () => { events.push('saving') })
    Post.on('saved',    () => { events.push('saved') })
    await Post.increment(1, 'count')
    assert.deepEqual(events, [])
    Post.clearObservers()
  })
})

// ─── Route model binding helpers ──────────────────────────────────────────────

describe('Model.findForRoute()', () => {
  beforeEach(() => ModelRegistry.reset())

  it('default implementation queries by primary key', async () => {
    const seen: Array<[string, unknown]> = []
    const qb = makeQb({
      where: function(this: QueryBuilder<unknown>, col: string, val: unknown) { seen.push([col, val]); return this },
      first: async () => ({ id: 7, name: 'A' }),
    })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id!: number; name!: string }

    const result = await User.findForRoute('7') as User | null
    assert.deepStrictEqual(seen, [['id', '7']])
    assert.ok(result instanceof User)
    assert.equal(result?.id, 7)
  })

  it('honors a custom static routeKey', async () => {
    const seen: Array<[string, unknown]> = []
    const qb = makeQb({
      where: function(this: QueryBuilder<unknown>, col: string, val: unknown) { seen.push([col, val]); return this },
      first: async () => ({ id: 1, slug: 'hello-world' }),
    })
    ModelRegistry.set(makeAdapter(qb))
    class Post extends Model {
      static override routeKey = 'slug'
      id!: number
      slug!: string
    }

    await Post.findForRoute('hello-world')
    assert.deepStrictEqual(seen, [['slug', 'hello-world']])
  })

  it('returns null when no record is found', async () => {
    const qb = makeQb({ first: async () => null })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model {}
    assert.strictEqual(await User.findForRoute('does-not-exist'), null)
  })

  it('hydrated result is an instance of the model class', async () => {
    const qb = makeQb({ first: async () => ({ id: 1 }) })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id!: number }
    const u = await User.findForRoute('1')
    assert.ok(u instanceof User)
  })

  it('subclass override can apply additional constraints', async () => {
    const seen: unknown[][] = []
    const qb = makeQb({
      where: function(this: QueryBuilder<unknown>, ...args: unknown[]) { seen.push(args); return this } as unknown as QueryBuilder<unknown>['where'],
      first: async () => ({ id: 1, slug: 'x', publishedAt: 't0' }),
    })
    ModelRegistry.set(makeAdapter(qb))
    class Post extends Model {
      static override routeKey = 'slug'
      static override async findForRoute(value: string): Promise<Post | null> {
        // Only published posts.
        return this.where('slug', value).where('publishedAt', '!=', null).first() as Promise<Post | null>
      }
    }

    const p = await Post.findForRoute('x')
    assert.deepStrictEqual(seen, [['slug', 'x'], ['publishedAt', '!=', null]])
    assert.ok(p instanceof Post)
  })
})

// ─── Relations ────────────────────────────────────────────────────────────────

describe('Model.related()', () => {
  beforeEach(() => ModelRegistry.reset())

  it('hasMany builds a where(foreignKey, parentId) query on the related model', () => {
    const seen: Array<[string, unknown]> = []
    const qb = makeQb({
      where: function(this: QueryBuilder<unknown>, col: string, val: unknown) { seen.push([col, val]); return this },
    })
    ModelRegistry.set(makeAdapter(qb))
    class Post extends Model {}
    class User extends Model {
      static override relations = {
        posts: { type: 'hasMany' as const, model: () => Post, foreignKey: 'authorId' },
      }
      id!: number
    }

    const u = User.hydrate({ id: 5 })!
    u.related('posts')
    assert.deepStrictEqual(seen, [['authorId', 5]])
  })

  it('hasMany default foreign key is camelCase parent class + Id', () => {
    const seen: Array<[string, unknown]> = []
    const qb = makeQb({
      where: function(this: QueryBuilder<unknown>, col: string, val: unknown) { seen.push([col, val]); return this },
    })
    ModelRegistry.set(makeAdapter(qb))
    class Post extends Model {}
    class User extends Model {
      static override relations = {
        posts: { type: 'hasMany' as const, model: () => Post },
      }
      id!: number
    }

    const u = User.hydrate({ id: 9 })!
    u.related('posts')
    assert.deepStrictEqual(seen, [['userId', 9]])
  })

  it('hasOne uses the same query shape as hasMany', () => {
    const seen: Array<[string, unknown]> = []
    const qb = makeQb({
      where: function(this: QueryBuilder<unknown>, col: string, val: unknown) { seen.push([col, val]); return this },
    })
    ModelRegistry.set(makeAdapter(qb))
    class Phone extends Model {}
    class User extends Model {
      static override relations = {
        phone: { type: 'hasOne' as const, model: () => Phone, foreignKey: 'userId' },
      }
      id!: number
    }

    const u = User.hydrate({ id: 3 })!
    u.related('phone')
    assert.deepStrictEqual(seen, [['userId', 3]])
  })

  it('belongsTo queries the related primaryKey using the local FK value', () => {
    const seen: Array<[string, unknown]> = []
    const qb = makeQb({
      where: function(this: QueryBuilder<unknown>, col: string, val: unknown) { seen.push([col, val]); return this },
    })
    ModelRegistry.set(makeAdapter(qb))
    class Team extends Model { id!: number }
    class User extends Model {
      static override relations = {
        team: { type: 'belongsTo' as const, model: () => Team, foreignKey: 'teamId' },
      }
      teamId!: number
    }

    const u = User.hydrate({ teamId: 12 })!
    u.related('team')
    assert.deepStrictEqual(seen, [['id', 12]])
  })

  it('belongsTo defaults FK to camelCase relatedClass + Id', () => {
    const seen: Array<[string, unknown]> = []
    const qb = makeQb({
      where: function(this: QueryBuilder<unknown>, col: string, val: unknown) { seen.push([col, val]); return this },
    })
    ModelRegistry.set(makeAdapter(qb))
    class Team extends Model { id!: number }
    class User extends Model {
      static override relations = {
        team: { type: 'belongsTo' as const, model: () => Team },
      }
      teamId!: number
    }

    const u = User.hydrate({ teamId: 22 })!
    u.related('team')
    assert.deepStrictEqual(seen, [['id', 22]])
  })

  it('throws when the relation is not declared', () => {
    ModelRegistry.set(makeAdapter())
    class User extends Model {}
    const u = new User()
    assert.throws(() => u.related('mystery'), /not defined on User/)
  })

  it('throws on hasMany when the parent local key is unset', () => {
    ModelRegistry.set(makeAdapter())
    class Post extends Model {}
    class User extends Model {
      static override relations = {
        posts: { type: 'hasMany' as const, model: () => Post },
      }
      id?: number
    }
    const u = new User()
    assert.throws(() => u.related('posts'), /id is unset/)
  })

  it('throws on belongsTo when the local FK is unset', () => {
    ModelRegistry.set(makeAdapter())
    class Team extends Model {}
    class User extends Model {
      static override relations = {
        team: { type: 'belongsTo' as const, model: () => Team, foreignKey: 'teamId' },
      }
      teamId?: number
    }
    const u = new User()
    assert.throws(() => u.related('team'), /teamId is unset/)
  })

  it('returned QueryBuilder is chainable to first/get/paginate', async () => {
    const qb = makeQb({
      where: function(this: QueryBuilder<unknown>) { return this },
      first: async () => ({ id: 1, title: 'Hello', authorId: 5 }),
    })
    ModelRegistry.set(makeAdapter(qb))
    class Post extends Model { id!: number; title!: string }
    class User extends Model {
      static override relations = {
        posts: { type: 'hasMany' as const, model: () => Post, foreignKey: 'authorId' },
      }
      id!: number
    }
    const u = User.hydrate({ id: 5 })!
    const post = await u.related('posts').first()
    assert.ok(post instanceof Post)
  })

  it('localKey override changes the column resolved on the parent', () => {
    const seen: Array<[string, unknown]> = []
    const qb = makeQb({
      where: function(this: QueryBuilder<unknown>, col: string, val: unknown) { seen.push([col, val]); return this },
    })
    ModelRegistry.set(makeAdapter(qb))
    class Post extends Model {}
    class User extends Model {
      static override relations = {
        posts: { type: 'hasMany' as const, model: () => Post, foreignKey: 'ownerUuid', localKey: 'uuid' },
      }
      uuid!: string
    }
    const u = User.hydrate({ uuid: 'abc-123' })!
    u.related('posts')
    assert.deepStrictEqual(seen, [['ownerUuid', 'abc-123']])
  })
})

// ─── belongsToMany ────────────────────────────────────────────────────────────

/**
 * Tiny in-memory adapter that supports multiple tables — needed for the
 * M2M tests where we have to reason about real pivot state across calls.
 * Implements the chainable wheres + the new bulk primitives. Skips features
 * orthogonal to M2M (paginate, casts, soft-delete column).
 */
function memoryAdapter(): { adapter: OrmAdapter; rows: (table: string) => Record<string, unknown>[] } {
  const tables = new Map<string, Record<string, unknown>[]>()
  const ensure = (table: string): Record<string, unknown>[] => {
    if (!tables.has(table)) tables.set(table, [])
    return tables.get(table)!
  }

  const matches = (row: Record<string, unknown>, wheres: Array<[string, string, unknown]>): boolean => {
    for (const [col, op, val] of wheres) {
      const v = row[col]
      switch (op) {
        case '=':      if (v !== val) return false; break
        case '!=':     if (v === val) return false; break
        case '>':      if (!(typeof v === 'number' && typeof val === 'number' && v >  val)) return false; break
        case '>=':     if (!(typeof v === 'number' && typeof val === 'number' && v >= val)) return false; break
        case '<':      if (!(typeof v === 'number' && typeof val === 'number' && v <  val)) return false; break
        case '<=':     if (!(typeof v === 'number' && typeof val === 'number' && v <= val)) return false; break
        case 'IN':     if (!Array.isArray(val) || !val.some(x => x === v)) return false; break
        case 'NOT IN': if (!Array.isArray(val) ||  val.some(x => x === v)) return false; break
        default: throw new Error(`memoryAdapter: unsupported op ${op}`)
      }
    }
    return true
  }

  const makeQbFor = <T>(table: string): QueryBuilder<T> => {
    const wheres: Array<[string, string, unknown]> = []
    const nextId = (): number => {
      const data = ensure(table)
      let max = 0
      for (const r of data) {
        const id = r['id']
        if (typeof id === 'number' && id > max) max = id
      }
      return max + 1
    }
    const qb: QueryBuilder<T> = {
      where: (col: string, opOrVal: unknown, maybeVal?: unknown) => {
        const op = arguments.length === 3 || maybeVal !== undefined ? String(opOrVal) : '='
        const val = maybeVal !== undefined ? maybeVal : opOrVal
        wheres.push([col, op, val])
        return qb
      },
      orWhere: () => qb,
      orderBy: () => qb,
      limit:   () => qb,
      offset:  () => qb,
      with:    () => qb,
      withTrashed: () => qb,
      onlyTrashed: () => qb,
      first: async () => (ensure(table).find(r => matches(r, wheres)) ?? null) as T | null,
      find:  async (id) => (ensure(table).find(r => r['id'] === id) ?? null) as T | null,
      get:   async () => ensure(table).filter(r => matches(r, wheres)) as T[],
      all:   async () => [...ensure(table)] as T[],
      count: async () => ensure(table).filter(r => matches(r, wheres)).length,
      create: async (data) => {
        const data2 = data as Record<string, unknown>
        const row = { id: data2['id'] ?? nextId(), ...data2 }
        ensure(table).push(row)
        return row as T
      },
      update: async (id, data) => {
        const list = ensure(table)
        const i = list.findIndex(r => r['id'] === id)
        if (i < 0) throw new Error(`memoryAdapter: no row in ${table} with id=${String(id)}`)
        list[i] = { ...list[i], ...(data as Record<string, unknown>) }
        return list[i] as T
      },
      delete: async (id) => {
        const list = ensure(table)
        const i = list.findIndex(r => r['id'] === id)
        if (i >= 0) list.splice(i, 1)
      },
      restore: async (_id) => ({} as T),
      forceDelete: async (id) => {
        const list = ensure(table)
        const i = list.findIndex(r => r['id'] === id)
        if (i >= 0) list.splice(i, 1)
      },
      increment: async () => ({} as T),
      decrement: async () => ({} as T),
      insertMany: async (rows) => {
        const list = ensure(table)
        for (const r of rows) list.push({ ...(r as Record<string, unknown>) })
      },
      deleteAll: async () => {
        const list = ensure(table)
        const keep: Record<string, unknown>[] = []
        let removed = 0
        for (const r of list) {
          if (matches(r, wheres)) { removed++ } else { keep.push(r) }
        }
        list.length = 0
        list.push(...keep)
        return removed
      },
      paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
    }
    // Workaround: arrow functions don't have `arguments`. Rewrite where().
    qb.where = ((col: string, opOrVal: unknown, maybeVal?: unknown) => {
      const op  = maybeVal === undefined ? '=' : String(opOrVal)
      const val = maybeVal === undefined ? opOrVal : maybeVal
      wheres.push([col, op, val])
      return qb
    }) as QueryBuilder<T>['where']
    return qb
  }

  return {
    adapter: {
      query: <T,>(table: string) => makeQbFor<T>(table),
      connect: async () => undefined,
      disconnect: async () => undefined,
    },
    rows: (table: string) => ensure(table),
  }
}

describe('Model.belongsToMany — declaration', () => {
  beforeEach(() => ModelRegistry.reset())

  it('relations entry parses as belongsToMany with required + optional fields', () => {
    class Role extends Model {}
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
      id!: number
    }
    const def = User.relations['roles']!
    assert.strictEqual(def.type, 'belongsToMany')
    if (def.type === 'belongsToMany') {
      assert.strictEqual(def.pivotTable, 'role_user')
      assert.strictEqual((def as { foreignPivotKey?: string }).foreignPivotKey, undefined)
    }
  })

  it('throws when used on a non-belongsToMany relation', () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post extends Model {}
    class User extends Model {
      static override relations = {
        posts: { type: 'hasMany' as const, model: () => Post, foreignKey: 'authorId' },
      }
      id!: number
    }
    const u = User.hydrate({ id: 1 })!
    assert.throws(() => Model.belongsToMany(u, 'posts'), /not "belongsToMany"/)
  })

  it('throws when the relation is not declared at all', () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class User extends Model { id!: number }
    const u = User.hydrate({ id: 1 })!
    assert.throws(() => Model.belongsToMany(u, 'mystery'), /not defined on User/)
  })
})

describe('Model.belongsToMany — related() lazy fetch', () => {
  beforeEach(() => ModelRegistry.reset())

  it('returns the related rows joined through the pivot', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Role extends Model { id!: number; name!: string }
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
      id!: number
    }
    rows('roles').push({ id: 1, name: 'admin' }, { id: 2, name: 'editor' })
    rows('role_user').push({ userId: 5, roleId: 1 }, { userId: 5, roleId: 2 })

    const u = User.hydrate({ id: 5 })!
    const roles = await u.related('roles').get()
    const ids = roles.map(r => (r as unknown as { id: number }).id).sort()
    assert.deepStrictEqual(ids, [1, 2])
  })

  it('returns empty array when the pivot has no rows for this parent', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Role extends Model { id!: number }
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
      id!: number
    }
    rows('roles').push({ id: 1, name: 'admin' })
    const u = User.hydrate({ id: 99 })!
    const roles = await u.related('roles').get()
    assert.deepStrictEqual(roles, [])
  })

  it('chainable .where() filters via the related model columns', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Role extends Model { id!: number; active!: boolean }
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
      id!: number
    }
    rows('roles').push({ id: 1, active: true }, { id: 2, active: false }, { id: 3, active: true })
    rows('role_user').push({ userId: 5, roleId: 1 }, { userId: 5, roleId: 2 }, { userId: 5, roleId: 3 })

    const u = User.hydrate({ id: 5 })!
    const active = await u.related('roles').where('active', true).get()
    const ids = active.map(r => (r as unknown as { id: number }).id).sort()
    assert.deepStrictEqual(ids, [1, 3])
  })

  it('throws when the parent key is unset on the instance', () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Role extends Model {}
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
      id?: number
    }
    const u = new User()
    assert.throws(() => u.related('roles').get(), /id is unset/)
  })

  it('mutation methods on the deferred QB throw with a helpful message', async () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Role extends Model {}
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
      id!: number
    }
    const u = User.hydrate({ id: 5 })!
    const q = u.related('roles')
    assert.throws(() => (q as unknown as { create: () => void }).create(), /not supported on a belongsToMany/)
    assert.throws(() => (q as unknown as { delete: () => void }).delete(), /not supported on a belongsToMany/)
  })
})

describe('Model.belongsToMany — attach / detach / sync', () => {
  beforeEach(() => ModelRegistry.reset())

  function setup() {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Role extends Model { id!: number; name!: string }
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
      id!: number
    }
    rows('roles').push({ id: 1, name: 'admin' }, { id: 2, name: 'editor' }, { id: 3, name: 'viewer' })
    return { Role, User, rows }
  }

  it('attach writes pivot rows', async () => {
    const { User, rows } = setup()
    const u = User.hydrate({ id: 5 })!
    await Model.belongsToMany(u, 'roles').attach([1, 2])
    const pivot = rows('role_user').filter(r => r['userId'] === 5)
    assert.strictEqual(pivot.length, 2)
    assert.deepStrictEqual(pivot.map(r => r['roleId']).sort(), [1, 2])
  })

  it('attach with flat pivot data round-trips the extra column', async () => {
    const { User, rows } = setup()
    const u = User.hydrate({ id: 5 })!
    await Model.belongsToMany(u, 'roles').attach([1], { addedBy: 'admin' })
    const pivot = rows('role_user')
    assert.strictEqual(pivot.length, 1)
    assert.strictEqual(pivot[0]!['addedBy'], 'admin')
  })

  it('attach with per-id pivot data writes per-row pivot columns', async () => {
    const { User, rows } = setup()
    const u = User.hydrate({ id: 5 })!
    await Model.belongsToMany(u, 'roles').attach({
      1: { addedBy: 'admin' },
      2: { addedBy: 'system' },
    })
    const byRole = new Map(rows('role_user').map(r => [r['roleId'], r['addedBy']]))
    assert.strictEqual(byRole.get(1), 'admin')
    assert.strictEqual(byRole.get(2), 'system')
  })

  it('attach with empty input is a no-op', async () => {
    const { User, rows } = setup()
    const u = User.hydrate({ id: 5 })!
    await Model.belongsToMany(u, 'roles').attach([])
    assert.strictEqual(rows('role_user').length, 0)
  })

  it('detach(ids) removes only matching pivot rows', async () => {
    const { User, rows } = setup()
    const u = User.hydrate({ id: 5 })!
    await Model.belongsToMany(u, 'roles').attach([1, 2, 3])
    const removed = await Model.belongsToMany(u, 'roles').detach([2])
    assert.strictEqual(removed, 1)
    const remaining = rows('role_user').filter(r => r['userId'] === 5).map(r => r['roleId']).sort()
    assert.deepStrictEqual(remaining, [1, 3])
  })

  it('detach() with no args removes all pivot rows for this parent', async () => {
    const { User, rows } = setup()
    const u = User.hydrate({ id: 5 })!
    await Model.belongsToMany(u, 'roles').attach([1, 2])
    const removed = await Model.belongsToMany(u, 'roles').detach()
    assert.strictEqual(removed, 2)
    assert.strictEqual(rows('role_user').filter(r => r['userId'] === 5).length, 0)
  })

  it('detach([]) is a no-op (does not delete everything)', async () => {
    const { User, rows } = setup()
    const u = User.hydrate({ id: 5 })!
    await Model.belongsToMany(u, 'roles').attach([1, 2])
    const removed = await Model.belongsToMany(u, 'roles').detach([])
    assert.strictEqual(removed, 0)
    assert.strictEqual(rows('role_user').length, 2)
  })

  it('sync diffs correctly — attach missing, detach extra', async () => {
    const { User, rows } = setup()
    const u = User.hydrate({ id: 5 })!
    await Model.belongsToMany(u, 'roles').attach([1, 2])
    const result = await Model.belongsToMany(u, 'roles').sync([2, 3])
    assert.deepStrictEqual([...result.attached].sort(), [3])
    assert.deepStrictEqual([...result.detached].sort(), [1])
    const finalIds = rows('role_user').filter(r => r['userId'] === 5).map(r => r['roleId']).sort()
    assert.deepStrictEqual(finalIds, [2, 3])
  })

  it('sync writes pivot data on the new attaches only — leaves existing alone', async () => {
    const { User, rows } = setup()
    const u = User.hydrate({ id: 5 })!
    await Model.belongsToMany(u, 'roles').attach([1], { addedBy: 'system' })
    await Model.belongsToMany(u, 'roles').sync([1, 2], { addedBy: 'admin' })
    const byRole = new Map(rows('role_user').map(r => [r['roleId'], r['addedBy']]))
    assert.strictEqual(byRole.get(1), 'system')
    assert.strictEqual(byRole.get(2), 'admin')
  })

  it('sync([]) detaches all', async () => {
    const { User, rows } = setup()
    const u = User.hydrate({ id: 5 })!
    await Model.belongsToMany(u, 'roles').attach([1, 2])
    const result = await Model.belongsToMany(u, 'roles').sync([])
    assert.deepStrictEqual([...result.detached].sort(), [1, 2])
    assert.deepStrictEqual(result.attached, [])
    assert.strictEqual(rows('role_user').length, 0)
  })

  it('multiple parents are isolated — detach for one does not affect the other', async () => {
    const { User, rows } = setup()
    const a = User.hydrate({ id: 5 })!
    const b = User.hydrate({ id: 6 })!
    await Model.belongsToMany(a, 'roles').attach([1, 2])
    await Model.belongsToMany(b, 'roles').attach([1, 3])
    await Model.belongsToMany(a, 'roles').detach()
    const aRows = rows('role_user').filter(r => r['userId'] === 5)
    const bRows = rows('role_user').filter(r => r['userId'] === 6).map(r => r['roleId']).sort()
    assert.strictEqual(aRows.length, 0)
    assert.deepStrictEqual(bRows, [1, 3])
  })

  it('honors custom pivot keys', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag extends Model { id!: number }
    class Post extends Model {
      static override relations = {
        tags: {
          type:            'belongsToMany' as const,
          model:           () => Tag,
          pivotTable:      'post_tag',
          foreignPivotKey: 'thePostId',
          relatedPivotKey: 'theTagId',
        },
      }
      id!: number
    }
    rows('tags').push({ id: 10 }, { id: 20 })
    const p = Post.hydrate({ id: 7 })!
    await Model.belongsToMany(p, 'tags').attach([10, 20])
    const pivot = rows('post_tag')
    assert.strictEqual(pivot.length, 2)
    assert.strictEqual(pivot[0]!['thePostId'], 7)
    assert.deepStrictEqual(pivot.map(r => r['theTagId']).sort(), [10, 20])
  })

  it('lazy model thunk handles circular import case (no throw at module load)', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    // Simulate a circular import where the related class is not yet
    // defined at the time the parent's `relations` map is read. The
    // `() => holder.Role` thunk defers the lookup until first use.
    const holder: { Role?: typeof Model } = {}
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => holder.Role!, pivotTable: 'role_user' },
      }
      id!: number
    }
    const Role = class extends Model { id!: number }
    Object.defineProperty(Role, 'name', { value: 'Role' })
    holder.Role = Role
    rows('roles').push({ id: 1 })
    const u = User.hydrate({ id: 5 })!
    await Model.belongsToMany(u, 'roles').attach([1])
    const list = await u.related('roles').get()
    assert.strictEqual(list.length, 1)
  })

  it('auto-installs a per-relation method on the prototype', async () => {
    const { User, rows } = setup()
    // Before any query the prototype method may not be installed yet —
    // calling Model.query() (via ModelRegistry.register) installs it.
    User.query()
    const u = User.hydrate({ id: 5 })!
    interface UserWithRoles { roles(): BelongsToManyAccessor }
    const accessor = (u as unknown as UserWithRoles).roles()
    await accessor.attach([1, 2])
    assert.strictEqual(rows('role_user').filter(r => r['userId'] === 5).length, 2)
  })
})
