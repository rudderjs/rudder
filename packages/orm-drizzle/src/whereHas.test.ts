import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import type { RelationExistencePredicate, QueryBuilder } from '@rudderjs/contracts'
import { drizzle, DrizzleAdapter, type DrizzleConfig } from './index.js'

// ─── Schema ──────────────────────────────────────────────────────────────────
//
// Three tables exercise the three whereRelationExists branches:
//   - hasMany: users → posts via authorId
//   - belongsToMany: users ⇄ roles via role_user pivot
//   - morphMany: users → images via imageableId / imageableType

const users = sqliteTable('users', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
})

const posts = sqliteTable('posts', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  authorId:  integer('authorId').notNull(),
  published: integer('published', { mode: 'boolean' }).notNull(),
})

const roles = sqliteTable('roles', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
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

interface User { id: number; name: string }

async function makeAdapter(): Promise<DrizzleAdapter> {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE users     (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE posts     (id INTEGER PRIMARY KEY AUTOINCREMENT, authorId INTEGER NOT NULL, published INTEGER NOT NULL);
    CREATE TABLE roles     (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
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

  const p = adapter.query<{ id: number; authorId: number; published: boolean }>('posts')
  await p.create({ authorId: 1, published: true  })
  await p.create({ authorId: 1, published: false })
  await p.create({ authorId: 2, published: true  })
  // Carol has no posts.

  const r = adapter.query<{ id: number; name: string }>('roles')
  await r.create({ id: 1, name: 'admin' })
  await r.create({ id: 2, name: 'user' })

  const ru = adapter.query<{ userId: number; roleId: number }>('role_user')
  await ru.create({ userId: 1, roleId: 1 })  // Alice → admin
  await ru.create({ userId: 2, roleId: 2 })  // Bob → user

  const i = adapter.query<{ id: number; imageableId: number; imageableType: string }>('images')
  await i.create({ imageableId: 1, imageableType: 'User' })
}

let adapter: DrizzleAdapter

describe('DrizzleQueryBuilder.whereRelationExists — hasMany (direct)', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('returns parents whose relation has at least one matching child', async () => {
    const predicate: RelationExistencePredicate = {
      relation: 'posts', exists: true, relatedTable: 'posts',
      parentColumn: 'id', relatedColumn: 'authorId', constraintWheres: [],
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .whereRelationExists(predicate)
      .get()
    assert.deepEqual(rows.map(r => r.name).sort(), ['Alice', 'Bob'])
  })

  it('whereDoesntHave returns parents with no matching child', async () => {
    const predicate: RelationExistencePredicate = {
      relation: 'posts', exists: false, relatedTable: 'posts',
      parentColumn: 'id', relatedColumn: 'authorId', constraintWheres: [],
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .whereRelationExists(predicate)
      .get()
    assert.deepEqual(rows.map(r => r.name).sort(), ['Carol'])
  })

  it('applies constraint wheres to the inner subquery', async () => {
    const predicate: RelationExistencePredicate = {
      relation: 'posts', exists: true, relatedTable: 'posts',
      parentColumn: 'id', relatedColumn: 'authorId',
      constraintWheres: [{ column: 'published', operator: '=', value: true }],
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .whereRelationExists(predicate)
      .get()
    // Alice has a published post (yes), Bob has a published post (yes).
    // Carol has no posts.
    assert.deepEqual(rows.map(r => r.name).sort(), ['Alice', 'Bob'])
  })
})

describe('DrizzleQueryBuilder.whereRelationExists — belongsToMany (pivot)', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('returns parents whose pivot has matching related rows', async () => {
    const predicate: RelationExistencePredicate = {
      relation: 'roles', exists: true, relatedTable: 'roles',
      parentColumn: 'id', relatedColumn: 'id',
      constraintWheres: [{ column: 'name', operator: '=', value: 'admin' }],
      through: { pivotTable: 'role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .whereRelationExists(predicate)
      .get()
    assert.deepEqual(rows.map(r => r.name), ['Alice'])
  })
})

describe('DrizzleQueryBuilder.whereRelationExists — morphMany', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('filters by extraEquals discriminator on the related table', async () => {
    const predicate: RelationExistencePredicate = {
      relation: 'images', exists: true, relatedTable: 'images',
      parentColumn: 'id', relatedColumn: 'imageableId',
      constraintWheres: [],
      extraEquals: { imageableType: 'User' },
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .whereRelationExists(predicate)
      .get()
    assert.deepEqual(rows.map(r => r.name), ['Alice'])
  })

  it('exists=false flips polarity', async () => {
    const predicate: RelationExistencePredicate = {
      relation: 'images', exists: false, relatedTable: 'images',
      parentColumn: 'id', relatedColumn: 'imageableId',
      constraintWheres: [],
      extraEquals: { imageableType: 'User' },
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .whereRelationExists(predicate)
      .get()
    assert.deepEqual(rows.map(r => r.name).sort(), ['Bob', 'Carol'])
  })
})

describe('DrizzleQueryBuilder.whereRelationExists — chainable + flat where', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('chains with flat where() — both apply', async () => {
    const predicate: RelationExistencePredicate = {
      relation: 'posts', exists: true, relatedTable: 'posts',
      parentColumn: 'id', relatedColumn: 'authorId', constraintWheres: [],
    }
    const rows = await (adapter.query<User>('users') as QueryBuilder<User>)
      .where('name', 'Alice')
      .whereRelationExists(predicate)
      .get()
    assert.deepEqual(rows.map(r => r.name), ['Alice'])
  })
})

describe('DrizzleQueryBuilder.whereRelationExists — unknown table', () => {
  beforeEach(async () => { adapter = await makeAdapter(); await seed(adapter) })

  it('throws a clear error when the related table is not registered', () => {
    const predicate: RelationExistencePredicate = {
      relation: 'orphans', exists: true, relatedTable: 'orphans',
      parentColumn: 'id', relatedColumn: 'userId', constraintWheres: [],
    }
    assert.throws(
      () => (adapter.query<User>('users') as QueryBuilder<User>).whereRelationExists(predicate),
      /no table schema registered for "orphans"/,
    )
  })
})
