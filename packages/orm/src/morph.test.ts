import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, type QueryBuilder, type OrmAdapter } from './index.js'

// ─── In-memory adapter (parallel to index.test.ts:1799) ──────────────────────

type Where = [string, string, unknown]

function memoryAdapter(): {
  adapter: OrmAdapter
  rows: (table: string) => Record<string, unknown>[]
} {
  const tables = new Map<string, Record<string, unknown>[]>()
  const ensure = (table: string): Record<string, unknown>[] => {
    if (!tables.has(table)) tables.set(table, [])
    return tables.get(table)!
  }

  const matches = (row: Record<string, unknown>, wheres: ReadonlyArray<Where>): boolean => {
    for (const [col, op, val] of wheres) {
      const v = row[col]
      switch (op) {
        case '=':  if (v !== val) return false; break
        case '!=': if (v === val) return false; break
        default: throw new Error(`memoryAdapter: unsupported op ${op}`)
      }
    }
    return true
  }

  const makeQbFor = <T>(table: string): QueryBuilder<T> => {
    const wheres: Where[] = []
    let softDeletesEnabled = false
    const qb: QueryBuilder<T> = {
      where: ((col: string, opOrVal: unknown, maybeVal?: unknown) => {
        const op  = maybeVal === undefined ? '=' : String(opOrVal)
        const val = maybeVal === undefined ? opOrVal : maybeVal
        wheres.push([col, op, val])
        return qb
      }) as QueryBuilder<T>['where'],
      orWhere: () => qb,
      orderBy: () => qb,
      limit:   () => qb,
      offset:  () => qb,
      with:    () => qb,
      withTrashed: () => qb,
      onlyTrashed: () => qb,
      first: async () => {
        const list = ensure(table).filter(r => {
          if (softDeletesEnabled && r['deletedAt'] !== null && r['deletedAt'] !== undefined) return false
          return matches(r, wheres)
        })
        return (list[0] ?? null) as T | null
      },
      find: async (id) => (ensure(table).find(r => r['id'] === id) ?? null) as T | null,
      get:  async () => ensure(table).filter(r => {
        if (softDeletesEnabled && r['deletedAt'] !== null && r['deletedAt'] !== undefined) return false
        return matches(r, wheres)
      }) as T[],
      all:   async () => [...ensure(table)] as T[],
      count: async () => ensure(table).filter(r => matches(r, wheres)).length,
      create: async (data) => {
        const data2 = data as Record<string, unknown>
        const row = { id: data2['id'] ?? ensure(table).length + 1, ...data2 }
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
      restore:     async () => ({} as T),
      forceDelete: async (id) => {
        const list = ensure(table)
        const i = list.findIndex(r => r['id'] === id)
        if (i >= 0) list.splice(i, 1)
      },
      increment:  async () => ({} as T),
      decrement:  async () => ({} as T),
      insertMany: async () => undefined,
      deleteAll:  async () => 0,
      paginate:   async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
    }
    ;(qb as unknown as { _enableSoftDeletes: () => void })._enableSoftDeletes = () => {
      softDeletesEnabled = true
    }
    ;(qb as unknown as { _recordedWheres: ReadonlyArray<Where> })._recordedWheres = wheres
    return qb
  }

  return {
    adapter: {
      query: <T,>(table: string) => makeQbFor<T>(table),
      connect:    async () => undefined,
      disconnect: async () => undefined,
    },
    rows: (table: string) => ensure(table),
  }
}

// ─── morphMany / morphOne (parent side) ──────────────────────────────────────

describe('Model.related — morphMany', () => {
  beforeEach(() => ModelRegistry.reset())

  it('filters by {morphName}Id and {morphName}Type with default discriminator', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Comment extends Model { id!: number; commentableId!: number; commentableType!: string }
    class Post extends Model {
      static override relations = {
        comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
      }
      id!: number
    }
    rows('comments').push(
      { id: 1, commentableId: 5, commentableType: 'Post', body: 'a' },
      { id: 2, commentableId: 5, commentableType: 'Post', body: 'b' },
      { id: 3, commentableId: 5, commentableType: 'Video', body: 'c' },
      { id: 4, commentableId: 9, commentableType: 'Post', body: 'd' },
    )
    const post = Post.hydrate({ id: 5 })!
    const comments = await post.related('comments').get()
    const ids = comments.map(c => (c as unknown as { id: number }).id).sort()
    assert.deepStrictEqual(ids, [1, 2])
  })

  it('honors morphAlias on the parent class', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Comment extends Model { id!: number; commentableId!: number; commentableType!: string }
    class BlogPost extends Model {
      static override morphAlias = 'post'
      static override relations = {
        comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
      }
      id!: number
    }
    rows('comments').push(
      { id: 1, commentableId: 5, commentableType: 'post' },
      { id: 2, commentableId: 5, commentableType: 'BlogPost' },
    )
    const post = BlogPost.hydrate({ id: 5 })!
    const comments = await post.related('comments').get()
    const ids = comments.map(c => (c as unknown as { id: number }).id)
    assert.deepStrictEqual(ids, [1])
  })

  it('honors morphType override on the relation (wins over class-level alias)', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Comment extends Model { id!: number; commentableId!: number; commentableType!: string }
    class Post extends Model {
      static override morphAlias = 'post'
      static override relations = {
        comments: {
          type: 'morphMany' as const,
          model: () => Comment,
          morphName: 'commentable',
          morphType: 'CUSTOM',
        },
      }
      id!: number
    }
    rows('comments').push(
      { id: 1, commentableId: 5, commentableType: 'CUSTOM' },
      { id: 2, commentableId: 5, commentableType: 'post' },
    )
    const post = Post.hydrate({ id: 5 })!
    const comments = await post.related('comments').get()
    const ids = comments.map(c => (c as unknown as { id: number }).id)
    assert.deepStrictEqual(ids, [1])
  })

  it('throws when the parent has no value for the local key', async () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Comment extends Model {}
    class Post extends Model {
      static override relations = {
        comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
      }
      id!: number
    }
    const post = Post.hydrate({ id: null as unknown as number })!
    assert.throws(
      () => post.related('comments'),
      /id is unset/,
    )
  })

  it('honors localKey override on the relation', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Comment extends Model { id!: number; commentableId!: number; commentableType!: string }
    class Post extends Model {
      static override relations = {
        comments: {
          type: 'morphMany' as const,
          model: () => Comment,
          morphName: 'commentable',
          localKey: 'uuid',
        },
      }
      id!: number
      uuid!: string
    }
    rows('comments').push(
      { id: 1, commentableId: 'abc', commentableType: 'Post' },
      { id: 2, commentableId: 'def', commentableType: 'Post' },
    )
    const post = Post.hydrate({ id: 5, uuid: 'abc' })!
    const comments = await post.related('comments').get()
    const ids = comments.map(c => (c as unknown as { id: number }).id)
    assert.deepStrictEqual(ids, [1])
  })
})

