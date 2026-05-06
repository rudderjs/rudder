import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  Model,
  ModelRegistry,
  AGGREGATES_SYMBOL,
  type AggregateFn,
  type AggregateRequest,
  type OrmAdapter,
  type QueryBuilder,
  type RelationExistencePredicate,
  type WhereClause,
  type WhereOperator,
} from './index.js'

// ─── Recording adapter ───────────────────────────────────────────────────────
//
// Aggregate testing has two needs the whereHas recorder doesn't:
//   1. Capture the `withAggregate(reqs)` calls so we can assert request shape.
//   2. Stub responses for `_aggregate(fn, col)` and `count()` so the instance
//      load path (`loadCount`, `loadSum`, etc.) returns predictable values.
//
// `setAggregateValue(table, fn, column?, value)` overrides the canned value
// for a specific (table, fn, column) tuple. Defaults: `count` → 0, `_aggregate`
// → 0 / null per fn.

interface RecordedQb {
  table:        string
  aggregates:   AggregateRequest[]
  aggregateCalls: Array<{ fn: AggregateFn; column?: string | undefined }>
  predicates:   RelationExistencePredicate[]
  wheres:       Array<[string, WhereOperator, unknown]>
  withs:        string[]
  rowsToReturn: Array<Record<string, unknown>>
}

interface RecordingHandle {
  adapter:        OrmAdapter
  latest:         () => RecordedQb
  all:            () => RecordedQb[]
  setAggregateResult: (table: string, fn: AggregateFn, column: string | undefined, value: unknown) => void
  setRows:        (table: string, rows: Array<Record<string, unknown>>) => void
}

function recordingAdapter(): RecordingHandle {
  const all: RecordedQb[] = []
  const aggregateResults = new Map<string, unknown>()
  const rowSets = new Map<string, Array<Record<string, unknown>>>()
  const key = (table: string, fn: AggregateFn, column?: string): string =>
    `${table}::${fn}::${column ?? ''}`

  const makeQb = <T,>(table: string): QueryBuilder<T> => {
    const rec: RecordedQb = {
      table,
      aggregates:     [],
      aggregateCalls: [],
      predicates:     [],
      wheres:         [],
      withs:          [],
      rowsToReturn:   rowSets.get(table) ?? [],
    }
    all.push(rec)

    const qb: QueryBuilder<T> = {
      where: ((col: string, opOrVal: unknown, maybeVal?: unknown): QueryBuilder<T> => {
        if (maybeVal === undefined) rec.wheres.push([col, '=', opOrVal])
        else                        rec.wheres.push([col, opOrVal as WhereOperator, maybeVal])
        return qb
      }) as QueryBuilder<T>['where'],
      orWhere: () => qb,
      orderBy: () => qb,
      limit:   () => qb,
      offset:  () => qb,
      with:    (...rels: string[]) => { rec.withs.push(...rels); return qb },
      withPivot: () => qb,
      withTrashed: () => qb,
      onlyTrashed: () => qb,
      first: async () => (rec.rowsToReturn[0] ?? null) as T | null,
      find:  async () => null,
      get:   async () => rec.rowsToReturn as T[],
      all:   async () => rec.rowsToReturn as T[],
      count: async () => Number(aggregateResults.get(key(table, 'count')) ?? 0),
      create: async (d) => d as T,
      update: async (_id, d) => d as T,
      delete: async () => undefined,
      restore: async () => ({} as T),
      forceDelete: async () => undefined,
      increment: async () => ({} as T),
      decrement: async () => ({} as T),
      insertMany: async () => undefined,
      deleteAll: async () => 0,
      updateAll: async () => 0,
      paginate: async () => ({ data: rec.rowsToReturn as T[], total: rec.rowsToReturn.length, perPage: 15, currentPage: 1, lastPage: 1, from: 0, to: 0 }),
      whereRelationExists: (predicate) => { rec.predicates.push(predicate); return qb },
      withConstrained: () => qb,
      withAggregate: (reqs) => { rec.aggregates.push(...reqs); return qb },
      _aggregate: async (fn, column) => {
        rec.aggregateCalls.push(column !== undefined ? { fn, column } : { fn })
        const v = aggregateResults.get(key(table, fn, column))
        if (v !== undefined) return v
        // Sensible defaults
        if (fn === 'count')  return 0
        if (fn === 'exists') return false
        if (fn === 'sum')    return 0
        return null
      },
      whereGroup:   () => qb,
      orWhereGroup: () => qb,
    }
    return qb
  }

  return {
    adapter: {
      query: <T,>(table: string) => makeQb<T>(table),
      connect:    async () => undefined,
      disconnect: async () => undefined,
    },
    latest: () => {
      if (all.length === 0) throw new Error('No query was built yet.')
      return all[all.length - 1]!
    },
    all: () => all,
    setAggregateResult(table, fn, column, value) {
      aggregateResults.set(key(table, fn, column), value)
    },
    setRows(table, rows) {
      rowSets.set(table, rows)
    },
  }
}

