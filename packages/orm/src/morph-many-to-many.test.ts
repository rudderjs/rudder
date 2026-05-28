import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, type QueryBuilder, type OrmAdapter } from './index.js'

// ─── In-memory adapter (extends morph.test.ts shape with IN + real
// insertMany / deleteAll, which the morph M2M code paths exercise) ──────────

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
        case 'IN':
          if (!Array.isArray(val) || !(val as unknown[]).includes(v)) return false
          break
        default: throw new Error(`memoryAdapter: unsupported op ${op}`)
      }
    }
    return true
  }

  const makeQbFor = <T,>(table: string): QueryBuilder<T> => {
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
      withPivot: () => qb,
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
      insertMany: async (records) => {
        for (const r of records as Array<Record<string, unknown>>) {
          ensure(table).push({ ...r })
        }
      },
      deleteAll: async () => {
        const list = ensure(table)
        const keep: Record<string, unknown>[] = []
        let removed = 0
        for (const r of list) {
          if (matches(r, wheres)) removed++
          else keep.push(r)
        }
        tables.set(table, keep)
        return removed
      },
      updateAll: async (data) => {
        const list = ensure(table)
        let updated = 0
        for (const r of list) {
          if (matches(r, wheres)) {
            Object.assign(r, data as Record<string, unknown>)
            updated++
          }
        }
        return updated
      },
      paginate:   async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
      whereRelationExists: () => qb,
      withAggregate: () => qb,
      _aggregate: async () => 0,
      whereGroup:   () => qb,
      orWhereGroup: () => qb,
    }
    ;(qb as unknown as { _enableSoftDeletes: () => void })._enableSoftDeletes = () => {
      softDeletesEnabled = true
    }
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

// ─── morphToMany — reads (parent side) ───────────────────────────────────────

describe('Model.related — morphToMany', () => {
  beforeEach(() => ModelRegistry.reset())

  it('returns related rows linked through the pivot, filtered by discriminator', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag  extends Model { id!: number; name!: string }
    class Post extends Model {
      static override relations = {
        tags: {
          type:       'morphToMany' as const,
          model:      () => Tag,
          pivotTable: 'taggable',
          morphName:  'taggable',
        },
      }
      id!: number
    }
    rows('tags').push({ id: 10, name: 'red' }, { id: 11, name: 'blue' }, { id: 12, name: 'green' })
    rows('taggable').push(
      { tagId: 10, taggableId: 1, taggableType: 'Post' },
      { tagId: 11, taggableId: 1, taggableType: 'Post' },
      { tagId: 12, taggableId: 1, taggableType: 'Video' }, // wrong discriminator
      { tagId: 11, taggableId: 2, taggableType: 'Post' },  // wrong parent id
    )
    const post = Post.hydrate({ id: 1 })!
    const tags = await post.related('tags').get()
    const ids = tags.map(t => (t as unknown as { id: number }).id).sort()
    assert.deepStrictEqual(ids, [10, 11])
  })

  it('honors morphAlias on the parent class', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag extends Model { id!: number; name!: string }
    class BlogPost extends Model {
      static override morphAlias = 'post'
      static override relations = {
        tags: {
          type:       'morphToMany' as const,
          model:      () => Tag,
          pivotTable: 'taggable',
          morphName:  'taggable',
        },
      }
      id!: number
    }
    rows('tags').push({ id: 10, name: 'red' })
    rows('taggable').push(
      { tagId: 10, taggableId: 1, taggableType: 'post' },
      { tagId: 10, taggableId: 1, taggableType: 'BlogPost' },
    )
    const post = BlogPost.hydrate({ id: 1 })!
    const tags = await post.related('tags').get()
    assert.strictEqual(tags.length, 1)
  })

  it('honors morphType override on the relation (wins over class-level alias)', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag extends Model { id!: number }
    class Post extends Model {
      static override morphAlias = 'post'
      static override relations = {
        tags: {
          type:       'morphToMany' as const,
          model:      () => Tag,
          pivotTable: 'taggable',
          morphName:  'taggable',
          morphType:  'CUSTOM',
        },
      }
      id!: number
    }
    rows('tags').push({ id: 10 })
    rows('taggable').push(
      { tagId: 10, taggableId: 1, taggableType: 'CUSTOM' },
      { tagId: 10, taggableId: 1, taggableType: 'post' },
    )
    const post = Post.hydrate({ id: 1 })!
    const tags = await post.related('tags').get()
    assert.strictEqual(tags.length, 1)
  })

  it('throws when the parent has no value for the parent key', () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag extends Model {}
    class Post extends Model {
      static override relations = {
        tags: {
          type:       'morphToMany' as const,
          model:      () => Tag,
          pivotTable: 'taggable',
          morphName:  'taggable',
        },
      }
      id!: number
    }
    const post = Post.hydrate({ id: null as unknown as number })!
    assert.throws(
      () => post.related('tags'),
      /id is null\/undefined/,
    )
  })
})