describe('Model.related — morphOne', () => {
  beforeEach(() => ModelRegistry.reset())

  it('produces the same shape as morphMany (consumer differs only by first vs get)', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Image extends Model { id!: number; imageableId!: number; imageableType!: string; url!: string }
    class User extends Model {
      static override relations = {
        avatar: { type: 'morphOne' as const, model: () => Image, morphName: 'imageable' },
      }
      id!: number
    }
    rows('images').push(
      { id: 1, imageableId: 7, imageableType: 'User', url: '/a.png' },
      { id: 2, imageableId: 7, imageableType: 'Post', url: '/b.png' },
    )
    const user = User.hydrate({ id: 7 })!
    const avatar = await user.related('avatar').first()
    assert.strictEqual((avatar as unknown as { url: string }).url, '/a.png')
  })
})

// ─── morphTo (child side) ────────────────────────────────────────────────────

describe('Model.related — morphTo', () => {
  beforeEach(() => ModelRegistry.reset())

  it('resolves to the correct target class by discriminator', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post  extends Model { id!: number; title!: string }
    class Video extends Model { id!: number; url!: string }
    class Comment extends Model {
      static override relations = {
        commentable: {
          type: 'morphTo' as const,
          morphName: 'commentable',
          types: () => [Post, Video],
        },
      }
      id!: number
      commentableId!: number
      commentableType!: string
    }
    rows('posts').push({ id: 5, title: 'hello' })
    rows('videos').push({ id: 5, url: '/v' })

    const cPost  = Comment.hydrate({ id: 1, commentableId: 5, commentableType: 'Post' })!
    const cVideo = Comment.hydrate({ id: 2, commentableId: 5, commentableType: 'Video' })!
    const post  = await cPost.related('commentable').first()
    const video = await cVideo.related('commentable').first()
    assert.strictEqual((post  as unknown as { title: string }).title, 'hello')
    assert.strictEqual((video as unknown as { url:   string }).url,   '/v')
  })

  it('honors target class morphAlias for discriminator lookup', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class BlogPost extends Model {
      static override morphAlias = 'post'
      id!: number
      title!: string
    }
    class Comment extends Model {
      static override relations = {
        commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [BlogPost] },
      }
      id!: number
      commentableId!: number
      commentableType!: string
    }
    rows('blogposts').push({ id: 5, title: 'aliased' })
    const c = Comment.hydrate({ id: 1, commentableId: 5, commentableType: 'post' })!
    const post = await c.related('commentable').first()
    assert.strictEqual((post as unknown as { title: string }).title, 'aliased')
  })

  it('throws when the discriminator value is not in the types list', () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post  extends Model {}
    class Video extends Model {}
    class Comment extends Model {
      static override relations = {
        commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post, Video] },
      }
      id!: number
      commentableId!: number
      commentableType!: string
    }
    const c = Comment.hydrate({ id: 1, commentableId: 5, commentableType: 'Audio' })!
    assert.throws(
      () => c.related('commentable'),
      /unknown commentableType = "Audio".*Allowed: Post, Video/,
    )
  })

  it('throws when {morphName}Id is unset', () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post extends Model {}
    class Comment extends Model {
      static override relations = {
        commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post] },
      }
      id!: number
    }
    const c = Comment.hydrate({ id: 1, commentableType: 'Post' })!
    assert.throws(
      () => c.related('commentable'),
      /commentableId\/commentableType unset/,
    )
  })

  it('throws when {morphName}Type is unset', () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post extends Model {}
    class Comment extends Model {
      static override relations = {
        commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post] },
      }
      id!: number
    }
    const c = Comment.hydrate({ id: 1, commentableId: 5 })!
    assert.throws(
      () => c.related('commentable'),
      /commentableId\/commentableType unset/,
    )
  })

  it('throws with explicit message when types: () => [] is empty', () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Comment extends Model {
      static override relations = {
        commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [] },
      }
      id!: number
    }
    const c = Comment.hydrate({ id: 1, commentableId: 5, commentableType: 'Post' })!
    assert.throws(
      () => c.related('commentable'),
      /`types: \(\) => \[\.\.\.\]` is empty/,
    )
  })

  it('detects duplicate discriminators across types in dev mode', () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post extends Model { static override morphAlias = 'thing' }
    class Video extends Model { static override morphAlias = 'thing' }
    class Comment extends Model {
      static override relations = {
        commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post, Video] },
      }
      id!: number
    }
    const prevEnv = process.env['NODE_ENV']
    delete process.env['NODE_ENV']
    try {
      const c = Comment.hydrate({ id: 1, commentableId: 5, commentableType: 'thing' })!
      assert.throws(
        () => c.related('commentable'),
        /duplicate discriminator "thing".*both Post and Video/,
      )
    } finally {
      if (prevEnv !== undefined) process.env['NODE_ENV'] = prevEnv
    }
  })

  it('honors the target class primaryKey override', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post extends Model {
      static override primaryKey = 'uuid'
      uuid!: string
      title!: string
    }
    class Comment extends Model {
      static override relations = {
        commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post] },
      }
      id!: number
      commentableId!: string
      commentableType!: string
    }
    rows('posts').push({ uuid: 'abc-123', title: 'pk override' })
    const c = Comment.hydrate({ id: 1, commentableId: 'abc-123', commentableType: 'Post' })!
    const post = await c.related('commentable').first()
    assert.strictEqual((post as unknown as { title: string }).title, 'pk override')
  })

  it('passes through to Target.where so soft-deleted targets are excluded', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post extends Model {
      static override softDeletes = true
      id!: number
      title!: string
      deletedAt!: Date | null
    }
    class Comment extends Model {
      static override relations = {
        commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post] },
      }
      id!: number
      commentableId!: number
      commentableType!: string
    }
    rows('posts').push({ id: 5, title: 'gone', deletedAt: new Date() })
    const c = Comment.hydrate({ id: 1, commentableId: 5, commentableType: 'Post' })!
    const post = await c.related('commentable').first()
    assert.strictEqual(post, null)
  })
})

