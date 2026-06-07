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

function recordingAdapter(opts: { nestedSupport?: boolean } = {}): { adapter: OrmAdapter; latest: () => RecordedQb } {
  let latest: RecordedQb | null = null

  const makeQb = <T,>(): QueryBuilder<T> => {
    const rec: RecordedQb = { predicates: [], wheres: [], withs: [], withConstraineds: [] }
    latest = rec
    const qb: QueryBuilder<T> & { supportsNestedRelationPredicates?: boolean } = {
      where: ((col: string, opOrVal: unknown, maybeVal?: unknown): QueryBuilder<T> => {
        if (maybeVal === undefined) rec.wheres.push([col, '=', opOrVal])
        else                        rec.wheres.push([col, opOrVal as WhereOperator, maybeVal])
        return qb
      }) as QueryBuilder<T>['where'],
      orWhere: () => qb,
      selectRaw: () => qb,
      whereRaw: () => qb,
      orWhereRaw: () => qb,
      orderByRaw: () => qb,
      orderBy: () => qb,
      limit:   () => qb,
      offset:  () => qb,
      with:    (...rels: string[]) => { rec.withs.push(...rels); return qb },
      withPivot: () => qb,
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
      updateAll: async () => 0,
      paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
      whereRelationExists: (predicate) => { rec.predicates.push(predicate); return qb },
      withConstrained: (rel, ws) => { rec.withConstraineds.push([rel, ws]); return qb },
      withAggregate: () => qb,
      _aggregate: async () => 0,
      whereGroup:   () => qb,
      orWhereGroup: () => qb,
    }
    if (opts.nestedSupport) qb.supportsNestedRelationPredicates = true
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

  it('throws on the count-comparison form too (has)', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => Comment.has('target', '>', 2),
      /morphTo "target" cannot be used with whereHas/,
    )
  })

  it('throws on the OR-rooted form too (orWhereHas)', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => Comment.orWhereHas('target'),
      /morphTo "target" cannot be used with whereHas/,
    )
  })
})

// ─── whereHas — malformed nested path ────────────────────────────────────────

describe('Model.whereHas — malformed nested path', () => {
  beforeEach(() => ModelRegistry.reset())

  it('an empty segment ("a..b") throws before any predicate is built', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => Comment.whereHas('target..body'),
      /Malformed nested relation path "target\.\.body" — empty segment/,
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

  it('rejects nested whereHas on adapters without the recursive-EXISTS marker', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    // The child predicate builds fine — the ADAPTER guard is what rejects:
    // the recording stub has no `supportsNestedRelationPredicates`, mirroring
    // Drizzle/Prisma's current posture.
    assert.throws(
      () => Team.whereHas('members', (q) => q.whereHas('posts')),
      /Nested whereHas \("members"\) is not supported on this adapter/,
    )
  })

  it('unknown child relation names the owning model', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => User.whereHas('posts', (q) => q.whereHas('nope')),
      /Relation "nope" is not defined on Post \(nested whereHas inside a constrain callback\)/,
    )
  })

  it('throws when orWhere is used inside the constrain callback', () => {
    const { adapter } = recordingAdapter()
    ModelRegistry.set(adapter)

    assert.throws(
      () => User.whereHas('posts', (q) => {
        q.where('approved', true)
        ;q.orWhere('featured', true)
      }),
      /orWhere\(\) inside a whereHas constrain callback is not supported/,
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

    await User.where('teamId', 7).whereHas('posts').get()

    const rec = latest()
    assert.deepEqual(rec.wheres, [['teamId', '=', 7]])
    assert.equal(rec.predicates.length, 1)
    assert.equal(rec.predicates[0]!.relation, 'posts')
  })
})

// ─── whereRelation — column-on-relation sugar ────────────────────────────────

