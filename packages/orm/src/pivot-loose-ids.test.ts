// Loose id comparison on pivot ops (sync/attach/detach/updatePivot).
//
// Ids that cross an HTTP boundary arrive as strings while autoincrement
// pivot rows store numbers. The accessor must diff on the String() form and
// write DB-typed values — strict `Set.has()` used to re-attach "3" against a
// stored 3 (UNIQUE violation on a constrained pivot) and pass string ids
// into WHERE clauses that typed adapters reject. The memory adapter below
// matches with strict `===` (like a typed adapter), so any value that isn't
// type-correct simply doesn't match — which is exactly what these tests pin.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, type QueryBuilder, type OrmAdapter } from './index.js'

// ─── In-memory adapter (mirrors belongs-to-many-pivot.test.ts; strict ===) ──

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

  const single = (row: Record<string, unknown>, [col, op, val]: Where): boolean => {
    const v = row[col]
    switch (op) {
      case '=':  return v === val
      case 'IN': return Array.isArray(val) && (val as unknown[]).includes(v)
      default: throw new Error(`memoryAdapter: unsupported op ${op}`)
    }
  }
  const matches = (row: Record<string, unknown>, wheres: ReadonlyArray<Where>): boolean =>
    wheres.every(w => single(row, w))

  const makeQbFor = <T,>(table: string): QueryBuilder<T> => {
    const wheres: Where[] = []
    const qb = {
      where: ((col: string, opOrVal: unknown, maybeVal?: unknown) => {
        const op  = maybeVal === undefined ? '=' : String(opOrVal)
        const val = maybeVal === undefined ? opOrVal : maybeVal
        wheres.push([col, op, val])
        return qb
      }) as QueryBuilder<T>['where'],
      orWhere: (() => qb) as QueryBuilder<T>['orWhere'],
      selectRaw: () => qb, whereRaw: () => qb, orWhereRaw: () => qb, orderByRaw: () => qb,
      orderBy: () => qb, limit: () => qb, offset: () => qb,
      with: () => qb, withPivot: () => qb, withTrashed: () => qb, onlyTrashed: () => qb,
      first: async () => (ensure(table).find(r => matches(r, wheres)) ?? null) as T | null,
      find:  async (id: unknown) => (ensure(table).find(r => r['id'] === id) ?? null) as T | null,
      get:   async () => ensure(table).filter(r => matches(r, wheres)) as T[],
      all:   async () => [...ensure(table)] as T[],
      count: async () => ensure(table).filter(r => matches(r, wheres)).length,
      create: async (data: unknown) => {
        const row = { ...(data as Record<string, unknown>) }
        ensure(table).push(row)
        return row as T
      },
      update: async () => ({} as T),
      delete: async () => undefined,
      restore: async () => ({} as T),
      forceDelete: async () => undefined,
      increment: async () => ({} as T),
      decrement: async () => ({} as T),
      insertMany: async (records: ReadonlyArray<unknown>) => {
        for (const r of records) ensure(table).push({ ...(r as Record<string, unknown>) })
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
      updateAll: async (data: unknown) => {
        let updated = 0
        for (const r of ensure(table)) {
          if (matches(r, wheres)) {
            Object.assign(r, data as Record<string, unknown>)
            updated++
          }
        }
        return updated
      },
      paginate: async () => ({ data: [], total: 0, perPage: 15, currentPage: 1, lastPage: 1, from: 0, to: 0 }),
      whereRelationExists: () => qb,
      whereGroup: () => qb, orWhereGroup: () => qb,
      withAggregate: () => qb,
      _aggregate: async () => 0,
    } as unknown as QueryBuilder<T>
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

// ─── Fixtures ────────────────────────────────────────────────────────────────

function setup(): { rows: (t: string) => Record<string, unknown>[]; User: typeof Model } {
  const { adapter, rows } = memoryAdapter()
  ModelRegistry.set(adapter)
  class Role extends Model { id!: number; name!: string }
  class User extends Model {
    static override relations = {
      roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
    }
    id!: number
  }
  return { rows, User }
}

// ─── sync — string ids vs numeric pivot rows ────────────────────────────────

describe('pivot loose ids — sync()', () => {
  beforeEach(() => ModelRegistry.reset())

  it('unchanged form re-submit is a no-op: sync(["1","3"]) against stored {1,3}', async () => {
    const { rows, User } = setup()
    rows('role_user').push(
      { userId: 7, roleId: 1 },
      { userId: 7, roleId: 3 },
    )
    const user = User.hydrate({ id: 7 })!
    const result = await Model.belongsToMany(user, 'roles').sync(['1', '3'])
    assert.deepStrictEqual(result.attached, [])
    assert.deepStrictEqual(result.detached, [])
    assert.strictEqual(rows('role_user').length, 2)
  })

  it('attaches new ids coerced to the observed numeric type; detaches with raw DB values', async () => {
    const { rows, User } = setup()
    rows('role_user').push(
      { userId: 7, roleId: 1 },
      { userId: 7, roleId: 3 },
    )
    const user = User.hydrate({ id: 7 })!
    const result = await Model.belongsToMany(user, 'roles').sync(['1', '4'])
    assert.deepStrictEqual(result.attached, [4]) // number, not "4"
    assert.deepStrictEqual(result.detached, [3])
    const ids = rows('role_user').filter(r => r['userId'] === 7).map(r => r['roleId'])
    assert.deepStrictEqual(ids.sort(), [1, 4])
    assert.ok(ids.every(id => typeof id === 'number'))
  })

  it('numeric ids vs string-PK pivot rows: the reverse direction is loose too', async () => {
    const { rows, User } = setup()
    rows('role_user').push(
      { userId: 7, roleId: 'a1' },
      { userId: 7, roleId: '7' }, // all-digit string PK
    )
    const user = User.hydrate({ id: 7 })!
    const result = await Model.belongsToMany(user, 'roles').sync(['a1', 7])
    assert.deepStrictEqual(result.attached, [])
    assert.deepStrictEqual(result.detached, [])
    assert.strictEqual(rows('role_user').length, 2)
  })

  it('duplicate desired ids collapse — sync(["3","3",3]) attaches at most once', async () => {
    const { rows, User } = setup()
    const user = User.hydrate({ id: 7 })!
    const result = await Model.belongsToMany(user, 'roles').sync(['3', '3', 3])
    assert.strictEqual(result.attached.length, 1)
    assert.strictEqual(rows('role_user').length, 1)
  })

  it('sync(map) with string keys reconciles extras on numeric rows instead of re-attaching', async () => {
    const { rows, User } = setup()
    rows('role_user').push({ userId: 7, roleId: 1, role: 'owner' })
    const user = User.hydrate({ id: 7 })!
    const result = await Model.belongsToMany(user, 'roles').sync({ '1': { role: 'editor' } })
    assert.deepStrictEqual(result.attached, [])
    assert.deepStrictEqual(result.updated, [1])
    assert.strictEqual(rows('role_user').length, 1)
    assert.strictEqual(rows('role_user')[0]!['role'], 'editor')
  })

  it('leading-zero map keys stay strings (lossy round-trip is never coerced)', async () => {
    const { rows, User } = setup()
    const user = User.hydrate({ id: 7 })!
    await Model.belongsToMany(user, 'roles').sync({ '0123': {} })
    assert.strictEqual(rows('role_user')[0]!['roleId'], '0123')
  })
})

// ─── attach / detach / updatePivot — write-side type correctness ────────────

describe('pivot loose ids — attach/detach/updatePivot', () => {
  beforeEach(() => ModelRegistry.reset())

  it('attach(["5"]) coerces to the observed numeric type', async () => {
    const { rows, User } = setup()
    rows('role_user').push({ userId: 7, roleId: 1 })
    const user = User.hydrate({ id: 7 })!
    await Model.belongsToMany(user, 'roles').attach(['5'])
    const added = rows('role_user').find(r => r['roleId'] === 5)
    assert.ok(added, 'expected roleId to be inserted as number 5')
  })

  it('attach with no observable rows keeps the id as given (status quo)', async () => {
    const { rows, User } = setup()
    const user = User.hydrate({ id: 7 })!
    await Model.belongsToMany(user, 'roles').attach(['5'])
    assert.strictEqual(rows('role_user')[0]!['roleId'], '5')
  })

  it('detach(["3"]) deletes the numeric row', async () => {
    const { rows, User } = setup()
    rows('role_user').push(
      { userId: 7, roleId: 1 },
      { userId: 7, roleId: 3 },
    )
    const user = User.hydrate({ id: 7 })!
    const removed = await Model.belongsToMany(user, 'roles').detach(['3'])
    assert.strictEqual(removed, 1)
    assert.deepStrictEqual(rows('role_user').map(r => r['roleId']), [1])
  })

  it('updatePivot("1", data) updates the numeric row', async () => {
    const { rows, User } = setup()
    rows('role_user').push({ userId: 7, roleId: 1, role: 'owner' })
    const user = User.hydrate({ id: 7 })!
    const updated = await Model.belongsToMany(user, 'roles').updatePivot('1', { role: 'editor' })
    assert.strictEqual(updated, 1)
    assert.strictEqual(rows('role_user')[0]!['role'], 'editor')
  })
})

// ─── morph variants share the factory — one smoke each ──────────────────────

describe('pivot loose ids — morphToMany parity', () => {
  beforeEach(() => ModelRegistry.reset())

  it('sync(["10"]) against a stored numeric 10 is a no-op and keeps the discriminator filter', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag  extends Model { id!: number }
    class Post extends Model {
      static override relations = {
        tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    rows('taggable').push(
      { tagId: 10, taggableId: 1, taggableType: 'Post'  },
      { tagId: 11, taggableId: 1, taggableType: 'Video' }, // other discriminator — untouched
    )
    const post = Post.hydrate({ id: 1 })!
    const result = await Model.morphToMany(post, 'tags').sync(['10'])
    assert.deepStrictEqual(result.attached, [])
    assert.deepStrictEqual(result.detached, [])
    assert.strictEqual(rows('taggable').length, 2)
  })
})