// ─── Test models ─────────────────────────────────────────────────────────────

class Post extends Model {
  static override table = 'posts'
  id!:        number
  authorId!:  number
  views!:     number
  published!: boolean
}

class Tag extends Model {
  static override table = 'tags'
  id!: number
}

class Role extends Model {
  static override table = 'roles'
  id!: number
}

class Team extends Model {
  static override table = 'teams'
  id!: number
}

class User extends Model {
  static override table = 'users'
  id!:     number
  teamId!: number
  static override relations = {
    posts: { type: 'hasMany' as const,    model: () => Post,    foreignKey: 'authorId' },
    team:  { type: 'belongsTo' as const,  model: () => Team,    foreignKey: 'teamId' },
    roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
  }
}

class Image extends Model {
  static override table = 'images'
  id!:            number
  imageableId!:   number
  imageableType!: string
  size!:          number
}

class Article extends Model {
  static override table = 'articles'
  id!: number
  static override relations = {
    images: { type: 'morphMany' as const, model: () => Image, morphName: 'imageable' },
    tags:   { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
  }
}

class Comment extends Model {
  static override table = 'comments'
  id!:              number
  commentableId!:   number
  commentableType!: string
  static override relations = {
    target: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post] },
  }
}

// Soft-delete'd related model
class SoftPost extends Model {
  static override table = 'soft_posts'
  static override softDeletes = true
  id!:       number
  authorId!: number
}
class UserSD extends Model {
  static override table = 'users_sd'
  id!: number
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => SoftPost, foreignKey: 'authorId' },
  }
}

// ─── withCount — overload normalization ───────────────────────────────────────

describe('Model.query().withCount — single string', () => {
  beforeEach(() => ModelRegistry.reset())

  it('emits one AggregateRequest with default alias = relation+Count', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (User.query() as unknown as { withCount: (n: string) => { get: () => Promise<unknown[]> } })
      .withCount('posts').get()

    const reqs = latest().aggregates
    assert.equal(reqs.length, 1)
    const r = reqs[0]!
    assert.equal(r.relation, 'posts')
    assert.equal(r.fn,       'count')
    assert.equal(r.alias,    'postsCount')
    assert.equal(r.column,   undefined)
    assert.deepEqual(r.constraintWheres, [])
    assert.equal(r.joinShape.relatedTable,    'posts')
    assert.equal(r.joinShape.parentColumn,    'id')
    assert.equal(r.joinShape.relatedColumn,   'authorId')
    assert.equal(r.joinShape.through,         undefined)
    assert.equal(r.joinShape.extraEquals,     undefined)
  })
})