describe('whereRelation / orWhereRelation', () => {
  beforeEach(() => ModelRegistry.reset())

  it('static, two-arg: whereHas(rel, q => q.where(col, value)) with `=`', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereRelation('posts', 'published', true).get()

    const p = latest().predicates[0]!
    assert.equal(p.relation, 'posts')
    assert.equal(p.exists, true)
    assert.equal(p.boolean, undefined) // AND-rooted
    assert.deepEqual(p.constraintWheres, [{ column: 'published', operator: '=', value: true }])
  })

  it('static, three-arg: carries the operator', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereRelation('posts', 'authorId', '>=', 5).get()

    assert.deepEqual(latest().predicates[0]!.constraintWheres, [
      { column: 'authorId', operator: '>=', value: 5 },
    ])
  })

  it('orWhereRelation is OR-rooted', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.orWhereRelation('posts', 'published', true).get()

    const p = latest().predicates[0]!
    assert.equal(p.boolean, 'OR')
    assert.deepEqual(p.constraintWheres, [{ column: 'published', operator: '=', value: true }])
  })

  it('works on a belongsToMany relation (predicate keeps the through-block)', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereRelation('roles', 'name', 'admin').get()

    const p = latest().predicates[0]!
    assert.equal(p.relation, 'roles')
    assert.ok(p.through)
    assert.equal(p.through!.pivotTable, 'role_user')
    assert.deepEqual(p.constraintWheres, [{ column: 'name', operator: '=', value: 'admin' }])
  })

  it('chainable: User.where(...).whereRelation(...).get() routes through the proxy', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.where('teamId', 7).whereRelation('posts', 'published', true).orWhereRelation('posts', 'authorId', '>', 0).get()

    const rec = latest()
    assert.deepEqual(rec.wheres, [['teamId', '=', 7]])
    assert.equal(rec.predicates.length, 2)
    assert.equal(rec.predicates[0]!.boolean, undefined)
    assert.deepEqual(rec.predicates[0]!.constraintWheres, [{ column: 'published', operator: '=', value: true }])
    assert.equal(rec.predicates[1]!.boolean, 'OR')
    assert.deepEqual(rec.predicates[1]!.constraintWheres, [{ column: 'authorId', operator: '>', value: 0 }])
  })
})

// ─── whereHas — through relations (hasOneThrough / hasManyThrough) ───────────

class Essay extends Model {
  static override table = 'essays'
  id!: number
  citizenId!: number
}
class Citizen extends Model {
  static override table = 'citizens'
  id!: number
  nationId!: number
}
class Nation extends Model {
  static override table = 'nations'
  id!: number
  static override relations = {
    essays: { type: 'hasManyThrough' as const, model: () => Essay, through: () => Citizen },
    motto:  { type: 'hasOneThrough'  as const, model: () => Essay, through: () => Citizen },
    custom: {
      type: 'hasManyThrough' as const, model: () => Essay, through: () => Citizen,
      firstKey: 'homeId', secondKey: 'writerId', localKey: 'code', secondLocalKey: 'uuid',
    },
  }
}

describe('Model.whereHas — through relations', () => {
  beforeEach(() => ModelRegistry.reset())

  it('builds the two-hop predicate: intermediate as the through block + fanOut', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await Nation.whereHas('essays').get()

    const p = latest().predicates[0]!
    assert.equal(p.relation,      'essays')
    assert.equal(p.exists,        true)
    assert.equal(p.relatedTable,  'essays')
    assert.equal(p.parentColumn,  'id')          // localKey default = Nation PK
    assert.equal(p.relatedColumn, 'citizenId')   // secondKey default = camelHead(Citizen)+Id
    assert.deepEqual(p.through, {
      pivotTable:      'citizens',
      foreignPivotKey: 'nationId',               // firstKey default = camelHead(Nation)+Id
      relatedPivotKey: 'id',                     // secondLocalKey default = Citizen PK
      fanOut:          true,
    })
    assert.equal(p.extraEquals, undefined)
  })

  it('whereDoesntHave flips exists; hasOneThrough builds the same walk', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await Nation.whereDoesntHave('motto').get()

    const p = latest().predicates[0]!
    assert.equal(p.exists, false)
    assert.equal(p.relatedTable, 'essays')
    assert.equal(p.through!.pivotTable, 'citizens')
    assert.equal(p.through!.fanOut, true)
  })

  it('honors explicit key overrides on every hop', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await Nation.whereHas('custom').get()

    const p = latest().predicates[0]!
    assert.equal(p.parentColumn,  'code')
    assert.equal(p.relatedColumn, 'writerId')
    assert.deepEqual(p.through, {
      pivotTable:      'citizens',
      foreignPivotKey: 'homeId',
      relatedPivotKey: 'uuid',
      fanOut:          true,
    })
  })

  it('constrain callback wheres target the FAR table clauses', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await Nation.whereHas('essays', q => q.where('published', true)).get()

    const p = latest().predicates[0]!
    assert.deepEqual(p.constraintWheres, [{ column: 'published', operator: '=', value: true }])
  })

  it('has(relation, op, n) carries the count comparison on the predicate', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await Nation.has('essays', '>=', 3).get()

    const p = latest().predicates[0]!
    assert.deepEqual(p.count, { operator: '>=', value: 3 })
    assert.equal(p.through!.fanOut, true)
  })

  it('withWhereHas on a through relation falls back to plain with() — never withConstrained', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await Nation.withWhereHas('essays', q => q.where('published', true)).get()

    const rec = latest()
    assert.equal(rec.predicates.length, 1, 'parent-side filter still applies')
    assert.deepEqual(rec.withConstraineds, [], 'withConstrained cannot express the two-hop walk')
    // The eager load itself never reaches the adapter QB: through relations
    // always ride the Model-layer two-hop walk (attachHasThrough), so the
    // adapter sees neither with() nor withConstrained(). The loaded children
    // are asserted in the has-through E2E suite.
    assert.deepEqual(rec.withs, [])
  })
})

