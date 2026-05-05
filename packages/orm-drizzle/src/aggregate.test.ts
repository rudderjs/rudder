import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import type { AggregateRequest, QueryBuilder } from '@rudderjs/contracts'
import { drizzle, DrizzleAdapter, type DrizzleConfig } from './index.js'

// ─── Schema ──────────────────────────────────────────────────────────────────
//
// Real SQLite end-to-end so we exercise the correlated-subselect SQL the
// adapter emits. Three tables: users, posts (hasMany), images (morphMany),
// roles + role_user pivot (belongsToMany).

const users = sqliteTable('users', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
})

const posts = sqliteTable('posts', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  authorId:  integer('authorId').notNull(),
  views:     integer('views').notNull(),
  published: integer('published', { mode: 'boolean' }).notNull(),
})

const roles = sqliteTable('roles', {
  id:       integer('id').primaryKey({ autoIncrement: true }),
  name:     text('name').notNull(),
  priority: integer('priority').notNull(),
})

const role_user = sqliteTable('role_user', {
  userId: integer('userId').notNull(),
  roleId: integer('roleId').notNull(),
})

const images = sqliteTable('images', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  imageableId:   integer('imageableId').notNull(),
  imageableType: text('imageableType').notNull(),
})

interface User { id: number; name: string; postsCount?: number; postsSumViews?: number; postsExists?: boolean; rolesCount?: number; rolesSumPriority?: number; imagesCount?: number; publishedPostsCount?: number }

