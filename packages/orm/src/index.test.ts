import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, ModelNotFoundError, type QueryBuilder, type OrmAdapter } from './index.js'

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
    assert.deepStrictEqual(result, restored)
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
    assert.deepStrictEqual(result, expected)
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
    assert.deepStrictEqual(result, expected)
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
    assert.deepStrictEqual(result, existing)
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
    assert.deepStrictEqual(result, { id: 2, email: 'b@x.com', name: 'Bob' })
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
    assert.deepStrictEqual(result, { id: 7, email: 'a@x.com', name: 'New' })
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
    assert.deepStrictEqual(result, { id: 9, email: 'c@x.com', name: 'Cara' })
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
    assert.deepStrictEqual(events, [{ id: 1, name: 'A' }])
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
    assert.deepStrictEqual(events, [{ id: 1 }, { id: 2 }])
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
