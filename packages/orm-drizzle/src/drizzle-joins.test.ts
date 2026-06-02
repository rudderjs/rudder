// Real joins + structured select() on the Drizzle adapter.
//
// join/leftJoin/rightJoin + select(...) build native Drizzle joins. With a join
// and no explicit select(), rows project the BASE table's columns so they still
// hydrate as the base model (the join filters/fans out rows). Referenced tables
// must be registered (tables: {...}), same as whereHas.

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
})

const posts = sqliteTable('posts', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  userId:    integer('userId').notNull(),
  title:     text('title').notNull(),
  published: integer('published').notNull(),
})

class User extends Model {
  static override table = 'users'
  id!: number
  name!: string
}

function makeAdapter() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);`)
  sqlite.exec(`CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, title TEXT NOT NULL, published INTEGER NOT NULL);`)
  // Ada → 2 posts (1 published), Alan → 1 post (unpublished), Grace → 0 posts.
  sqlite.exec(`INSERT INTO users (id, name) VALUES (1,'Ada'),(2,'Alan'),(3,'Grace');`)
  sqlite.exec(`INSERT INTO posts (userId, title, published) VALUES (1,'A1',1),(1,'A2',0),(2,'B1',0);`)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = { client: db, dialect: 'sqlite', tables: { users, posts } }
  return drizzle(cfg).create()
}

beforeEach(async () => {
  ModelRegistry.reset()
  ModelRegistry.set(await makeAdapter())
})

describe('Drizzle joins', () => {
  it('INNER JOIN keeps only users with a matching post (base columns hydrate)', async () => {
    const rows = await User.query()
      .join('posts', 'posts.userId', '=', 'users.id')
      .orderBy('id')
      .get()
    // 3 post rows match → Ada×2 + Alan×1; rows carry base User columns.
    assert.equal(rows.length, 3)
    assert.ok(rows.every(r => r instanceof User))
    assert.deepEqual(rows.map(r => r.name), ['Ada', 'Ada', 'Alan'])
  })

  it('callback form composes ON + a bound where', async () => {
    const rows = await User.query()
      .join('posts', (j) => { j.on('posts.userId', '=', 'users.id').where('posts.published', 1) })
      .get()
    assert.deepEqual(rows.map(r => r.name), ['Ada']) // only the published post
  })

  it('select() projects specific columns across tables', async () => {
    const rows = await User.query()
      .select('users.name', 'posts.title')
      .join('posts', 'posts.userId', '=', 'users.id')
      .orderBy('id')
      .get()
    const titles = (rows as unknown as Array<{ title: string }>).map(r => r.title).sort()
    assert.deepEqual(titles, ['A1', 'A2', 'B1'])
  })

  it('LEFT JOIN keeps users with no posts', async () => {
    const rows = await User.query()
      .leftJoin('posts', 'posts.userId', '=', 'users.id')
      .get()
    const names = rows.map(r => r.name).sort()
    assert.equal(rows.length, 4) // Ada×2 + Alan×1 + Grace×1 (null post)
    assert.ok(names.includes('Grace'))
  })

  it('count() reflects the join fan-out', async () => {
    const n = await User.query().join('posts', 'posts.userId', '=', 'users.id').count()
    assert.equal(n, 3)
  })

  it('two-arg ON callback defaults the operator to =', async () => {
    const rows = await User.query()
      .join('posts', (j) => { j.on('posts.userId', 'users.id') })
      .get()
    assert.equal(rows.length, 3)
  })

  it('an unregistered join table throws a clear error', () => {
    assert.throws(
      () => User.query().join('comments', 'comments.userId', '=', 'users.id'),
      /table "comments" which isn't registered|not registered/,
    )
  })
})