describe('Model.query().withCount — array form', () => {
  beforeEach(() => ModelRegistry.reset())

  it('emits one AggregateRequest per name', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (User.query() as unknown as { withCount: (n: readonly string[]) => { get: () => Promise<unknown[]> } })
      .withCount(['posts', 'roles']).get()

    const reqs = latest().aggregates
    assert.equal(reqs.length, 2)
    assert.equal(reqs[0]!.relation, 'posts')
    assert.equal(reqs[0]!.alias,    'postsCount')
    assert.equal(reqs[1]!.relation, 'roles')
    assert.equal(reqs[1]!.alias,    'rolesCount')
    // belongsToMany pivot — through must be set on the second request.
    assert.deepEqual(reqs[1]!.joinShape.through, {
      pivotTable:      'role_user',
      foreignPivotKey: 'userId',
      relatedPivotKey: 'roleId',
    })
  })
})

describe('Model.query().withCount — map form with constraint', () => {
  beforeEach(() => ModelRegistry.reset())

  it('captures constraint wheres on the request', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (User.query() as unknown as {
      withCount: (m: Record<string, (q: unknown) => unknown>) => { get: () => Promise<unknown[]> }
    }).withCount({
      posts: (q) => (q as { where: (c: string, v: unknown) => unknown }).where('published', true),
    }).get()

    const r = latest().aggregates[0]!
    assert.equal(r.alias, 'postsCount')
    assert.deepEqual(r.constraintWheres, [
      { column: 'published', operator: '=', value: true },
    ])
  })

  it('.as("publishedPosts") rewrites alias to publishedPostsCount', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (User.query() as unknown as {
      withCount: (m: Record<string, (q: unknown) => unknown>) => { get: () => Promise<unknown[]> }
    }).withCount({
      posts: (q) => (q as { where: (c: string, v: unknown) => { as: (n: string) => unknown } })
        .where('published', true).as('publishedPosts'),
    }).get()

    const r = latest().aggregates[0]!
    assert.equal(r.alias, 'publishedPostsCount')
    assert.equal(r.relation, 'posts')
  })
})

// ─── withSum / withMin / withMax / withAvg ───────────────────────────────────

describe('Model.query().withSum — string + column', () => {
  beforeEach(() => ModelRegistry.reset())

  it('alias = relation + Sum + capitalised column', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (User.query() as unknown as { withSum: (r: string, c: string) => { get: () => Promise<unknown[]> } })
      .withSum('posts', 'views').get()

    const r = latest().aggregates[0]!
    assert.equal(r.fn,       'sum')
    assert.equal(r.column,   'views')
    assert.equal(r.alias,    'postsSumViews')
  })

  it('throws when column missing', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => (User.query() as unknown as { withSum: (r: string) => unknown }).withSum('posts'),
      /requires a column argument/,
    )
  })
})

describe('Model.query() — withMin / withMax / withAvg suffixes', () => {
  beforeEach(() => ModelRegistry.reset())

  it('produce the expected fn + alias triplet', async () => {
    const { adapter, all } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (User.query() as unknown as { withMin: (r: string, c: string) => { get: () => Promise<unknown[]> } })
      .withMin('posts', 'views').get()
    await (User.query() as unknown as { withMax: (r: string, c: string) => { get: () => Promise<unknown[]> } })
      .withMax('posts', 'views').get()
    await (User.query() as unknown as { withAvg: (r: string, c: string) => { get: () => Promise<unknown[]> } })
      .withAvg('posts', 'views').get()

    const recs = all()
    assert.equal(recs[0]!.aggregates[0]!.fn,    'min')
    assert.equal(recs[0]!.aggregates[0]!.alias, 'postsMinViews')
    assert.equal(recs[1]!.aggregates[0]!.fn,    'max')
    assert.equal(recs[1]!.aggregates[0]!.alias, 'postsMaxViews')
    assert.equal(recs[2]!.aggregates[0]!.fn,    'avg')
    assert.equal(recs[2]!.aggregates[0]!.alias, 'postsAvgViews')
  })
})

