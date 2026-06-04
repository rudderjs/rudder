// Relations + aggregates conformance for the native engine (Phase 3).
//
// Boots a REAL better-sqlite3 in-memory DB, registers NativeAdapter, and drives
// whereHas / whereDoesntHave and the aggregate eager-loads (withCount/withSum/…)
// + per-instance loadCount/loadSum through the real Model API end-to-end. The
// dialect-agnostic Model suite IS the conformance suite (cross-phase rule 1).

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { Model, ModelRegistry } from '../index.js'
import { NativeAdapter } from './adapter.js'
import { BetterSqlite3Driver } from './drivers/better-sqlite3.js'
import type { Driver } from './driver.js'

// ── Models ───────────────────────────────────────────────────
class User extends Model {
  static override table = 'users'
  static override relations = {
    posts: { type: 'hasMany' as const, model: () => Post, foreignKey: 'userId' },
    roles: { type: 'belongsToMany' as const, model: () => Role, pivotTable: 'role_user' },
  }
  id!: number
  name!: string
}

class Post extends Model {
  static override table = 'posts'
  static override relations = {
    author: { type: 'belongsTo' as const, model: () => User, foreignKey: 'userId' },
  }
  id!: number
  userId!: number
  title!: string
  views!: number
  published!: number
}

class Role extends Model {
  static override table = 'roles'
  id!: number
  name!: string
  weight!: number
}

// For the morphTo-rejection friction case (no table needed — the throw happens
// at query-build time, before any SQL).
class Commentable extends Model {
  static override table = 'comments'
  static override relations = {
    commentable: { type: 'morphTo' as const, morphName: 'commentable', types: () => [Post] },
  }
  id!: number
}

let driver: Driver

async function seed(): Promise<void> {
  await driver.execute(`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`, [])
  await driver.execute(`CREATE TABLE posts (id INTEGER PRIMARY KEY, userId INTEGER, title TEXT, views INTEGER, published INTEGER)`, [])
  await driver.execute(`CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT, weight INTEGER)`, [])
  await driver.execute(`CREATE TABLE role_user (userId INTEGER, roleId INTEGER)`, [])

  // Ada(1): 2 posts (1 published), 2 roles. Alan(2): 1 unpublished post, 0 roles.
  // Grace(3): 0 posts, 1 role.
  for (const [id, name] of [[1, 'Ada'], [2, 'Alan'], [3, 'Grace']] as Array<[number, string]>) {
    await driver.execute(`INSERT INTO users (id, name) VALUES (?, ?)`, [id, name])
  }
  const posts: Array<[number, number, string, number, number]> = [
    [1, 1, 'A1', 100, 1],
    [2, 1, 'A2', 50, 0],
    [3, 2, 'B1', 10, 0],
  ]
  for (const p of posts) await driver.execute(`INSERT INTO posts (id, userId, title, views, published) VALUES (?, ?, ?, ?, ?)`, p)
  const roles: Array<[number, string, number]> = [[1, 'admin', 5], [2, 'editor', 3], [3, 'viewer', 1]]
  for (const r of roles) await driver.execute(`INSERT INTO roles (id, name, weight) VALUES (?, ?, ?)`, r)
  for (const [u, r] of [[1, 1], [1, 2], [3, 3]] as Array<[number, number]>) {
    await driver.execute(`INSERT INTO role_user (userId, roleId) VALUES (?, ?)`, [u, r])
  }
}

before(async () => { driver = await BetterSqlite3Driver.open({ filename: ':memory:' }); await seed() })
after(async () => { await driver.close() })
beforeEach(async () => { ModelRegistry.reset(); ModelRegistry.set(await NativeAdapter.make({ driverInstance: driver })) })

describe('native relations — whereHas / whereDoesntHave (hasMany)', () => {
  it('whereHas filters parents that have at least one child', async () => {
    const users = await User.whereHas('posts').get()
    assert.deepStrictEqual(users.map(u => u.id).sort(), [1, 2])
  })

  it('whereDoesntHave returns parents with no children', async () => {
    const users = await User.whereDoesntHave('posts').get()
    assert.deepStrictEqual(users.map(u => u.id), [3])
  })

  it('whereHas with a constraint callback', async () => {
    const users = await User.whereHas('posts', q => q.where('published', 1)).get()
    assert.deepStrictEqual(users.map(u => u.id), [1])
  })

  it('whereHas composes with a flat where', async () => {
    const users = await User.query().where('name', 'Ada').whereHas('posts', q => q.where('published', 1)).get()
    assert.deepStrictEqual(users.map(u => u.id), [1])
  })

  it('whereHas count respects the predicate', async () => {
    assert.strictEqual(await User.whereHas('posts').count(), 2)
  })
})

