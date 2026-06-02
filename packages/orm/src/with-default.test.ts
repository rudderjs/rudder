import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, type QueryBuilder, type OrmAdapter, type RelationDefault } from './index.js'

const rec = (v: unknown): Record<string, unknown> => v as Record<string, unknown>

// ─── Minimal in-memory adapter (where =/IN, first/get/all) with a
// `model-layer` eager strategy so `with()` resolves through the ORM's
// batched direct-relation loader — exercising the withDefault post-pass on
// real (non-null) and missing relations alike. ─────────────────────────────

type Where = [string, string, unknown]

function memoryAdapter(): {
  adapter: OrmAdapter
  rows: (table: string) => Record<string, unknown>[]
} {
  const tables = new Map<string, Record<string, unknown>[]>()
  const ensure = (t: string): Record<string, unknown>[] => {
    if (!tables.has(t)) tables.set(t, [])
    return tables.get(t)!
  }
  const matches = (row: Record<string, unknown>, wheres: ReadonlyArray<Where>): boolean => {
    for (const [col, op, val] of wheres) {
      const v = row[col]
      if (op === '=') { if (v !== val) return false }
      else if (op === 'IN') { if (!Array.isArray(val) || !(val as unknown[]).includes(v)) return false }
      else throw new Error(`memoryAdapter: unsupported op ${op}`)
    }
    return true
  }
  const makeQb = <T,>(table: string): QueryBuilder<T> => {
    const wheres: Where[] = []
    const qb = {
      where: ((col: string, opOrVal: unknown, maybeVal?: unknown) => {
        wheres.push([col, maybeVal === undefined ? '=' : String(opOrVal), maybeVal === undefined ? opOrVal : maybeVal])
        return qb
      }) as QueryBuilder<T>['where'],
      orWhere: () => qb, selectRaw: () => qb, whereRaw: () => qb, orWhereRaw: () => qb, orderByRaw: () => qb,
      orderBy: () => qb, limit: () => qb, offset: () => qb, with: () => qb, withPivot: () => qb,
      withTrashed: () => qb, onlyTrashed: () => qb, whereRelationExists: () => qb, whereGroup: () => qb,
      orWhereGroup: () => qb, withAggregate: () => qb, _aggregate: async () => 0,
      first: async () => (ensure(table).find(r => matches(r, wheres)) ?? null) as T | null,
      find:  async (id: unknown) => (ensure(table).find(r => r['id'] === id) ?? null) as T | null,
      get:   async () => ensure(table).filter(r => matches(r, wheres)) as T[],
      all:   async () => [...ensure(table)] as T[],
      count: async () => ensure(table).filter(r => matches(r, wheres)).length,
      create: async (d: unknown) => { const row = { id: ensure(table).length + 1, ...(d as object) }; ensure(table).push(row); return row as T },
      update: async () => ({} as T), delete: async () => undefined, restore: async () => ({} as T),
      forceDelete: async () => undefined, increment: async () => ({} as T), decrement: async () => ({} as T),
      insertMany: async () => undefined, deleteAll: async () => 0, updateAll: async () => 0,
      paginate: async () => ({ data: ensure(table).filter(r => matches(r, wheres)) as T[], total: 0, perPage: 15, currentPage: 1, lastPage: 1, from: 1, to: 0 }),
    } as unknown as QueryBuilder<T>
    return qb
  }
  return {
    adapter: {
      query: <T,>(table: string) => makeQb<T>(table),
      connect: async () => undefined,
      disconnect: async () => undefined,
      eagerLoadStrategy: 'model-layer',
    },
    rows: (t: string) => ensure(t),
  }
}

// ─── belongsTo ──────────────────────────────────────────────────────────────