describe('Model.query().withSum — map form with constraint', () => {
  beforeEach(() => ModelRegistry.reset())

  it('takes { column, constraint } per relation', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (User.query() as unknown as {
      withSum: (m: Record<string, { column: string; constraint?: (q: unknown) => unknown }>) => { get: () => Promise<unknown[]> }
    }).withSum({
      posts: { column: 'views', constraint: (q) => (q as { where: (c: string, v: unknown) => unknown }).where('published', true) },
    }).get()

    const r = latest().aggregates[0]!
    assert.equal(r.column, 'views')
    assert.deepEqual(r.constraintWheres, [
      { column: 'published', operator: '=', value: true },
    ])
  })
})

// ─── withExists ──────────────────────────────────────────────────────────────

describe('Model.query().withExists', () => {
  beforeEach(() => ModelRegistry.reset())

  it('emits fn=exists with alias relation+Exists', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (User.query() as unknown as { withExists: (n: string) => { get: () => Promise<unknown[]> } })
      .withExists('posts').get()

    const r = latest().aggregates[0]!
    assert.equal(r.fn,    'exists')
    assert.equal(r.alias, 'postsExists')
  })
})

// ─── Polymorphic / pivot join shapes ─────────────────────────────────────────

describe('withCount on morphMany — extraEquals on joinShape', () => {
  beforeEach(() => ModelRegistry.reset())

  it('carries the discriminator', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (Article.query() as unknown as { withCount: (n: string) => { get: () => Promise<unknown[]> } })
      .withCount('images').get()

    const r = latest().aggregates[0]!
    assert.deepEqual(r.joinShape.extraEquals, { imageableType: 'Article' })
    assert.equal(r.joinShape.through, undefined)
  })
})

describe('withCount on morphToMany — through + extraEquals', () => {
  beforeEach(() => ModelRegistry.reset())

  it('carries pivot block + discriminator', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (Article.query() as unknown as { withCount: (n: string) => { get: () => Promise<unknown[]> } })
      .withCount('tags').get()

    const r = latest().aggregates[0]!
    assert.deepEqual(r.joinShape.through, {
      pivotTable:      'taggable',
      foreignPivotKey: 'taggableId',
      relatedPivotKey: 'tagId',
    })
    assert.deepEqual(r.joinShape.extraEquals, { taggableType: 'Article' })
  })
})

// ─── Soft-delete propagation ─────────────────────────────────────────────────

describe('joinShape.softDeletes = true when related Model.softDeletes', () => {
  beforeEach(() => ModelRegistry.reset())

  it('flag is set so adapters add the deleted_at filter', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (UserSD.query() as unknown as { withCount: (n: string) => { get: () => Promise<unknown[]> } })
      .withCount('posts').get()

    const r = latest().aggregates[0]!
    assert.equal(r.joinShape.softDeletes, true)
  })
})

// ─── Error cases ─────────────────────────────────────────────────────────────

describe('withCount — error paths', () => {
  beforeEach(() => ModelRegistry.reset())

  it('throws on unknown relation', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => (User.query() as unknown as { withCount: (n: string) => unknown }).withCount('nope'),
      /Relation "nope" is not defined on User/,
    )
  })

  it('throws on belongsTo (ambiguous)', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => (User.query() as unknown as { withCount: (n: string) => unknown }).withCount('team'),
      /withCount on belongsTo "team" is ambiguous/,
    )
  })

  it('throws on morphTo', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => (Comment.query() as unknown as { withCount: (n: string) => unknown }).withCount('target'),
      /withCount\(\) on morphTo "target" is not supported/,
    )
  })
})

// ─── Static convenience entrypoints ──────────────────────────────────────────

