import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, type QueryBuilder, type OrmAdapter, type WhereOperator } from './index.js'
import { partitionEagerLoads } from './polymorphic-eager-load.js'

// ─── Recording adapter ─────────────────────────────────────────────────────
//
// Captures every query the helper fires (table, where calls, .get() result).
// Tests assert against the recording instead of a real DB.

interface QueryRecord {
  table: string
  wheres: Array<{ column: string; operator: WhereOperator | '='; value: unknown }>
}

interface SeededTable {
  rows: Record<string, unknown>[]
}

class RecordingAdapter {
  records: QueryRecord[] = []
  tables:  Record<string, SeededTable> = {}

  seed(table: string, rows: Record<string, unknown>[]): void {
    this.tables[table] = { rows }
  }

  asOrmAdapter(): OrmAdapter {
    return {
      query: <T>(table: string): QueryBuilder<T> => this.makeQb(table) as unknown as QueryBuilder<T>,
      connect:    async () => undefined,
      disconnect: async () => undefined,
    }
  }

  private makeQb(table: string): QueryBuilder<Record<string, unknown>> {
    const wheres: Array<{ column: string; operator: WhereOperator | '='; value: unknown }> = []
    const recordOnGet = (): Record<string, unknown>[] => {
      this.records.push({ table, wheres: [...wheres] })
      const seed = this.tables[table]
      if (!seed) return []
      return seed.rows.filter(row => wheres.every(w => matchWhere(row, w)))
    }
    const qb: QueryBuilder<Record<string, unknown>> = {
      where: ((col: string, opOrVal: WhereOperator | unknown, val?: unknown) => {
        if (val === undefined) wheres.push({ column: col, operator: '=', value: opOrVal })
        else wheres.push({ column: col, operator: opOrVal as WhereOperator, value: val })
        return qb
      }) as QueryBuilder<Record<string, unknown>>['where'],
      orWhere: (() => qb) as QueryBuilder<Record<string, unknown>>['orWhere'],
      selectRaw: () => qb,
      whereRaw: () => qb,
      orWhereRaw: () => qb,
      orderByRaw: () => qb,
      orderBy: () => qb,
      limit:   () => qb,
      offset:  () => qb,
      with:    () => qb,
      withPivot:   () => qb,
      withTrashed: () => qb,
      onlyTrashed: () => qb,
      first:   async () => recordOnGet()[0] ?? null,
      find:    async (_id) => null,
      get:     async () => recordOnGet(),
      all:     async () => recordOnGet(),
      count:   async () => 0,
      create:  async (data) => data as Record<string, unknown>,
      update:  async (_id, data) => data as Record<string, unknown>,
      delete:  async () => undefined,
      restore: async (_id) => ({} as Record<string, unknown>),
      forceDelete: async () => undefined,
      increment:   async (_id, _col, _amount, _extra) => ({} as Record<string, unknown>),
      decrement:   async (_id, _col, _amount, _extra) => ({} as Record<string, unknown>),
      insertMany: async () => undefined,
      deleteAll:  async () => 0,
      updateAll:  async () => 0,
      paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
      whereRelationExists: () => qb,
      withAggregate: () => qb,
      _aggregate:    async () => 0,
      whereGroup:    () => qb,
      orWhereGroup:  () => qb,
    }
    return qb
  }
}

function matchWhere(row: Record<string, unknown>, w: { column: string; operator: WhereOperator | '='; value: unknown }): boolean {
  const v = row[w.column]
  switch (w.operator) {
    case '=':  return v === w.value
    case 'IN': return Array.isArray(w.value) && (w.value as unknown[]).includes(v)
    default:   return true
  }
}

// ─── Test models ───────────────────────────────────────────────────────────

class Post extends Model {
  static override table = 'post'
  static override relations = {
    comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
    tags:     { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
    cover:    { type: 'morphOne' as const, model: () => Asset, morphName: 'assetable' },
  }
  id!:    number
  title!: string
}

class Video extends Model {
  static override table = 'video'
  static override relations = {
    comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
  }
  id!:  number
  url!: string
}

class Comment extends Model {
  static override table = 'comment'
  static override relations = {
    commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post, Video] },
  }
  id!:              number
  body!:            string
  commentableId!:   number
  commentableType!: string
}

class Tag extends Model {
  static override table = 'tag'
  static override relations = {
    posts: { type: 'morphedByMany' as const, model: () => Post, pivotTable: 'taggable', morphName: 'taggable' },
  }
  id!:   number
  name!: string
}

class Asset extends Model {
  static override table = 'asset'
  id!:           number
  url!:          string
  assetableId!:  number
  assetableType!:string
}

// ─── partitionEagerLoads ──────────────────────────────────────────────────

