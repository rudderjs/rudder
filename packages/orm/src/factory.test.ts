import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelFactory, ModelRegistry, type QueryBuilder, type OrmAdapter } from './index.js'

// ─── In-memory adapter (mirrors belongs-to-many-pivot.test.ts; supports IN,
// real create with auto-id, insertMany / deleteAll / updateAll) ──────────────

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
      selectRaw: () => qb,
      whereRaw: () => qb,
      orWhereRaw: () => qb,
      orderByRaw: () => qb,
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

// ─── Model.factory() entry point ─────────────────────────────────────────────

describe('Model.factory() entry point', () => {
  beforeEach(() => ModelRegistry.reset())

  it('returns the linked factory and is equivalent to <Factory>.new()', async () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)

    class User extends Model {
      static override table = 'users'
      id!: number; name!: string; email!: string
    }
    class UserFactory extends ModelFactory<{ name: string; email: string }> {
      protected modelClass = User
      definition() { return { name: 'Alice', email: 'a@x.test' } }
    }
    User.factoryClass = UserFactory

    const viaEntry = User.factory()
    assert.ok(viaEntry instanceof UserFactory)
    assert.ok(viaEntry instanceof ModelFactory)

    const u = await User.factory().create() as unknown as Record<string, unknown>
    assert.strictEqual(u['name'], 'Alice')
    assert.strictEqual(u['id'], 1)
  })

  it('chains .state() / .with() from the entry point', async () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)

    class User extends Model {
      static override table = 'users'
      id!: number; name!: string; role!: string
    }
    class UserFactory extends ModelFactory<{ name: string; role: string }> {
      protected modelClass = User
      definition() { return { name: 'Alice', role: 'user' } }
      protected override states() { return { admin: () => ({ role: 'admin' }) } }
    }
    User.factoryClass = UserFactory

    const admin = await User.factory().state('admin').create() as unknown as Record<string, unknown>
    assert.strictEqual(admin['role'], 'admin')
    const bob = await User.factory().with(() => ({ name: 'Bob' })).make() as Record<string, unknown>
    assert.strictEqual(bob['name'], 'Bob')
  })

  it('throws a helpful error when no factory is linked', () => {
    class Orphan extends Model {}
    assert.throws(() => Orphan.factory(), /No factory linked to Orphan/)
  })
})

// ─── Mass-assignment bypass (Laravel parity) ─────────────────────────────────

describe('factory create() bypasses mass-assignment', () => {
  beforeEach(() => ModelRegistry.reset())

  it('persists guarded attributes that Model.create() would drop', async () => {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)

    class User extends Model {
      static override table = 'users'
      // Lock everything to mass-assignment — Model.create() drops all keys.
      static override guarded = ['*']
      id!: number; name!: string; role!: string
    }
    class UserFactory extends ModelFactory<{ name: string; role: string }> {
      protected modelClass = User
      definition() { return { name: 'Alice', role: 'admin' } }
    }

    // Sanity: Model.create() drops the guarded keys.
    const dropped = await User.create({ name: 'Zed', role: 'admin' }) as unknown as Record<string, unknown>
    assert.strictEqual(dropped['name'], undefined)

    // Factory persists every attribute regardless of the guard.
    const u = await UserFactory.new().create() as unknown as Record<string, unknown>
    assert.strictEqual(u['name'], 'Alice')
    assert.strictEqual(u['role'], 'admin')
    const persisted = rows('users').find(r => r['id'] === u['id'])!
    assert.strictEqual(persisted['name'], 'Alice')
    assert.strictEqual(persisted['role'], 'admin')
  })

  it('fires creating/created observers on the persist path', async () => {
    const { adapter } = memoryAdapter()
    ModelRegistry.set(adapter)

    const fired: string[] = []
    class User extends Model {
      static override table = 'users'
      id!: number; name!: string
    }
    User.on('creating', () => { fired.push('creating') })
    User.on('created',  () => { fired.push('created') })
    class UserFactory extends ModelFactory<{ name: string }> {
      protected modelClass = User
      definition() { return { name: 'Alice' } }
    }

    await UserFactory.new().create()
    assert.deepStrictEqual(fired, ['creating', 'created'])
  })
})

// ─── Relationship building ───────────────────────────────────────────────────

