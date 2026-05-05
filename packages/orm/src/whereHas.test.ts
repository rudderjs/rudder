import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, type QueryBuilder, type OrmAdapter, type RelationExistencePredicate, type WhereClause, type WhereOperator } from './index.js'

// ─── Recording adapter ───────────────────────────────────────────────────────
//
// The Model layer's job is to translate a relation declaration into a
// {@link RelationExistencePredicate} and pass it to the adapter via
// `whereRelationExists`. These tests exercise that translation — they don't
// touch SQL or pivot lookups. Instead the adapter records every predicate
// it receives plus every flat where + with the test inspects them.

interface RecordedQb {
  predicates: RelationExistencePredicate[]
  wheres:     Array<[string, WhereOperator, unknown]>
  withs:      string[]
  withConstraineds: Array<[string, WhereClause[]]>
}

function recordingAdapter(): { adapter: OrmAdapter; latest: () => RecordedQb } {
  let latest: RecordedQb | null = null

  const makeQb = <T,>(): QueryBuilder<T> => {
    const rec: RecordedQb = { predicates: [], wheres: [], withs: [], withConstraineds: [] }
    latest = rec
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
      withTrashed: () => qb,
      onlyTrashed: () => qb,
      first: async () => null,
      find:  async () => null,
      get:   async () => [],
      all:   async () => [],
      count: async () => 0,
      create: async (d) => d as T,
      update: async (_id, d) => d as T,
      delete: async () => undefined,
      restore: async () => ({} as T),
      forceDelete: async () => undefined,
      increment: async () => ({} as T),
      decrement: async () => ({} as T),
      insertMany: async () => undefined,
      deleteAll: async () => 0,
      paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
      whereRelationExists: (predicate) => { rec.predicates.push(predicate); return qb },
      withConstrained: (rel, ws) => { rec.withConstraineds.push([rel, ws]); return qb },
      withAggregate: () => qb,
      _aggregate: async () => 0,
    }
    return qb
  }

  return {
    adapter: {
      query: <T,>(_table: string) => makeQb<T>(),
      connect:    async () => undefined,
      disconnect: async () => undefined,
    },
    latest: () => {
      if (!latest) throw new Error('No query was built yet.')
      return latest
    },
  }
}

// ─── Test models ─────────────────────────────────────────────────────────────

class Post extends Model {
  static override table = 'posts'
  id!: number
  authorId!: number
  published!: boolean
}

class User extends Model {
  static override table = 'users'
  id!: number
  teamId!: number
  static override relations = {
    posts: { type: 'hasMany' as const,    model: () => Post,    foreignKey: 'authorId' },
    team:  { type: 'belongsTo' as const,  model: () => Team,    foreignKey: 'teamId' },
    roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
  }
}

class Team extends Model {
  static override table = 'teams'
  id!: number
  static override relations = {
    members: { type: 'hasMany' as const, model: () => User, foreignKey: 'teamId' },
  }
}

class Role extends Model {
  static override table = 'roles'
  id!: number
}

class Image extends Model {
  static override table = 'images'
  id!: number
  imageableId!: number
  imageableType!: string
}

class Article extends Model {
  static override table = 'articles'
  id!: number
  static override relations = {
    images: { type: 'morphMany' as const, model: () => Image, morphName: 'imageable' },
  }
}

class Tag extends Model {
  static override table = 'tags'
  id!: number
}

class TaggedPost extends Model {
  static override table = 'tagged_posts'
  id!: number
  static override relations = {
    tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
  }
}

class Comment extends Model {
  static override table = 'comments'
  id!: number
  commentableId!: number
  commentableType!: string
  static override relations = {
    target: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post, Article] },
  }
}

// Two-belongsTo-to-same-parent ambiguity
class TeamWithDual extends Model {
  static override table = 'teams_dual'
  id!: number
}
class Repo extends Model {
  static override table = 'repos'
  id!: number
  ownerTeamId!: number
  reviewerTeamId!: number
  static override relations = {
    owner:    { type: 'belongsTo' as const, model: () => TeamWithDual, foreignKey: 'ownerTeamId' },
    reviewer: { type: 'belongsTo' as const, model: () => TeamWithDual, foreignKey: 'reviewerTeamId' },
  }
}