describe('Model.withCount static — sugars Model.query().withCount(...)', () => {
  beforeEach(() => ModelRegistry.reset())

  it('routes through the proxy and stamps aggregates on the QB', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.withCount('posts').get()
    assert.equal(latest().aggregates.length, 1)
    assert.equal(latest().aggregates[0]!.alias, 'postsCount')
  })
})

// ─── Hydration: copies aggregate keys + tags via Symbol ──────────────────────

describe('hydration — aggregate keys land on the instance and are tagged', () => {
  beforeEach(() => ModelRegistry.reset())

  it('first()/get() instances carry the alias values + AGGREGATES_SYMBOL set', async () => {
    const { adapter, setRows } = recordingAdapter()
    ModelRegistry.set(adapter)
    setRows('users', [{ id: 1, teamId: 7, postsCount: 5 }])

    const u = await (User.query() as unknown as { withCount: (n: string) => { first: () => Promise<User | null> } })
      .withCount('posts').first()

    assert.ok(u, 'user hydrated')
    assert.equal((u as unknown as Record<string, unknown>)['postsCount'], 5)

    const set = (u as unknown as Record<symbol, Set<string>>)[AGGREGATES_SYMBOL]
    assert.ok(set, 'aggregates Symbol set is present')
    assert.equal(set.has('postsCount'), true)
  })
})

// ─── _toData / toJSON behavior ───────────────────────────────────────────────

describe('aggregate-stamped keys — _toData skips, toJSON keeps', () => {
  beforeEach(() => ModelRegistry.reset())

  it('a hydrated row with postsCount writes back without postsCount', async () => {
    const { adapter, setRows } = recordingAdapter()
    ModelRegistry.set(adapter)
    setRows('users', [{ id: 1, teamId: 7, postsCount: 3 }])

    const u = await (User.query() as unknown as { withCount: (n: string) => { first: () => Promise<User | null> } })
      .withCount('posts').first()
    assert.ok(u)

    // toJSON includes postsCount (it's an own enumerable property).
    const json = u.toJSON() as Record<string, unknown>
    assert.equal(json['postsCount'], 3)

    // _toData drops postsCount so Prisma writes won't reject on the unknown column.
    const data = (u as unknown as { _toData: () => Record<string, unknown> })._toData()
    assert.equal('postsCount' in data, false)
    assert.equal(data['id'],      1)
    assert.equal(data['teamId'],  7)
  })
})

// ─── Instance loadCount / loadExists / loadSum / loadMissing ─────────────────

describe('instance.loadCount', () => {
  beforeEach(() => ModelRegistry.reset())

  it('mutates instance with <relation>Count and tags via Symbol', async () => {
    const { adapter, setAggregateResult } = recordingAdapter()
    ModelRegistry.set(adapter)
    setAggregateResult('posts', 'count', undefined, 7)

    const user = User.hydrate({ id: 1, teamId: 7 }) as User
    await user.loadCount('posts')

    assert.equal((user as unknown as Record<string, unknown>)['postsCount'], 7)
    const set = (user as unknown as Record<symbol, Set<string> | undefined>)[AGGREGATES_SYMBOL]
    assert.ok(set, 'AGGREGATES_SYMBOL set is present')
    assert.equal(set.has('postsCount'), true)
  })

  it('multiple relations via array form', async () => {
    const { adapter, setAggregateResult } = recordingAdapter()
    ModelRegistry.set(adapter)
    setAggregateResult('posts', 'count', undefined, 4)
    setAggregateResult('roles', 'count', undefined, 2)

    const user = User.hydrate({ id: 1, teamId: 7 }) as User
    await user.loadCount(['posts', 'roles'])

    assert.equal((user as unknown as Record<string, unknown>)['postsCount'], 4)
    // belongsToMany pivot path uses the deferred Proxy → falls back to
    // public count() (the recorder returns 0 by default unless set on
    // the pivot fallback's count call). Just assert the tag is present.
    const set2 = (user as unknown as Record<symbol, Set<string> | undefined>)[AGGREGATES_SYMBOL]
    assert.ok(set2)
    assert.equal(set2.has('postsCount'), true)
    assert.equal(set2.has('rolesCount'), true)
  })
})