// ─── morphedByMany — reads (inverse side) ────────────────────────────────────

describe('Model.related — morphedByMany', () => {
  beforeEach(() => ModelRegistry.reset())

  it('walks back through the pivot to the related (polymorphic-side) class', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post  extends Model { id!: number; title!: string }
    class Video extends Model { id!: number; url!:   string }
    class Tag extends Model {
      static override relations = {
        posts: {
          type:       'morphedByMany' as const,
          model:      () => Post,
          pivotTable: 'taggable',
          morphName:  'taggable',
        },
        videos: {
          type:       'morphedByMany' as const,
          model:      () => Video,
          pivotTable: 'taggable',
          morphName:  'taggable',
        },
      }
      id!: number
    }
    rows('posts').push({ id: 1, title: 'first' }, { id: 2, title: 'second' })
    rows('videos').push({ id: 9, url: '/v9' })
    rows('taggable').push(
      { tagId: 7, taggableId: 1, taggableType: 'Post' },
      { tagId: 7, taggableId: 2, taggableType: 'Post' },
      { tagId: 7, taggableId: 9, taggableType: 'Video' },
      { tagId: 8, taggableId: 1, taggableType: 'Post' }, // different tag
    )
    const tag = Tag.hydrate({ id: 7 })!
    const taggedPosts  = await tag.related('posts').get()
    const taggedVideos = await tag.related('videos').get()

    const postIds  = taggedPosts.map(p  => (p  as unknown as { id: number }).id).sort()
    const videoIds = taggedVideos.map(v => (v as unknown as { id: number }).id).sort()
    assert.deepStrictEqual(postIds,  [1, 2])
    assert.deepStrictEqual(videoIds, [9])
  })

  it('honors morphAlias on the related class for inverse discriminator', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class BlogPost extends Model {
      static override morphAlias = 'post'
      id!: number
      title!: string
    }
    class Tag extends Model {
      static override relations = {
        posts: {
          type:       'morphedByMany' as const,
          model:      () => BlogPost,
          pivotTable: 'taggable',
          morphName:  'taggable',
        },
      }
      id!: number
    }
    rows('blogposts').push({ id: 1, title: 'aliased' })
    rows('taggable').push(
      { tagId: 7, taggableId: 1, taggableType: 'post' },
      { tagId: 7, taggableId: 1, taggableType: 'BlogPost' }, // wrong discriminator
    )
    const tag = Tag.hydrate({ id: 7 })!
    const posts = await tag.related('posts').get()
    assert.strictEqual(posts.length, 1)
  })

  it('honors morphType override on the relation (wins over related class alias)', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post extends Model {
      static override morphAlias = 'post'
      id!: number
    }
    class Tag extends Model {
      static override relations = {
        posts: {
          type:       'morphedByMany' as const,
          model:      () => Post,
          pivotTable: 'taggable',
          morphName:  'taggable',
          morphType:  'CUSTOM',
        },
      }
      id!: number
    }
    rows('posts').push({ id: 1 })
    rows('taggable').push(
      { tagId: 7, taggableId: 1, taggableType: 'CUSTOM' },
      { tagId: 7, taggableId: 1, taggableType: 'post' },
    )
    const tag = Tag.hydrate({ id: 7 })!
    const posts = await tag.related('posts').get()
    assert.strictEqual(posts.length, 1)
  })
})

// ─── morphToMany — pivot writes ──────────────────────────────────────────────

