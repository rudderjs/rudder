import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, JsonResource, type QueryBuilder, type OrmAdapter } from './index.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

class Post extends Model {
  static override table = 'posts'
}

class User extends Model {
  static override table = 'users'
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => Post },
  }
}

// Subclass exposing the protected helpers so tests can call them directly on
// arbitrary hydrated instances (the helpers are `protected` by design).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
class ProbeResource extends JsonResource<any> {
  toArray() {
    return {
      id:         this.resource.id,
      email:      this.whenHas('email'),
      role:       this.whenHas('role', 'elevated'),
      bio:        this.whenHas('bio', this.resource.bio, 'no bio'),
      postsCount: this.whenCounted('posts'),
      drafts:     this.whenCounted('drafts', 0),
      totalViews: this.whenAggregated('posts', 'sum', 'views'),
      hasPosts:   this.whenAggregated('posts', 'exists'),
    }
  }
}

/** Minimal adapter — `withAggregate` is a chainable no-op; `get` returns the
 *  canned rows (alias columns included, the way a real adapter responds). */
function adapterReturning(rows: Array<Record<string, unknown>>): OrmAdapter {
  const qb = {
    where: () => qb,
    orderBy: () => qb,
    limit: () => qb,
    offset: () => qb,
    withAggregate: () => qb,
    get: async () => rows,
    first: async () => rows[0] ?? null,
  } as unknown as QueryBuilder<unknown>
  return {
    query: (() => qb) as OrmAdapter['query'],
    connect: async () => undefined,
    disconnect: async () => undefined,
  }
}

// ─── whenHas ──────────────────────────────────────────────────────────────────

describe('whenHas', () => {
  it('includes the attribute value when present (value defaults to the attribute)', () => {
    const out = new ProbeResource({ id: 1, email: 'ada@example.com' }).toArray()
    assert.equal(out['email'], 'ada@example.com')
  })

  it('returns the explicit value when the attribute is present', () => {
    const out = new ProbeResource({ id: 1, role: 'admin' }).toArray()
    assert.equal(out['role'], 'elevated')
  })

  it('omits when the attribute is absent (partial-select hydration)', () => {
    // Hydrated from a partial select — `email` was never selected.
    const user = User.hydrate({ id: 1, name: 'Ada' })
    const out = new ProbeResource(user).toArray()
    assert.equal(out['email'], undefined)
    assert.equal(out['role'], undefined)
  })

  it('falls back when absent and a fallback is given', () => {
    const out = new ProbeResource({ id: 1 }).toArray()
    assert.equal(out['bio'], 'no bio')
  })

  it('treats an undefined own property as absent', () => {
    const out = new ProbeResource({ id: 1, email: undefined }).toArray()
    assert.equal(out['email'], undefined)
  })
})

// ─── whenCounted / whenAggregated ────────────────────────────────────────────

describe('whenCounted / whenAggregated', () => {
  beforeEach(() => ModelRegistry.reset())

  it('includes the stamped count after a withCount query', async () => {
    ModelRegistry.set(adapterReturning([{ id: 1, postsCount: 3 }]))
    const [user] = await User.withCount('posts').get()
    const out = new ProbeResource(user).toArray()
    assert.equal(out['postsCount'], 3)
  })

  it('a stamped zero count is included (not mistaken for missing)', async () => {
    ModelRegistry.set(adapterReturning([{ id: 1, postsCount: 0 }]))
    const [user] = await User.withCount('posts').get()
    const out = new ProbeResource(user).toArray()
    assert.equal(out['postsCount'], 0)
  })

  it('omits the count on a plain query (no withCount)', async () => {
    ModelRegistry.set(adapterReturning([{ id: 1 }]))
    const [user] = await User.where('id', 1).get()
    const out = new ProbeResource(user).toArray()
    assert.equal(out['postsCount'], undefined)
  })

  it('whenCounted falls back when the count was not loaded', async () => {
    ModelRegistry.set(adapterReturning([{ id: 1 }]))
    const [user] = await User.where('id', 1).get()
    const out = new ProbeResource(user).toArray()
    assert.equal(out['drafts'], 0)
  })

  it('whenAggregated reads the deterministic sum alias after withSum', async () => {
    ModelRegistry.set(adapterReturning([{ id: 1, postsSumViews: 42 }]))
    const [user] = await User.withSum('posts', 'views').get()
    const out = new ProbeResource(user).toArray()
    assert.equal(out['totalViews'], 42)
  })

  it('whenAggregated reads the exists alias after withExists', async () => {
    ModelRegistry.set(adapterReturning([{ id: 1, postsExists: true }]))
    const [user] = await User.withExists('posts').get()
    const out = new ProbeResource(user).toArray()
    assert.equal(out['hasPosts'], true)
  })

  it('omits aggregates on a plain query', async () => {
    ModelRegistry.set(adapterReturning([{ id: 1 }]))
    const [user] = await User.where('id', 1).get()
    const out = new ProbeResource(user).toArray()
    assert.equal(out['totalViews'], undefined)
    assert.equal(out['hasPosts'], undefined)
  })
})