describe('factory relationship building', () => {
  beforeEach(() => ModelRegistry.reset())

  function setup() {
    const { adapter, rows } = memoryAdapter()
    ModelRegistry.set(adapter)

    class Post extends Model {
      static override table = 'posts'
      id!: number; title!: string; userId!: number
      static override relations = {
        author: { type: 'belongsTo' as const, model: () => User, foreignKey: 'userId' },
      }
    }
    class Phone extends Model {
      static override table = 'phones'
      id!: number; number!: string; userId!: number
    }
    class Role extends Model {
      static override table = 'roles'
      id!: number; name!: string
    }
    class User extends Model {
      static override table = 'users'
      id!: number; name!: string
      static override relations = {
        posts: { type: 'hasMany' as const,  model: () => Post,  foreignKey: 'userId' },
        phone: { type: 'hasOne' as const,   model: () => Phone, foreignKey: 'userId' },
        roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
      }
    }

    class PostFactory extends ModelFactory<{ title: string }> {
      protected modelClass = Post
      definition() { return { title: 'Hello' } }
    }
    class PhoneFactory extends ModelFactory<{ number: string }> {
      protected modelClass = Phone
      definition() { return { number: '555-0100' } }
    }
    class RoleFactory extends ModelFactory<{ name: string }> {
      protected modelClass = Role
      definition() { return { name: 'editor' } }
    }
    class UserFactory extends ModelFactory<{ name: string }> {
      protected modelClass = User
      definition() { return { name: 'Alice' } }
    }
    User.factoryClass  = UserFactory
    Post.factoryClass  = PostFactory
    Phone.factoryClass = PhoneFactory
    Role.factoryClass  = RoleFactory

    return { adapter, rows, User, Post, Phone, Role }
  }

  it('has() creates hasMany children with the parent FK set (inferred relation)', async () => {
    const { rows, User, Post } = setup()
    const user = await User.factory().has(Post.factory(), 3).create() as Record<string, unknown>

    const posts = rows('posts')
    assert.strictEqual(posts.length, 3)
    for (const p of posts) assert.strictEqual(p['userId'], user['id'])
  })

  it('has() resolves an explicit relation name (hasOne)', async () => {
    const { rows, User, Phone } = setup()
    const user = await User.factory().has(Phone.factory(), 1, 'phone').create() as Record<string, unknown>

    const phones = rows('phones')
    assert.strictEqual(phones.length, 1)
    assert.strictEqual(phones[0]!['userId'], user['id'])
  })

  it('has() creates children for each parent when the parent count > 1', async () => {
    const { rows, User, Post } = setup()
    await User.factory().has(Post.factory(), 2).create(2)
    assert.strictEqual(rows('users').length, 2)
    assert.strictEqual(rows('posts').length, 4)
  })

  it('for() creates the belongsTo parent and sets the child FK (inferred)', async () => {
    const { rows, Post, User } = setup()
    const post = await Post.factory().for(User.factory()).create() as Record<string, unknown>

    const users = rows('users')
    assert.strictEqual(users.length, 1)
    assert.strictEqual(post['userId'], users[0]!['id'])
  })

  it('for() resolves an explicit relation name', async () => {
    const { rows, Post, User } = setup()
    const post = await Post.factory().for(User.factory(), 'author').create() as Record<string, unknown>
    assert.strictEqual(post['userId'], rows('users')[0]!['id'])
  })

  it('hasAttached() creates belongsToMany related rows and attaches via the pivot', async () => {
    const { rows, User, Role } = setup()
    const user = await User.factory().hasAttached(Role.factory(), 2, { active: true }).create() as Record<string, unknown>

    assert.strictEqual(rows('roles').length, 2)
    const pivots = rows('role_user')
    assert.strictEqual(pivots.length, 2)
    for (const p of pivots) {
      assert.strictEqual(p['userId'], user['id'])
      assert.strictEqual(p['active'], true)
      assert.ok(rows('roles').some(r => r['id'] === p['roleId']))
    }
  })

  it('throws when no relation of the right kind points at the other model', async () => {
    const { Post, Role } = setup()
    await assert.rejects(
      () => Post.factory().has(Role.factory()).create(),
      /No hasMany\/hasOne relation on Post points at Role/,
    )
  })

  it('throws when the named relation is the wrong kind', async () => {
    const { User, Post } = setup()
    await assert.rejects(
      () => User.factory().for(Post.factory(), 'posts').create(),
      /relation "posts" on User is "hasMany", expected "belongsTo"/,
    )
  })
})