describe('Model.morphToMany — pivot writes', () => {
  beforeEach(() => ModelRegistry.reset())

  it('attach() writes pivot rows with discriminator stamped', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag  extends Model { id!: number }
    class Post extends Model {
      static override relations = {
        tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    const post = Post.hydrate({ id: 1 })!
    await Model.morphToMany(post, 'tags').attach([10, 11])

    assert.deepStrictEqual(rows('taggable'), [
      { taggableId: 1, tagId: 10, taggableType: 'Post' },
      { taggableId: 1, tagId: 11, taggableType: 'Post' },
    ])
  })

  it('attach() with empty input is a no-op', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag  extends Model {}
    class Post extends Model {
      static override relations = {
        tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    const post = Post.hydrate({ id: 1 })!
    await Model.morphToMany(post, 'tags').attach([])
    assert.strictEqual(rows('taggable').length, 0)
  })

  it('attach() stamps morphAlias when set', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag extends Model { id!: number }
    class BlogPost extends Model {
      static override morphAlias = 'post'
      static override relations = {
        tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    const post = BlogPost.hydrate({ id: 1 })!
    await Model.morphToMany(post, 'tags').attach([10])
    assert.strictEqual(rows('taggable')[0]!['taggableType'], 'post')
  })

  it('attach() flat pivot data is applied to every row', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag  extends Model {}
    class Post extends Model {
      static override relations = {
        tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    const post = Post.hydrate({ id: 1 })!
    await Model.morphToMany(post, 'tags').attach([10, 11], { addedBy: 'admin' })
    assert.strictEqual(rows('taggable')[0]!['addedBy'], 'admin')
    assert.strictEqual(rows('taggable')[1]!['addedBy'], 'admin')
    assert.strictEqual(rows('taggable')[0]!['taggableType'], 'Post')
  })

  it('detach(ids) removes only matching pivot rows for this parent + discriminator', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag  extends Model {}
    class Post extends Model {
      static override relations = {
        tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    rows('taggable').push(
      { tagId: 10, taggableId: 1, taggableType: 'Post' },
      { tagId: 11, taggableId: 1, taggableType: 'Post' },
      { tagId: 10, taggableId: 1, taggableType: 'Video' }, // different discriminator — must NOT be detached
    )
    const post = Post.hydrate({ id: 1 })!
    const removed = await Model.morphToMany(post, 'tags').detach([10])
    assert.strictEqual(removed, 1)
    const remaining = rows('taggable').map(r => `${String(r['tagId'])}:${String(r['taggableType'])}`).sort()
    assert.deepStrictEqual(remaining, ['10:Video', '11:Post'])
  })

  it('detach() with no args removes every row for this parent on this discriminator', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag  extends Model {}
    class Post extends Model {
      static override relations = {
        tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    rows('taggable').push(
      { tagId: 10, taggableId: 1, taggableType: 'Post' },
      { tagId: 10, taggableId: 1, taggableType: 'Video' }, // different discriminator — must remain
    )
    const post = Post.hydrate({ id: 1 })!
    await Model.morphToMany(post, 'tags').detach()
    assert.deepStrictEqual(rows('taggable'), [
      { tagId: 10, taggableId: 1, taggableType: 'Video' },
    ])
  })

  it('sync() diffs current vs desired and applies the difference', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag  extends Model {}
    class Post extends Model {
      static override relations = {
        tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    rows('taggable').push(
      { tagId: 10, taggableId: 1, taggableType: 'Post' },
      { tagId: 11, taggableId: 1, taggableType: 'Post' },
    )
    const post = Post.hydrate({ id: 1 })!
    const result = await Model.morphToMany(post, 'tags').sync([11, 12])
    assert.deepStrictEqual(result.attached, [12])
    assert.deepStrictEqual(result.detached, [10])
    const remainingTagIds = rows('taggable')
      .filter(r => r['taggableId'] === 1 && r['taggableType'] === 'Post')
      .map(r => r['tagId'])
      .sort()
    assert.deepStrictEqual(remainingTagIds, [11, 12])
  })

  it('throws when the relation type does not match', () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag extends Model {}
    class Post extends Model {
      static override relations = {
        tags: { type: 'morphedByMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    const post = Post.hydrate({ id: 1 })!
    assert.throws(
      () => Model.morphToMany(post, 'tags'),
      /is "morphedByMany", not "morphToMany"/,
    )
  })
})

// ─── morphedByMany — pivot writes (inverse) ──────────────────────────────────

describe('Model.morphedByMany — pivot writes', () => {
  beforeEach(() => ModelRegistry.reset())

  it('attach() stamps the related class discriminator', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post extends Model {}
    class Tag extends Model {
      static override relations = {
        posts: {
          type:       'morphedByMany' as const,
          model:      () => Post,
          pivotTable: 'taggable',
          morphName:  'taggable',
        },
      }
      id!: number
    }
    const tag = Tag.hydrate({ id: 7 })!
    await Model.morphedByMany(tag, 'posts').attach([1, 2])
    assert.deepStrictEqual(rows('taggable'), [
      { tagId: 7, taggableId: 1, taggableType: 'Post' },
      { tagId: 7, taggableId: 2, taggableType: 'Post' },
    ])
  })

  it('detach() honors discriminator — does not touch other inverse classes', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post  extends Model {}
    class Video extends Model {}
    class Tag extends Model {
      static override relations = {
        posts:  { type: 'morphedByMany' as const, model: () => Post,  pivotTable: 'taggable', morphName: 'taggable' },
        videos: { type: 'morphedByMany' as const, model: () => Video, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    rows('taggable').push(
      { tagId: 7, taggableId: 1, taggableType: 'Post' },
      { tagId: 7, taggableId: 1, taggableType: 'Video' },
    )
    const tag = Tag.hydrate({ id: 7 })!
    await Model.morphedByMany(tag, 'posts').detach()
    assert.deepStrictEqual(rows('taggable'), [
      { tagId: 7, taggableId: 1, taggableType: 'Video' },
    ])
  })

  it('sync() diffs are scoped to the discriminator', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post extends Model {}
    class Tag extends Model {
      static override relations = {
        posts: { type: 'morphedByMany' as const, model: () => Post, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    rows('taggable').push(
      { tagId: 7, taggableId: 1, taggableType: 'Post' },
      { tagId: 7, taggableId: 9, taggableType: 'Video' }, // out of scope
    )
    const tag = Tag.hydrate({ id: 7 })!
    const result = await Model.morphedByMany(tag, 'posts').sync([1, 2])
    assert.deepStrictEqual(result.attached, [2])
    assert.deepStrictEqual(result.detached, [])
    const all = rows('taggable')
      .map(r => `${String(r['taggableId'])}:${String(r['taggableType'])}`)
      .sort()
    assert.deepStrictEqual(all, ['1:Post', '2:Post', '9:Video'])
  })
})

// ─── Auto-installed prototype methods ────────────────────────────────────────

describe('auto-installed prototype methods (morph M2M)', () => {
  beforeEach(() => ModelRegistry.reset())

  // The auto-installed prototype methods are accessed via cast — declaring
  // an instance field `tags!: ...` would create an own-property `undefined`
  // on every instance and shadow the prototype method.

  type WithTagsMethod = { tags: () => { attach(ids: number[]): Promise<void> } }
  type WithPostsMethod = { posts: () => { attach(ids: number[]): Promise<void> } }

  it('post.tags() returns a MorphToManyAccessor after first query', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag  extends Model {}
    class Post extends Model {
      static override relations = {
        tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    rows('posts').push({ id: 1 })
    const post = (await Post.find(1)) as unknown as WithTagsMethod
    await post.tags().attach([10])
    assert.strictEqual(rows('taggable').length, 1)
    assert.strictEqual(rows('taggable')[0]!['taggableType'], 'Post')
  })

  it('tag.posts() returns a MorphedByManyAccessor', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post extends Model {}
    class Tag extends Model {
      static override relations = {
        posts: { type: 'morphedByMany' as const, model: () => Post, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    rows('tags').push({ id: 7 })
    const tag = (await Tag.find(7)) as unknown as WithPostsMethod
    await tag.posts().attach([1])
    assert.strictEqual(rows('taggable')[0]!['tagId'], 7)
    assert.strictEqual(rows('taggable')[0]!['taggableType'], 'Post')
  })
})
