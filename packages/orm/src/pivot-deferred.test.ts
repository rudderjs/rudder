/**
 * Phase 5 — Deferred-pivot proxy: race fix + unsupported-method throws.
 *
 * - Race: previously `lastPivotRows` was captured in the QB factory closure,
 *   so `Promise.all([qb.get(), qb.get()])` interleaved `buildResolved` and
 *   `postProcess` and the second terminal would stamp pivot rows from the
 *   first call. Now `buildResolved` returns `{ q, pivotRows }` together,
 *   threaded into `postProcess(result, terminal, pivotRows)` per call.
 *
 * - Silent swallow: previously the Proxy `get` trap returned `undefined`
 *   for unknown method names, so `parent.related('tags').whereHas(...)` /
 *   `.withCount(...)` / `.whereGroup(...)` quietly no-oped and the user's
 *   intent dropped on the floor. Now any unknown method-shaped string
 *   property (`where*`, `with*`, `load*`, `or<X>*`) throws with a clear
 *   message; runtime-internal access (`Symbol.iterator`, `then`, etc.)
 *   continues to return `undefined` so the proxy behaves as a plain object.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, type QueryBuilder, type OrmAdapter } from './index.js'

// ─── Minimal in-memory adapter that records when each pivot query fires.
// Used for the race test: by gating the *first* pivot query on a Promise the
// test controls, we can interleave two concurrent terminals and observe
// whether their results read the right pivot rows.

type Where = [string, string, unknown]

type Adapter = {
  adapter:    OrmAdapter
  rows:       (table: string) => Record<string, unknown>[]
  /** Per-table gate — if set, the next `get()` against that table waits on
   *  the gate before resolving. Lets us interleave concurrent terminals. */
  gateNext:   (table: string, gate: Promise<unknown>) => void
}