// ─── Constrain-callback recorder — sugar support + loud rejections ───────────
//
// Historically the recorder silently no-oped every method except where/
// orWhere/whereHas — a whereIn(...) inside a callback silently matched MORE
// rows than intended. It now records the AND-expressible sugar and throws on
// everything that can't round-trip through the flat constraint list.

describe('whereHas constrain callback — recorded sugar', () => {
  beforeEach(() => ModelRegistry.reset())

  it('whereIn / whereNotIn lower to IN / NOT IN clauses', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereHas('posts', q => q.whereIn('id', [1, 2]).whereNotIn('authorId', [9])).get()

    assert.deepEqual(latest().predicates[0]!.constraintWheres, [
      { column: 'id',       operator: 'IN',     value: [1, 2] },
      { column: 'authorId', operator: 'NOT IN', value: [9] },
    ])
  })

  it('whereNull / whereNotNull lower to null equality', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereHas('posts', q => q.whereNull('deletedAt').whereNotNull('publishedAt')).get()

    assert.deepEqual(latest().predicates[0]!.constraintWheres, [
      { column: 'deletedAt',   operator: '=',  value: null },
      { column: 'publishedAt', operator: '!=', value: null },
    ])
  })

  it('whereBetween lowers to its two AND bounds', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereHas('posts', q => q.whereBetween('views', [10, 20])).get()

    assert.deepEqual(latest().predicates[0]!.constraintWheres, [
      { column: 'views', operator: '>=', value: 10 },
      { column: 'views', operator: '<=', value: 20 },
    ])
  })

  it('when / unless run their callbacks against the recorder', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereHas('posts', q =>
      q.when(true,  (qq) => qq.where('published', true))
       .when(false, (qq) => qq.where('never', 1), (qq) => qq.where('otherwise', 2))
       .unless(true, (qq) => qq.where('nor-this', 3)),
    ).get()

    assert.deepEqual(latest().predicates[0]!.constraintWheres, [
      { column: 'published', operator: '=', value: true },
      { column: 'otherwise', operator: '=', value: 2 },
    ])
  })

  it('harmless ordering/limiting methods still chain silently', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.whereHas('posts', q => q.orderBy('id').limit(5).where('published', true)).get()

    assert.deepEqual(latest().predicates[0]!.constraintWheres, [
      { column: 'published', operator: '=', value: true },
    ])
  })
})

