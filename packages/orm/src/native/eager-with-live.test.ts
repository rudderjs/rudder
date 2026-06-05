// Eager loading (`Model.with()`) against real engines — audit P2-9.
//
// The Model-layer batched WHERE-IN strategy (`direct-eager-load.ts`) was only
// ever proven on sqlite (`eager-with.test.ts`). This suite runs the same
// relation shapes — hasMany / hasOne / belongsTo / belongsToMany — through one
// shared scenario on sqlite (always) AND live Postgres + MySQL (gated on
// PG_TEST_URL / MYSQL_TEST_URL, stood up by CI's orm-pg / orm-mysql jobs).
// A 300-parent batch pins the long-IN-list path (placeholder handling: `$n`
// enumeration on pg, `?` expansion on mysql) that a 3-row seed can't reach.

import { describe, it, test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import {
  NativeAdapter, BetterSqlite3Driver, PostgresDriver, MysqlDriver,
  PgDialect, MysqlDialect,
} from '@rudderjs/database/native'
import type { OrmAdapter } from '@rudderjs/contracts'

const PG_URL = process.env['PG_TEST_URL']
const MYSQL_URL = process.env['MYSQL_TEST_URL']

type RawAdapter = OrmAdapter & {
  affectingStatement(sql: string, bindings: readonly unknown[]): Promise<number>
}

// ─── Models (shared — same table names on every dialect) ────────────────────

class EwProfile extends Model {
  static override table = 'rudder_ew_profiles'
  id!: number
  userId!: number
  bio!: string
}
class EwPost extends Model {
  static override table = 'rudder_ew_posts'
  static override relations = {
    author: { type: 'belongsTo' as const, model: () => EwUser, foreignKey: 'userId' },
  }
  id!: number
  userId!: number
  title!: string
}
class EwRole extends Model {
  static override table = 'rudder_ew_roles'
  id!: number
  name!: string
}
class EwUser extends Model {
  static override table = 'rudder_ew_users'
  static override relations = {
    posts:   { type: 'hasMany' as const, model: () => EwPost, foreignKey: 'userId' },
    profile: { type: 'hasOne' as const, model: () => EwProfile, foreignKey: 'userId' },
    roles:   { type: 'belongsToMany' as const, model: () => EwRole, pivotTable: 'rudder_ew_role_user', foreignPivotKey: 'userId', relatedPivotKey: 'roleId' },
  }
  id!: number
  name!: string
}

const TABLES = ['rudder_ew_role_user', 'rudder_ew_roles', 'rudder_ew_posts', 'rudder_ew_profiles', 'rudder_ew_users']

// Seed: Ada (2 posts, profile, 2 roles) · Bob (1 post, 1 role) · Cleo (nothing)
async function seedRows(adapter: RawAdapter, quoted = true): Promise<void> {
  const run = (sql: string): Promise<number> => adapter.affectingStatement(quoted ? sql : dequote(sql), [])
  await run(`INSERT INTO rudder_ew_users (id, name) VALUES (1, 'Ada'), (2, 'Bob'), (3, 'Cleo')`)
  await run(`INSERT INTO rudder_ew_profiles (id, "userId", bio) VALUES (1, 1, 'mathematician')`)
  await run(`INSERT INTO rudder_ew_posts (id, "userId", title) VALUES (1, 1, 'Notes I'), (2, 1, 'Notes II'), (3, 2, 'Memo')`)
  await run(`INSERT INTO rudder_ew_roles (id, name) VALUES (1, 'admin'), (2, 'editor')`)
  await run(`INSERT INTO rudder_ew_role_user ("userId", "roleId") VALUES (1, 1), (1, 2), (2, 2)`)
}

// MySQL has no double-quoted identifiers (without ANSI_QUOTES); camelCase
// unquoted is fine there — strip the quotes per-dialect.
function dequote(sql: string): string {
  return sql.replaceAll('"', '')
}

/** The shared scenario — every direct relation type through the batched WHERE-IN loader. */
function defineScenario(opts: { quoted: boolean; raw: () => RawAdapter }): void {
  const exec = (sql: string): Promise<number> =>
    opts.raw().affectingStatement(opts.quoted ? sql : dequote(sql), [])

  it('hasMany: with("posts") batches one WHERE-IN and stitches children onto parents', async () => {
    const users = await EwUser.query().with('posts').orderBy('id', 'ASC').get()
    const byName = new Map(users.map(u => [u.name, u as unknown as { posts: EwPost[] }]))
    assert.equal(byName.get('Ada')!.posts.length, 2)
    assert.equal(byName.get('Bob')!.posts.length, 1)
    assert.deepEqual(byName.get('Cleo')!.posts, [])
    assert.ok(byName.get('Ada')!.posts[0] instanceof EwPost)
  })

  it('hasOne: with("profile") attaches the single child or null', async () => {
    const users = await EwUser.query().with('profile').orderBy('id', 'ASC').get()
    const [ada, bob] = users as unknown as Array<{ profile: EwProfile | null }>
    assert.ok(ada!.profile instanceof EwProfile)
    assert.equal((ada!.profile as EwProfile).bio, 'mathematician')
    assert.equal(bob!.profile, null)
  })

  it('belongsTo: with("author") resolves the parent', async () => {
    const posts = await EwPost.query().with('author').orderBy('id', 'ASC').get()
    const authors = (posts as unknown as Array<{ author: EwUser }>).map(p => p.author.name)
    assert.deepEqual(authors, ['Ada', 'Ada', 'Bob'])
  })

  it('belongsToMany: with("roles") walks the pivot', async () => {
    const users = await EwUser.query().with('roles').orderBy('id', 'ASC').get()
    const roleNames = (u: unknown): string[] => (u as { roles: EwRole[] }).roles.map(r => r.name).sort()
    assert.deepEqual(roleNames(users[0]), ['admin', 'editor'])
    assert.deepEqual(roleNames(users[1]), ['editor'])
    assert.deepEqual(roleNames(users[2]), [])
  })

  it('composes: whereHas filter + with() load on the same query', async () => {
    const users = await EwUser.query().whereHas('posts').with('posts').orderBy('id', 'ASC').get()
    assert.deepEqual(users.map(u => u.name), ['Ada', 'Bob'])
    assert.equal((users[0] as unknown as { posts: EwPost[] }).posts.length, 2)
  })

  it('300-parent batch: the WHERE-IN list survives at scale (placeholder handling)', async () => {
    // Seed 300 extra users (ids 1001..1300), each with exactly one post.
    const userValues: string[] = []
    const postValues: string[] = []
    for (let i = 1; i <= 300; i++) {
      userValues.push(`(${1000 + i}, 'bulk-${i}')`)
      postValues.push(`(${1000 + i}, ${1000 + i}, 'bulk post ${i}')`)
    }
    await exec(`INSERT INTO rudder_ew_users (id, name) VALUES ${userValues.join(', ')}`)
    await exec(`INSERT INTO rudder_ew_posts (id, "userId", title) VALUES ${postValues.join(', ')}`)

    const users = await EwUser.query().where('id', '>', 1000).with('posts').orderBy('id', 'ASC').get()
    assert.equal(users.length, 300)
    for (const u of users) {
      const posts = (u as unknown as { posts: EwPost[] }).posts
      assert.equal(posts.length, 1)
      assert.equal(posts[0]!.userId, u.id)
    }
  })
}

// ─── SQLite (always runs) ────────────────────────────────────────────────────

describe('eager with() — native sqlite', () => {
  let adapter: RawAdapter

  before(async () => {
    const driver = await BetterSqlite3Driver.open({ filename: ':memory:' })
    adapter = await NativeAdapter.make({ driverInstance: driver }) as RawAdapter
    await adapter.affectingStatement(`CREATE TABLE rudder_ew_users (id INTEGER PRIMARY KEY, name TEXT)`, [])
    await adapter.affectingStatement(`CREATE TABLE rudder_ew_profiles (id INTEGER PRIMARY KEY, "userId" INTEGER, bio TEXT)`, [])
    await adapter.affectingStatement(`CREATE TABLE rudder_ew_posts (id INTEGER PRIMARY KEY, "userId" INTEGER, title TEXT)`, [])
    await adapter.affectingStatement(`CREATE TABLE rudder_ew_roles (id INTEGER PRIMARY KEY, name TEXT)`, [])
    await adapter.affectingStatement(`CREATE TABLE rudder_ew_role_user ("userId" INTEGER, "roleId" INTEGER)`, [])
  })

  beforeEach(async () => {
    ModelRegistry.reset()
    ModelRegistry.set(adapter)
    for (const t of TABLES) await adapter.affectingStatement(`DELETE FROM ${t}`, [])
    await seedRows(adapter)
  })

  defineScenario({ quoted: true, raw: () => adapter })
})

// ─── Postgres (live) ─────────────────────────────────────────────────────────

if (!PG_URL) {
  test('eager with() pg live tests (skipped — set PG_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('eager with() — Postgres (live)', () => {
    let driver: PostgresDriver
    let adapter: RawAdapter

    before(async () => {
      driver = await PostgresDriver.open({ url: PG_URL })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new PgDialect() }) as RawAdapter
      for (const t of TABLES) await adapter.affectingStatement(`DROP TABLE IF EXISTS ${t}`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_ew_users (id INT PRIMARY KEY, name TEXT)`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_ew_profiles (id INT PRIMARY KEY, "userId" INT, bio TEXT)`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_ew_posts (id INT PRIMARY KEY, "userId" INT, title TEXT)`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_ew_roles (id INT PRIMARY KEY, name TEXT)`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_ew_role_user ("userId" INT, "roleId" INT)`, [])
    })

    after(async () => {
      for (const t of TABLES) await adapter.affectingStatement(`DROP TABLE IF EXISTS ${t}`, []).catch(() => {})
      await driver.close()
    })

    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      for (const t of TABLES) await adapter.affectingStatement(`DELETE FROM ${t}`, [])
      await seedRows(adapter)
    })

    defineScenario({ quoted: true, raw: () => adapter })
  })
}

// ─── MySQL (live) ────────────────────────────────────────────────────────────

if (!MYSQL_URL) {
  test('eager with() mysql live tests (skipped — set MYSQL_TEST_URL to run)', { skip: true }, () => {})
} else {
  describe('eager with() — MySQL (live)', () => {
    let driver: MysqlDriver
    let adapter: RawAdapter

    before(async () => {
      driver = await MysqlDriver.open({ url: MYSQL_URL })
      adapter = await NativeAdapter.make({ driverInstance: driver, dialect: new MysqlDialect() }) as RawAdapter
      for (const t of TABLES) await adapter.affectingStatement(`DROP TABLE IF EXISTS ${t}`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_ew_users (id INT PRIMARY KEY, name TEXT)`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_ew_profiles (id INT PRIMARY KEY, userId INT, bio TEXT)`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_ew_posts (id INT PRIMARY KEY, userId INT, title TEXT)`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_ew_roles (id INT PRIMARY KEY, name TEXT)`, [])
      await adapter.affectingStatement(`CREATE TABLE rudder_ew_role_user (userId INT, roleId INT)`, [])
    })

    after(async () => {
      for (const t of TABLES) await adapter.affectingStatement(`DROP TABLE IF EXISTS ${t}`, []).catch(() => {})
      await driver.close()
    })

    beforeEach(async () => {
      ModelRegistry.reset()
      ModelRegistry.set(adapter)
      for (const t of TABLES) await adapter.affectingStatement(`DELETE FROM ${t}`, [])
      await seedRows(adapter, false)
    })

    defineScenario({ quoted: false, raw: () => adapter })
  })
}
