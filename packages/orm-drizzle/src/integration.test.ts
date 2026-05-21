import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import type { QueryBuilder } from '@rudderjs/contracts'
import { drizzle, DrizzleAdapter, type DrizzleConfig } from './index.js'

// Real Drizzle table with all the columns our adapter exercises:
//   id (PK), name, email, age, viewCount, deletedAt (soft delete)
const users = sqliteTable('users', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  name:      text('name').notNull(),
  email:     text('email').notNull(),
  age:       integer('age').notNull(),
  viewCount: integer('view_count').notNull().default(0),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
})

type User = {
  id: number
  name: string
  email: string
  age: number
  viewCount: number
  deletedAt: Date | null
}

// Internal escape hatch — Model normally toggles this at query time.
type SoftDeleteCapable<T> = QueryBuilder<T> & { _enableSoftDeletes(): QueryBuilder<T> }

function softDelQuery<T>(adapter: DrizzleAdapter, table: string): SoftDeleteCapable<T> {
  const qb = adapter.query<T>(table) as SoftDeleteCapable<T>
  qb._enableSoftDeletes()
  return qb
}

let adapter: DrizzleAdapter

async function makeAdapter(): Promise<DrizzleAdapter> {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL,
      age         INTEGER NOT NULL,
      view_count  INTEGER NOT NULL DEFAULT 0,
      deleted_at  INTEGER
    );
  `)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = { client: db, tables: { users } }
  return drizzle(cfg).create() as Promise<DrizzleAdapter>
}

async function seed(): Promise<void> {
  const qb = adapter.query<User>('users')
  await qb.create({ name: 'Alice',   email: 'a@x', age: 30 })
  await qb.create({ name: 'Bob',     email: 'b@x', age: 25 })
  await qb.create({ name: 'Charlie', email: 'c@x', age: 40 })
  await qb.create({ name: 'Dave',    email: 'd@x', age: 35 })
}

describe('DrizzleQueryBuilder — real SQLite', () => {
  before(async () => { adapter = await makeAdapter() })
  beforeEach(async () => {
    // Fresh adapter per test for isolation
    adapter = await makeAdapter()
    await seed()
  })

  it('where() chains AND', async () => {
    const rows = await adapter.query<User>('users')
      .where('age', '>=', 30)
      .where('age', '<=', 35)
      .get()
    assert.deepEqual(rows.map((r: User) => r.name).sort(), ['Alice', 'Dave'])
  })

  it('orWhere() emits OR — bug fix #1', async () => {
    const rows = await adapter.query<User>('users')
      .where('name', 'Alice')
      .orWhere('name', 'Bob')
      .get()
    assert.deepEqual(rows.map((r: User) => r.name).sort(), ['Alice', 'Bob'])
  })

  it('orWhere() with operator overload', async () => {
    const rows = await adapter.query<User>('users')
      .orWhere('age', '<', 30)
      .orWhere('age', '>', 35)
      .get()
    assert.deepEqual(rows.map((r: User) => r.name).sort(), ['Bob', 'Charlie'])
  })

  it('first() returns null when no match', async () => {
    const r = await adapter.query<User>('users').where('name', 'Nope').first()
    assert.equal(r, null)
  })

  it('find() returns the row by primary key', async () => {
    const all = await adapter.query<User>('users').get()
    const row = await adapter.query<User>('users').find(all[0]!.id)
    assert.equal(row!.name, 'Alice')
  })

  it('orderBy + limit + offset', async () => {
    const rows = await adapter.query<User>('users')
      .orderBy('age', 'ASC')
      .limit(2)
      .offset(1)
      .get()
    assert.deepEqual(rows.map((r: User) => r.name), ['Alice', 'Dave'])
  })

  it('count() returns total matching rows', async () => {
    assert.equal(await adapter.query<User>('users').count(), 4)
    assert.equal(
      await adapter.query<User>('users').where('age', '>', 30).count(),
      2,
    )
  })

  it('update() modifies a row', async () => {
    const all  = await adapter.query<User>('users').get()
    const id   = all[0]!.id
    const next = await adapter.query<User>('users').update(id, { name: 'Alicia' })
    assert.equal(next.name, 'Alicia')
  })

  it('delete() hard-deletes when soft deletes are not enabled', async () => {
    const all = await adapter.query<User>('users').get()
    await adapter.query<User>('users').delete(all[0]!.id)
    assert.equal(await adapter.query<User>('users').count(), 3)
  })

  it('increment() / decrement() are atomic', async () => {
    const all = await adapter.query<User>('users').get()
    const id  = all[0]!.id
    const r1  = await adapter.query<User>('users').increment(id, 'viewCount', 5)
    assert.equal(r1.viewCount, 5)
    const r2  = await adapter.query<User>('users').decrement(id, 'viewCount', 2)
    assert.equal(r2.viewCount, 3)
  })

  it('paginate() returns metadata + rows', async () => {
    const page = await adapter.query<User>('users').orderBy('id', 'ASC').paginate(1, 2)
    assert.equal(page.total, 4)
    assert.equal(page.perPage, 2)
    assert.equal(page.currentPage, 1)
    assert.equal(page.lastPage, 2)
    assert.equal(page.from, 1)
    assert.equal(page.to, 2)
    assert.equal(page.data.length, 2)
  })

  describe('soft deletes', () => {
    it('delete() soft-deletes when enabled', async () => {
      const all = await adapter.query<User>('users').get()
      await softDelQuery<User>(adapter, 'users').delete(all[0]!.id)

      // Row still exists in raw query
      assert.equal(await adapter.query<User>('users').count(), 4)

      // But hidden when soft-deletes enabled
      assert.equal(await softDelQuery<User>(adapter, 'users').count(), 3)
    })

    it('find() respects soft-delete filter — bug fix #2', async () => {
      const all = await adapter.query<User>('users').get()
      const id  = all[0]!.id
      await softDelQuery<User>(adapter, 'users').delete(id)

      // Without soft deletes: still finds (raw access)
      assert.notEqual(await adapter.query<User>('users').find(id), null)

      // With soft deletes: filtered out
      assert.equal(await softDelQuery<User>(adapter, 'users').find(id), null)
    })

    it('find() composes with prior where() clauses — bug fix (cross-tenant leak)', async () => {
      // Reproduces the cross-tenant scenario: previously, find(id) bypassed
      // the where chain entirely, so a tenant-scoped query like
      // `User.where('tenantId', t).find(5)` would return rows across tenants.
      const all     = await adapter.query<User>('users').get()
      const aliceId = all.find(u => u.name === 'Alice')!.id

      // Composing where() with find() — Alice's age=30, so where(age, >=, 31)
      // should miss her even when finding by her PK.
      const wrongAge = await adapter.query<User>('users')
        .where('age', '>=', 31)
        .find(aliceId)
      assert.equal(wrongAge, null, 'find(id) must respect prior where() clauses')

      // Sanity: matching where + correct id resolves the row
      const rightAge = await adapter.query<User>('users')
        .where('age', '>=', 30)
        .find(aliceId)
      assert.equal(rightAge?.name, 'Alice')
    })

    it('all() respects wheres + soft-delete filter — bug fix #3', async () => {
      const allRows = await adapter.query<User>('users').get()
      const id      = allRows[0]!.id
      await softDelQuery<User>(adapter, 'users').delete(id)

      // all() must apply where + soft-delete (previously ignored both)
      const rows = await softDelQuery<User>(adapter, 'users').where('age', '>=', 25).all()
      assert.equal(rows.length, 3, 'soft-deleted Alice should be excluded')
      assert.ok(rows.every((r: User) => r.name !== 'Alice'))
    })

    it('withTrashed() includes soft-deleted rows', async () => {
      const all = await adapter.query<User>('users').get()
      await softDelQuery<User>(adapter, 'users').delete(all[0]!.id)

      assert.equal(await softDelQuery<User>(adapter, 'users').withTrashed().count(), 4)
    })

    it('onlyTrashed() returns only soft-deleted rows', async () => {
      const all = await adapter.query<User>('users').get()
      await softDelQuery<User>(adapter, 'users').delete(all[0]!.id)

      assert.equal(await softDelQuery<User>(adapter, 'users').onlyTrashed().count(), 1)
    })

    it('restore() clears deletedAt', async () => {
      const all = await adapter.query<User>('users').get()
      const id  = all[0]!.id
      await softDelQuery<User>(adapter, 'users').delete(id)

      const restored = await adapter.query<User>('users').restore(id)
      assert.equal(restored.deletedAt, null)
    })

    it('forceDelete() removes the row even with soft deletes enabled', async () => {
      const all = await adapter.query<User>('users').get()
      await softDelQuery<User>(adapter, 'users').forceDelete(all[0]!.id)
      assert.equal(await adapter.query<User>('users').count(), 3)
    })
  })
})