describe('whereHas constrain callback — loud rejections (previously silent drops)', () => {
  beforeEach(() => {
    ModelRegistry.reset()
    ModelRegistry.set(recordingAdapter().adapter)
  })

  const cases: Array<[string, (q: QueryBuilder<Model>) => void]> = [
    ['whereNotBetween',    q => (q as unknown as { whereNotBetween(c: string, r: [number, number]): void }).whereNotBetween('views', [1, 2])],
    ['whereDate',          q => (q as unknown as { whereDate(c: string, v: string): void }).whereDate('createdAt', '2026-01-01')],
    ['whereJsonContains',  q => (q as unknown as { whereJsonContains(c: string, v: unknown): void }).whereJsonContains('meta->tags', 'a')],
    ['whereRaw',           q => q.whereRaw('1 = 1')],
    ['whereGroup',         q => q.whereGroup(() => {})],
    ['whereColumn',        q => (q as unknown as { whereColumn(a: string, b: string): void }).whereColumn('a', 'b')],
    ['onlyTrashed',        q => q.onlyTrashed()],
    ['whereExists',        q => (q as unknown as { whereExists(b: unknown): void }).whereExists('SELECT 1')],
  ]

  for (const [name, call] of cases) {
    it(`${name} throws instead of silently widening the filter`, () => {
      assert.throws(
        () => User.whereHas('posts', q => call(q)),
        new RegExp(`${name}\\(\\) inside a whereHas constrain callback is not supported`),
      )
    })
  }

  it('unknown / terminal methods throw with the supported list', () => {
    assert.throws(
      () => User.whereHas('posts', q => { void (q as unknown as { get(): unknown }).get() }),
      /get\(\) is not available inside a whereHas constrain callback[\s\S]*Supported: where, whereIn/,
    )
  })

  it('orWhere keeps its dedicated error', () => {
    assert.throws(
      () => User.whereHas('posts', q => q.orWhere('a', 1)),
      /orWhere\(\) inside a whereHas constrain callback is not supported/,
    )
  })
})

// ─── Callback-nested whereHas — predicate shapes (PR A) ──────────────────────
//
// `whereHas('posts', q => q.whereHas('comments', cb))` — the callback-nested
// form. Children land on the parent predicate's `nested` ARRAY (dot-paths
// keep emitting the singular form), each with its own exists flag +
// constraints; recursion is unbounded. Native-only via the same
// `supportsNestedRelationPredicates` marker as dot-paths.

class NComment extends Model {
  static override table = 'ncomments'
  id!: number
  static override relations = {
    reactions: { type: 'hasMany' as const, model: () => NReaction, foreignKey: 'commentId' },
  }
}
class NReaction extends Model {
  static override table = 'nreactions'
  id!: number
}
class NPost extends Model {
  static override table = 'nposts'
  id!: number
  static override relations = {
    comments: { type: 'hasMany' as const, model: () => NComment, foreignKey: 'postId' },
    tags:     { type: 'belongsToMany' as const, model: () => NTag, pivotTable: 'npost_tag' },
  }
}
class NTag extends Model {
  static override table = 'ntags'
  id!: number
}
class NUser extends Model {
  static override table = 'nusers'
  id!: number
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => NPost, foreignKey: 'authorId' },
  }
}

const asArray = (n: RelationExistencePredicate['nested']): RelationExistencePredicate[] =>
  n === undefined ? [] : Array.isArray(n) ? n : [n]

