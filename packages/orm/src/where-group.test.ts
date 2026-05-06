import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  Model, ModelRegistry,
  type QueryBuilder, type OrmAdapter, type WhereOperator,
  type RelationExistencePredicate,
} from './index.js'

// ─── Recording adapter ───────────────────────────────────────────────────────
//
// Captures every call (where, orWhere, whereGroup, orWhereGroup,
// whereRelationExists, terminals) on the chain. Sub-builders are produced by
// the same factory, but tagged with an `_isSub` flag so terminals throw —
// matches the real adapter's `_markSubBuilder` behaviour.
//
// `whereGroup` / `orWhereGroup` invoke the callback with a fresh sub-recorder.
// The recorded captures form a tree we can inspect.

interface GroupNode {
  kind:   'and' | 'or'
  parts:  Array<{ kind: 'where' | 'orWhere'; col: string; op: WhereOperator; val: unknown }
                | { kind: 'group'; node: GroupNode }>
  predicates: RelationExistencePredicate[]
}

function makeRecorder(isSub: boolean = false): {
  qb: QueryBuilder<unknown>
  node: GroupNode
} {
  const node: GroupNode = { kind: 'and', parts: [], predicates: [] }
  const qb: QueryBuilder<unknown> = {
    where: ((col: string, opOrVal: unknown, maybeVal?: unknown): QueryBuilder<unknown> => {
      const op:  WhereOperator = (maybeVal === undefined ? '=' : opOrVal) as WhereOperator
      const val:  unknown      =  maybeVal === undefined ? opOrVal : maybeVal
      node.parts.push({ kind: 'where', col, op, val })
      return qb
    }) as QueryBuilder<unknown>['where'],
    orWhere: ((col: string, opOrVal: unknown, maybeVal?: unknown): QueryBuilder<unknown> => {
      const op:  WhereOperator = (maybeVal === undefined ? '=' : opOrVal) as WhereOperator
      const val:  unknown      =  maybeVal === undefined ? opOrVal : maybeVal
      node.parts.push({ kind: 'orWhere', col, op, val })
      return qb
    }) as QueryBuilder<unknown>['orWhere'],
    whereGroup: (fn) => {
      const sub = makeRecorder(true)
      fn(sub.qb)
      sub.node.kind = 'and'
      node.parts.push({ kind: 'group', node: sub.node })
      return qb
    },
    orWhereGroup: (fn) => {
      const sub = makeRecorder(true)
      fn(sub.qb)
      sub.node.kind = 'or'
      node.parts.push({ kind: 'group', node: sub.node })
      return qb
    },
    orderBy: () => qb,
    limit:   () => qb,
    offset:  () => qb,
    with:    () => qb,
    withTrashed: () => qb,
    onlyTrashed: () => qb,
    first: async () => { if (isSub) throw new Error('sub'); return null },
    find:  async () => { if (isSub) throw new Error('sub'); return null },
    get:   async () => { if (isSub) throw new Error('sub'); return [] },
    all:   async () => { if (isSub) throw new Error('sub'); return [] },
    count: async () => { if (isSub) throw new Error('sub'); return 0 },
    create: async (d) => d as never,
    update: async (_id, d) => d as never,
    delete: async () => undefined,
    restore: async () => ({} as never),
    forceDelete: async () => undefined,
    increment: async () => ({} as never),
    decrement: async () => ({} as never),
    insertMany: async () => undefined,
    deleteAll:  async () => 0,
    updateAll:  async () => 0,
    withPivot:  () => qb,
    paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 0, from: 0, to: 0 }),
    whereRelationExists: (predicate) => { node.predicates.push(predicate); return qb },
    withAggregate: () => qb,
    _aggregate: async () => 0,
  }
  return { qb, node }
}

function recordingAdapter(): { adapter: OrmAdapter; latest: () => GroupNode } {
  let latest: GroupNode | null = null
  return {
    adapter: {
      query: <T,>(_table: string) => {
        const { qb, node } = makeRecorder()
        latest = node
        return qb as unknown as QueryBuilder<T>
      },
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
  status!: string
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => Post, foreignKey: 'authorId' },
  }
}

// ─── Single group ────────────────────────────────────────────────────────────

