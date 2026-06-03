// Real groupBy / having / distinct on the Drizzle adapter.
//
// Drizzle exposes `.groupBy()`, `.having()` and `.selectDistinct()` natively, so
// these map onto the fluent builder instead of throwing. count()/paginate() of a
// grouped or distinct builder wrap the projection as a subquery and COUNT(*) its
// rows (Laravel parity: group count / distinct-row count). Aggregate projections
// (COUNT(*) AS total) still need selectRaw → DB facade, so HAVING on an aggregate
// goes through havingRaw('COUNT(*) > ?'), not having('total', ...).

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { drizzle, type DrizzleConfig } from './index.js'

const users = sqliteTable('users', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  role: text('role').notNull(),
})

const posts = sqliteTable('posts', {
  id:     integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('userId').notNull(),
  title:  text('title').notNull(),
})

class User extends Model {
  static override table = 'users'
  id!:   number
  name!: string
  role!: string
}

class Post extends Model {
  static override table = 'posts'
  id!:     number
  userId!: number
  title!:  string
}

function makeAdapter() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, role TEXT NOT NULL);`)
  sqlite.exec(`CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, title TEXT NOT NULL);`)
  // Ada/admin → 2 posts, Alan/user → 1 post, Grace/admin → 0 posts.
  sqlite.exec(`INSERT INTO users (id, name, role) VALUES (1,'Ada','admin'),(2,'Alan','user'),(3,'Grace','admin');`)
  sqlite.exec(`INSERT INTO posts (userId, title) VALUES (1,'A1'),(1,'A2'),(2,'B1');`)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = { client: db, dialect: 'sqlite', tables: { users, posts } }
  return drizzle(cfg).create()
}

beforeEach(async () => {
  ModelRegistry.reset()
  ModelRegistry.set(await makeAdapter())
})

describe('Drizzle distinct()', () => {
  it('select(col).distinct() dedups column values', async () => {
    const rows = await User.query().select('role').distinct().orderBy('role').get()
    assert.deepEqual((rows as unknown as Array<{ role: string }>).map(r => r.role), ['admin', 'user'])
  })

  it('distinct().count() counts distinct rows', async () => {
    // SELECT DISTINCT role → 2 distinct roles.
    assert.equal(await User.query().select('role').distinct().count(), 2)
    // distinct over all columns: every row is unique (PK) → row count.
    assert.equal(await User.query().distinct().count(), 3)
  })

  it('distinct() paginates with the distinct total', async () => {
    const page = await User.query().select('role').distinct().paginate(1, 10)
    assert.equal(page.total, 2)
    assert.equal(page.data.length, 2)
  })
})

describe('Drizzle groupBy() / having()', () => {
  it('groupBy().count() returns the number of groups', async () => {
    // userId 1 and 2 have posts → 2 groups.
    assert.equal(await Post.query().groupBy('userId').count(), 2)
  })

  it('groupBy() projects base columns and hydrates the model', async () => {
    const rows = await Post.query().groupBy('userId').orderBy('userId').get()
    assert.equal(rows.length, 2)
    assert.ok(rows.every(r => r instanceof Post))
    assert.deepEqual(rows.map(r => r.userId), [1, 2])
  })

  it('havingRaw() filters groups by aggregate', async () => {
    // Only userId 1 has more than one post.
    const rows = await Post.query().groupBy('userId').havingRaw('COUNT(*) > ?', [1]).get()
    assert.deepEqual(rows.map(r => r.userId), [1])
    assert.equal(await Post.query().groupBy('userId').havingRaw('COUNT(*) > ?', [1]).count(), 1)
  })

  it('having() filters groups by a grouped column', async () => {
    const rows = await Post.query().groupBy('userId').having('userId', '>', 1).get()
    assert.deepEqual(rows.map(r => r.userId), [2])
  })

  it('orHaving / orHavingRaw compose as an OR group', async () => {
    // userId = 2  OR  COUNT(*) > 1  → groups 1 (count) and 2 (id) → both.
    const rows = await Post.query()
      .groupBy('userId')
      .having('userId', '=', 2)
      .orHavingRaw('COUNT(*) > ?', [1])
      .orderBy('userId')
      .get()
    assert.deepEqual(rows.map(r => r.userId), [1, 2])
  })

  it('groupBy() paginates with the group count as total', async () => {
    const page = await Post.query().groupBy('userId').paginate(1, 10)
    assert.equal(page.total, 2)
    assert.equal(page.data.length, 2)
  })
})