// ─── Model.morph() write helper ──────────────────────────────────────────────

describe('Model.morph — write helper', () => {
  beforeEach(() => ModelRegistry.reset())

  it('returns { nameId, nameType } using class name by default', () => {
    class Post extends Model { id!: number }
    const post = Post.hydrate({ id: 7 })!
    const payload = Model.morph('commentable', post)
    assert.deepStrictEqual(payload, { commentableId: 7, commentableType: 'Post' })
  })

  it('honors morphAlias on the parent class', () => {
    class BlogPost extends Model {
      static override morphAlias = 'post'
      id!: number
    }
    const post = BlogPost.hydrate({ id: 7 })!
    const payload = Model.morph('commentable', post)
    assert.deepStrictEqual(payload, { commentableId: 7, commentableType: 'post' })
  })

  it('throws when the parent primary key is unset', () => {
    class Post extends Model { id!: number }
    const post = Post.hydrate({ id: null as unknown as number })!
    assert.throws(
      () => Model.morph('commentable', post),
      /parent\.id is unset — save the parent first/,
    )
  })

  it('honors a parent with overridden primaryKey', () => {
    class Post extends Model {
      static override primaryKey = 'uuid'
      uuid!: string
    }
    const post = Post.hydrate({ uuid: 'abc-123' })!
    const payload = Model.morph('commentable', post)
    assert.deepStrictEqual(payload, { commentableId: 'abc-123', commentableType: 'Post' })
  })
})