describe('instance.loadSum', () => {
  beforeEach(() => ModelRegistry.reset())

  it('stamps relation+Sum+Column via _aggregate', async () => {
    const { adapter, setAggregateResult } = recordingAdapter()
    ModelRegistry.set(adapter)
    setAggregateResult('posts', 'sum', 'views', 42)

    const user = User.hydrate({ id: 1, teamId: 7 }) as User
    await user.loadSum('posts', 'views')

    assert.equal((user as unknown as Record<string, unknown>)['postsSumViews'], 42)
  })
})

describe('instance.loadExists', () => {
  beforeEach(() => ModelRegistry.reset())

  it('stamps a boolean for the alias', async () => {
    const { adapter, setAggregateResult } = recordingAdapter()
    ModelRegistry.set(adapter)
    setAggregateResult('posts', 'exists', undefined, true)

    const user = User.hydrate({ id: 1, teamId: 7 }) as User
    await user.loadExists('posts')

    assert.equal((user as unknown as Record<string, unknown>)['postsExists'], true)
  })
})

describe('instance.loadMissing', () => {
  beforeEach(() => ModelRegistry.reset())

  it('skips relations whose property is already populated', async () => {
    const { adapter, all } = recordingAdapter()
    ModelRegistry.set(adapter)

    const user = User.hydrate({ id: 1, teamId: 7 }) as User
    ;(user as unknown as Record<string, unknown>)['posts'] = [{ id: 99 }]
    await user.loadMissing('posts')

    // No queries should have been issued for `posts` since it was truthy.
    const postsQueries = all().filter(r => r.table === 'posts')
    assert.equal(postsQueries.length, 0)
  })

  it('loads the relation when the property is null/undefined', async () => {
    const { adapter, setRows } = recordingAdapter()
    ModelRegistry.set(adapter)
    setRows('posts', [{ id: 1, authorId: 1 }, { id: 2, authorId: 1 }])

    const user = User.hydrate({ id: 1, teamId: 7 }) as User
    await user.loadMissing('posts')

    const loaded = (user as unknown as Record<string, unknown>)['posts'] as Array<Record<string, unknown>>
    assert.equal(loaded.length, 2)
  })
})

// ─── Chainable form on QueryBuilder ──────────────────────────────────────────

describe('Chainable withCount via QueryBuilder', () => {
  beforeEach(() => ModelRegistry.reset())

  it('User.where(...).withCount("posts").get() chains through the proxy', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (User.where('teamId', 7) as unknown as { withCount: (n: string) => { get: () => Promise<unknown[]> } })
      .withCount('posts').get()

    const rec = latest()
    assert.deepEqual(rec.wheres, [['teamId', '=', 7]])
    assert.equal(rec.aggregates.length, 1)
    assert.equal(rec.aggregates[0]!.alias, 'postsCount')
  })
})

// ─── Multiple aggregates on one query ────────────────────────────────────────

describe('Multiple aggregates accumulate in order', () => {
  beforeEach(() => ModelRegistry.reset())

  it('withCount + withSum + withExists land on the same aggregates[]', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (User.query() as unknown as {
      withCount:  (n: string) => { withSum: (r: string, c: string) => { withExists: (n: string) => { get: () => Promise<unknown[]> } } }
    }).withCount('posts').withSum('posts', 'views').withExists('posts').get()

    const reqs = latest().aggregates
    assert.equal(reqs.length, 3)
    assert.equal(reqs[0]!.fn, 'count')
    assert.equal(reqs[1]!.fn, 'sum')
    assert.equal(reqs[2]!.fn, 'exists')
  })
})

// Compile-time witness: WhereClause typing flows through fine.
const _w: WhereClause = { column: 'x', operator: '=', value: 1 }
void _w
