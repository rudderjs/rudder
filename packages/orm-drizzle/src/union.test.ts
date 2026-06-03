// Real union / unionAll on the Drizzle adapter.
//
// Built on Drizzle's native set operators (`.union()` / `.unionAll()`). Each
// member contributes its select BODY (projection → HAVING — its own ORDER BY /
// LIMIT are dropped); the base query's ORDER BY / LIMIT / OFFSET apply to the
// whole compound (Drizzle attaches a post-union orderBy/limit to the full set
// operation). count()/paginate() wrap the compound as a subquery and COUNT(*)
// it — the combined row count. Same semantics as the native engine's union.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { drizzle, type DrizzleConfig } from './index.js'

const users = sqliteTable('users', {
  id:     integer('id').primaryKey({ autoIncrement: true }),
  name:   text('name').notNull(),
  role:   text('role').notNull(),
  active: integer('active').notNull(),
})

class User extends Model {
  static override table = 'users'
  id!:     number
  name!:   string
  role!:   string
  active!: number
}

function makeAdapter() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL);`)
  // active=1 → Ada, Alan. role=admin → Ada, Grace. Overlap = Ada.
  sqlite.exec(`INSERT INTO users (id, name, role, active) VALUES
    (1,'Ada','admin',1),(2,'Alan','user',1),(3,'Grace','admin',0),(4,'Edsger','user',0);`)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = { client: db, dialect: 'sqlite', tables: { users } }
  return drizzle(cfg).create()
}

beforeEach(async () => {
  ModelRegistry.reset()
  ModelRegistry.set(await makeAdapter())
})

describe('Drizzle union() / unionAll()', () => {
  it('union merges two result sets and de-duplicates', async () => {
    const admins = User.query().where('role', 'admin')
    const rows = await User.query().where('active', 1).union(admins).orderBy('name').get()
    assert.deepEqual(rows.map(u => u.name), ['Ada', 'Alan', 'Grace'])
  })

  it('unionAll keeps duplicates', async () => {
    const admins = User.query().where('role', 'admin')
    const rows = await User.query().where('active', 1).unionAll(admins).get()
    assert.equal(rows.length, 4) // Ada twice — in both branches
  })

  it("the base query's orderBy + limit apply to the whole compound", async () => {
    const admins = User.query().where('role', 'admin')
    const rows = await User.query().where('active', 1).union(admins).orderBy('name').limit(2).get()
    assert.deepEqual(rows.map(u => u.name), ['Ada', 'Alan'])
  })

  it("a member's own orderBy + limit are dropped", async () => {
    // If the member's limit applied, only Ada would arrive from the admin
    // branch and Grace would be missing.
    const admins = User.query().where('role', 'admin').orderBy('name').limit(1)
    const rows = await User.query().where('active', 1).union(admins).get()
    assert.equal(rows.length, 3)
    assert.ok(rows.some(u => u.name === 'Grace'))
  })

  it('count() returns the combined row count', async () => {
    const admins = User.query().where('role', 'admin')
    assert.equal(await User.query().where('active', 1).union(admins).count(), 3)
    assert.equal(await User.query().where('active', 1).unionAll(admins).count(), 4)
  })

  it('paginate() totals the combined rows', async () => {
    const admins = User.query().where('role', 'admin')
    const page = await User.query().where('active', 1).union(admins).orderBy('name').paginate(1, 2)
    assert.equal(page.total, 3)
    assert.equal(page.data.length, 2)
    assert.equal(page.lastPage, 2)
  })

  it('first() returns the first row of the compound', async () => {
    const admins = User.query().where('role', 'admin')
    const row = await User.query().where('active', 1).union(admins).orderBy('name', 'DESC').first()
    assert.equal(row?.name, 'Grace')
  })

  it('union rows hydrate as Model instances', async () => {
    const admins = User.query().where('role', 'admin')
    const rows = await User.query().where('active', 1).union(admins).get()
    assert.ok(rows.every(u => u instanceof User))
  })

  it('structured select() projections union across members', async () => {
    const adminNames = User.query().select('name').where('role', 'admin')
    const rows = await User.query().select('name').where('active', 1).union(adminNames).orderBy('name').get()
    assert.deepEqual((rows as unknown as Array<{ name: string }>).map(r => r.name), ['Ada', 'Alan', 'Grace'])
  })

  it('throws when the member is not a Drizzle query builder', () => {
    const q = User.query() as unknown as { union(o: unknown): unknown }
    assert.throws(() => q.union({}), /requires another Drizzle query builder/)
  })
})