describe('partitionEagerLoads', () => {
  it('routes morph relations to polymorphic, leaves direct + unknown to adapter', () => {
    class TestPost extends Model {
      static override relations = {
        comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
        tags:     { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
        author:   { type: 'belongsTo' as const, model: () => Comment },
      }
    }
    const r = partitionEagerLoads(TestPost, ['author', 'comments', 'tags', 'unknown'])
    assert.deepStrictEqual(r.adapter,     ['author', 'unknown'])
    assert.deepStrictEqual(r.polymorphic, ['comments', 'tags'])
    assert.deepStrictEqual(r.direct,      [])
  })

  it('on a model-layer adapter, direct + unknown route to direct (not adapter)', () => {
    class TestPost extends Model {
      static override relations = {
        comments: { type: 'morphMany' as const, model: () => Comment, morphName: 'commentable' },
        tags:     { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
        author:   { type: 'belongsTo' as const, model: () => Comment },
      }
    }
    const r = partitionEagerLoads(TestPost, ['author', 'comments', 'tags', 'unknown'], 'model-layer')
    assert.deepStrictEqual(r.adapter,     [])
    assert.deepStrictEqual(r.polymorphic, ['comments', 'tags'])
    assert.deepStrictEqual(r.direct,      ['author', 'unknown'])
  })

  it('returns empty arrays for empty input', () => {
    class Empty extends Model {}
    const r = partitionEagerLoads(Empty, [])
    assert.deepStrictEqual(r, { adapter: [], polymorphic: [], direct: [] })
  })
})

// ─── Eager-load via the proxy intercept ────────────────────────────────────

describe('attachPolymorphicRelations via Model.with()', () => {
  let rec: RecordingAdapter

  beforeEach(() => {
    rec = new RecordingAdapter()
    ModelRegistry.set(rec.asOrmAdapter())
  })

  it('morphMany — single batched IN-query per relation, attaches array per parent', async () => {
    // The parents come from one query (we hydrate them via Model.hydrate to
    // skip needing a fake `all()` result on the test adapter).
    const posts = [
      Post.hydrate({ id: 1, title: 'A' })!,
      Post.hydrate({ id: 2, title: 'B' })!,
      Post.hydrate({ id: 3, title: 'C' })!,
    ]
    rec.seed('comment', [
      { id: 10, body: 'p1-c1', commentableId: 1, commentableType: 'Post' },
      { id: 11, body: 'p1-c2', commentableId: 1, commentableType: 'Post' },
      { id: 12, body: 'p2-c1', commentableId: 2, commentableType: 'Post' },
      // Foreign rows that must NOT be attached
      { id: 13, body: 'v1-c1', commentableId: 1, commentableType: 'Video' },
    ])

    const { attachPolymorphicRelations } = await import('./polymorphic-eager-load.js')
    await attachPolymorphicRelations(Post, posts, ['comments'])

    // One query fired on the related table
    assert.strictEqual(rec.records.length, 1)
    assert.strictEqual(rec.records[0]!.table, 'comment')
    assert.deepStrictEqual(rec.records[0]!.wheres, [
      { column: 'commentableId',   operator: 'IN', value: [1, 2, 3] },
      { column: 'commentableType', operator: '=',  value: 'Post' },
    ])

    // Attachments
    const p1 = posts[0] as unknown as Record<string, Model[]>
    const p2 = posts[1] as unknown as Record<string, Model[]>
    const p3 = posts[2] as unknown as Record<string, Model[]>
    assert.strictEqual(p1['comments']!.length, 2)
    assert.strictEqual(p2['comments']!.length, 1)
    assert.strictEqual(p3['comments']!.length, 0)
  })

  it('morphOne — returns single instance or null per parent', async () => {
    const posts = [
      Post.hydrate({ id: 1, title: 'A' })!,
      Post.hydrate({ id: 2, title: 'B' })!,
    ]
    rec.seed('asset', [
      { id: 100, url: '/p1.png', assetableId: 1, assetableType: 'Post' },
    ])

    const { attachPolymorphicRelations } = await import('./polymorphic-eager-load.js')
    await attachPolymorphicRelations(Post, posts, ['cover'])

    const p1 = posts[0] as unknown as Record<string, Model | null>
    const p2 = posts[1] as unknown as Record<string, Model | null>
    assert.ok(p1['cover'] !== null)
    assert.strictEqual((p1['cover'] as Asset).id, 100)
    assert.strictEqual(p2['cover'], null)
  })

  it('morphTo — groups by type, fires one query per distinct discriminator', async () => {
    const comments = [
      Comment.hydrate({ id: 10, body: 'c1', commentableId: 1, commentableType: 'Post' })!,
      Comment.hydrate({ id: 11, body: 'c2', commentableId: 2, commentableType: 'Post' })!,
      Comment.hydrate({ id: 12, body: 'c3', commentableId: 5, commentableType: 'Video' })!,
    ]
    rec.seed('post',  [{ id: 1, title: 'A' }, { id: 2, title: 'B' }])
    rec.seed('video', [{ id: 5, url: '/v.mp4' }])

    const { attachPolymorphicRelations } = await import('./polymorphic-eager-load.js')
    await attachPolymorphicRelations(Comment, comments, ['commentable'])

    // Two queries — one per distinct type
    assert.strictEqual(rec.records.length, 2)
    const tables = rec.records.map(r => r.table).sort()
    assert.deepStrictEqual(tables, ['post', 'video'])

    const c1 = comments[0] as unknown as Record<string, Model>
    const c3 = comments[2] as unknown as Record<string, Model>
    assert.strictEqual((c1['commentable'] as Post).id, 1)
    assert.strictEqual((c3['commentable'] as Video).id, 5)
  })

  it('morphToMany — 2 queries (pivot + related), attaches array', async () => {
    const posts = [
      Post.hydrate({ id: 1, title: 'A' })!,
      Post.hydrate({ id: 2, title: 'B' })!,
    ]
    rec.seed('taggable', [
      { tagId: 100, taggableId: 1, taggableType: 'Post' },
      { tagId: 101, taggableId: 1, taggableType: 'Post' },
      { tagId: 100, taggableId: 2, taggableType: 'Post' },
      // foreign — different morph type
      { tagId: 999, taggableId: 1, taggableType: 'Video' },
    ])
    rec.seed('tag', [
      { id: 100, name: 'red' },
      { id: 101, name: 'blue' },
    ])

    const { attachPolymorphicRelations } = await import('./polymorphic-eager-load.js')
    await attachPolymorphicRelations(Post, posts, ['tags'])

    assert.strictEqual(rec.records.length, 2)
    assert.strictEqual(rec.records[0]!.table, 'taggable')
    assert.deepStrictEqual(rec.records[0]!.wheres, [
      { column: 'taggableId',   operator: 'IN', value: [1, 2] },
      { column: 'taggableType', operator: '=',  value: 'Post' },
    ])
    assert.strictEqual(rec.records[1]!.table, 'tag')

    const p1 = posts[0] as unknown as Record<string, Tag[]>
    const p2 = posts[1] as unknown as Record<string, Tag[]>
    assert.strictEqual(p1['tags']!.length, 2)
    assert.strictEqual(p2['tags']!.length, 1)
  })

  it('morphedByMany — mirror of morphToMany, parent is strong side', async () => {
    const tags = [
      Tag.hydrate({ id: 100, name: 'red' })!,
      Tag.hydrate({ id: 101, name: 'blue' })!,
    ]
    rec.seed('taggable', [
      { tagId: 100, taggableId: 1, taggableType: 'Post' },
      { tagId: 100, taggableId: 2, taggableType: 'Post' },
      { tagId: 101, taggableId: 1, taggableType: 'Post' },
    ])
    rec.seed('post', [
      { id: 1, title: 'A' },
      { id: 2, title: 'B' },
    ])

    const { attachPolymorphicRelations } = await import('./polymorphic-eager-load.js')
    await attachPolymorphicRelations(Tag, tags, ['posts'])

    assert.strictEqual(rec.records.length, 2)
    assert.strictEqual(rec.records[0]!.table, 'taggable')
    // Pivot lookup uses tag id under the morph type
    assert.deepStrictEqual(rec.records[0]!.wheres, [
      { column: 'tagId',        operator: 'IN', value: [100, 101] },
      { column: 'taggableType', operator: '=',  value: 'Post' },
    ])

    const t1 = tags[0] as unknown as Record<string, Post[]>
    const t2 = tags[1] as unknown as Record<string, Post[]>
    assert.strictEqual(t1['posts']!.length, 2)
    assert.strictEqual(t2['posts']!.length, 1)
  })

  it('empty parent set fires zero queries', async () => {
    const { attachPolymorphicRelations } = await import('./polymorphic-eager-load.js')
    await attachPolymorphicRelations(Post, [], ['comments'])
    assert.strictEqual(rec.records.length, 0)
  })

  it('morphTo throws helpful error on unknown discriminator', async () => {
    const comments = [
      Comment.hydrate({ id: 10, body: 'c1', commentableId: 1, commentableType: 'UnknownType' })!,
    ]
    const { attachPolymorphicRelations } = await import('./polymorphic-eager-load.js')
    await assert.rejects(
      () => attachPolymorphicRelations(Comment, comments, ['commentable']),
      /unknown commentableType = "UnknownType"/,
    )
  })

  it('Model.with() proxy intercept partitions + attaches end-to-end', async () => {
    // Seed parents + children
    rec.seed('post', [
      { id: 1, title: 'A' },
      { id: 2, title: 'B' },
    ])
    rec.seed('comment', [
      { id: 10, body: 'c1', commentableId: 1, commentableType: 'Post' },
      { id: 11, body: 'c2', commentableId: 2, commentableType: 'Post' },
    ])

    const posts = await Post.with('comments').all()
    assert.strictEqual(posts.length, 2)

    // Two queries — one for parents (Post.all), one for children
    assert.strictEqual(rec.records.length, 2)
    assert.strictEqual(rec.records[0]!.table, 'post')
    assert.strictEqual(rec.records[1]!.table, 'comment')

    const p1 = posts[0] as unknown as Record<string, Comment[]>
    const p2 = posts[1] as unknown as Record<string, Comment[]>
    assert.strictEqual(p1['comments']!.length, 1)
    assert.strictEqual(p2['comments']!.length, 1)
  })
})
