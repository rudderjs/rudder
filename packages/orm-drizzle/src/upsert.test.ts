// Upsert on the Drizzle adapter — end-to-end against real SQLite.
//
// Drives `Model.upsert()` through the Model layer → DrizzleQueryBuilder.upsert →
// drizzle's `.onConflictDoUpdate()` / `.onConflictDoNothing()`. Proves insert on
// no conflict, update-listed-columns on conflict, default update set,
// empty-update DO NOTHING, and composite uniqueBy — all on a real unique index.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text, primaryKey } from 'drizzle-orm/sqlite-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { drizzle, type DrizzleConfig } from './index.js'

const users = sqliteTable('users', {
  id:     integer('id').primaryKey({ autoIncrement: true }),
  email:  text('email').notNull().unique(),
  name:   text('name'),
  visits: integer('visits').notNull().default(0),
})
const memberships = sqliteTable('memberships', {
  userId: integer('userId').notNull(),
  teamId: integer('teamId').notNull(),
  role:   text('role'),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.teamId] }) }))

class User extends Model {
  static override table = 'users'
  id!: number
  email!: string
  name!: string
  visits!: number
}
class Membership extends Model {
  static override table = 'memberships'
  userId!: number
  teamId!: number
  role!: string
}

function makeAdapter() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      visits INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE memberships (
      userId INTEGER NOT NULL,
      teamId INTEGER NOT NULL,
      role TEXT,
      PRIMARY KEY (userId, teamId)
    );
  `)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = { client: db, dialect: 'sqlite', tables: { users, memberships } }
  return drizzle(cfg).create()
}

beforeEach(async () => {
  ModelRegistry.reset()
  ModelRegistry.set(await makeAdapter())
})

describe('Drizzle upsert', () => {
  it('inserts new rows and returns the affected count', async () => {
    const n = await User.upsert(
      [{ email: 'a@x.com', name: 'Ada' }, { email: 'b@x.com', name: 'Bob' }],
      'email', ['name'],
    )
    assert.strictEqual(n, 2)
    assert.strictEqual(await User.count(), 2)
  })

  it('updates only the listed columns on a unique conflict (no duplicate row)', async () => {
    await User.create({ email: 'a@x.com', name: 'Ada', visits: 1 })
    await User.upsert([{ email: 'a@x.com', name: 'Ada Lovelace', visits: 99 }], 'email', ['name'])
    const row = (await User.where('email', 'a@x.com').first())!
    assert.strictEqual(await User.count(), 1)
    assert.strictEqual(row.name, 'Ada Lovelace')
    assert.strictEqual(row.visits, 1) // not in update list → unchanged
  })

  it('default update set overwrites every non-unique inserted column', async () => {
    await User.create({ email: 'a@x.com', name: 'Ada', visits: 1 })
    await User.upsert([{ email: 'a@x.com', name: 'Ada2', visits: 5 }], 'email')
    const row = (await User.where('email', 'a@x.com').first())!
    assert.strictEqual(row.name, 'Ada2')
    assert.strictEqual(row.visits, 5)
  })

  it('empty update list → DO NOTHING (insert-or-ignore)', async () => {
    await User.create({ email: 'a@x.com', name: 'Original', visits: 7 })
    await User.upsert([{ email: 'a@x.com', name: 'Ignored', visits: 0 }], 'email', [])
    const row = (await User.where('email', 'a@x.com').first())!
    assert.strictEqual(row.name, 'Original')
    assert.strictEqual(row.visits, 7)
    assert.strictEqual(await User.count(), 1)
  })

  it('conflicts on a composite uniqueBy', async () => {
    await Membership.upsert([{ userId: 1, teamId: 2, role: 'member' }], ['userId', 'teamId'], ['role'])
    await Membership.upsert([{ userId: 1, teamId: 2, role: 'admin' }], ['userId', 'teamId'], ['role'])
    const rows = await Membership.all()
    assert.strictEqual(rows.length, 1)
    assert.strictEqual((rows[0] as Membership).role, 'admin')
  })

  it('empty rows array is a no-op returning 0', async () => {
    assert.strictEqual(await User.upsert([], 'email'), 0)
    assert.strictEqual(await User.count(), 0)
  })
})
