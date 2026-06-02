// Direct-relation eager loading on the Drizzle adapter (PR3 of the data-layer arc).
//
// Drizzle's adapter can't resolve a direct relation from a name alone (its
// relational query API needs pre-declared `relations()` schemas the adapter
// doesn't hold), so historically `Model.with('relation')` either silently
// loaded nothing or (since #826) threw. The adapter now advertises
// `eagerLoadStrategy = 'model-layer'`, so the ORM resolves direct relations in
// its Model layer: one batched WHERE-IN query per relation, stitched onto each
// parent. These tests prove that end-to-end against real SQLite for every
// direct relation type — hasMany, hasOne, belongsTo, belongsToMany.

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { drizzle, DrizzleTableRegistry, type DrizzleConfig } from './index.js'

// ─── Drizzle table schemas ─────────────────────────────────────────────────

const users = sqliteTable('users', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
})
const profiles = sqliteTable('profiles', {
  id:     integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('userId').notNull(),
  bio:    text('bio').notNull(),
})
const posts = sqliteTable('posts', {
  id:     integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('userId').notNull(),
  title:  text('title').notNull(),
})
const roles = sqliteTable('roles', {
  id:   integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
})
const role_user = sqliteTable('role_user', {
  userId: integer('userId').notNull(),
  roleId: integer('roleId').notNull(),
})

// ─── Models ─────────────────────────────────────────────────────────────────

class Profile extends Model {
  static override table = 'profiles'
  id!: number
  userId!: number
  bio!: string
}
class Post extends Model {
  static override table = 'posts'
  static override relations = {
    author: { type: 'belongsTo' as const, model: () => User },
  }
  id!: number
  userId!: number
  title!: string
}
class Role extends Model {
  static override table = 'roles'
  id!: number
  name!: string
}
class User extends Model {
  static override table = 'users'
  static override relations = {
    posts:   { type: 'hasMany' as const, model: () => Post },
    profile: { type: 'hasOne' as const, model: () => Profile },
    roles:   { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
  }
  id!: number
  name!: string
}

function makeAdapter() {
  const sqlite = new Database(':memory:')
  sqlite.exec(`
    CREATE TABLE users    (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, bio TEXT NOT NULL);
    CREATE TABLE posts    (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, title TEXT NOT NULL);
    CREATE TABLE roles    (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL);
    CREATE TABLE role_user(userId INTEGER NOT NULL, roleId INTEGER NOT NULL);
  `)
  const db = drizzleSqlite(sqlite)
  const cfg: DrizzleConfig = {
    client: db,
    dialect: 'sqlite',
    tables: { users, profiles, posts, roles, role_user },
  }
  return drizzle(cfg).create()
}

beforeEach(async () => {
  // The belongsToMany pivot lookup goes through the global table registry too.
  DrizzleTableRegistry.register('role_user', role_user)
  ModelRegistry.reset()
  ModelRegistry.set(await makeAdapter())

  const ada = await User.create({ name: 'Ada' })
  const bob = await User.create({ name: 'Bob' })
  await User.create({ name: 'Cleo' }) // no relations at all

  await Profile.create({ userId: ada.id, bio: 'mathematician' })

  await Post.create({ userId: ada.id, title: 'Notes I' })
  await Post.create({ userId: ada.id, title: 'Notes II' })
  await Post.create({ userId: bob.id, title: 'Hello' })

  const admin  = await Role.create({ name: 'admin' })
  const editor = await Role.create({ name: 'editor' })
  await ModelRegistry.getAdapter().query('role_user').create({ userId: ada.id, roleId: admin.id })
  await ModelRegistry.getAdapter().query('role_user').create({ userId: ada.id, roleId: editor.id })
  await ModelRegistry.getAdapter().query('role_user').create({ userId: bob.id, roleId: editor.id })
})

describe('Drizzle eager loading — hasMany', () => {
  it('attaches the related collection to each parent (batched)', async () => {
    const all = await User.query().with('posts').orderBy('id', 'ASC').get()
    const byName = Object.fromEntries(all.map(u => [u.name, u]))

    const adaPosts = (byName['Ada'] as unknown as { posts: Post[] }).posts
    assert.deepEqual(adaPosts.map(p => p.title).sort(), ['Notes I', 'Notes II'])
    assert.ok(adaPosts.every(p => p instanceof Post), 'related rows are Model instances')

    assert.deepEqual((byName['Bob'] as unknown as { posts: Post[] }).posts.map(p => p.title), ['Hello'])
    // A parent with no children gets an empty array, not undefined.
    assert.deepEqual((byName['Cleo'] as unknown as { posts: Post[] }).posts, [])
  })

  it('works on a single-row terminal (first)', async () => {
    const ada = await User.query().where('name', 'Ada').with('posts').first()
    assert.equal((ada as unknown as { posts: Post[] }).posts.length, 2)
  })
})

describe('Drizzle eager loading — hasOne', () => {
  it('attaches the single related row, or null when absent', async () => {
    const all = await User.query().with('profile').orderBy('id', 'ASC').get()
    const byName = Object.fromEntries(all.map(u => [u.name, u]))

    const adaProfile = (byName['Ada'] as unknown as { profile: Profile | null }).profile
    assert.ok(adaProfile instanceof Profile)
    assert.equal(adaProfile!.bio, 'mathematician')

    assert.equal((byName['Bob'] as unknown as { profile: Profile | null }).profile, null)
  })
})

describe('Drizzle eager loading — belongsTo', () => {
  it('resolves the parent by foreign key', async () => {
    const all = await Post.query().with('author').orderBy('id', 'ASC').get()
    assert.equal(all.length, 3)
    for (const post of all) {
      const author = (post as unknown as { author: User | null }).author
      assert.ok(author instanceof User)
    }
    const titles = Object.fromEntries(all.map(p => [p.title, (p as unknown as { author: User }).author.name]))
    assert.equal(titles['Notes I'], 'Ada')
    assert.equal(titles['Hello'], 'Bob')
  })
})

describe('Drizzle eager loading — belongsToMany', () => {
  it('attaches related rows through the pivot table', async () => {
    const all = await User.query().with('roles').orderBy('id', 'ASC').get()
    const byName = Object.fromEntries(all.map(u => [u.name, u]))

    const adaRoles = (byName['Ada'] as unknown as { roles: Role[] }).roles
    assert.deepEqual(adaRoles.map(r => r.name).sort(), ['admin', 'editor'])
    assert.ok(adaRoles.every(r => r instanceof Role))

    assert.deepEqual((byName['Bob'] as unknown as { roles: Role[] }).roles.map(r => r.name), ['editor'])
    assert.deepEqual((byName['Cleo'] as unknown as { roles: Role[] }).roles, [])
  })
})

describe('Drizzle eager loading — multiple + errors', () => {
  it('loads several relations in one call', async () => {
    const ada = await User.query().where('name', 'Ada').with('posts', 'profile', 'roles').first()
    const a = ada as unknown as { posts: Post[]; profile: Profile | null; roles: Role[] }
    assert.equal(a.posts.length, 2)
    assert.ok(a.profile instanceof Profile)
    assert.equal(a.roles.length, 2)
  })

  it('throws a clear error for an undeclared relation', async () => {
    await assert.rejects(
      User.query().with('nope').get(),
      /no relation named "nope" is declared on static relations/,
    )
  })
})