describe('withDefault — belongsTo', () => {
  beforeEach(() => ModelRegistry.reset())

  function setup(withDefault?: RelationDefault): { rows: (t: string) => Record<string, unknown>[]; Post: typeof Model; Author: typeof Model } {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Author extends Model { id!: number; name!: string }
    class Post extends Model {
      static override relations = {
        author: { type: 'belongsTo' as const, model: () => Author, foreignKey: 'authorId', ...(withDefault !== undefined ? { withDefault } : {}) },
      }
      id!: number; authorId!: number | null
    }
    return { rows, Post, Author }
  }

  it('lazy: returns the default instance when the FK is null (true form)', async () => {
    const { rows, Post, Author } = setup(true)
    rows('posts').push({ id: 1, authorId: null })
    const post = Post.hydrate({ id: 1, authorId: null })!
    const author = await post.related('author').first()
    assert.ok(author instanceof Author)
    assert.strictEqual(rec(author)['id'], undefined) // unsaved
  })

  it('lazy: fills attributes from the object form', async () => {
    const { Post } = setup({ name: 'Guest' })
    const post = Post.hydrate({ id: 1, authorId: null })!
    const author = rec(await post.related('author').first())
    assert.strictEqual(author['name'], 'Guest')
  })

  it('lazy: callback form receives instance + parent', async () => {
    const { Post } = setup((a, p) => { rec(a)['name'] = `by-post-${rec(p)['id']}` })
    const post = Post.hydrate({ id: 9, authorId: null })!
    const author = rec(await post.related('author').first())
    assert.strictEqual(author['name'], 'by-post-9')
  })

  it('lazy: returns the REAL row when one exists (default not applied)', async () => {
    const { rows, Post } = setup({ name: 'Guest' })
    rows('authors').push({ id: 5, name: 'Ada' })
    const post = Post.hydrate({ id: 1, authorId: 5 })!
    const author = rec(await post.related('author').first())
    assert.strictEqual(author['id'], 5)
    assert.strictEqual(author['name'], 'Ada')
  })

  it('lazy: default survives a .where() chain', async () => {
    const { Post } = setup({ name: 'Guest' })
    const post = Post.hydrate({ id: 1, authorId: 999 })! // no such author row
    const author = rec(await post.related('author').where('name', 'nope').first())
    assert.strictEqual(author['name'], 'Guest')
  })

  it('lazy: WITHOUT withDefault, a null FK still throws (back-compat)', async () => {
    const { Post } = setup(undefined)
    const post = Post.hydrate({ id: 1, authorId: null })!
    assert.throws(() => post.related('author'), /Cannot resolve belongsTo "author"/)
  })

  it('lazy: an unloaded FK column throws even with withDefault', async () => {
    const { Post } = setup(true)
    const post = Post.hydrate({ id: 1 })! // authorId not selected → undefined
    assert.throws(() => post.related('author'), /Cannot resolve belongsTo "author"/)
  })

  it('eager: substitutes the default only for parents whose author is missing', async () => {
    const { rows, Post } = setup({ name: 'Guest' })
    rows('authors').push({ id: 5, name: 'Ada' })
    rows('posts').push({ id: 1, authorId: 5 }, { id: 2, authorId: null })
    const posts = await Post.query().with('author').all() as unknown as Array<Record<string, unknown>>
    const byId = new Map(posts.map(p => [p['id'], rec(p['author'])]))
    assert.strictEqual(byId.get(1)!['id'], 5)         // real
    assert.strictEqual(byId.get(1)!['name'], 'Ada')
    assert.strictEqual(byId.get(2)!['id'], undefined) // default
    assert.strictEqual(byId.get(2)!['name'], 'Guest')
  })
})

// ─── hasOne ───────────────────────────────────────────────────────────────

describe('withDefault — hasOne', () => {
  beforeEach(() => ModelRegistry.reset())

  function setup(withDefault?: RelationDefault): { rows: (t: string) => Record<string, unknown>[]; User: typeof Model; Profile: typeof Model } {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Profile extends Model { id!: number; userId!: number; bio!: string }
    class User extends Model {
      static override relations = {
        profile: { type: 'hasOne' as const, model: () => Profile, ...(withDefault !== undefined ? { withDefault } : {}) },
      }
      id!: number
    }
    return { rows, User, Profile }
  }

  it('lazy: default when no profile exists', async () => {
    const { User, Profile } = setup({ bio: 'n/a' })
    const user = User.hydrate({ id: 1 })!
    const profile = await user.related('profile').first()
    assert.ok(profile instanceof Profile)
    assert.strictEqual(rec(profile)['bio'], 'n/a')
  })

  it('eager: default for users without a profile, real otherwise', async () => {
    const { rows, User } = setup({ bio: 'n/a' })
    rows('profiles').push({ id: 1, userId: 1, bio: 'hello' })
    rows('users').push({ id: 1 }, { id: 2 })
    const users = await User.query().with('profile').all() as unknown as Array<Record<string, unknown>>
    const byId = new Map(users.map(u => [u['id'], rec(u['profile'])]))
    assert.strictEqual(byId.get(1)!['bio'], 'hello')
    assert.strictEqual(byId.get(2)!['bio'], 'n/a')
  })
})

// ─── hasMany ignores withDefault ────────────────────────────────────────────

describe('withDefault — ignored on hasMany', () => {
  beforeEach(() => ModelRegistry.reset())

  it('hasMany with a withDefault still yields [] (no null-object)', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Comment extends Model { id!: number; postId!: number }
    class Post extends Model {
      static override relations = {
        // withDefault is meaningless here — exercised to prove it's ignored.
        comments: { type: 'hasMany' as const, model: () => Comment, withDefault: { body: 'x' } },
      }
      id!: number
    }
    rows('posts').push({ id: 1 })
    const posts = await Post.query().with('comments').all() as unknown as Array<Record<string, unknown>>
    assert.deepStrictEqual(posts[0]!['comments'], [])
    // lazy is a plain query — no default wrapping
    const post = Post.hydrate({ id: 1 })!
    assert.deepStrictEqual(await post.related('comments').get(), [])
  })
})