// ─── whereHas / whereDoesntHave — direct relations ───────────────────────────

describe('Model.whereHas — hasMany', () => {
  beforeEach(() => ModelRegistry.reset())

  it('builds a predicate with parent / related columns and no constraints', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    const q = User.whereHas('posts')
    await q.get()

    const rec = latest()
    assert.equal(rec.predicates.length, 1)
    const p = rec.predicates[0]!
    assert.equal(p.relation,        'posts')
    assert.equal(p.exists,          true)
    assert.equal(p.relatedTable,    'posts')
    assert.equal(p.parentColumn,    'id')
    assert.equal(p.relatedColumn,   'authorId')
    assert.deepEqual(p.constraintWheres, [])
    assert.equal(p.through,         undefined)
    assert.equal(p.extraEquals,     undefined)
  })

  it('captures constrain callback wheres', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereHas('posts', q => q.where('published', true).where('viewCount', '>=', 10)).get()

    const p = latest().predicates[0]!
    assert.deepEqual(p.constraintWheres, [
      { column: 'published', operator: '=',  value: true },
      { column: 'viewCount', operator: '>=', value: 10 },
    ])
  })
})

describe('Model.whereDoesntHave', () => {
  beforeEach(() => ModelRegistry.reset())

  it('flips the predicate polarity', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereDoesntHave('posts').get()

    assert.equal(latest().predicates[0]!.exists, false)
  })
})

// ─── whereHas — belongsTo ────────────────────────────────────────────────────

describe('Model.whereHas — belongsTo', () => {
  beforeEach(() => ModelRegistry.reset())

  it('parentColumn = FK on this model, relatedColumn = related primaryKey', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereHas('team').get()

    const p = latest().predicates[0]!
    assert.equal(p.parentColumn,  'teamId')
    assert.equal(p.relatedColumn, 'id')
    assert.equal(p.relatedTable,  'teams')
    assert.equal(p.through,       undefined)
  })
})

// ─── whereHas — belongsToMany (pivot) ────────────────────────────────────────

describe('Model.whereHas — belongsToMany', () => {
  beforeEach(() => ModelRegistry.reset())

  it('predicate carries the pivot through-block', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereHas('roles').get()

    const p = latest().predicates[0]!
    assert.equal(p.relatedTable,    'roles')
    assert.equal(p.parentColumn,    'id')        // User.primaryKey
    assert.equal(p.relatedColumn,   'id')        // Role.primaryKey
    assert.deepEqual(p.through, {
      pivotTable:      'role_user',
      foreignPivotKey: 'userId',
      relatedPivotKey: 'roleId',
    })
  })
})

// ─── whereHas — morphMany ────────────────────────────────────────────────────

describe('Model.whereHas — morphMany', () => {
  beforeEach(() => ModelRegistry.reset())

  it('predicate carries extraEquals discriminator', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await Article.whereHas('images').get()

    const p = latest().predicates[0]!
    assert.equal(p.relatedTable,  'images')
    assert.equal(p.parentColumn,  'id')
    assert.equal(p.relatedColumn, 'imageableId')
    assert.deepEqual(p.extraEquals, { imageableType: 'Article' })
  })
})

// ─── whereHas — morphToMany ──────────────────────────────────────────────────

describe('Model.whereHas — morphToMany', () => {
  beforeEach(() => ModelRegistry.reset())

  it('predicate carries through-block + extraEquals', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await TaggedPost.whereHas('tags').get()

    const p = latest().predicates[0]!
    assert.equal(p.relatedTable, 'tags')
    assert.deepEqual(p.through, {
      pivotTable:      'taggable',
      foreignPivotKey: 'taggableId',
      relatedPivotKey: 'tagId',
    })
    assert.deepEqual(p.extraEquals, { taggableType: 'TaggedPost' })
  })
})

// ─── whereHas — morphTo (unsupported) ────────────────────────────────────────

