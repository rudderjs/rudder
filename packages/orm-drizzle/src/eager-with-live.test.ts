// Direct-relation eager loading on the Drizzle adapter — LIVE pg + mysql
// (audit P2-9). `eager-with.test.ts` proves the Model-layer batched WHERE-IN
// strategy on sqlite only; this suite runs the same relation shapes — hasMany /
// hasOne / belongsTo / belongsToMany — against real Postgres and MySQL servers
// (gated on PG_TEST_URL / MYSQL_TEST_URL — CI's orm-pg / orm-mysql jobs), plus
// a 300-parent batch to pin drizzle's `inArray` placeholder handling at scale.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pgTable, integer as pgInt, text as pgText } from 'drizzle-orm/pg-core'
import { mysqlTable, int as myInt, text as myText } from 'drizzle-orm/mysql-core'
import { Model, ModelRegistry } from '@rudderjs/orm'
import { DrizzleAdapter } from './index.js'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

interface ModelSet {
  User:    typeof Model & (new () => Model & { id: number; name: string })
  Post:    typeof Model & (new () => Model & { id: number; userId: number; title: string })
  Profile: typeof Model & (new () => Model & { id: number; userId: number; bio: string })
  Role:    typeof Model & (new () => Model & { id: number; name: string })
}

/** Per-dialect model set — table keys match the per-dialect drizzle schemas. */
function makeModels(): ModelSet {
  class DzProfile extends Model {
    static override table = 'dz_ew_profiles'
    id!: number
    userId!: number
    bio!: string
  }
  class DzPost extends Model {
    static override table = 'dz_ew_posts'
    static override relations = {
      author: { type: 'belongsTo' as const, model: () => DzUser, foreignKey: 'userId' },
    }
    id!: number
    userId!: number
    title!: string
  }
  class DzRole extends Model {
    static override table = 'dz_ew_roles'
    id!: number
    name!: string
  }
  class DzUser extends Model {
    static override table = 'dz_ew_users'
    static override relations = {
      posts:   { type: 'hasMany' as const, model: () => DzPost, foreignKey: 'userId' },
      profile: { type: 'hasOne' as const, model: () => DzProfile, foreignKey: 'userId' },
      roles:   { type: 'belongsToMany' as const, model: () => DzRole, pivotTable: 'dz_ew_role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
    }
    id!: number
    name!: string
  }
  return { User: DzUser, Post: DzPost, Profile: DzProfile, Role: DzRole } as unknown as ModelSet
}

const TABLES = ['dz_ew_role_user', 'dz_ew_roles', 'dz_ew_posts', 'dz_ew_profiles', 'dz_ew_users']

async function runScenario(exec: (sql: string) => Promise<number>, m: ModelSet): Promise<void> {

  // Seed: Ada (2 posts, profile, 2 roles) · Bob (1 post, 1 role) · Cleo (nothing)
  await exec(`insert into dz_ew_users (id, name) values (1, 'Ada'), (2, 'Bob'), (3, 'Cleo')`)
  await exec(`insert into dz_ew_profiles (id, userId, bio) values (1, 1, 'mathematician')`)
  await exec(`insert into dz_ew_posts (id, userId, title) values (1, 1, 'Notes I'), (2, 1, 'Notes II'), (3, 2, 'Memo')`)
  await exec(`insert into dz_ew_roles (id, name) values (1, 'admin'), (2, 'editor')`)
  await exec(`insert into dz_ew_role_user (userId, roleId) values (1, 1), (1, 2), (2, 2)`)

  // hasMany
  const users = await m.User.query().with('posts').orderBy('id', 'ASC').get()
  assert.equal(users.length, 3)
  assert.equal((users[0] as unknown as { posts: unknown[] }).posts.length, 2)
  assert.equal((users[1] as unknown as { posts: unknown[] }).posts.length, 1)
  assert.deepEqual((users[2] as unknown as { posts: unknown[] }).posts, [])

  // hasOne
  const withProfile = await m.User.query().with('profile').orderBy('id', 'ASC').get()
  assert.equal((withProfile[0] as unknown as { profile: { bio: string } }).profile.bio, 'mathematician')
  assert.equal((withProfile[1] as unknown as { profile: unknown }).profile, null)

  // belongsTo
  const posts = await m.Post.query().with('author').orderBy('id', 'ASC').get()
  assert.deepEqual((posts as unknown as Array<{ author: { name: string } }>).map(p => p.author.name), ['Ada', 'Ada', 'Bob'])

  // belongsToMany via pivot
  const withRoles = await m.User.query().with('roles').orderBy('id', 'ASC').get()
  const roleNames = (u: unknown): string[] => (u as { roles: Array<{ name: string }> }).roles.map(r => r.name).sort()
  assert.deepEqual(roleNames(withRoles[0]), ['admin', 'editor'])
  assert.deepEqual(roleNames(withRoles[1]), ['editor'])
  assert.deepEqual(roleNames(withRoles[2]), [])

  // whereHas filter + with() load composition
  const filtered = await m.User.query().whereHas('posts').with('posts').orderBy('id', 'ASC').get()
  assert.deepEqual(filtered.map(u => (u as unknown as { name: string }).name), ['Ada', 'Bob'])

  // 300-parent batch — inArray placeholder handling at scale
  const userValues: string[] = []
  const postValues: string[] = []
  for (let i = 1; i <= 300; i++) {
    userValues.push(`(${1000 + i}, 'bulk-${i}')`)
    postValues.push(`(${1000 + i}, ${1000 + i}, 'bulk post ${i}')`)
  }
  await exec(`insert into dz_ew_users (id, name) values ${userValues.join(', ')}`)
  await exec(`insert into dz_ew_posts (id, userId, title) values ${postValues.join(', ')}`)
  const bulk = await m.User.query().where('id', '>', 1000).with('posts').orderBy('id', 'ASC').get()
  assert.equal(bulk.length, 300)
  for (const u of bulk) {
    const ps = (u as unknown as { posts: Array<{ userId: number }>; id: number })
    assert.equal(ps.posts.length, 1)
    assert.equal(ps.posts[0]!.userId, ps.id)
  }
}

// ─── Postgres (live) ─────────────────────────────────────────────────────────

test('drizzle eager with() — live pg', { skip: !PG_URL }, async () => {
  const users = pgTable('dz_ew_users', {
    id:   pgInt('id').primaryKey(),
    name: pgText('name').notNull(),
  })
  const profiles = pgTable('dz_ew_profiles', {
    id:     pgInt('id').primaryKey(),
    userId: pgInt('userId').notNull(),
    bio:    pgText('bio').notNull(),
  })
  const posts = pgTable('dz_ew_posts', {
    id:     pgInt('id').primaryKey(),
    userId: pgInt('userId').notNull(),
    title:  pgText('title').notNull(),
  })
  const roles = pgTable('dz_ew_roles', {
    id:   pgInt('id').primaryKey(),
    name: pgText('name').notNull(),
  })
  const role_user = pgTable('dz_ew_role_user', {
    userId: pgInt('userId').notNull(),
    roleId: pgInt('roleId').notNull(),
  })

  const adapter = await DrizzleAdapter.make({
    driver: 'postgresql',
    url: PG_URL!,
    connectionName: `dz-ew-pg-${process.pid}`,
    tables: { dz_ew_users: users, dz_ew_profiles: profiles, dz_ew_posts: posts, dz_ew_roles: roles, dz_ew_role_user: role_user },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  // pg folds unquoted identifiers to lowercase — quote the camelCase columns
  // in every raw DDL/seed statement.
  const exec = (sql: string): Promise<number> =>
    adapter.affectingStatement(sql.replace(/\buserId\b/g, '"userId"').replace(/\broleId\b/g, '"roleId"'), [])
  try {
    for (const t of TABLES) await exec(`drop table if exists ${t}`)
    await exec(`create table dz_ew_users (id int primary key, name text not null)`)
    await exec(`create table dz_ew_profiles (id int primary key, userId int not null, bio text not null)`)
    await exec(`create table dz_ew_posts (id int primary key, userId int not null, title text not null)`)
    await exec(`create table dz_ew_roles (id int primary key, name text not null)`)
    await exec(`create table dz_ew_role_user (userId int not null, roleId int not null)`)

    await runScenario(exec, makeModels())
  } finally {
    for (const t of TABLES) await exec(`drop table if exists ${t}`).catch(() => {})
    await adapter.disconnect()
  }
})

// ─── MySQL (live) ────────────────────────────────────────────────────────────

test('drizzle eager with() — live mysql', { skip: !MYSQL_URL }, async () => {
  const users = mysqlTable('dz_ew_users', {
    id:   myInt('id').primaryKey(),
    name: myText('name').notNull(),
  })
  const profiles = mysqlTable('dz_ew_profiles', {
    id:     myInt('id').primaryKey(),
    userId: myInt('userId').notNull(),
    bio:    myText('bio').notNull(),
  })
  const posts = mysqlTable('dz_ew_posts', {
    id:     myInt('id').primaryKey(),
    userId: myInt('userId').notNull(),
    title:  myText('title').notNull(),
  })
  const roles = mysqlTable('dz_ew_roles', {
    id:   myInt('id').primaryKey(),
    name: myText('name').notNull(),
  })
  const role_user = mysqlTable('dz_ew_role_user', {
    userId: myInt('userId').notNull(),
    roleId: myInt('roleId').notNull(),
  })

  const adapter = await DrizzleAdapter.make({
    driver: 'mysql',
    url: MYSQL_URL!,
    connectionName: `dz-ew-mysql-${process.pid}`,
    tables: { dz_ew_users: users, dz_ew_profiles: profiles, dz_ew_posts: posts, dz_ew_roles: roles, dz_ew_role_user: role_user },
  })
  ModelRegistry.reset()
  ModelRegistry.set(adapter)
  const exec = (sql: string): Promise<number> => adapter.affectingStatement(sql, [])
  try {
    for (const t of TABLES) await exec(`drop table if exists ${t}`)
    await exec(`create table dz_ew_users (id int primary key, name text not null)`)
    await exec(`create table dz_ew_profiles (id int primary key, userId int not null, bio text not null)`)
    await exec(`create table dz_ew_posts (id int primary key, userId int not null, title text not null)`)
    await exec(`create table dz_ew_roles (id int primary key, name text not null)`)
    await exec(`create table dz_ew_role_user (userId int not null, roleId int not null)`)

    await runScenario(exec, makeModels())
  } finally {
    for (const t of TABLES) await exec(`drop table if exists ${t}`).catch(() => {})
    await adapter.disconnect()
  }
})