async function makeAdapter(): Promise<DrizzleAdapter> {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE users     (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE posts     (id INTEGER PRIMARY KEY AUTOINCREMENT, authorId INTEGER NOT NULL, views INTEGER NOT NULL, published INTEGER NOT NULL);
    CREATE TABLE roles     (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, priority INTEGER NOT NULL);
    CREATE TABLE role_user (userId INTEGER NOT NULL, roleId INTEGER NOT NULL);
    CREATE TABLE images    (id INTEGER PRIMARY KEY AUTOINCREMENT, imageableId INTEGER NOT NULL, imageableType TEXT NOT NULL);
  `)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = { client: db, tables: { users, posts, roles, role_user, images } }
  return drizzle(cfg).create() as Promise<DrizzleAdapter>
}

async function seed(adapter: DrizzleAdapter): Promise<void> {
  const u = adapter.query<User>('users')
  await u.create({ id: 1, name: 'Alice' })
  await u.create({ id: 2, name: 'Bob' })
  await u.create({ id: 3, name: 'Carol' })

  const p = adapter.query<{ id: number; authorId: number; views: number; published: boolean }>('posts')
  await p.create({ authorId: 1, views: 10, published: true  })
  await p.create({ authorId: 1, views: 20, published: false })
  await p.create({ authorId: 2, views:  5, published: true  })
  // Carol has no posts.

  const r = adapter.query<{ id: number; name: string; priority: number }>('roles')
  await r.create({ id: 1, name: 'admin', priority: 10 })
  await r.create({ id: 2, name: 'user',  priority:  1 })

  const ru = adapter.query<{ userId: number; roleId: number }>('role_user')
  await ru.create({ userId: 1, roleId: 1 })  // Alice → admin
  await ru.create({ userId: 1, roleId: 2 })  // Alice → user
  await ru.create({ userId: 2, roleId: 2 })  // Bob → user

  const i = adapter.query<{ id: number; imageableId: number; imageableType: string }>('images')
  await i.create({ imageableId: 1, imageableType: 'User' })
  await i.create({ imageableId: 1, imageableType: 'User' })
  await i.create({ imageableId: 2, imageableType: 'User' })
  await i.create({ imageableId: 1, imageableType: 'Post' })  // not a user — should be filtered
}

let adapter: DrizzleAdapter

// ─── Direct count via correlated subselect ───────────────────────────────────

describe('DrizzleQueryBuilder.withAggregate — hasMany count', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('stamps postsCount on each row', async () => {
    const req: AggregateRequest = {
      relation: 'posts', fn: 'count', alias: 'postsCount',
      joinShape: { relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'authorId' },
      constraintWheres: [],
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .withAggregate([req])
      .get()
    const byName = Object.fromEntries(rows.map(r => [r.name, Number(r.postsCount)]))
    assert.deepEqual(byName, { Alice: 2, Bob: 1, Carol: 0 })
  })

  it('alias rewrites the stamped key', async () => {
    const req: AggregateRequest = {
      relation: 'posts', fn: 'count', alias: 'publishedPostsCount',
      joinShape: { relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'authorId' },
      constraintWheres: [{ column: 'published', operator: '=', value: true }],
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .withAggregate([req])
      .get()
    const byName = Object.fromEntries(rows.map(r => [r.name, Number(r.publishedPostsCount)]))
    assert.deepEqual(byName, { Alice: 1, Bob: 1, Carol: 0 })
  })
})

describe('DrizzleQueryBuilder.withAggregate — hasMany sum', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('stamps postsSumViews per parent', async () => {
    const req: AggregateRequest = {
      relation: 'posts', fn: 'sum', column: 'views', alias: 'postsSumViews',
      joinShape: { relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'authorId' },
      constraintWheres: [],
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .withAggregate([req])
      .get()
    const byName = Object.fromEntries(rows.map(r => [r.name, Number(r.postsSumViews)]))
    assert.deepEqual(byName, { Alice: 30, Bob: 5, Carol: 0 })
  })
})

describe('DrizzleQueryBuilder.withAggregate — withExists', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('stamps a boolean flag per parent', async () => {
    const req: AggregateRequest = {
      relation: 'posts', fn: 'exists', alias: 'postsExists',
      joinShape: { relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'authorId' },
      constraintWheres: [],
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .withAggregate([req])
      .get()
    const byName = Object.fromEntries(rows.map(r => [r.name, Boolean(r.postsExists)]))
    assert.deepEqual(byName, { Alice: true, Bob: true, Carol: false })
  })
})

// ─── Polymorphic count (extraEquals) ─────────────────────────────────────────

describe('DrizzleQueryBuilder.withAggregate — morphMany count', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('honors {imageableType: "User"} discriminator', async () => {
    const req: AggregateRequest = {
      relation: 'images', fn: 'count', alias: 'imagesCount',
      joinShape: {
        relatedTable: 'images', parentColumn: 'id', relatedColumn: 'imageableId',
        extraEquals: { imageableType: 'User' },
      },
      constraintWheres: [],
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .withAggregate([req])
      .get()
    const byName = Object.fromEntries(rows.map(r => [r.name, Number(r.imagesCount)]))
    // Alice has 2 user-imageable images (3rd image is `imageableType: 'Post'`),
    // Bob has 1, Carol has 0.
    assert.deepEqual(byName, { Alice: 2, Bob: 1, Carol: 0 })
  })
})

// ─── belongsToMany count (pivot, no extraEquals) ─────────────────────────────

describe('DrizzleQueryBuilder.withAggregate — belongsToMany count via pivot', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('counts pivot rows per parent', async () => {
    const req: AggregateRequest = {
      relation: 'roles', fn: 'count', alias: 'rolesCount',
      joinShape: {
        relatedTable: 'roles', parentColumn: 'id', relatedColumn: 'id',
        through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
      },
      constraintWheres: [],
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .withAggregate([req])
      .get()
    const byName = Object.fromEntries(rows.map(r => [r.name, Number(r.rolesCount)]))
    assert.deepEqual(byName, { Alice: 2, Bob: 1, Carol: 0 })
  })
})

// ─── belongsToMany sum (pivot + JOIN to related) ─────────────────────────────

describe('DrizzleQueryBuilder.withAggregate — belongsToMany sum via pivot', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('sums a related column across pivot-joined rows', async () => {
    const req: AggregateRequest = {
      relation: 'roles', fn: 'sum', column: 'priority', alias: 'rolesSumPriority',
      joinShape: {
        relatedTable: 'roles', parentColumn: 'id', relatedColumn: 'id',
        through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
      },
      constraintWheres: [],
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .withAggregate([req])
      .get()
    const byName = Object.fromEntries(rows.map(r => [r.name, Number(r.rolesSumPriority)]))
    assert.deepEqual(byName, { Alice: 11, Bob: 1, Carol: 0 })
  })
})

// ─── _aggregate single-scalar terminal ───────────────────────────────────────

describe('DrizzleQueryBuilder._aggregate', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('count returns the SQL COUNT(*)', async () => {
    const n = await (adapter.query<User>('users') as QueryBuilder<User>)
      ._aggregate('count')
    assert.equal(n, 3)
  })

  it('sum returns COALESCE(SUM(col), 0)', async () => {
    const n = await (adapter.query<{ views: number }>('posts') as QueryBuilder<{ views: number }>)
      ._aggregate('sum', 'views')
    assert.equal(n, 35)
  })

  it('exists returns true / false', async () => {
    const yes = await (adapter.query<User>('users') as QueryBuilder<User>)
      .where('id', 1)._aggregate('exists')
    const no  = await (adapter.query<User>('users') as QueryBuilder<User>)
      .where('id', 999)._aggregate('exists')
    assert.equal(yes, true)
    assert.equal(no,  false)
  })

  it('avg of an empty set returns null', async () => {
    const v = await (adapter.query<{ views: number }>('posts') as QueryBuilder<{ views: number }>)
      .where('authorId', 999)._aggregate('avg', 'views')
    assert.equal(v, null)
  })
})

// ─── Multiple aggregates per query ───────────────────────────────────────────

describe('DrizzleQueryBuilder.withAggregate — multiple aggregates per query', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('stamps every alias on the same row', async () => {
    const reqs: AggregateRequest[] = [
      {
        relation: 'posts', fn: 'count', alias: 'postsCount',
        joinShape: { relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'authorId' },
        constraintWheres: [],
      },
      {
        relation: 'posts', fn: 'sum', column: 'views', alias: 'postsSumViews',
        joinShape: { relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'authorId' },
        constraintWheres: [],
      },
      {
        relation: 'posts', fn: 'exists', alias: 'postsExists',
        joinShape: { relatedTable: 'posts', parentColumn: 'id', relatedColumn: 'authorId' },
        constraintWheres: [],
      },
    ]
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .withAggregate(reqs)
      .get()
    const alice = rows.find(r => r.name === 'Alice')!
    assert.equal(Number(alice.postsCount),    2)
    assert.equal(Number(alice.postsSumViews), 30)
    assert.equal(Boolean(alice.postsExists),  true)
  })
})
