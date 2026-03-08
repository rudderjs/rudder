/**
 * ORM-Drizzle integration tests — SQLite in-memory
 *
 * Tests the full stack: drizzle() factory → DrizzleAdapter → DrizzleQueryBuilder
 * against a real SQLite database using better-sqlite3.
 */
import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as dzSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'
import { drizzle, DrizzleTableRegistry } from '@boostkit/orm-drizzle'
import { ModelRegistry } from '@boostkit/orm'
import type { OrmAdapter } from '@boostkit/contracts'

// ─── Schema ────────────────────────────────────────────────

const users = sqliteTable('users', {
  id:    integer('id').primaryKey({ autoIncrement: true }),
  name:  text('name').notNull(),
  email: text('email').notNull(),
  role:  text('role').notNull().default('user'),
})

interface User {
  id:    number
  name:  string
  email: string
  role:  string
}

// ─── Shared state ──────────────────────────────────────────

let sqlite: InstanceType<typeof Database>
let adapter: OrmAdapter

function qb() {
  return adapter.query<User>('users')
}

async function seed(...rows: Omit<User, 'id'>[]) {
  for (const row of rows) {
    await qb().create(row)
  }
}

// ─── Tests ─────────────────────────────────────────────────

describe('orm-drizzle — SQLite in-memory', () => {
  before(async () => {
    sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE users (
        id    INTEGER PRIMARY KEY AUTOINCREMENT,
        name  TEXT NOT NULL,
        email TEXT NOT NULL,
        role  TEXT NOT NULL DEFAULT 'user'
      )
    `)
    const db = dzSqlite(sqlite)
    adapter  = await drizzle({ client: db, tables: { users } }).create()
    await adapter.connect()
  })

  beforeEach(() => {
    sqlite.exec('DELETE FROM users')
  })

  describe('create() + find()', () => {
    it('inserts a row and retrieves it by id', async () => {
      const created = await qb().create({ name: 'Alice', email: 'alice@example.com', role: 'user' })
      assert.equal(created.name, 'Alice')
      assert.equal(created.email, 'alice@example.com')
      assert.ok(created.id > 0)

      const found = await qb().find(created.id)
      assert.deepEqual(found, created)
    })

    it('find() returns null for non-existent id', async () => {
      const found = await qb().find(9999)
      assert.strictEqual(found, null)
    })
  })

  describe('all()', () => {
    it('returns all rows', async () => {
      await seed(
        { name: 'Alice', email: 'alice@example.com', role: 'user' },
        { name: 'Bob',   email: 'bob@example.com',   role: 'admin' },
      )
      const rows = await qb().all()
      assert.equal(rows.length, 2)
    })

    it('returns empty array when table is empty', async () => {
      const rows = await qb().all()
      assert.deepEqual(rows, [])
    })
  })

  describe('where()', () => {
    it('filters by equality', async () => {
      await seed(
        { name: 'Alice', email: 'alice@example.com', role: 'user' },
        { name: 'Bob',   email: 'bob@example.com',   role: 'admin' },
      )
      const rows = await qb().where('role', 'admin').get()
      assert.equal(rows.length, 1)
      assert.equal(rows[0]!.name, 'Bob')
    })

    it('filters with != operator', async () => {
      await seed(
        { name: 'Alice', email: 'a@example.com', role: 'user' },
        { name: 'Bob',   email: 'b@example.com', role: 'admin' },
        { name: 'Carol', email: 'c@example.com', role: 'user' },
      )
      const rows = await qb().where('role', '!=', 'admin').get()
      assert.equal(rows.length, 2)
    })

    it('filters with LIKE operator', async () => {
      await seed(
        { name: 'Alice Smith', email: 'alice@example.com', role: 'user' },
        { name: 'Bob Jones',   email: 'bob@example.com',   role: 'user' },
      )
      const rows = await qb().where('name', 'LIKE', '%Smith%').get()
      assert.equal(rows.length, 1)
      assert.equal(rows[0]!.name, 'Alice Smith')
    })

    it('filters with IN operator', async () => {
      await seed(
        { name: 'Alice', email: 'a@example.com', role: 'user' },
        { name: 'Bob',   email: 'b@example.com', role: 'admin' },
        { name: 'Carol', email: 'c@example.com', role: 'mod' },
      )
      const rows = await qb().where('role', 'IN', ['user', 'admin']).get()
      assert.equal(rows.length, 2)
    })

    it('filters with NOT IN operator', async () => {
      await seed(
        { name: 'Alice', email: 'a@example.com', role: 'user' },
        { name: 'Bob',   email: 'b@example.com', role: 'admin' },
        { name: 'Carol', email: 'c@example.com', role: 'mod' },
      )
      const rows = await qb().where('role', 'NOT IN', ['admin', 'mod']).get()
      assert.equal(rows.length, 1)
      assert.equal(rows[0]!.name, 'Alice')
    })
  })

  describe('first()', () => {
    it('returns first matching row', async () => {
      await seed(
        { name: 'Alice', email: 'a@example.com', role: 'user' },
        { name: 'Bob',   email: 'b@example.com', role: 'user' },
      )
      const row = await qb().where('role', 'user').first()
      assert.ok(row !== null)
      assert.equal(row.name, 'Alice')
    })

    it('returns null when no match', async () => {
      const row = await qb().where('role', 'superadmin').first()
      assert.strictEqual(row, null)
    })
  })

  describe('orderBy()', () => {
    it('sorts ASC', async () => {
      await seed(
        { name: 'Carol', email: 'c@example.com', role: 'user' },
        { name: 'Alice', email: 'a@example.com', role: 'user' },
        { name: 'Bob',   email: 'b@example.com', role: 'user' },
      )
      const rows = await qb().orderBy('name', 'ASC').get()
      assert.deepEqual(rows.map(r => r.name), ['Alice', 'Bob', 'Carol'])
    })

    it('sorts DESC', async () => {
      await seed(
        { name: 'Alice', email: 'a@example.com', role: 'user' },
        { name: 'Bob',   email: 'b@example.com', role: 'user' },
        { name: 'Carol', email: 'c@example.com', role: 'user' },
      )
      const rows = await qb().orderBy('name', 'DESC').get()
      assert.deepEqual(rows.map(r => r.name), ['Carol', 'Bob', 'Alice'])
    })
  })

  describe('limit() + offset()', () => {
    it('limits result count', async () => {
      await seed(
        { name: 'A', email: 'a@example.com', role: 'user' },
        { name: 'B', email: 'b@example.com', role: 'user' },
        { name: 'C', email: 'c@example.com', role: 'user' },
      )
      const rows = await qb().limit(2).get()
      assert.equal(rows.length, 2)
    })

    it('skips rows with offset', async () => {
      await seed(
        { name: 'A', email: 'a@example.com', role: 'user' },
        { name: 'B', email: 'b@example.com', role: 'user' },
        { name: 'C', email: 'c@example.com', role: 'user' },
      )
      const rows = await qb().orderBy('name', 'ASC').offset(1).limit(2).get()
      assert.deepEqual(rows.map(r => r.name), ['B', 'C'])
    })
  })

  describe('count()', () => {
    it('counts all rows', async () => {
      await seed(
        { name: 'A', email: 'a@example.com', role: 'user' },
        { name: 'B', email: 'b@example.com', role: 'admin' },
      )
      assert.equal(await qb().count(), 2)
    })

    it('counts filtered rows', async () => {
      await seed(
        { name: 'A', email: 'a@example.com', role: 'user' },
        { name: 'B', email: 'b@example.com', role: 'admin' },
        { name: 'C', email: 'c@example.com', role: 'user' },
      )
      assert.equal(await qb().where('role', 'user').count(), 2)
    })

    it('returns 0 on empty table', async () => {
      assert.equal(await qb().count(), 0)
    })
  })

  describe('update()', () => {
    it('updates a row by id and returns updated row', async () => {
      const created = await qb().create({ name: 'Alice', email: 'alice@example.com', role: 'user' })
      const updated = await qb().update(created.id, { role: 'admin' })
      assert.equal(updated.role, 'admin')
      assert.equal(updated.id, created.id)

      const found = await qb().find(created.id)
      assert.equal(found!.role, 'admin')
    })
  })

  describe('delete()', () => {
    it('removes a row by id', async () => {
      const created = await qb().create({ name: 'Alice', email: 'alice@example.com', role: 'user' })
      await qb().delete(created.id)
      const found = await qb().find(created.id)
      assert.strictEqual(found, null)
    })
  })

  describe('paginate()', () => {
    it('returns correct page slice and metadata', async () => {
      for (let i = 1; i <= 7; i++) {
        await qb().create({ name: `User ${i}`, email: `u${i}@example.com`, role: 'user' })
      }
      const page1 = await qb().orderBy('id', 'ASC').paginate(1, 3)
      assert.equal(page1.data.length, 3)
      assert.equal(page1.total, 7)
      assert.equal(page1.currentPage, 1)
      assert.equal(page1.lastPage, 3)
      assert.equal(page1.perPage, 3)
      assert.equal(page1.from, 1)
      assert.equal(page1.to, 3)

      const page3 = await qb().orderBy('id', 'ASC').paginate(3, 3)
      assert.equal(page3.data.length, 1)
      assert.equal(page3.from, 7)
      assert.equal(page3.to, 7)
    })

    it('returns correct metadata for empty table', async () => {
      const result = await qb().paginate(1, 10)
      assert.equal(result.total, 0)
      assert.equal(result.lastPage, 1)
      assert.deepEqual(result.data, [])
    })
  })

  describe('DrizzleTableRegistry fallback', () => {
    it('resolves table via registry when not in config', async () => {
      DrizzleTableRegistry.register('users_reg', users)
      const fallbackAdapter = await drizzle({ client: dzSqlite(sqlite), tables: {} }).create()
      assert.doesNotThrow(() => fallbackAdapter.query('users_reg'))
    })
  })

  describe('ModelRegistry integration', () => {
    it('Model static methods work via ModelRegistry', async () => {
      const { Model } = await import('@boostkit/orm')
      ModelRegistry.set(adapter)

      class User extends Model {
        static table = 'users'
        declare id: number
        declare name: string
        declare email: string
        declare role: string
      }

      await qb().create({ name: 'ModelTest', email: 'mt@example.com', role: 'user' })
      const rows = await User.all()
      assert.ok(Array.isArray(rows))
      assert.ok(rows.length >= 1)

      const found = await User.where('name', 'ModelTest').first()
      assert.ok(found !== null)
      assert.equal((found as User).name, 'ModelTest')

      ModelRegistry.reset()
    })
  })
})