describe('Model.whereHas — morphTo', () => {
  beforeEach(() => ModelRegistry.reset())

  it('throws — related table is dynamic', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => Comment.whereHas('target'),
      /morphTo "target" cannot be used with whereHas/,
    )
  })
})

// ─── whereHas — unknown relation ─────────────────────────────────────────────

describe('Model.whereHas — unknown relation', () => {
  beforeEach(() => ModelRegistry.reset())

  it('throws with a helpful message', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => User.whereHas('nope'),
      /Relation "nope" is not defined on User/,
    )
  })
})

// ─── Nested whereHas inside callback throws ──────────────────────────────────

describe('Model.whereHas — nested whereHas inside callback', () => {
  beforeEach(() => ModelRegistry.reset())

  it('throws v1-deferred error', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => User.whereHas('posts', (q) => {
        (q as unknown as { whereHas: (r: string) => unknown }).whereHas('author')
      }),
      /Nested whereHas inside a whereHas constrain callback is deferred to v2/,
    )
  })
})

// ─── withWhereHas ────────────────────────────────────────────────────────────

describe('Model.withWhereHas', () => {
  beforeEach(() => ModelRegistry.reset())

  it('constrained: registers withConstrained when the adapter supports it', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.withWhereHas('posts', q => q.where('published', true)).get()

    const rec = latest()
    assert.equal(rec.predicates.length, 1)
    assert.equal(rec.withs.length,      0, 'falls into withConstrained branch — no plain with()')
    assert.equal(rec.withConstraineds.length, 1)
    const [rel, ws] = rec.withConstraineds[0]!
    assert.equal(rel, 'posts')
    assert.deepEqual(ws, [{ column: 'published', operator: '=', value: true }])
  })

  it('unconstrained: falls back to plain with()', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.withWhereHas('posts').get()

    const rec = latest()
    assert.deepEqual(rec.withs, ['posts'])
    assert.equal(rec.withConstraineds.length, 0)
  })
})

// ─── whereBelongsTo ──────────────────────────────────────────────────────────

describe('Model.whereBelongsTo', () => {
  beforeEach(() => ModelRegistry.reset())

  it('adds equality where(fk, parent.pk) — explicit relation name', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    const team = Team.hydrate({ id: 7 }) as Team
    await User.whereBelongsTo(team, 'team').get()

    assert.deepEqual(latest().wheres, [['teamId', '=', 7]])
  })

  it('infers single belongsTo when relation name omitted', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    const team = Team.hydrate({ id: 7 }) as Team
    await User.whereBelongsTo(team).get()

    assert.deepEqual(latest().wheres, [['teamId', '=', 7]])
  })

  it('throws when multiple belongsTo relations point at the same parent', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    const team = TeamWithDual.hydrate({ id: 1 }) as TeamWithDual
    assert.throws(
      () => Repo.whereBelongsTo(team),
      /multiple belongsTo relations pointing at TeamWithDual.*owner.*reviewer/s,
    )
  })

  it('throws when parent has no primary key value', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    const team = Team.hydrate({}) as Team  // no id
    assert.throws(
      () => User.whereBelongsTo(team, 'team'),
      /whereBelongsTo: parent\.id is unset on Team/,
    )
  })

  it('throws when relation name is not belongsTo', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    const team = Team.hydrate({ id: 1 }) as Team
    assert.throws(
      () => User.whereBelongsTo(team, 'posts'),
      /Relation "posts" on User is "hasMany", not "belongsTo"/,
    )
  })
})

// ─── Chainable form on QueryBuilder ──────────────────────────────────────────

describe('Chainable whereHas via QueryBuilder', () => {
  beforeEach(() => ModelRegistry.reset())

  it('User.where(...).whereHas(...).get() routes through the proxy', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await (User.where('teamId', 7) as unknown as { whereHas: (r: string) => { get: () => Promise<unknown[]> } }).whereHas('posts').get()

    const rec = latest()
    assert.deepEqual(rec.wheres, [['teamId', '=', 7]])
    assert.equal(rec.predicates.length, 1)
    assert.equal(rec.predicates[0]!.relation, 'posts')
  })
})
