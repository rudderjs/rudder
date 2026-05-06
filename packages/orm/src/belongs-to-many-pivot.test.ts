import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry, type QueryBuilder, type OrmAdapter } from './index.js'

// ─── In-memory adapter (mirrors morph-many-to-many.test.ts; supports
// IN, real insertMany / deleteAll / updateAll, no soft deletes) ────────

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
      first: async () => (ensure(table).find(r => matches(r, wheres)) ?? null) as T | null,
      find:  async (id) => (ensure(table).find(r => r['id'] === id) ?? null) as T | null,
      get:   async () => ensure(table).filter(r => matches(r, wheres)) as T[],
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
      paginate:   async () => {
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
    rows: (table: string) => ensure(table),
  }
}

// ─── withPivot — read projection ────────────────────────────────────────────

describe('belongsToMany — withPivot()', () => {
  beforeEach(() => ModelRegistry.reset())

  function setup(): {
    adapter: OrmAdapter
    rows: (t: string) => Record<string, unknown>[]
    User: typeof Model
    Role: typeof Model
  } {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Role extends Model { id!: number; name!: string }
    class User extends Model {
      static override relations = {
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
      id!: number
    }
    return { adapter, rows, User, Role }
  }

  it('projects pivot columns onto each loaded related row via row.pivot', async () => {
    const { rows, User } = setup()
    rows('roles').push({ id: 1, name: 'admin' }, { id: 2, name: 'editor' })
    rows('role_user').push(
      { userId: 7, roleId: 1, role: 'owner',  assignedBy: 'system' },
      { userId: 7, roleId: 2, role: 'editor', assignedBy: 'admin'  },
    )
    const user = User.hydrate({ id: 7 })!
    const result = await user.related('roles').withPivot('role').get() as unknown as Array<Record<string, unknown>>
    const byId = new Map(result.map(r => [r['id'], r['pivot'] as Record<string, unknown>]))
    assert.deepStrictEqual(byId.get(1), { role: 'owner' })
    assert.deepStrictEqual(byId.get(2), { role: 'editor' })
  })

  it('projects multiple pivot columns onto each row', async () => {
    const { rows, User } = setup()
    rows('roles').push({ id: 1, name: 'admin' })
    rows('role_user').push(
      { userId: 7, roleId: 1, role: 'owner', assignedBy: 'system' },
    )
    const user = User.hydrate({ id: 7 })!
    const result = await user.related('roles').withPivot('role', 'assignedBy').first() as unknown as Record<string, unknown>
    assert.deepStrictEqual(result['pivot'], { role: 'owner', assignedBy: 'system' })
  })

  it('throws when withPivot() is called with no arguments', async () => {
    const { User } = setup()
    const user = User.hydrate({ id: 7 })!
    assert.throws(
      () => user.related('roles').withPivot(),
      /withPivot\(\) requires at least one column name\./,
    )
  })

  it('absent pivot column on a row yields pivot.col === undefined', async () => {
    const { rows, User } = setup()
    rows('roles').push({ id: 1, name: 'admin' })
    rows('role_user').push({ userId: 7, roleId: 1 }) // no `role` column
    const user = User.hydrate({ id: 7 })!
    const result = await user.related('roles').withPivot('role').first() as unknown as Record<string, unknown>
    assert.ok('pivot' in result)
    const pivot = result['pivot'] as Record<string, unknown>
    assert.ok('role' in pivot)
    assert.strictEqual(pivot['role'], undefined)
  })

  it('NULL pivot column yields pivot.col === null', async () => {
    const { rows, User } = setup()
    rows('roles').push({ id: 1, name: 'admin' })
    rows('role_user').push({ userId: 7, roleId: 1, role: null })
    const user = User.hydrate({ id: 7 })!
    const result = await user.related('roles').withPivot('role').first() as unknown as Record<string, unknown>
    assert.deepStrictEqual(result['pivot'], { role: null })
  })

  it('without withPivot(), no pivot field is stamped', async () => {
    const { rows, User } = setup()
    rows('roles').push({ id: 1, name: 'admin' })
    rows('role_user').push({ userId: 7, roleId: 1, role: 'owner' })
    const user = User.hydrate({ id: 7 })!
    const result = await user.related('roles').first() as unknown as Record<string, unknown>
    assert.strictEqual(result['pivot'], undefined)
  })

  it('chains with where()/orderBy()/paginate() — pivot still stamped on paginate.data rows', async () => {
    const { rows, User } = setup()
    rows('roles').push({ id: 1, name: 'admin' }, { id: 2, name: 'editor' })
    rows('role_user').push(
      { userId: 7, roleId: 1, role: 'owner'  },
      { userId: 7, roleId: 2, role: 'editor' },
    )
    const user = User.hydrate({ id: 7 })!
    const page = await user.related('roles').withPivot('role').paginate(1, 10) as unknown as { data: Array<Record<string, unknown>> }
    assert.strictEqual(page.data.length, 2)
    const byId = new Map(page.data.map(r => [r['id'], r['pivot'] as Record<string, unknown>]))
    assert.deepStrictEqual(byId.get(1), { role: 'owner'  })
    assert.deepStrictEqual(byId.get(2), { role: 'editor' })
  })
})

// ─── updatePivot — patch extras on a single pivot row ───────────────────────

describe('belongsToMany — updatePivot()', () => {
  beforeEach(() => ModelRegistry.reset())

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

  it('updates extras on the matching pivot row only; returns 1', async () => {
    const { rows, User } = setup()
    rows('role_user').push(
      { userId: 7, roleId: 1, role: 'owner' },
      { userId: 7, roleId: 2, role: 'owner' },
      { userId: 8, roleId: 1, role: 'owner' }, // different parent
    )
    const user = User.hydrate({ id: 7 })!
    const updated = await Model.belongsToMany(user, 'roles').updatePivot(1, { role: 'editor' })
    assert.strictEqual(updated, 1)
    // Only the (7,1) pivot row changed.
    const target  = rows('role_user').find(r => r['userId'] === 7 && r['roleId'] === 1)!
    const sibling = rows('role_user').find(r => r['userId'] === 7 && r['roleId'] === 2)!
    const other   = rows('role_user').find(r => r['userId'] === 8 && r['roleId'] === 1)!
    assert.strictEqual(target['role'],  'editor')
    assert.strictEqual(sibling['role'], 'owner')
    assert.strictEqual(other['role'],   'owner')
  })

  it('returns 0 when no pivot row matches; does NOT throw', async () => {
    const { User } = setup()
    const user = User.hydrate({ id: 7 })!
    const updated = await Model.belongsToMany(user, 'roles').updatePivot(999, { role: 'owner' })
    assert.strictEqual(updated, 0)
  })
})

// ─── sync per-id pivot map form ─────────────────────────────────────────────

describe('belongsToMany — sync(map) per-id pivot data', () => {
  beforeEach(() => ModelRegistry.reset())

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

  it('attaches every key with its pivot data; returns updated:[] when no overlaps', async () => {
    const { rows, User } = setup()
    const user = User.hydrate({ id: 7 })!
    const result = await Model.belongsToMany(user, 'roles').sync({
      1: { role: 'owner'  },
      2: { role: 'editor' },
    })
    assert.deepStrictEqual([...(result.attached as number[])].sort(), [1, 2])
    assert.deepStrictEqual(result.detached, [])
    assert.deepStrictEqual(result.updated,  [])
    const byId = new Map(rows('role_user').map(r => [r['roleId'], r['role']]))
    assert.strictEqual(byId.get(1), 'owner')
    assert.strictEqual(byId.get(2), 'editor')
  })

  it('mixed: attaches new, detaches missing, updates still-present with changed extras', async () => {
    const { rows, User } = setup()
    rows('role_user').push(
      { userId: 7, roleId: 1, role: 'owner'  }, // present, will be updated
      { userId: 7, roleId: 2, role: 'editor' }, // present, no change requested → not in updated
      { userId: 7, roleId: 3, role: 'viewer' }, // dropped from desired → detached
    )
    const user = User.hydrate({ id: 7 })!
    const result = await Model.belongsToMany(user, 'roles').sync({
      1: { role: 'admin'  }, // changed
      2: { role: 'editor' }, // unchanged but provided → still goes through updateAll
      4: { role: 'helper' }, // new
    })
    assert.deepStrictEqual([...(result.attached as number[])].sort(), [4])
    assert.deepStrictEqual([...(result.detached as number[])].sort(), [3])
    // Both 1 and 2 are reconciled (updateAll runs even when value matches).
    assert.deepStrictEqual([...(result.updated as number[])].sort(), [1, 2])

    // Verify final state.
    const byId = new Map(rows('role_user').filter(r => r['userId'] === 7).map(r => [r['roleId'], r['role']]))
    assert.strictEqual(byId.size, 3)
    assert.strictEqual(byId.get(1), 'admin')
    assert.strictEqual(byId.get(2), 'editor')
    assert.strictEqual(byId.get(4), 'helper')
    assert.ok(!byId.has(3))
  })

  it('flat-list form gains updated:[]', async () => {
    const { User } = setup()
    const user = User.hydrate({ id: 7 })!
    const result = await Model.belongsToMany(user, 'roles').sync([1, 2])
    assert.deepStrictEqual(result.updated, [])
  })
})

// ─── morphToMany / morphedByMany parity ─────────────────────────────────────

describe('morphToMany — withPivot / updatePivot / sync(map)', () => {
  beforeEach(() => ModelRegistry.reset())

  function setup(): { rows: (t: string) => Record<string, unknown>[]; Post: typeof Model } {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Tag  extends Model { id!: number; name!: string }
    class Post extends Model {
      static override relations = {
        tags: { type: 'morphToMany' as const, model: () => Tag, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    return { rows, Post }
  }

  it('withPivot projects extras on morphToMany reads', async () => {
    const { rows, Post } = setup()
    rows('tags').push({ id: 10, name: 'red' })
    rows('taggable').push({ tagId: 10, taggableId: 1, taggableType: 'Post', addedBy: 'system' })
    const post = Post.hydrate({ id: 1 })!
    const result = await post.related('tags').withPivot('addedBy').first() as unknown as Record<string, unknown>
    assert.deepStrictEqual(result['pivot'], { addedBy: 'system' })
  })

  it('updatePivot patches extras on the matching morph pivot row only', async () => {
    const { rows, Post } = setup()
    rows('taggable').push(
      { tagId: 10, taggableId: 1, taggableType: 'Post',  addedBy: 'system' },
      { tagId: 10, taggableId: 1, taggableType: 'Video', addedBy: 'system' }, // wrong discriminator — must NOT be updated
    )
    const post = Post.hydrate({ id: 1 })!
    const updated = await Model.morphToMany(post, 'tags').updatePivot(10, { addedBy: 'admin' })
    assert.strictEqual(updated, 1)
    const target = rows('taggable').find(r => r['taggableType'] === 'Post')!
    const other  = rows('taggable').find(r => r['taggableType'] === 'Video')!
    assert.strictEqual(target['addedBy'], 'admin')
    assert.strictEqual(other['addedBy'],  'system')
  })

  it('sync(map) on morphToMany attaches with discriminator + pivot extras', async () => {
    const { rows, Post } = setup()
    const post = Post.hydrate({ id: 1 })!
    const result = await Model.morphToMany(post, 'tags').sync({
      10: { addedBy: 'system' },
      11: { addedBy: 'admin'  },
    })
    assert.deepStrictEqual([...(result.attached as number[])].sort(), [10, 11])
    assert.deepStrictEqual(result.updated, [])
    for (const r of rows('taggable')) {
      assert.strictEqual(r['taggableType'], 'Post')
    }
    const byId = new Map(rows('taggable').map(r => [r['tagId'], r['addedBy']]))
    assert.strictEqual(byId.get(10), 'system')
    assert.strictEqual(byId.get(11), 'admin')
  })
})

describe('morphedByMany — withPivot / updatePivot / sync(map)', () => {
  beforeEach(() => ModelRegistry.reset())

  function setup(): { rows: (t: string) => Record<string, unknown>[]; Tag: typeof Model } {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)
    class Post extends Model { id!: number; title!: string }
    class Tag extends Model {
      static override relations = {
        posts: { type: 'morphedByMany' as const, model: () => Post, pivotTable: 'taggable', morphName: 'taggable' },
      }
      id!: number
    }
    return { rows, Tag }
  }

  it('withPivot projects extras on morphedByMany reads', async () => {
    const { rows, Tag } = setup()
    rows('posts').push({ id: 1, title: 'first' })
    rows('taggable').push({ tagId: 7, taggableId: 1, taggableType: 'Post', addedBy: 'admin' })
    const tag = Tag.hydrate({ id: 7 })!
    const result = await tag.related('posts').withPivot('addedBy').first() as unknown as Record<string, unknown>
    assert.deepStrictEqual(result['pivot'], { addedBy: 'admin' })
  })

  it('updatePivot patches extras on the matching morphedByMany pivot row only', async () => {
    const { rows, Tag } = setup()
    rows('taggable').push(
      { tagId: 7, taggableId: 1, taggableType: 'Post',  addedBy: 'system' },
      { tagId: 7, taggableId: 1, taggableType: 'Video', addedBy: 'system' }, // wrong inverse — must NOT be updated
    )
    const tag = Tag.hydrate({ id: 7 })!
    const updated = await Model.morphedByMany(tag, 'posts').updatePivot(1, { addedBy: 'admin' })
    assert.strictEqual(updated, 1)
    const target = rows('taggable').find(r => r['taggableType'] === 'Post')!
    const other  = rows('taggable').find(r => r['taggableType'] === 'Video')!
    assert.strictEqual(target['addedBy'], 'admin')
    assert.strictEqual(other['addedBy'],  'system')
  })

  it('sync(map) on morphedByMany attaches with discriminator + pivot extras', async () => {
    const { rows, Tag } = setup()
    const tag = Tag.hydrate({ id: 7 })!
    const result = await Model.morphedByMany(tag, 'posts').sync({
      1: { addedBy: 'system' },
      2: { addedBy: 'admin'  },
    })
    assert.deepStrictEqual([...(result.attached as number[])].sort(), [1, 2])
    assert.deepStrictEqual(result.updated, [])
    for (const r of rows('taggable')) {
      assert.strictEqual(r['taggableType'], 'Post')
    }
    const byId = new Map(rows('taggable').map(r => [r['taggableId'], r['addedBy']]))
    assert.strictEqual(byId.get(1), 'system')
    assert.strictEqual(byId.get(2), 'admin')
  })
})