describe('Model.whereGroup — single AND group', () => {
  beforeEach(() => ModelRegistry.reset())

  it('captures a where + orWhere inside the group', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.query()
      .where('status', 'active')
      .whereGroup(g => g.where('priority', 'high').orWhere('starred', true))
      .get()

    const root = latest()
    assert.equal(root.parts.length, 2)
    const flat = root.parts[0]
    assert.equal(flat?.kind, 'where')
    if (flat?.kind === 'where') {
      assert.equal(flat.col, 'status')
      assert.equal(flat.val, 'active')
    }
    const grp = root.parts[1]
    assert.equal(grp?.kind, 'group')
    if (grp?.kind === 'group') {
      assert.equal(grp.node.kind, 'and')
      assert.equal(grp.node.parts.length, 2)
      const [a, b] = grp.node.parts
      assert.deepEqual(a, { kind: 'where',   col: 'priority', op: '=', val: 'high' })
      assert.deepEqual(b, { kind: 'orWhere', col: 'starred',  op: '=', val: true   })
    }
  })
})

// ─── Single OR-rooted group ──────────────────────────────────────────────────

describe('Model.orWhereGroup — single OR group', () => {
  beforeEach(() => ModelRegistry.reset())

  it('flags the group as OR-rooted', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.query()
      .where('status', 'active')
      .orWhereGroup(g => g.where('priority', 'high').where('starred', true))
      .get()

    const root = latest()
    const grp = root.parts[1]
    assert.equal(grp?.kind, 'group')
    if (grp?.kind === 'group') {
      assert.equal(grp.node.kind, 'or')
      assert.equal(grp.node.parts.length, 2)
    }
  })
})

// ─── Nested groups (3 deep) ──────────────────────────────────────────────────

describe('Model.whereGroup — 3-level nesting', () => {
  beforeEach(() => ModelRegistry.reset())

  it('builds (A AND (B OR (C AND D)))', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.query()
      .where('a', 1)
      .whereGroup(g1 =>
        g1.where('b', 2)
          .orWhereGroup(g2 =>
            g2.where('c', 3).where('d', 4),
          ),
      )
      .get()

    const root = latest()
    assert.equal(root.parts.length, 2)
    const g1 = root.parts[1]
    assert.equal(g1?.kind, 'group')
    if (g1?.kind !== 'group') return
    assert.equal(g1.node.kind, 'and')
    assert.equal(g1.node.parts.length, 2)

    const inner = g1.node.parts[1]
    assert.equal(inner?.kind, 'group')
    if (inner?.kind !== 'group') return
    assert.equal(inner.node.kind, 'or')
    assert.equal(inner.node.parts.length, 2)
    const [c, d] = inner.node.parts
    assert.deepEqual(c, { kind: 'where', col: 'c', op: '=', val: 3 })
    assert.deepEqual(d, { kind: 'where', col: 'd', op: '=', val: 4 })
  })
})

// ─── Empty group is a no-op ──────────────────────────────────────────────────

describe('Model.whereGroup — empty group', () => {
  beforeEach(() => ModelRegistry.reset())

  it('records the group node but with no parts', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.query().where('status', 'active').whereGroup(g => g).get()

    const root = latest()
    // Recorder collects every group call; empty-group-as-no-op is the
    // adapter's responsibility (verified separately in adapter tests). Here
    // we only confirm the orm proxy invoked the callback exactly once.
    assert.equal(root.parts.length, 2)
    const grp = root.parts[1]
    assert.equal(grp?.kind, 'group')
    if (grp?.kind === 'group') {
      assert.deepEqual(grp.node.parts, [])
    }
  })
})

// ─── Mix with whereHas ───────────────────────────────────────────────────────

describe('Model.whereGroup — mix with whereHas', () => {
  beforeEach(() => ModelRegistry.reset())

  it('whereHas inside whereGroup goes through the orm proxy on the sub-builder', async () => {
    const { adapter, latest } = recordingAdapter()
    ModelRegistry.set(adapter)

    await User.query().whereGroup(g => {
      // The orm proxy wraps the sub-builder so `whereHas` is available too.
      (g as unknown as { whereHas: (rel: string, fn: (q: QueryBuilder<unknown>) => unknown) => QueryBuilder<unknown> })
        .whereHas('posts', q => q.where('published', true))
    }).get()

    const root = latest()
    const grp = root.parts[0]
    assert.equal(grp?.kind, 'group')
    if (grp?.kind !== 'group') return
    assert.equal(grp.node.predicates.length, 1)
    const p = grp.node.predicates[0]!
    assert.equal(p.relation,     'posts')
    assert.equal(p.relatedTable, 'posts')
    assert.deepEqual(p.constraintWheres, [
      { column: 'published', operator: '=', value: true },
    ])
  })
})

// ─── Sub-builder terminals throw ─────────────────────────────────────────────
//
// Verified at the adapter level — the orm-package recording adapter doesn't
// model the sub-builder restriction itself. Both real adapters
// (orm-prisma, orm-drizzle) cover this in their own test files via
// `sub.get()` / `sub.first()` / etc. throwing.
