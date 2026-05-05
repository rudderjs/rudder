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

// ─── Dirty Tracking ────────────────────────────────────────────────────────────

describe('Model dirty tracking', () => {
  beforeEach(() => ModelRegistry.reset())

  it('new Model() with property set is dirty', () => {
    class User extends Model { id?: number; name?: string }
    const u = new User()
    u.name = 'Alice'
    assert.equal(u.isDirty(), true)
    assert.equal(u.isDirty('name'), true)
    assert.equal(u.isClean(), false)
    assert.deepStrictEqual(u.getDirty(), { name: 'Alice' })
  })

  it('hydrate() captures original snapshot, not dirty', () => {
    class User extends Model { id!: number; name!: string }
    const u = User.hydrate({ id: 1, name: 'Alice' })!
    assert.equal(u.isDirty(), false)
    assert.equal(u.isClean(), true)
    assert.deepStrictEqual(u.getOriginal(), { id: 1, name: 'Alice' })
    assert.equal(u.getOriginal('name'), 'Alice')
  })

  it('mutating a hydrated instance flips it dirty', () => {
    class User extends Model { id!: number; email!: string }
    const u = User.hydrate({ id: 1, email: 'a@x.com' })!
    u.email = 'b@x.com'
    assert.equal(u.isDirty('email'), true)
    assert.equal(u.getOriginal('email'), 'a@x.com')
    assert.deepStrictEqual(u.getDirty(), { email: 'b@x.com' })
  })

  it('save() after mutation: not dirty, wasChanged true, getChanges populated', async () => {
    const qb = makeQb({
      update: async (id, data) => ({ id, ...(data as object) }),
    })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id!: number; email!: string }

    const u = User.hydrate({ id: 1, email: 'a@x.com' })!
    u.email = 'b@x.com'
    await u.save()
    assert.equal(u.isDirty(), false)
    assert.equal(u.wasChanged(), true)
    assert.equal(u.wasChanged('email'), true)
    assert.deepStrictEqual(u.getChanges(), { email: 'b@x.com' })
  })

  it('second save() with no mutation: wasChanged false, getChanges empty', async () => {
    const qb = makeQb({
      update: async (id, data) => ({ id, ...(data as object) }),
    })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id!: number; email!: string }

    const u = User.hydrate({ id: 1, email: 'a@x.com' })!
    u.email = 'b@x.com'
    await u.save()
    await u.save()
    assert.equal(u.wasChanged(), false)
    assert.deepStrictEqual(u.getChanges(), {})
  })

  it('refresh() resets dirty + changes', async () => {
    const qb = makeQb({
      find: async () => ({ id: 1, name: 'Fresh' }),
    })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id!: number; name!: string }

    const u = User.hydrate({ id: 1, name: 'Stale' })!
    u.name = 'Mutated'
    await u.refresh()
    assert.equal(u.name, 'Fresh')
    assert.equal(u.isDirty(), false)
    assert.equal(u.wasChanged(), false)
    assert.deepStrictEqual(u.getChanges(), {})
  })

  it('JSON cast — same content, different reference is not dirty', () => {
    class User extends Model { id!: number; meta!: Record<string, unknown> }
    const u = User.hydrate({ id: 1, meta: { a: 1, b: 2 } })!
    u.meta = { a: 1, b: 2 }
    assert.equal(u.isDirty('meta'), false)
    assert.equal(u.isDirty(), false)
  })

  it('JSON cast — different content is dirty', () => {
    class User extends Model { id!: number; meta!: Record<string, unknown> }
    const u = User.hydrate({ id: 1, meta: { a: 1 } })!
    u.meta = { a: 2 }
    assert.equal(u.isDirty('meta'), true)
  })

  it('Date cast — same epoch is not dirty', () => {
    class User extends Model { id!: number; createdAt!: Date }
    const original = new Date(2026, 0, 1)
    const u = User.hydrate({ id: 1, createdAt: original })!
    u.createdAt = new Date(2026, 0, 1) // different ref, same epoch
    assert.equal(u.isDirty('createdAt'), false)
  })

  it('Date cast — different epoch is dirty', () => {
    class User extends Model { id!: number; createdAt!: Date }
    const u = User.hydrate({ id: 1, createdAt: new Date(2026, 0, 1) })!
    u.createdAt = new Date(2026, 0, 2)
    assert.equal(u.isDirty('createdAt'), true)
  })

  it('instance.increment() re-baselines (not dirty after)', async () => {
    const qb = makeQb({
      increment: async (id, col, amount) => ({ id, [col]: 5 + (amount ?? 1) }),
    })
    ModelRegistry.set(makeAdapter(qb))
    class Post extends Model { id!: number; viewCount!: number }

    const p = Post.hydrate({ id: 1, viewCount: 5 })!
    await p.increment('viewCount', 1)
    assert.equal(p.viewCount, 6)
    assert.equal(p.isDirty(), false)
    assert.equal(p.isDirty('viewCount'), false)
  })

  it('replicate() yields an unsaved clone with empty original', () => {
    class Post extends Model { id?: number; title?: string }
    const original = Post.hydrate({ id: 1, title: 'First' })!
    const clone = original.replicate()
    assert.equal(clone.title, 'First')
    assert.equal(clone.isDirty(), true) // values present, no original
    assert.deepStrictEqual(clone.getOriginal(), {})
  })

  it('isClean(key) is the inverse of isDirty(key)', () => {
    class User extends Model { id!: number; name!: string }
    const u = User.hydrate({ id: 1, name: 'A' })!
    assert.equal(u.isClean('name'), true)
    u.name = 'B'
    assert.equal(u.isClean('name'), false)
    assert.equal(u.isClean('id'), true)
  })

  it('getOriginal() returns a copy, not the live snapshot', () => {
    class User extends Model { id!: number; name!: string }
    const u = User.hydrate({ id: 1, name: 'A' })!
    const snap = u.getOriginal() as Record<string, unknown>
    snap.name = 'tampered'
    assert.equal(u.getOriginal('name'), 'A')
  })

  it('save() after creating new instance: id set, not dirty, wasChanged true', async () => {
    const qb = makeQb({
      create: async (data) => ({ id: 42, ...(data as object) }),
    })
    ModelRegistry.set(makeAdapter(qb))
    class User extends Model { id?: number; name?: string }

    const u = new User()
    u.name = 'Alice'
    await u.save()
    assert.equal(u.id, 42)
    assert.equal(u.isDirty(), false)
    assert.equal(u.wasChanged(), true)
    // Both the new id and the persisted name appear in changes.
    assert.equal(u.wasChanged('id'), true)
    assert.equal(u.wasChanged('name'), true)
  })
})