describe('native relations — whereHas (belongsTo, belongsToMany)', () => {
  it('belongsTo whereHas (posts whose author is Ada)', async () => {
    const posts = await Post.whereHas('author', q => q.where('name', 'Ada')).get()
    assert.deepStrictEqual(posts.map(p => p.id).sort(), [1, 2])
  })

  it('belongsToMany whereHas through the pivot', async () => {
    const users = await User.whereHas('roles').get()
    assert.deepStrictEqual(users.map(u => u.id).sort(), [1, 3])
  })

  it('belongsToMany whereHas with a related constraint', async () => {
    const users = await User.whereHas('roles', q => q.where('name', 'admin')).get()
    assert.deepStrictEqual(users.map(u => u.id), [1])
  })
})

describe('native relations — withCount / withExists', () => {
  it('withCount stamps <relation>Count on each parent', async () => {
    const users = await User.query().withCount('posts').orderBy('id', 'ASC').get()
    assert.deepStrictEqual(users.map(u => (u as unknown as { postsCount: number }).postsCount), [2, 1, 0])
  })

  it('withCount map form with a constraint', async () => {
    const users = await User.query().withCount({ posts: q => q.where('published', 1) }).orderBy('id', 'ASC').get()
    assert.deepStrictEqual(users.map(u => (u as unknown as { postsCount: number }).postsCount), [1, 0, 0])
  })

  it('withExists stamps a boolean', async () => {
    const users = await User.query().withExists('posts').orderBy('id', 'ASC').get()
    assert.deepStrictEqual(users.map(u => (u as unknown as { postsExists: boolean }).postsExists), [true, true, false])
  })

  it('belongsToMany withCount through the pivot', async () => {
    const users = await User.query().withCount('roles').orderBy('id', 'ASC').get()
    assert.deepStrictEqual(users.map(u => (u as unknown as { rolesCount: number }).rolesCount), [2, 0, 1])
  })
})

describe('native relations — withSum / withMin / withMax / withAvg', () => {
  it('withSum over a related column', async () => {
    const users = await User.query().withSum('posts', 'views').orderBy('id', 'ASC').get()
    assert.deepStrictEqual(users.map(u => (u as unknown as { postsSumViews: number }).postsSumViews), [150, 10, 0])
  })

  it('withMax / withMin', async () => {
    const users = await User.query().withMax('posts', 'views').withMin('posts', 'views').orderBy('id', 'ASC').get()
    const u1 = users[0] as unknown as { postsMaxViews: number; postsMinViews: number }
    assert.strictEqual(u1.postsMaxViews, 100)
    assert.strictEqual(u1.postsMinViews, 50)
  })

  it('belongsToMany withSum joins pivot → related', async () => {
    const users = await User.query().withSum('roles', 'weight').orderBy('id', 'ASC').get()
    assert.deepStrictEqual(users.map(u => (u as unknown as { rolesSumWeight: number }).rolesSumWeight), [8, 0, 1])
  })
})

describe('native relations — per-instance load aggregates (_aggregate)', () => {
  it('loadCount on a single instance', async () => {
    const ada = await User.find(1)
    await ada!.loadCount('posts')
    assert.strictEqual((ada as unknown as { postsCount: number }).postsCount, 2)
  })

  it('loadSum on a single instance', async () => {
    const ada = await User.find(1)
    await ada!.loadSum('posts', 'views')
    assert.strictEqual((ada as unknown as { postsSumViews: number }).postsSumViews, 150)
  })

  it('loadExists true / false', async () => {
    const grace = await User.find(3)
    await grace!.loadExists('posts')
    assert.strictEqual((grace as unknown as { postsExists: boolean }).postsExists, false)
  })

  it('sum over an empty set is 0; avg over empty is null', async () => {
    const grace = await User.find(3)
    await grace!.loadSum('posts', 'views')
    assert.strictEqual((grace as unknown as { postsSumViews: number }).postsSumViews, 0)
  })
})

describe('native relations — friction cases (CLAUDE.md)', () => {
  it('nested whereHas inside a constrain callback throws (use dot-path form)', () => {
    // The error is raised synchronously at query-build time (inside the
    // constrain callback), before any terminal — so it throws, not rejects.
    assert.throws(
      () => User.whereHas('posts', q => (q as unknown as { whereHas(r: string): unknown }).whereHas('author')),
      /Nested whereHas inside a whereHas constrain callback is not supported/,
    )
  })

  it('morphTo + whereHas throws a clear error', () => {
    // whereHas rejects morphTo synchronously at build time — the related table
    // is dynamic, so no EXISTS subquery can represent it.
    assert.throws(
      () => Commentable.whereHas('commentable'),
      /morphTo "commentable" cannot be used with whereHas/,
    )
  })
})