function makeAdapter(): Adapter {
  const tables = new Map<string, Record<string, unknown>[]>()
  const ensure = (t: string): Record<string, unknown>[] => {
    if (!tables.has(t)) tables.set(t, [])
    return tables.get(t)!
  }
  const gates  = new Map<string, Promise<unknown>>()

  const matches = (row: Record<string, unknown>, wheres: ReadonlyArray<Where>): boolean => {
    for (const [col, op, val] of wheres) {
      const v = row[col]
      if (op === 'IN') {
        if (!Array.isArray(val) || !(val as unknown[]).includes(v)) return false
        continue
      }
      if (v !== val) return false
    }
    return true
  }

  const makeQbFor = <T,>(table: string): QueryBuilder<T> => {
    const wheres: Where[] = []
    const qb: QueryBuilder<T> = {
      where: ((col: string, opOrVal: unknown, maybeVal?: unknown) => {
        const op  = maybeVal === undefined ? '=' : String(opOrVal)
        const val = maybeVal === undefined ? opOrVal : maybeVal
        wheres.push([col, op, val])
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
      with:    () => qb,
      withPivot:    () => qb,
      withTrashed:  () => qb,
      onlyTrashed:  () => qb,
      first: async () => (ensure(table).find(r => matches(r, wheres)) ?? null) as T | null,
      find:  async (id) => (ensure(table).find(r => r['id'] === id) ?? null) as T | null,
      get:   async () => {
        const gate = gates.get(table)
        if (gate) {
          gates.delete(table)
          await gate
        }
        return ensure(table).filter(r => matches(r, wheres)) as T[]
      },
      all:   async () => [...ensure(table)] as T[],
      count: async () => ensure(table).filter(r => matches(r, wheres)).length,
      create: async (data) => {
        const d = data as Record<string, unknown>
        const row = { id: d['id'] ?? ensure(table).length + 1, ...d }
        ensure(table).push(row)
        return row as T
      },
      update:      async () => ({} as T),
      delete:      async () => undefined,
      restore:     async () => ({} as T),
      forceDelete: async () => undefined,
      increment:   async () => ({} as T),
      decrement:   async () => ({} as T),
      insertMany:  async () => undefined,
      deleteAll:   async () => 0,
      updateAll:   async () => 0,
      paginate:    async () => {
        const all = ensure(table).filter(r => matches(r, wheres)) as T[]
        return { data: all, total: all.length, perPage: 15, currentPage: 1, lastPage: 1, from: 1, to: all.length }
      },
      whereRelationExists: () => qb,
      whereGroup:   () => qb,
      orWhereGroup: () => qb,
      withAggregate: () => qb,
      _aggregate: async () => 0,
    }
    return qb
  }

  return {
    adapter: {
      query: <T,>(table: string) => makeQbFor<T>(table),
      connect:    async () => undefined,
      disconnect: async () => undefined,
    },
    rows:     (table: string) => ensure(table),
    gateNext: (table: string, gate: Promise<unknown>) => { gates.set(table, gate) },
  }
}

// ─── Race regression ───────────────────────────────────────

describe('pivot-deferred — concurrent terminal calls', () => {
  beforeEach(() => ModelRegistry.reset())

  // Helper so both belongsToMany and morphToMany variants exercise the same
  // race shape.
  function setupBelongsToMany(): {
    rows: (t: string) => Record<string, unknown>[]
    gate: (t: string, p: Promise<unknown>) => void
    User: typeof Model
  } {
    const a = makeAdapter()
    ModelRegistry.set(a.adapter)
    class Role extends Model { id!: number; name!: string }
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
      id!: number
    }
    return { rows: a.rows, gate: a.gateNext, User }
  }

  it('two parallel .get() calls on the same parent see consistent pivot rows', async () => {
    // The fix: each terminal call resolves its own pivot rows and passes them
    // into postProcess. Previously the second call would read whatever
    // `lastPivotRows` got assigned by the first.
    const { rows, User } = setupBelongsToMany()
    rows('roles').push({ id: 1, name: 'admin' }, { id: 2, name: 'editor' })
    rows('role_user').push(
      { userId: 7, roleId: 1, role: 'owner',  assignedBy: 'system' },
      { userId: 7, roleId: 2, role: 'editor', assignedBy: 'admin'  },
    )
    const user = User.hydrate({ id: 7 })!

    const [a, b] = await Promise.all([
      user.related('roles').withPivot('role').get() as unknown as Promise<Array<Record<string, unknown>>>,
      user.related('roles').withPivot('role').get() as unknown as Promise<Array<Record<string, unknown>>>,
    ])

    assert.equal(a.length, 2)
    assert.equal(b.length, 2)
    const aPivots = a.map(r => r['pivot'])
    const bPivots = b.map(r => r['pivot'])
    assert.deepStrictEqual(aPivots, bPivots, 'both calls must see the same pivot rows')
    // And they must be the right rows — not undefined (which is what
    // surfaced when the closure raced and the second call's pivotRows were
    // overwritten before stampPivotOnResult ran).
    assert.ok(aPivots.every(p => p && typeof p === 'object'))
  })

  it('interleaved terminals: gating pivot fetch A delays A but B finishes with its own pivot rows', async () => {
    // Explicit interleave: queue terminal A behind a gate so terminal B can
    // complete its pivot lookup + stamping while A is parked. Before the
    // fix, when A resumed it would stamp using B's pivotRows (whichever
    // overwrote `lastPivotRows` last).
    const { rows, gate, User } = setupBelongsToMany()
    rows('roles').push({ id: 1, name: 'admin' }, { id: 2, name: 'editor' })
    rows('role_user').push(
      { userId: 7, roleId: 1, role: 'first',  assignedBy: 'sys' },
      { userId: 7, roleId: 2, role: 'second', assignedBy: 'sys' },
    )
    const user = User.hydrate({ id: 7 })!

    // Park A's pivot query until we release it.
    let release: () => void = () => {}
    const gateA = new Promise<void>(res => { release = res })
    gate('role_user', gateA)

    const pA = user.related('roles').withPivot('role').get() as unknown as Promise<Array<Record<string, unknown>>>
    // A's pivot query is parked. Now fire B — it should not be gated
    // (gateNext only gates the next call) and should complete first.
    const b  = await (user.related('roles').withPivot('role').get() as unknown as Promise<Array<Record<string, unknown>>>)
    assert.ok(b.length === 2, 'B finished first')
    release()
    const a = await pA
    assert.deepStrictEqual(a.map(r => r['pivot']), b.map(r => r['pivot']))
  })
})

// ─── Unsupported chain methods ─────────────────────────────

describe('pivot-deferred — unsupported chain method throws', () => {
  beforeEach(() => ModelRegistry.reset())

  function setup(): { User: typeof Model } {
    const a = makeAdapter()
    ModelRegistry.set(a.adapter)
    class Role extends Model { id!: number }
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
      id!: number
    }
    return { User }
  }

  const unsupported = ['whereHas', 'whereDoesntHave', 'withWhereHas', 'whereBelongsTo',
                      'whereGroup', 'orWhereGroup', 'withCount', 'withSum', 'withMin',
                      'withMax', 'withAvg', 'withExists', 'withAggregate',
                      'loadCount', 'loadSum']

  for (const method of unsupported) {
    it(`throws when ${method}() is chained on a deferred pivot relation`, () => {
      const { User } = setup()
      const user = User.hydrate({ id: 1 })!
      const qb = user.related('roles') as unknown as Record<string, (...a: unknown[]) => unknown>
      assert.throws(
        () => qb[method]!('whatever'),
        /not supported on a belongsToMany lazy-fetch query/,
      )
    })
  }

  it('error message lists the supported chain methods to guide the user', () => {
    const { User } = setup()
    const user = User.hydrate({ id: 1 })!
    const qb = user.related('roles') as unknown as Record<string, (...a: unknown[]) => unknown>
    try {
      qb['whereHas']!('something')
      assert.fail('expected throw')
    } catch (err) {
      const msg = (err as Error).message
      // Sanity-check that the helpful chain list landed in the message.
      assert.match(msg, /where/)
      assert.match(msg, /orderBy/)
    }
  })

  it('still returns undefined for non-method-shaped property access (then, toString, Symbol.iterator)', () => {
    const { User } = setup()
    const user = User.hydrate({ id: 1 })!
    const qb = user.related('roles') as unknown as Record<PropertyKey, unknown>
    // These are read by the JS runtime / await machinery; throwing would
    // break `await qb`, spread, deep-equal, etc.
    assert.equal(qb['then'], undefined)
    assert.equal(qb['catch'], undefined)
    assert.equal(qb['finally'], undefined)
    assert.equal(qb['toString'], undefined)
    assert.equal(qb['valueOf'], undefined)
    assert.equal((qb as { [Symbol.iterator]?: unknown })[Symbol.iterator], undefined)
    assert.equal((qb as { [Symbol.toPrimitive]?: unknown })[Symbol.toPrimitive], undefined)
  })

  it('await on the proxy resolves to the proxy itself (not thenable)', async () => {
    // Regression: if the unknown-method throw fired on `then`, `await qb`
    // would throw before chaining could ever happen. We need the proxy to
    // be NOT thenable.
    const { User } = setup()
    const user = User.hydrate({ id: 1 })!
    const qb = user.related('roles')
    const r  = await qb
    assert.equal(r, qb)
  })

  it('whereHas message names the relation kind so morphToMany / morphedByMany users see the right hint', () => {
    const a = makeAdapter()
    ModelRegistry.set(a.adapter)
    class Tag extends Model { id!: number }
    class Post extends Model {
      static override relations = {
        tags: {
          type:           'morphToMany' as const,
          model:          () => Tag,
          pivotTable:     'taggable',
          morphName:      'taggable',
          morphTypeValue: 'Post',
        },
      }
      id!: number
    }
    const post = Post.hydrate({ id: 1 })!
    const qb = post.related('tags') as unknown as Record<string, (...a: unknown[]) => unknown>
    assert.throws(
      () => qb['whereHas']!('parent'),
      /morphToMany lazy-fetch query/,
    )
  })
})

// ─── Mutation throws (regression — make sure we didn't break these) ───

describe('pivot-deferred — mutation methods still throw with the original error', () => {
  beforeEach(() => ModelRegistry.reset())

  it('create()/update()/delete() on the deferred QB throw, naming the relation kind', () => {
    const a = makeAdapter()
    ModelRegistry.set(a.adapter)
    class Role extends Model { id!: number }
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
      id!: number
    }
    const user = User.hydrate({ id: 1 })!
    const qb = user.related('roles') as unknown as Record<string, (...a: unknown[]) => unknown>
    for (const m of ['create', 'update', 'delete', 'insertMany', 'deleteAll']) {
      assert.throws(
        () => qb[m]!({}),
        /not supported on a belongsToMany lazy-fetch query/,
        `${m}() should throw`,
      )
    }
  })
})