describe('Model.whereHas — callback-nested children', () => {
  beforeEach(() => ModelRegistry.reset())

  it('records a child predicate with constraints at BOTH levels', async () => {
    const { adapter, latest } = recordingAdapter({ nestedSupport: true })
    ModelRegistry.set(adapter)

    await NUser.whereHas('posts', q =>
      q.where('published', true)
       .whereHas('comments', c => c.where('approved', true)),
    ).get()

    const p = latest().predicates[0]!
    assert.equal(p.relation, 'posts')
    assert.deepEqual(p.constraintWheres, [{ column: 'published', operator: '=', value: true }])
    const children = asArray(p.nested)
    assert.equal(children.length, 1)
    const child = children[0]!
    assert.equal(child.relation, 'comments')
    assert.equal(child.relatedTable, 'ncomments')
    assert.equal(child.parentColumn, 'id')
    assert.equal(child.relatedColumn, 'postId')
    assert.equal(child.exists, true)
    assert.deepEqual(child.constraintWheres, [{ column: 'approved', operator: '=', value: true }])
  })

  it('inner whereDoesntHave flips the CHILD exists flag only', async () => {
    const { adapter, latest } = recordingAdapter({ nestedSupport: true })
    ModelRegistry.set(adapter)

    await NUser.whereHas('posts', q => q.whereDoesntHave('comments')).get()

    const p = latest().predicates[0]!
    assert.equal(p.exists, true)
    assert.equal(asArray(p.nested)[0]!.exists, false)
  })

  it('sibling nested calls AND together as an array', async () => {
    const { adapter, latest } = recordingAdapter({ nestedSupport: true })
    ModelRegistry.set(adapter)

    await NUser.whereHas('posts', q => q.whereHas('comments').whereHas('tags')).get()

    const children = asArray(latest().predicates[0]!.nested)
    assert.deepEqual(children.map(c => c.relation), ['comments', 'tags'])
    // The pivot child carries its through block like any top-level pivot predicate.
    assert.equal(children[1]!.through?.pivotTable, 'npost_tag')
  })

  it('recursion: a child callback may nest again', async () => {
    const { adapter, latest } = recordingAdapter({ nestedSupport: true })
    ModelRegistry.set(adapter)

    await NUser.whereHas('posts', q =>
      q.whereHas('comments', c => c.whereHas('reactions', r => r.where('kind', 'up'))),
    ).get()

    const level1 = asArray(latest().predicates[0]!.nested)[0]!
    const level2 = asArray(level1.nested)[0]!
    assert.equal(level2.relation, 'reactions')
    assert.deepEqual(level2.constraintWheres, [{ column: 'kind', operator: '=', value: 'up' }])
  })

  it('dot-path inside a callback composes through the nested builder', async () => {
    const { adapter, latest } = recordingAdapter({ nestedSupport: true })
    ModelRegistry.set(adapter)

    await NUser.whereHas('posts', q => q.whereHas('comments.reactions')).get()

    const child = asArray(latest().predicates[0]!.nested)[0]!
    assert.equal(child.relation, 'comments')
    assert.equal((child.nested as RelationExistencePredicate).relation, 'reactions')
  })

  it('dot-path whereHas with a callback that nests applies children at the DEEPEST level', async () => {
    const { adapter, latest } = recordingAdapter({ nestedSupport: true })
    ModelRegistry.set(adapter)

    await NUser.whereHas('posts.comments', q => q.where('approved', true).whereHas('reactions')).get()

    const outer = latest().predicates[0]!
    assert.equal(outer.relation, 'posts')
    assert.deepEqual(outer.constraintWheres, [])
    const deepest = outer.nested as RelationExistencePredicate
    assert.equal(deepest.relation, 'comments')
    assert.deepEqual(deepest.constraintWheres, [{ column: 'approved', operator: '=', value: true }])
    assert.deepEqual(asArray(deepest.nested).map(c => c.relation), ['reactions'])
  })

  it('morphTo child throws; withWhereHas inside a callback throws', () => {
    const { adapter } = recordingAdapter({ nestedSupport: true })
    ModelRegistry.set(adapter)

    // NThread.comments → Comment, whose 'target' is a morphTo — the dynamic
    // related table can't appear at ANY nesting level.
    class NThread extends Model {
      static override table = 'nthreads'
      static override relations = {
        comments: { type: 'hasMany' as const, model: () => Comment, foreignKey: 'threadId' },
      }
    }
    assert.throws(
      () => NThread.whereHas('comments', q => q.whereHas('target')),
      /morphTo "target" cannot be used with whereHas/,
    )
    assert.throws(
      () => NUser.whereHas('posts', q => (q as unknown as { withWhereHas(r: string): unknown }).withWhereHas('comments')),
      /withWhereHas\(\) inside a whereHas constrain callback is not supported/,
    )
  })

  it('withWhereHas with a NESTED callback falls back to plain with() — flat withConstrained cannot carry children', async () => {
    const { adapter, latest } = recordingAdapter({ nestedSupport: true })
    ModelRegistry.set(adapter)

    await NUser.withWhereHas('posts', q => q.where('published', true).whereHas('comments')).get()

    const rec = latest()
    assert.equal(rec.predicates.length, 1)
    assert.deepEqual(rec.withConstraineds, [], 'children cannot round-trip through withConstrained')
    assert.deepEqual(rec.withs, ['posts'])
  })
})
